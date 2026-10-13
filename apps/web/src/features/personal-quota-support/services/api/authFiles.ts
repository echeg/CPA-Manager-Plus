import { apiClient } from './client';
import { isRecord } from '@/features/quota/utils/helpers';
import type {
  AuthFileQuotaReserve,
  AuthFilesResponse,
} from '@/features/personal-quota-support/types/authFile';
import { getQuotaCacheKey } from '@/features/quota/utils/quota/identity';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
} from '@/features/quota/utils/recentRequests';
import { parseTimestampMs } from '@/features/quota/utils/timestamp';
import { normalizeAuthFileCooldowns, normalizeCooldownTimestamp } from './authFileCooldowns';

type AuthFileStatusResponse = { status: string; disabled: boolean };
export type AuthFileLookup = { name: string; authIndex?: string };
type AuthFileEntry = AuthFilesResponse['files'][number];
export type AuthFileFieldsPatch = { quota_reserve?: AuthFileQuotaReserve | null };
export interface AuthFileCooldownResetResponse {
  status: 'ok';
  auth_index: string;
  models: string[];
}

const readTextField = (entry: AuthFileEntry, key: string): string => {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
};

const readDateField = (entry: AuthFileEntry): number => {
  const candidates = [entry['modtime'], entry['updated_at'], entry['last_refresh']];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const parsed = parseTimestampMs(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const isRuntimeOnlyEntry = (entry: AuthFileEntry): boolean => entry['runtime_only'] === true;

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const countMeaningfulFields = (entry: AuthFileEntry): number =>
  Object.values(entry).reduce<number>(
    (count, value) => count + (hasMeaningfulValue(value) ? 1 : 0),
    0
  );

const authFilePriorityScore = (entry: AuthFileEntry): number => {
  let score = 0;
  if (readTextField(entry, 'source').toLowerCase() === 'file') score += 32;
  if (readTextField(entry, 'path')) score += 16;
  if (!isRuntimeOnlyEntry(entry)) score += 8;
  if (entry.disabled !== true) score += 4;
  if (readDateField(entry) > 0) score += 2;
  return score;
};

const compareAuthFileEntries = (left: AuthFileEntry, right: AuthFileEntry): number => {
  const scoreDiff = authFilePriorityScore(right) - authFilePriorityScore(left);
  if (scoreDiff !== 0) return scoreDiff;

  const dateDiff = readDateField(right) - readDateField(left);
  if (dateDiff !== 0) return dateDiff;

  const fieldDiff = countMeaningfulFields(right) - countMeaningfulFields(left);
  if (fieldDiff !== 0) return fieldDiff;

  return 0;
};

const mergeAuthFileEntries = (entries: AuthFileEntry[]): AuthFileEntry => {
  const [primary, ...rest] = [...entries].sort(compareAuthFileEntries);
  const merged: AuthFileEntry = { ...primary };

  rest.forEach((entry) => {
    Object.entries(entry).forEach(([key, value]) => {
      // Cooldown snapshots are atomic: [] and null are meaningful, not missing fields.
      if (key === 'cooldowns' && Object.prototype.hasOwnProperty.call(merged, key)) return;
      if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
        merged[key] = value;
      }
    });
  });

  return merged;
};

const INTEGER_STRING_PATTERN = /^[+-]?\d+$/;

const readIntegerField = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !INTEGER_STRING_PATTERN.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

export const parseAuthFileQuotaReserve = (value: unknown): AuthFileQuotaReserve | undefined => {
  if (!isRecord(value)) return undefined;
  const percent = readIntegerField(value.percent);
  if (percent === undefined || percent < 1 || percent > 99) return undefined;
  // The backend defaults a missing mode to soft.
  const mode = value.mode ?? 'soft';
  return mode === 'soft' || mode === 'hard' ? { percent, mode } : undefined;
};

/** The selector's verdict is only meaningful next to a configured reserve. */
const readQuotaReserveFields = (entry: AuthFileEntry) => {
  const quotaReserve = parseAuthFileQuotaReserve(entry['quota_reserve']);
  if (!quotaReserve) {
    return { quotaReserve: undefined, quotaReserveActive: undefined, quotaReserveUntil: undefined };
  }
  const active = entry['quota_reserve_active'];
  const until = entry['quota_reserve_until'];
  return {
    quotaReserve,
    quotaReserveActive: typeof active === 'boolean' ? active : undefined,
    quotaReserveUntil:
      typeof until === 'string' && Number.isFinite(Date.parse(until)) ? until : undefined,
  };
};

const readRuntimeOnlyField = (entry: AuthFileEntry): boolean => {
  const raw = entry['runtime_only'] ?? entry.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
};

/** Normalize declared fields while preserving provider metadata for quota resolvers. */
const normalizeAuthFileEntry = (
  entry: AuthFileEntry,
  observedAt: string | undefined,
  receivedAtMs: number
): AuthFileEntry => {
  const declaredStatusMessage =
    typeof entry.statusMessage === 'string' ? entry.statusMessage.trim() : '';
  const statusMessage = readTextField(entry, 'status_message') || declaredStatusMessage;
  const note = readTextField(entry, 'note');
  const email = readTextField(entry, 'email');
  // API-key credentials may contain a secret in account; do not normalize it for display.
  const projectId = readTextField(entry, 'project_id');
  const modified = readDateField(entry);
  const priority = readIntegerField(entry['priority']);
  const weight = readIntegerField(entry['weight']);

  return {
    ...entry,
    cooldownSnapshot: normalizeAuthFileCooldowns(entry.cooldowns, observedAt, receivedAtMs),
    runtimeOnly: readRuntimeOnlyField(entry),
    authIndex: normalizeRecentRequestAuthIndex(entry['auth_index'] ?? entry.authIndex),
    recentRequests: normalizeRecentRequestBuckets(entry.recent_requests ?? entry.recentRequests),
    successCount: normalizeUsageTotal(entry.success),
    failureCount: normalizeUsageTotal(entry.failed),
    ...(statusMessage ? { statusMessage } : {}),
    ...(modified > 0 ? { modified } : {}),
    priority,
    weight,
    ...readQuotaReserveFields(entry),
    ...(note ? { note } : {}),
    ...(email ? { email } : {}),
    ...(projectId ? { projectId } : {}),
  };
};

export const normalizeAuthFilesResponse = (
  payload: AuthFilesResponse,
  receivedAtMs = Date.now()
): AuthFilesResponse => {
  const observedAt = normalizeCooldownTimestamp(payload?.observed_at);
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const grouped = new Map<string, AuthFileEntry[]>();

  files.forEach((entry) => {
    const name = readTextField(entry, 'name');
    const key = name
      ? getQuotaCacheKey({
          ...entry,
          name,
          authIndex: normalizeRecentRequestAuthIndex(entry['auth_index'] ?? entry.authIndex),
        })
      : JSON.stringify(entry);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    grouped.set(key, [entry]);
  });

  const normalizedFiles = Array.from(grouped.values()).map((entries) =>
    normalizeAuthFileEntry(mergeAuthFileEntries(entries), observedAt, receivedAtMs)
  );
  normalizedFiles.sort((left, right) => {
    const nameOrder = readTextField(left, 'name').localeCompare(
      readTextField(right, 'name'),
      undefined,
      { sensitivity: 'accent' }
    );
    if (nameOrder !== 0) return nameOrder;
    return String(left.authIndex ?? '').localeCompare(String(right.authIndex ?? ''), undefined, {
      sensitivity: 'accent',
    });
  });

  return {
    ...payload,
    observedAt,
    files: normalizedFiles,
    total: normalizedFiles.length,
  };
};

export const authFilesApi = {
  list: async (lookup?: AuthFileLookup) =>
    normalizeAuthFilesResponse(
      await apiClient.get<AuthFilesResponse>(
        '/credentials',
        lookup ? { params: { name: lookup.name, auth_index: lookup.authIndex } } : undefined
      )
    ),

  setStatus: (name: string, disabled: boolean, authIndex?: string) =>
    apiClient.patch<AuthFileStatusResponse>('/credentials/status', {
      name,
      disabled,
      ...(authIndex ? { auth_index: authIndex } : {}),
    }),

  patchFields: (name: string, fields: AuthFileFieldsPatch) =>
    apiClient.patch('/credentials/fields', { name, ...fields }),

  resetCooldown: (authIndex: string) =>
    apiClient.post<AuthFileCooldownResetResponse>('/routing/cooldown/reset', {
      auth_index: authIndex,
    }),

  downloadText: async (name: string): Promise<string> => {
    const response = await apiClient.getRaw('/credentials/download', {
      params: { name },
      responseType: 'text',
      // Credentials are parsed only by the provider resolver and never cached here.
      transformResponse: [(data: unknown) => data],
    });
    return String(response.data);
  },
};
