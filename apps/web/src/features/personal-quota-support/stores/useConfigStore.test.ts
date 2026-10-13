import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  revision: 0,
  onConnectionChange: undefined as (() => void) | undefined,
}));
vi.mock('../services/api/client', () => ({
  apiClient: { getConnectionRevision: () => mocks.revision },
  onQuotaConnectionChange: (listener: () => void) => {
    mocks.onConnectionChange = listener;
  },
}));
vi.mock('../services/api/config', () => ({ configApi: { getConfig: mocks.getConfig } }));

import { useConfigStore } from './useConfigStore';
import type { Config } from '../types';

const deferred = () => {
  let resolve!: (value: Config) => void;
  const promise = new Promise<Config>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  mocks.getConfig.mockReset();
  mocks.revision = 0;
  useConfigStore.getState().clearCache();
});

describe('personal quota config cache', () => {
  it('shares ordinary concurrent reads within the current connection', async () => {
    const result = deferred();
    mocks.getConfig.mockReturnValue(result.promise);
    const first = useConfigStore.getState().fetchConfig();
    const second = useConfigStore.getState().fetchConfig();
    result.resolve({ codexFastMode: false });
    await expect(first).resolves.toEqual({ codexFastMode: false });
    await expect(second).resolves.toEqual({ codexFastMode: false });
    expect(mocks.getConfig).toHaveBeenCalledTimes(1);
  });

  it('rejects old results after a connection switch and clears visible settings', async () => {
    mocks.getConfig.mockResolvedValueOnce({ codexFastMode: true });
    await useConfigStore.getState().fetchConfig();
    const result = deferred();
    mocks.getConfig.mockReturnValue(result.promise);
    const pending = useConfigStore.getState().fetchConfig(true);
    mocks.revision += 1;
    mocks.onConnectionChange?.();
    result.resolve({ codexFastMode: false });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(useConfigStore.getState().config).toBeNull();
    expect(useConfigStore.getState().isCacheValid()).toBe(false);
  });

  it('keeps forced post-write readback when an older request finishes afterwards', async () => {
    const older = deferred();
    const readback = deferred();
    mocks.getConfig.mockReturnValueOnce(older.promise).mockReturnValueOnce(readback.promise);
    const pendingOld = useConfigStore.getState().fetchConfig();
    const pendingNew = useConfigStore.getState().fetchConfig(true);
    readback.resolve({ codexFastMode: true });
    await pendingNew;
    older.resolve({ codexFastMode: false });
    await pendingOld;
    expect(useConfigStore.getState().config?.codexFastMode).toBe(true);
  });
});
