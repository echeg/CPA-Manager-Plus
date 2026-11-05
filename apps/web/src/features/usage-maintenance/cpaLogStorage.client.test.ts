import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runs cpaLogStorageApi through the real v8 quota client; only the transport and the auth store are faked.
const mocks = vi.hoisted(() => ({
  requestRaw: vi.fn(),
  state: {
    apiBase: 'https://manager.example',
    managementKey: 'panel-admin-key',
    isAuthenticated: true,
    sessionMode: 'manager_embedded',
  },
}));

vi.mock('@/services/api/client', () => ({
  apiClient: { requestRaw: mocks.requestRaw },
}));
vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: { getState: () => mocks.state, subscribe: () => () => {} },
}));

import { cpaLogStorageApi } from './cpaLogStorage';

const livePayload = {
  total_bytes: 185068097,
  total_files: 15,
  capped_bytes: 183686396,
  capped_files: 12,
  oldest_modified_at: '2026-10-07T07:21:57Z',
  newest_modified_at: '2026-11-05T19:17:08Z',
  limit_mb: 0,
  request_log: false,
  logging_to_file: false,
};

beforeEach(() => {
  mocks.requestRaw.mockReset();
  Object.assign(mocks.state, {
    apiBase: 'https://manager.example',
    managementKey: 'panel-admin-key',
  });
});

describe('cpaLogStorageApi through the v8 quota client', () => {
  it('requests the storage route under /v8/management with the admin key', async () => {
    mocks.requestRaw.mockResolvedValue({ data: livePayload });
    const signal = new AbortController().signal;

    const result = await cpaLogStorageApi.get(signal);

    expect(result).toMatchObject({ supported: true, storage: { totalFiles: 15, limitMb: 0 } });
    const config = mocks.requestRaw.mock.calls[0][0];
    expect(config).toMatchObject({
      url: '/observability/logs/storage',
      method: 'GET',
      baseURL: 'https://manager.example/v8/management',
      signal,
    });
    expect(config.headers.get('Authorization')).toBe('Bearer panel-admin-key');
  });

  it('maps a 404 from an older CPA build to unsupported', async () => {
    mocks.requestRaw.mockRejectedValue(
      Object.assign(new Error('404 page not found'), { status: 404 })
    );

    await expect(cpaLogStorageApi.get()).resolves.toEqual({ supported: false });
  });

  it('rejects with the connection error when no management connection exists', async () => {
    Object.assign(mocks.state, { apiBase: '', managementKey: '' });

    await expect(cpaLogStorageApi.get()).rejects.toThrow(
      'The management connection is unavailable'
    );
    expect(mocks.requestRaw).not.toHaveBeenCalled();
  });
});
