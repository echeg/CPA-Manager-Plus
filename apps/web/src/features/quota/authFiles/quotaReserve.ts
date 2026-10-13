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
  /** Optional soft2 and soft3 thresholds; empty fields mean a single soft tier. */
  steps: [string, string];
  mode: AuthFileQuotaReserveMode;
  touched: boolean;
  /** The reserve the draft started from (auth JSON, else the listed entry); patches diff it. */
  initial?: AuthFileQuotaReserve;
};

export type QuotaReserveError =
  | 'auth_files.reserve.percent_invalid'
  | 'auth_files.reserve.steps_invalid'
  | 'auth_files.reserve.steps_order_invalid'
  | 'auth_files.reserve.steps_gap_invalid';

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
        steps: [String(reserve.steps?.[0] ?? ''), String(reserve.steps?.[1] ?? '')],
        mode: reserve.mode,
        touched: false,
        initial: reserve,
      }
    : { enabled: false, percent: '', steps: ['', ''], mode: 'soft', touched: false };
}

export function quotaReserveError(draft?: QuotaReserveDraft): QuotaReserveError | null {
  if (!draft?.touched || !draft.enabled) return null;
  const percent = parsePercent(draft.percent);
  if (percent === null) return 'auth_files.reserve.percent_invalid';
  if (draft.mode === 'hard') return null;
  const [second, third] = draft.steps.map((value) => value.trim());
  if (!second && third) return 'auth_files.reserve.steps_gap_invalid';
  let previous = percent;
  for (const value of [second, third]) {
    if (!value) continue;
    const step = parsePercent(value);
    if (step === null) return 'auth_files.reserve.steps_invalid';
    if (step >= previous) return 'auth_files.reserve.steps_order_invalid';
    previous = step;
  }
  return null;
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
  if (percent === null || quotaReserveError(draft)) return {};
  const steps =
    draft.mode === 'soft'
      ? draft.steps.filter((value) => value.trim() !== '').map((value) => Number(value.trim()))
      : [];
  if (
    initial &&
    initial.percent === percent &&
    initial.mode === draft.mode &&
    (initial.steps ?? []).join(',') === steps.join(',')
  )
    return {};
  const reserve: AuthFileQuotaReserve = { percent, mode: draft.mode };
  // Only clear tiers the editor actually observed; omission lets the server reject stale edits.
  if (steps.length > 0 || (initial?.steps?.length ?? 0) > 0) reserve.steps = steps;
  return { quota_reserve: reserve };
}
