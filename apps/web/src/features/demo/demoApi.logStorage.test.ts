import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cpaLogStorageApi,
  logRetention,
  logStorageWarning,
  readCpaLogStorage,
} from '@/features/usage-maintenance/cpaLogStorage';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  getDemoLogStorage,
  handleDemoApiRequest,
  handleDemoRawRequest,
  resetDemoConfigState,
} from './demoApi';
import { DEMO_API_BASE, DEMO_MANAGEMENT_KEY, setDemoMode } from './demoMode';

describe('demo CPA log storage', () => {
  afterEach(() => {
    resetDemoConfigState();
    setDemoMode(false);
    vi.restoreAllMocks();
  });

  it('reaches the fixture through the card API client in demo mode', async () => {
    setDemoMode(true);
    // The demo page logs in with these placeholders; the persisted store needs no browser storage here.
    const getState = useAuthStore.getState;
    vi.spyOn(useAuthStore, 'getState').mockImplementation(() => ({
      ...getState(),
      apiBase: DEMO_API_BASE,
      managementKey: DEMO_MANAGEMENT_KEY,
    }));

    const result = await cpaLogStorageApi.get();

    expect(result).toMatchObject({ supported: true, storage: { limitMb: 512, requestLog: true } });
  });

  it('serves a payload the card reader accepts through the raw request path', async () => {
    const response = await handleDemoRawRequest('/observability/logs/storage', { method: 'GET' });

    expect(response.status).toBe(200);
    const storage = readCpaLogStorage(response.data);
    expect(storage).toMatchObject({
      limitMb: 512,
      requestLog: true,
      loggingToFile: true,
    });
    expect(storage.cappedBytes).toBeLessThanOrEqual(storage.totalBytes);
    expect(storage.cappedFiles).toBeLessThanOrEqual(storage.totalFiles);
    expect(storage.cappedBytes).toBeLessThan(storage.limitMb * 1024 * 1024);
  });

  it('shows the near-limit warning and a multi-day retention span', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    const storage = readCpaLogStorage(getDemoLogStorage(now));

    expect(logStorageWarning(storage)).toBe('near_limit');
    expect(storage.newestModifiedAt?.getTime()).toBeLessThanOrEqual(now);
    const retention = logRetention(storage);
    expect(retention?.spanDays).toBeGreaterThan(13);
    expect(retention?.bytesPerDay).toEqual(expect.any(Number));
  });

  it('follows request-log and logging-to-file from the edited demo config', async () => {
    await handleDemoApiRequest(
      'put',
      '/config.yaml',
      ['request-log: false', 'logging-to-file: false'].join('\n')
    );

    const storage = readCpaLogStorage(getDemoLogStorage());

    expect(storage.requestLog).toBe(false);
    expect(storage.loggingToFile).toBe(false);
    expect(storage.limitMb).toBe(512);
  });

  it('follows the edited limit and warns when request logging has no limit', async () => {
    await handleDemoApiRequest(
      'put',
      '/config.yaml',
      ['request-log: true', 'logs-max-total-size-mb: 0'].join('\n')
    );

    const storage = readCpaLogStorage(getDemoLogStorage());

    expect(storage.limitMb).toBe(0);
    expect(logStorageWarning(storage)).toBe('unbounded');
  });
});
