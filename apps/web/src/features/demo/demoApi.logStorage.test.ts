import { afterEach, describe, expect, it } from 'vitest';
import {
  logRetention,
  logStorageWarning,
  readCpaLogStorage,
} from '@/features/usage-maintenance/cpaLogStorage';
import {
  getDemoLogStorage,
  handleDemoApiRequest,
  handleDemoRawRequest,
  resetDemoConfigState,
} from './demoApi';

describe('demo CPA log storage', () => {
  afterEach(() => {
    resetDemoConfigState();
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
});
