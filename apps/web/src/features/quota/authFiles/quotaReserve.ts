import {
  parseAuthFileQuotaReserve,
  type AuthFileFieldsPatch,
} from '@/features/personal-quota-support/services/api/authFiles';
import type {
  AuthFileQuotaReserve,
  AuthFileQuotaReserveMode,
} from '@/features/personal-quota-support/types/authFile';

/** Editor draft for the per-credential quota reserve (`quota_reserve` in the auth JSON). */
export type QuotaReserveDraft = {
  enabled: boolean;
  percent: string;
  mode: AuthFileQuotaReserveMode;
  touched: boolean;
  /** The reserve the draft started from (auth JSON, else the listed entry); patches diff it. */
  initial?: AuthFileQuotaReserve;
};

export type QuotaReserveError = 'auth_files.reserve.percent_invalid';

const PERCENT_PATTERN = /^\d+$/;

/** The backend rejects a reserve on any other provider with a 400. */
const supportsQuotaReserve = (providerKey: string): boolean =>
  providerKey === 'codex' || providerKey === 'claude';

const parsePercent = (text: string): number | null => {
  const trimmed = text.trim();
  if (!PERCENT_PATTERN.test(trimmed)) return null;
  const percent = Number(trimmed);
  return percent >= 1 && percent <= 99 ? percent : null;
};

/**
 * The auth JSON is the source of truth; the listed entry covers a JSON without the field.
 * Other providers get no draft, so the editor neither shows nor sends a reserve for them.
 */
export function readQuotaReserveDraft(
  providerKey: string,
  json: Record<string, unknown>,
  fallback?: AuthFileQuotaReserve
): QuotaReserveDraft | undefined {
  if (!supportsQuotaReserve(providerKey)) return undefined;
  const reserve =
    json.quota_reserve === undefined ? fallback : parseAuthFileQuotaReserve(json.quota_reserve);
  return reserve
    ? {
        enabled: true,
        percent: String(reserve.percent),
        mode: reserve.mode,
        touched: false,
        initial: reserve,
      }
    : { enabled: false, percent: '', mode: 'soft', touched: false };
}

export function quotaReserveError(draft?: QuotaReserveDraft): QuotaReserveError | null {
  if (!draft?.touched || !draft.enabled) return null;
  return parsePercent(draft.percent) === null ? 'auth_files.reserve.percent_invalid' : null;
}

export function buildQuotaReservePatch(
  original: Record<string, unknown>,
  draft: QuotaReserveDraft | undefined
): Pick<AuthFileFieldsPatch, 'quota_reserve'> {
  if (!draft?.touched) return {};
  const { initial } = draft;
  if (!draft.enabled) {
    // Removes any stored reserve, including an invalid JSON value the draft could not read.
    return initial || original.quota_reserve !== undefined ? { quota_reserve: null } : {};
  }
  const percent = parsePercent(draft.percent);
  if (percent === null) return {};
  if (initial && initial.percent === percent && initial.mode === draft.mode) return {};
  return { quota_reserve: { percent, mode: draft.mode } };
}
