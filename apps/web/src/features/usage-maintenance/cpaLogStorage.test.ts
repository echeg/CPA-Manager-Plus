import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/features/personal-quota-support/services/api/client', () => ({
  apiClient: { get: mocks.get },
}));
import {
  cpaLogStorageApi,
  logRetention,
  logStorageWarning,
  readCpaLogStorage,
  type CpaLogStorage,
} from './cpaLogStorage';

const MB = 1024 * 1024;
const liveSample = () => ({
  total_bytes: 185068097,
  total_files: 15,
  capped_bytes: 183686396,
  capped_files: 12,
  oldest_modified_at: '2026-10-07T07:21:57Z',
  newest_modified_at: '2026-11-05T19:17:08Z',
  limit_mb: 0,
  request_log: false,
  logging_to_file: false,
});
const missingDirectory = () => ({
  total_bytes: 0,
  total_files: 0,
  capped_bytes: 0,
  capped_files: 0,
  oldest_modified_at: null,
  newest_modified_at: null,
  limit_mb: 512,
  request_log: true,
  logging_to_file: true,
});
const storage = (overrides: Partial<CpaLogStorage> = {}): CpaLogStorage => ({
  ...readCpaLogStorage(liveSample()),
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('readCpaLogStorage', () => {
  it('maps the live sample to camelCase fields', () => {
    expect(readCpaLogStorage(liveSample())).toEqual({
      totalBytes: 185068097,
      totalFiles: 15,
      cappedBytes: 183686396,
      cappedFiles: 12,
      oldestModifiedAt: new Date('2026-10-07T07:21:57Z'),
      newestModifiedAt: new Date('2026-11-05T19:17:08Z'),
      limitMb: 0,
      requestLog: false,
      loggingToFile: false,
    });
  });

  it('accepts a missing logs directory reported as zeros and null timestamps', () => {
    expect(readCpaLogStorage(missingDirectory())).toMatchObject({
      totalBytes: 0,
      totalFiles: 0,
      oldestModifiedAt: null,
      newestModifiedAt: null,
      limitMb: 512,
      requestLog: true,
    });
  });

  it('accepts fractional seconds and numeric offsets', () => {
    const parsed = readCpaLogStorage({
      ...liveSample(),
      oldest_modified_at: '2026-10-07T10:21:57.123+03:00',
    });
    expect(parsed.oldestModifiedAt?.toISOString()).toBe('2026-10-07T07:21:57.123Z');
  });

  it.each([
    'total_bytes',
    'total_files',
    'capped_bytes',
    'capped_files',
    'oldest_modified_at',
    'newest_modified_at',
    'limit_mb',
    'request_log',
    'logging_to_file',
  ])('rejects a payload without %s', (key) => {
    const raw: Record<string, unknown> = liveSample();
    delete raw[key];
    expect(() => readCpaLogStorage(raw)).toThrow('Invalid CPA log storage response');
  });

  it.each([
    ['negative bytes', { total_bytes: -1 }],
    ['NaN files', { total_files: Number.NaN }],
    ['infinite capped bytes', { capped_bytes: Number.POSITIVE_INFINITY }],
    ['string limit', { limit_mb: '512' }],
    ['numeric flag', { request_log: 1 }],
    ['string flag', { logging_to_file: 'true' }],
    ['numeric timestamp', { oldest_modified_at: 1730000000 }],
    ['unparsable timestamp', { newest_modified_at: 'yesterday' }],
    ['date-only timestamp', { oldest_modified_at: '2026-10-07' }],
    ['invalid month', { newest_modified_at: '2026-13-05T19:17:08Z' }],
  ])('rejects %s', (_label, patch) => {
    expect(() => readCpaLogStorage({ ...liveSample(), ...patch })).toThrow(
      'Invalid CPA log storage response'
    );
  });

  it.each([null, undefined, 'text', 42, []])('rejects a non-object payload %#', (raw) => {
    expect(() => readCpaLogStorage(raw)).toThrow('Invalid CPA log storage response');
  });
});

describe('cpaLogStorageApi.get', () => {
  it('requests the storage route and returns the parsed payload', async () => {
    mocks.get.mockResolvedValue(liveSample());
    const controller = new AbortController();

    await expect(cpaLogStorageApi.get(controller.signal)).resolves.toEqual({
      supported: true,
      storage: readCpaLogStorage(liveSample()),
    });
    expect(mocks.get).toHaveBeenCalledWith('/observability/logs/storage', {
      signal: controller.signal,
    });
  });

  it('maps a 404 to an unsupported CPA build', async () => {
    mocks.get.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    await expect(cpaLogStorageApi.get()).resolves.toEqual({ supported: false });
  });

  it('rethrows a scan failure', async () => {
    const error = Object.assign(new Error('scan failed'), { status: 500 });
    mocks.get.mockRejectedValue(error);
    await expect(cpaLogStorageApi.get()).rejects.toBe(error);
  });

  it('rethrows a network error without a status', async () => {
    const error = new Error('Network Error');
    mocks.get.mockRejectedValue(error);
    await expect(cpaLogStorageApi.get()).rejects.toBe(error);
  });

  it('rethrows an invalid payload', async () => {
    mocks.get.mockResolvedValue({ total_bytes: 1 });
    await expect(cpaLogStorageApi.get()).rejects.toThrow('Invalid CPA log storage response');
  });
});

describe('logStorageWarning', () => {
  it('warns about request logging without a limit', () => {
    expect(logStorageWarning(storage({ requestLog: true, limitMb: 0 }))).toBe('unbounded');
  });

  it('stays quiet without a limit when request logging is off', () => {
    expect(logStorageWarning(storage({ requestLog: false, limitMb: 0 }))).toBeNull();
  });

  it('warns at exactly 90% of the limit', () => {
    expect(logStorageWarning(storage({ limitMb: 100, cappedBytes: 90 * MB }))).toBe('near_limit');
  });

  it('stays quiet just under 90% of the limit', () => {
    expect(logStorageWarning(storage({ limitMb: 100, cappedBytes: 90 * MB - 1 }))).toBeNull();
  });

  it('compares capped bytes, not total bytes, to the limit', () => {
    expect(
      logStorageWarning(storage({ limitMb: 100, cappedBytes: 10 * MB, totalBytes: 500 * MB }))
    ).toBeNull();
  });
});

describe('logRetention', () => {
  it('returns null when a timestamp is missing', () => {
    expect(logRetention(storage({ oldestModifiedAt: null }))).toBeNull();
    expect(logRetention(storage({ newestModifiedAt: null }))).toBeNull();
  });

  it('skips the per-day growth for a span under one day', () => {
    expect(
      logRetention(
        storage({
          oldestModifiedAt: new Date('2026-11-05T00:00:00Z'),
          newestModifiedAt: new Date('2026-11-05T12:00:00Z'),
        })
      )
    ).toEqual({ spanDays: 0.5, bytesPerDay: null });
  });

  it('averages total bytes over a multi-day span', () => {
    expect(
      logRetention(
        storage({
          totalBytes: 400 * MB,
          oldestModifiedAt: new Date('2026-11-01T00:00:00Z'),
          newestModifiedAt: new Date('2026-11-05T00:00:00Z'),
        })
      )
    ).toEqual({ spanDays: 4, bytesPerDay: 100 * MB });
  });

  it('extrapolates from exactly one day', () => {
    expect(
      logRetention(
        storage({
          totalBytes: 10,
          oldestModifiedAt: new Date('2026-11-04T00:00:00Z'),
          newestModifiedAt: new Date('2026-11-05T00:00:00Z'),
        })
      )
    ).toEqual({ spanDays: 1, bytesPerDay: 10 });
  });
});
