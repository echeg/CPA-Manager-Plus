import { apiClient } from '@/features/personal-quota-support/services/api/client';
import { isRecord } from '@/utils/helpers';

/** Disk usage of the CPA logs directory, from `GET /v8/management/observability/logs/storage`. */
export interface CpaLogStorage {
  /** Every regular file in the logs tree. */
  totalBytes: number;
  totalFiles: number;
  /** Top-level `*.log` / `*.log.gz` files the size cleaner counts toward `limitMb`. */
  cappedBytes: number;
  cappedFiles: number;
  oldestModifiedAt: Date | null;
  newestModifiedAt: Date | null;
  /** `logs-max-total-size-mb`; 0 means no limit. */
  limitMb: number;
  requestLog: boolean;
  loggingToFile: boolean;
}

export type CpaLogStorageResult =
  | { supported: true; storage: CpaLogStorage }
  | { supported: false };

export type CpaLogStorageWarning = 'unbounded' | 'near_limit';

export interface CpaLogRetention {
  spanDays: number;
  /** `null` when the span is under a day and too short to extrapolate. */
  bytesPerDay: number | null;
}

const BYTES_PER_MB = 1024 * 1024;
const MS_PER_DAY = 86_400_000;
const NEAR_LIMIT_RATIO = 0.9;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

const invalid = (): never => {
  throw new Error('Invalid CPA log storage response');
};

const readCount = (raw: Record<string, unknown>, key: string): number => {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid();
};

const readFlag = (raw: Record<string, unknown>, key: string): boolean => {
  const value = raw[key];
  return typeof value === 'boolean' ? value : invalid();
};

const readTimestamp = (raw: Record<string, unknown>, key: string): Date | null => {
  const value = raw[key];
  if (value === null) return null;
  if (typeof value !== 'string' || !RFC3339.test(value)) return invalid();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? invalid() : date;
};

/** Validate the endpoint payload; every key is required and wrong types throw. */
export function readCpaLogStorage(raw: unknown): CpaLogStorage {
  if (!isRecord(raw)) return invalid();
  return {
    totalBytes: readCount(raw, 'total_bytes'),
    totalFiles: readCount(raw, 'total_files'),
    cappedBytes: readCount(raw, 'capped_bytes'),
    cappedFiles: readCount(raw, 'capped_files'),
    oldestModifiedAt: readTimestamp(raw, 'oldest_modified_at'),
    newestModifiedAt: readTimestamp(raw, 'newest_modified_at'),
    limitMb: readCount(raw, 'limit_mb'),
    requestLog: readFlag(raw, 'request_log'),
    loggingToFile: readFlag(raw, 'logging_to_file'),
  };
}

export const cpaLogStorageApi = {
  /** CPA builds without the route answer 404, which maps to `{ supported: false }`. */
  async get(signal?: AbortSignal): Promise<CpaLogStorageResult> {
    try {
      const raw = await apiClient.get('/observability/logs/storage', { signal });
      return { supported: true, storage: readCpaLogStorage(raw) };
    } catch (error) {
      if (isRecord(error) && error.status === 404) return { supported: false };
      throw error;
    }
  },
};

export function logStorageWarning(storage: CpaLogStorage): CpaLogStorageWarning | null {
  if (storage.requestLog && storage.limitMb === 0) return 'unbounded';
  if (
    storage.limitMb > 0 &&
    storage.cappedBytes >= NEAR_LIMIT_RATIO * storage.limitMb * BYTES_PER_MB
  ) {
    return 'near_limit';
  }
  return null;
}

export function logRetention(storage: CpaLogStorage): CpaLogRetention | null {
  const { oldestModifiedAt, newestModifiedAt } = storage;
  if (!oldestModifiedAt || !newestModifiedAt) return null;
  const spanDays = (newestModifiedAt.getTime() - oldestModifiedAt.getTime()) / MS_PER_DAY;
  return { spanDays, bytesPerDay: spanDays >= 1 ? storage.totalBytes / spanDays : null };
}
