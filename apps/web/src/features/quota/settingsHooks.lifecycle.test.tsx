import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import { configApi } from '@/features/personal-quota-support/services/api/config';
import {
  subscriptionRoutingApi,
  type SubscriptionActivity,
} from '@/features/personal-quota-support/services/api/subscriptionRouting';
import { useConfigStore } from '@/features/personal-quota-support/stores/useConfigStore';
import type { Config } from '@/features/personal-quota-support/types';
import { useCodexFastMode, type CodexFastModeState } from './hooks/useCodexFastMode';
import {
  useSubscriptionRouting,
  type SubscriptionRoutingState,
} from './hooks/useSubscriptionRouting';
import { useSubscriptionActivity } from './hooks/useSubscriptionActivity';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const initialConfigState = useConfigStore.getState();
let renderer: ReactTestRenderer | undefined;
let revision = 0;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount(useHook: () => void) {
  function Harness() {
    useHook();
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Harness));
  });
}

beforeEach(() => {
  revision = 0;
  vi.spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
  useConfigStore.setState(initialConfigState, true);
});

afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
  useConfigStore.setState(initialConfigState, true);
});

describe('personal quota settings session lifecycle', () => {
  test('does not apply an initial fast-mode response from a previous connection', async () => {
    const response = deferred<Config>();
    useConfigStore.setState({ fetchConfig: vi.fn(() => response.promise) });
    let state!: CodexFastModeState;
    await mount(() => {
      state = useCodexFastMode(false);
    });
    expect(state.enabled).toBeNull();

    revision += 1;
    await act(async () => {
      response.resolve({ codexFastMode: true });
    });
    expect(state.enabled).toBeNull();
    expect(state.error).toBe('');
  });

  test('applies fast mode immediately and reconciles it with the server result', async () => {
    const fetchConfig = vi
      .fn<() => Promise<Config>>()
      .mockResolvedValueOnce({ codexFastMode: false })
      .mockResolvedValueOnce({ codexFastMode: true });
    const write = vi.spyOn(configApi, 'updateCodexFastMode').mockResolvedValue(undefined);
    useConfigStore.setState({ fetchConfig });
    let state!: CodexFastModeState;
    await mount(() => {
      state = useCodexFastMode(false);
    });
    expect(state.enabled).toBe(false);

    await act(async () => {
      await state.toggle(true);
    });
    expect(write).toHaveBeenCalledExactlyOnceWith(true);
    expect(fetchConfig).toHaveBeenLastCalledWith(true);
    expect(state.enabled).toBe(true);
    expect(state.saving).toBe(false);
  });

  test('does not reload another connection after a pending fast-mode write completes', async () => {
    const written = deferred<unknown>();
    const fetchConfig = vi.fn(async () => ({ codexFastMode: false }));
    vi.spyOn(configApi, 'updateCodexFastMode').mockReturnValue(written.promise);
    useConfigStore.setState({ fetchConfig });
    let state!: CodexFastModeState;
    await mount(() => {
      state = useCodexFastMode(false);
    });
    let save!: Promise<void>;
    await act(async () => {
      save = state.toggle(true);
    });
    revision += 1;
    await act(async () => {
      written.resolve(undefined);
      await save;
    });
    expect(fetchConfig).toHaveBeenCalledTimes(1);
    expect(state.enabled).toBe(false);
  });

  test('requires explicit routing save, preserves the baseline and reloads after writing', async () => {
    const initial: Config = { routingStrategy: 'round-robin', routingSessionAffinityTTL: '1h' };
    const next: Config = { ...initial, routingStrategy: 'earliest-reset' };
    const fetchConfig = vi
      .fn<() => Promise<Config>>()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(next);
    const write = vi.spyOn(subscriptionRoutingApi, 'update').mockResolvedValue(undefined);
    const clearCache = vi.fn();
    useConfigStore.setState({ fetchConfig, clearCache });
    let state!: SubscriptionRoutingState;
    await mount(() => {
      state = useSubscriptionRouting(false);
    });
    await act(async () => {
      state.change({ strategy: 'earliest-reset' });
    });
    expect(write).not.toHaveBeenCalled();
    expect(state.dirty).toBe(true);

    await act(async () => {
      await state.save();
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'round-robin' }),
      expect.objectContaining({ strategy: 'earliest-reset' })
    );
    expect(clearCache).toHaveBeenCalledWith('routing/strategy');
    expect(fetchConfig).toHaveBeenLastCalledWith(true);
    expect(state.saved).toBe(true);
    expect(state.dirty).toBe(false);
  });

  test('invalid routing TTLs never reach the API', async () => {
    const write = vi.spyOn(subscriptionRoutingApi, 'update').mockResolvedValue(undefined);
    useConfigStore.setState({
      fetchConfig: vi.fn(async () => ({ routingSessionAffinityTTL: '1h' })),
    });
    let state!: SubscriptionRoutingState;
    await mount(() => {
      state = useSubscriptionRouting(false);
    });
    await act(async () => {
      state.change({ sessionAffinityTTL: '0s' });
    });
    await act(async () => {
      await state.save();
    });
    expect(state.invalidTTL).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  test('polls activity after completed reads and cancels the timer on unmount', async () => {
    vi.useFakeTimers();
    const activity = [
      { authIndex: 'account-a', provider: 'codex', lastSelectedAt: '2026-10-14T00:00:00Z' },
    ];
    const read = vi.spyOn(subscriptionRoutingApi, 'activity').mockResolvedValue(activity);
    let state!: ReturnType<typeof useSubscriptionActivity>;
    await mount(() => {
      state = useSubscriptionActivity(false);
    });
    expect(state.activityState).toBe('ready');
    expect(state.activity).toEqual(activity);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => {
      renderer?.unmount();
    });
    renderer = undefined;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('discards pending activity and stops polling after a connection changes', async () => {
    vi.useFakeTimers();
    const response = deferred<SubscriptionActivity[]>();
    const read = vi.spyOn(subscriptionRoutingApi, 'activity').mockReturnValue(response.promise);
    let state!: ReturnType<typeof useSubscriptionActivity>;
    await mount(() => {
      state = useSubscriptionActivity(false);
    });
    revision += 1;
    await act(async () => {
      response.resolve([
        { authIndex: 'old', provider: 'codex', lastSelectedAt: '2026-10-14T00:00:00Z' },
      ]);
    });
    expect(state.activity).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
