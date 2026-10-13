import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiClient } from './client';
import { authFilesApi } from './authFiles';
import {
  getQuotaReserveMaxLevels,
  observeQuotaReserveCapabilities,
} from './quotaReserveCapabilities';

let revision = 100;
beforeEach(() => {
  revision = 100;
  vi.spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
  observeQuotaReserveCapabilities(undefined, revision);
});
afterEach(() => {
  observeQuotaReserveCapabilities(undefined, revision);
  vi.restoreAllMocks();
});

describe('staged quota reserve capability', () => {
  test('reads the current server capability and forwards the complete staged policy', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ files: [], quota_reserve_max_levels: 3 });
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
    await authFilesApi.list();
    expect(getQuotaReserveMaxLevels()).toBe(3);
    await authFilesApi.patchFields('a.json', {
      quota_reserve: { percent: 30, mode: 'soft', steps: [15, 5] },
    });
    expect(patch).toHaveBeenCalledExactlyOnceWith('/credentials/fields', {
      name: 'a.json',
      quota_reserve: { percent: 30, mode: 'soft', steps: [15, 5] },
    });
  });

  test('prevents staged submission to a server without capability, while single-level writes work', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ files: [] });
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
    await authFilesApi.list();
    await expect(
      authFilesApi.patchFields('a.json', {
        quota_reserve: { percent: 30, mode: 'soft', steps: [15] },
      })
    ).rejects.toMatchObject({ apiCode: 'quota_reserve_stages_unsupported' });
    expect(patch).not.toHaveBeenCalled();
    await authFilesApi.patchFields('a.json', {
      quota_reserve: { percent: 30, mode: 'soft', steps: [] },
    });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  test('does not retain capability after a connection switch or accept an old response', () => {
    observeQuotaReserveCapabilities(3, revision);
    expect(getQuotaReserveMaxLevels()).toBe(3);
    revision += 1;
    expect(getQuotaReserveMaxLevels()).toBe(1);
    observeQuotaReserveCapabilities(3, revision - 1);
    expect(getQuotaReserveMaxLevels()).toBe(1);
    observeQuotaReserveCapabilities(3, revision);
    expect(getQuotaReserveMaxLevels()).toBe(3);
    observeQuotaReserveCapabilities(undefined, revision);
    expect(getQuotaReserveMaxLevels()).toBe(1);
  });
});
