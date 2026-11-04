import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import {
  InvalidRoutingConfigError,
  UnknownApiKeyError,
  routingProfilesApi,
  unsupportedRoutingProfiles,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { useConfigStore } from '@/features/personal-quota-support/stores/useConfigStore';
import type { Config } from '@/features/personal-quota-support/types';
import type { ApiKeyAlias } from '@/services/api/usageService';
import { sha256Hex } from '@/utils/apiKeyHash';
import { useKeyProfiles, type KeyProfilesState } from './hooks/useKeyProfiles';

const aliasState = vi.hoisted(() => ({
  aliases: [] as ApiKeyAlias[],
  available: true,
}));
vi.mock('@/hooks/useApiKeyAliases', () => ({
  useApiKeyAliases: () => ({
    aliases: aliasState.aliases,
    available: aliasState.available,
    loading: false,
    reload: () => undefined,
    replaceAliases: () => undefined,
    removeAlias: () => undefined,
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const KEY_A = 'sk-alpha-0123456789abcdef';
const KEY_B = 'sk-bravo-fedcba9876543210';
const initialConfigState = useConfigStore.getState();
let renderer: ReactTestRenderer | undefined;
let revision = 0;
let hook!: KeyProfilesState;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const sharedProfile = (): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: {},
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  claudeFallback: { enabled: true, mode: 'auto', mappings: [] },
});
const ownProfile = (): RoutingProfile => ({
  sessionAffinity: false,
  preferredAccounts: { claude: 'claude-1' },
  selection: { primary: 'priority', tiebreak: 'fill-first' },
  claudeFallback: { enabled: false, mode: 'auto', mappings: [] },
});
const profilesState = (keys: RoutingProfilesState['keys'] = []): RoutingProfilesState => ({
  supported: true,
  unsupportedBackend: false,
  shared: sharedProfile(),
  keys,
  selectionOptions: {
    narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
    pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
  },
});
const config = (keys: string[] = [KEY_A, KEY_B]): Config => ({
  raw: { access: { 'api-keys': keys } },
  codexFastMode: false,
});

const capture = (value: KeyProfilesState) => {
  hook = value;
};

async function mount(disabled = false) {
  function Harness() {
    capture(useKeyProfiles(disabled));
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Harness));
  });
}

const unknownKeyMessage = 'This key was removed on the Config page. The key list was reloaded.';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  revision = 0;
  aliasState.aliases = [];
  aliasState.available = true;
  vi.spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
  useConfigStore.setState(initialConfigState, true);
  useConfigStore.setState({ fetchConfig: vi.fn(async () => config()) });
  vi.spyOn(routingProfilesApi, 'get').mockResolvedValue(
    profilesState([{ key: KEY_B, profile: ownProfile() }])
  );
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  useConfigStore.setState(initialConfigState, true);
});

describe('useKeyProfiles', () => {
  test('loads every client key with its profile and the N/M counts', async () => {
    aliasState.aliases = [{ apiKeyHash: sha256Hex(KEY_A).toLowerCase(), alias: 'Laptop' }];
    await mount();
    expect(hook.loading).toBe(false);
    expect(hook.error).toBe('');
    expect(hook.state?.supported).toBe(true);
    expect(hook.count).toBe(1);
    expect(hook.total).toBe(2);
    expect(hook.rows.map((row) => [row.key, row.profile !== null, row.hasAlias])).toEqual([
      [KEY_A, false, true],
      [KEY_B, true, false],
    ]);
    expect(hook.rows[0].label).toBe('Laptop');
    expect(hook.rows[1].label).toBe(hook.rows[1].masked);
    expect(hook.rows[1].label).not.toContain(KEY_B);
    // The first load shares the toolbar's cached config.
    expect(useConfigStore.getState().fetchConfig).toHaveBeenCalledExactlyOnceWith(false);
  });

  test('does not load while disabled', async () => {
    await mount(true);
    expect(routingProfilesApi.get).not.toHaveBeenCalled();
    expect(hook.state).toBeNull();
    expect(hook.rows).toEqual([]);
  });

  test('a key save replaces the state with the read-back result', async () => {
    const saved = profilesState([
      { key: KEY_A, profile: ownProfile() },
      { key: KEY_B, profile: ownProfile() },
    ]);
    const save = vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockResolvedValue(saved);
    const clearCache = vi.fn();
    useConfigStore.setState({ clearCache });
    await mount();
    let result = false;
    await act(async () => {
      result = await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(result).toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      KEY_A,
      ownProfile(),
      profilesState().selectionOptions
    );
    expect(hook.state).toBe(saved);
    expect(hook.count).toBe(2);
    expect(hook.saving).toBe(false);
    expect(clearCache).toHaveBeenCalled();
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(1);
  });

  test('a reset to the shared settings sends null', async () => {
    const save = vi
      .spyOn(routingProfilesApi, 'saveKeyProfile')
      .mockResolvedValue(profilesState([]));
    await mount();
    await act(async () => {
      await hook.saveKeyProfile(KEY_B, null);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(KEY_B, null, profilesState().selectionOptions);
    expect(hook.count).toBe(0);
    expect(hook.rows[1].profile).toBeNull();
  });

  test('ignores a second save while one is in flight', async () => {
    const pending = deferred<RoutingProfilesState>();
    const save = vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockReturnValue(pending.promise);
    await mount();
    let first!: Promise<boolean>;
    let second = true;
    await act(async () => {
      first = hook.saveKeyProfile(KEY_A, ownProfile());
      second = await hook.saveKeyProfile(KEY_B, null);
    });
    expect(second).toBe(false);
    expect(hook.saving).toBe(true);
    await act(async () => {
      pending.resolve(profilesState());
      await first;
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(hook.saving).toBe(false);
  });
});

describe('useKeyProfiles errors', () => {
  test('a backend without /routing/profiles is unsupported and does not save', async () => {
    vi.mocked(routingProfilesApi.get).mockResolvedValue(unsupportedRoutingProfiles());
    const save = vi.spyOn(routingProfilesApi, 'saveKeyProfile');
    await mount();
    expect(hook.state).toMatchObject({ supported: false, unsupportedBackend: true });
    expect(hook.error).toBe('');
    expect(hook.count).toBe(0);
    expect(hook.total).toBe(2);
    let result = true;
    await act(async () => {
      result = await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(result).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  test('keys stay masked when aliases are unavailable', async () => {
    aliasState.available = false;
    aliasState.aliases = [{ apiKeyHash: sha256Hex(KEY_A).toLowerCase(), alias: 'Laptop' }];
    await mount();
    expect(hook.rows.every((row) => !row.hasAlias && row.label === row.masked)).toBe(true);
    expect(JSON.stringify(hook.rows.map(({ label, masked }) => [label, masked]))).not.toMatch(
      /sk-alpha-0123456789abcdef|sk-bravo-fedcba9876543210/
    );
  });

  test('a load failure sets the error', async () => {
    vi.mocked(routingProfilesApi.get).mockRejectedValue(new Error('offline'));
    await mount();
    expect(hook.loading).toBe(false);
    expect(hook.state).toBeNull();
    expect(hook.error).toBe('offline');
  });

  test('a reload keeps the last loaded state while it runs and after it fails', async () => {
    await mount();
    const loaded = hook.state;
    const pending = deferred<RoutingProfilesState>();
    vi.mocked(routingProfilesApi.get).mockReturnValueOnce(pending.promise);
    await act(async () => hook.reload());
    expect(hook.loading).toBe(true);
    expect(hook.state).toBe(loaded);
    expect([hook.count, hook.total]).toEqual([1, 2]);
    await act(async () => pending.reject(new Error('offline')));
    expect(hook.loading).toBe(false);
    expect(hook.error).toBe('offline');
    expect(hook.state).toBe(loaded);
    expect([hook.count, hook.total]).toEqual([1, 2]);
  });

  test('a connection change drops the previous connection state', async () => {
    await mount();
    expect(hook.state).not.toBeNull();
    vi.mocked(routingProfilesApi.get).mockRejectedValue(new Error('offline'));
    revision += 1;
    await act(async () => hook.reload());
    expect(hook.state).toBeNull();
    expect([hook.count, hook.total]).toEqual([0, 0]);
    expect(hook.error).toBe('offline');
  });

  test('a 400 for a removed key reloads the list and keeps its message', async () => {
    vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockRejectedValue(new UnknownApiKeyError());
    const fetchConfig = vi
      .fn<(force?: boolean) => Promise<Config>>()
      .mockResolvedValue(config([KEY_B]))
      .mockResolvedValueOnce(config());
    useConfigStore.setState({ fetchConfig });
    await mount();
    let result = true;
    await act(async () => {
      result = await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(result).toBe(false);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
    expect(fetchConfig).toHaveBeenLastCalledWith(true);
    expect(hook.error).toBe(unknownKeyMessage);
    expect(hook.total).toBe(1);
    expect(hook.rows.map((row) => row.key)).toEqual([KEY_B]);
    // An explicit reload, such as reopening the modal, clears the message.
    await act(async () => hook.reload());
    expect(hook.error).toBe('');
  });

  test('a 422 shows the backend message and keeps the loaded state', async () => {
    const message = 'routing.key-profiles.ab12cd34ef56.selection.primary: unknown slot';
    vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockRejectedValue(
      new InvalidRoutingConfigError(message)
    );
    await mount();
    const loaded = hook.state;
    await act(async () => {
      await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(hook.error).toBe(message);
    expect(hook.state).toBe(loaded);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(1);
  });

  test('a failed read-back reloads the stored state', async () => {
    vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockRejectedValue(
      new Error('CPA did not retain the routing profile')
    );
    await mount();
    await act(async () => {
      await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(hook.error).toBe('CPA did not retain the routing profile');
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
  });

  test('a connection change discards a stale load and loads again', async () => {
    const stale = deferred<RoutingProfilesState>();
    const fresh = profilesState([]);
    vi.mocked(routingProfilesApi.get).mockResolvedValue(fresh).mockReturnValueOnce(stale.promise);
    await mount();
    expect(hook.loading).toBe(true);
    revision += 1;
    await act(async () => {
      stale.resolve(profilesState([{ key: KEY_A, profile: ownProfile() }]));
    });
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
    expect(hook.state).toBe(fresh);
    expect(hook.count).toBe(0);
    expect(hook.error).toBe('');
  });

  test('a connection change discards a stale load error', async () => {
    const stale = deferred<RoutingProfilesState>();
    const fresh = profilesState([]);
    vi.mocked(routingProfilesApi.get).mockResolvedValue(fresh).mockReturnValueOnce(stale.promise);
    await mount();
    revision += 1;
    await act(async () => {
      stale.reject(new Error('old connection failed'));
    });
    expect(hook.state).toBe(fresh);
    expect(hook.error).toBe('');
  });

  test('a connection change discards a stale save result and error', async () => {
    const pending = deferred<RoutingProfilesState>();
    vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockReturnValue(pending.promise);
    const clearCache = vi.fn();
    useConfigStore.setState({ clearCache });
    await mount();
    let result!: Promise<boolean>;
    await act(async () => {
      result = hook.saveKeyProfile(KEY_A, ownProfile());
    });
    revision += 1;
    const stale = profilesState([
      { key: KEY_A, profile: ownProfile() },
      { key: KEY_B, profile: ownProfile() },
    ]);
    await act(async () => {
      pending.resolve(stale);
    });
    await expect(result).resolves.toBe(false);
    expect(hook.state).not.toBe(stale);
    expect(hook.count).toBe(1);
    expect(clearCache).not.toHaveBeenCalled();
    expect(hook.error).toBe('');
    expect(hook.saving).toBe(false);
  });
});
