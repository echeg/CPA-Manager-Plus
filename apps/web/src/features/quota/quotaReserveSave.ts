import {
  buildQuotaReservePatch,
  quotaReserveError,
  type QuotaReserveDraft,
  type QuotaReserveError,
} from '@/features/quota/authFiles/quotaReserve';
import {
  authFilesApi,
  type AuthFileFieldsPatch,
} from '@/features/personal-quota-support/services/api/authFiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';

export type QuotaReserveSaveResult =
  | { status: 'saved' }
  | { status: 'unchanged' }
  | { status: 'stale' }
  | { status: 'invalid'; error: QuotaReserveError }
  | { status: 'error'; message: string };

interface SaveDeps {
  patchFields?: (name: string, fields: AuthFileFieldsPatch) => Promise<unknown>;
  /** Re-reads the backend verdict for the listed credentials; the quota cache stays. */
  reloadReserveVerdicts: () => Promise<unknown> | void;
  /** False once the connection changed while the write was in flight. */
  isCurrent: () => boolean;
}

/**
 * Saves a reserve edited on the Quota page through the same field PATCH as the
 * Auth Files editor. Turning the reserve off always clears the stored value,
 * even one the listing could not parse.
 */
export async function saveQuotaReserve(
  { file, draft }: { file: AuthFileItem; draft: QuotaReserveDraft },
  { patchFields = authFilesApi.patchFields, reloadReserveVerdicts, isCurrent }: SaveDeps
): Promise<QuotaReserveSaveResult> {
  const touched = { ...draft, touched: true };
  const error = quotaReserveError(touched);
  if (error) return { status: 'invalid', error };
  const patch = buildQuotaReservePatch(
    touched.enabled ? {} : { quota_reserve: file.quotaReserve ?? null },
    touched
  );
  if (!('quota_reserve' in patch)) return { status: 'unchanged' };
  try {
    await patchFields(file.name, patch);
  } catch (err: unknown) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  if (!isCurrent()) return { status: 'stale' };
  await reloadReserveVerdicts();
  return { status: 'saved' };
}
