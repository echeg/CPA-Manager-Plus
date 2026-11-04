import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAliasServiceBase, useApiKeyAliases } from './useApiKeyAliases';
import type { PanelFeatureAvailability } from './usePanelFeatureAvailability';

const mocks = vi.hoisted(() => ({
  getApiKeyAliases: vi.fn(),
  featureAvailability: {} as Record<string, unknown>,
  revision: 0,
  listeners: new Set<() => void>(),
}));

vi.mock('@/hooks/usePanelFeatureAvailability', () => ({
  usePanelFeatureAvailability: () => mocks.featureAvailability,
}));

vi.mock('@/services/api/usageService', () => ({
  usageServiceApi: { getApiKeyAliases: mocks.getApiKeyAliases },
}));

vi.mock('@/stores', () => ({
  useAuthStore: (selector: (state: { managementKey: string }) => unknown) =>
    selector({ managementKey: 'management-key' }),
}));

vi.mock('@/features/personal-quota-support/services/api/client', () => ({
  apiClient: { getConnectionRevision: () => mocks.revision },
  onQuotaConnectionChange: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
}));

type HookResult = ReturnType<typeof useApiKeyAliases>;

const managerHosted = () => ({
  checking: false,
  panelHostConfirmed: true,
  panelHostMode: 'manager_embedded',
  managerServiceAvailable: true,
  managerServiceBase: 'http://manager.local',
});

let latest: HookResult | null = null;
let renderer: ReactTestRenderer | null = null;

function Probe({ onRender }: { onRender: (result: HookResult) => void }) {
  onRender(useApiKeyAliases());
  return null;
}

const current = () => {
  if (!latest) throw new Error('hook not rendered');
  return latest;
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const mount = async () => {
  await act(async () => {
    renderer = create(
      <Probe
        onRender={(result) => {
          latest = result;
        }}
      />
    );
  });
  await flush();
};

const changeConnection = () => {
  act(() => {
    mocks.revision += 1;
    mocks.listeners.forEach((listener) => listener());
  });
};

describe('useApiKeyAliases', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.featureAvailability = managerHosted();
    mocks.revision = 0;
    mocks.listeners.clear();
    mocks.getApiKeyAliases.mockReset();
    latest = null;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  it('loads aliases with lowercased hashes when hosted by the manager', async () => {
    mocks.getApiKeyAliases.mockResolvedValue({
      items: [{ apiKeyHash: ' ABCDEF ', alias: 'Laptop' }],
    });

    await mount();

    expect(mocks.getApiKeyAliases).toHaveBeenCalledWith('http://manager.local', 'management-key');
    expect(current().available).toBe(true);
    expect(current().loading).toBe(false);
    expect(current().aliases).toEqual([{ apiKeyHash: 'abcdef', alias: 'Laptop' }]);
  });

  it('does not call the service and reports unavailable on a non-manager host', async () => {
    mocks.featureAvailability = { ...managerHosted(), panelHostMode: 'external_panel' };

    await mount();

    expect(mocks.getApiKeyAliases).not.toHaveBeenCalled();
    expect(current().available).toBe(false);
    expect(current().aliases).toEqual([]);
    expect(current().loading).toBe(false);
  });

  it('reports unavailable while the panel host is still being checked', async () => {
    mocks.featureAvailability = { ...managerHosted(), checking: true };

    await mount();

    expect(mocks.getApiKeyAliases).not.toHaveBeenCalled();
    expect(current().available).toBe(false);
  });

  it('reports unavailable without throwing when the service fails', async () => {
    mocks.getApiKeyAliases.mockRejectedValue(new Error('offline'));

    await mount();

    expect(current().available).toBe(false);
    expect(current().aliases).toEqual([]);
    expect(current().loading).toBe(false);
  });

  it('ignores a result that arrives after the connection changed', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    mocks.getApiKeyAliases
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ items: [{ apiKeyHash: 'NEW', alias: 'New host' }] });

    await mount();
    changeConnection();
    await flush();
    expect(current().aliases).toEqual([{ apiKeyHash: 'new', alias: 'New host' }]);

    await act(async () => {
      resolveFirst({ items: [{ apiKeyHash: 'OLD', alias: 'Old host' }] });
    });
    await flush();

    expect(mocks.getApiKeyAliases).toHaveBeenCalledTimes(2);
    expect(current().aliases).toEqual([{ apiKeyHash: 'new', alias: 'New host' }]);
  });

  it('reloads on demand and applies local replace and remove updates', async () => {
    mocks.getApiKeyAliases
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ apiKeyHash: 'AA', alias: 'One' }] });

    await mount();
    expect(current().aliases).toEqual([]);

    act(() => current().reload());
    await flush();
    expect(mocks.getApiKeyAliases).toHaveBeenCalledTimes(2);
    expect(current().aliases).toEqual([{ apiKeyHash: 'aa', alias: 'One' }]);

    act(() =>
      current().replaceAliases([
        { apiKeyHash: 'AA', alias: 'One' },
        { apiKeyHash: 'BB', alias: 'Two' },
      ])
    );
    act(() => current().removeAlias('AA'));
    expect(current().available).toBe(true);
    expect(current().aliases).toEqual([{ apiKeyHash: 'bb', alias: 'Two' }]);
  });
});

describe('resolveAliasServiceBase', () => {
  it('returns the manager base only for a confirmed manager-hosted panel', () => {
    const base = managerHosted() as unknown as PanelFeatureAvailability;
    expect(resolveAliasServiceBase(base)).toBe('http://manager.local');
    expect(resolveAliasServiceBase({ ...base, panelHostConfirmed: false })).toBe('');
    expect(resolveAliasServiceBase({ ...base, managerServiceAvailable: false })).toBe('');
  });
});
