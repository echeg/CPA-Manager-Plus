import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { authFilesApi } from '@/features/personal-quota-support/services/api/authFiles';
import { subscriptionRoutingApi } from '@/features/personal-quota-support/services/api/subscriptionRouting';
import {
  useAuthStore,
  useConfigStore,
  useQuotaStore,
} from '@/features/personal-quota-support/stores';
import { QuotaPage } from './QuotaPage';
import { QuotaCompactCardItem } from './components/QuotaCompactCardItem';
import { QuotaHeader } from './components/QuotaHeader';
import { QuotaSettingsBar } from './components/QuotaSettingsToolbar';
import { QUOTA_ADAPTERS } from './providers';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/services/storage/secureStorage', () => ({
  obfuscatedStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
}));

// Page tests focus on requests and session ownership rather than browser animation APIs.
vi.mock('./hooks/motion', async () => {
  const { useRef } = await import('react');
  return { useRevealGroup: () => useRef(null), useCountUp: (value: number) => value };
});

const initialAuth = useAuthStore.getState();
const initialConfig = useConfigStore.getState();
const file = { name: 'account-a.json', type: 'codex', authIndex: 'account-a' };
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  useAuthStore.setState({
    connectionStatus: 'connected',
    apiBase: 'https://cpa-a.example',
    isAuthenticated: true,
  });
  useQuotaStore.getState().clearQuotaCache();
  useConfigStore.setState({ fetchConfig: vi.fn(async () => ({ codexFastMode: false })) });
  vi.spyOn(subscriptionRoutingApi, 'activity').mockResolvedValue([]);
  vi.spyOn(QUOTA_ADAPTERS.codex, 'fetchQuota').mockResolvedValue({ windows: [] });
});

afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  vi.restoreAllMocks();
  useAuthStore.setState(initialAuth, true);
  useConfigStore.setState(initialConfig, true);
  useQuotaStore.getState().clearQuotaCache();
});

async function mountPage() {
  await act(async () => {
    renderer = create(createElement(MemoryRouter, null, createElement(QuotaPage)));
  });
}

describe('personal quota page lifecycle', () => {
  test('refreshes credential quotas on entry and records completion', async () => {
    const list = vi.spyOn(authFilesApi, 'list').mockResolvedValue({ files: [file] });
    await mountPage();
    expect(list).toHaveBeenCalledTimes(1);
    expect(QUOTA_ADAPTERS.codex.fetchQuota).toHaveBeenCalledWith(file, expect.any(Function));
    expect(renderer!.root.findAllByType(QuotaCompactCardItem)).toHaveLength(1);
    expect(useQuotaStore.getState().lastRefreshAt).toEqual(expect.any(Number));
  });

  test('does not keep the previous connection cards when the new credential list fails', async () => {
    const list = vi.spyOn(authFilesApi, 'list').mockResolvedValue({ files: [file] });
    await mountPage();
    expect(renderer!.root.findAllByType(QuotaCompactCardItem)).toHaveLength(1);

    list.mockRejectedValue(new Error('Connection B is unavailable'));
    await act(async () => {
      useAuthStore.setState({ apiBase: 'https://cpa-b.example' });
    });
    expect(renderer!.root.findAllByType(QuotaCompactCardItem)).toHaveLength(0);
    expect(renderer!.root.findByType(QuotaHeader).props.totalCount).toBe(0);
    expect(renderer!.root.findByType(QuotaSettingsBar).props.files).toEqual([]);
    expect(useQuotaStore.getState().lastRefreshAt).toBeNull();
  });

  test('disables mutations and offers Accounts when the connected backend lacks v8', async () => {
    vi.spyOn(authFilesApi, 'list').mockRejectedValue(
      Object.assign(new Error('v8 required'), { apiCode: 'quota_v8_required' })
    );
    await mountPage();
    expect(renderer!.root.findByType(QuotaSettingsBar).props.disabled).toBe(true);
    expect(renderer!.root.findAllByType(QuotaCompactCardItem)).toHaveLength(0);
    expect(renderer!.root.findAllByType('a').some((link) => link.props.href === '/accounts')).toBe(
      true
    );
    expect(renderer!.root.findByType(QuotaHeader).props.disableControls).toBe(false);
  });
});
