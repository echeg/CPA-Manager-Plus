/** Modal-free manual reset execution shared by the Cards confirmation and inline Ledger flows. */

import type { TFunction } from 'i18next';
import type { AuthFileItem, NotificationType } from '@/features/personal-quota-support/types';
import { getQuotaCacheKey } from '@/features/quota/utils/quota/identity';
import type { QuotaAdapter, QuotaMapUpdater } from '../providers';

export type QuotaResetFn = NonNullable<QuotaAdapter['resetQuota']>;

/** The reset call for this credential, or null when it may not spend a reset now. */
export function resetFnIfAllowed(
  file: AuthFileItem,
  adapter: Pick<QuotaAdapter, 'resetQuota'>,
  state: {
    disableControls: boolean;
    quotaStatus?: string;
    /** Cache keys with a reset in flight; each credential spends one reset at a time. */
    resettingKeys: ReadonlySet<string>;
  }
): QuotaResetFn | null {
  if (!adapter.resetQuota) return null;
  if (state.disableControls || file.disabled) return null;
  if (state.quotaStatus === 'loading') return null;
  if (state.resettingKeys.has(getQuotaCacheKey(file))) return null;
  return adapter.resetQuota;
}

export interface QuotaResetDeps<G> {
  file: AuthFileItem;
  adapter: Pick<QuotaAdapter, 'buildSuccessState'>;
  resetQuotaFn: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
  setQuota: QuotaMapUpdater;
  setResetting: (cacheKey: string, resetting: boolean) => void;
  notify: (message: string, type: NotificationType) => void;
  t: TFunction;
  displayName: (name: string) => string;
  captureGeneration: (name: string) => G;
  commitIfCurrent: (generation: G, commit: () => void) => boolean;
  /** Re-reads quota after a failure; the redemption may have landed before the error. */
  reloadAfterFailure?: () => void;
}

/** Resolves true only when the success state was committed for the current cache generation. */
export async function executeQuotaReset<G>(deps: QuotaResetDeps<G>): Promise<boolean> {
  const { file, adapter, setQuota, notify, t, displayName } = deps;
  const cacheKey = getQuotaCacheKey(file);
  const cacheGeneration = deps.captureGeneration(file.name);
  deps.setResetting(cacheKey, true);
  let reloadAfterFailure = false;
  try {
    const data = await deps.resetQuotaFn(file, t);
    return deps.commitIfCurrent(cacheGeneration, () => {
      setQuota((prev) => ({
        ...prev,
        [cacheKey]: adapter.buildSuccessState(data),
      }));
      notify(t('codex_quota.reset_success', { name: displayName(file.name) }), 'success');
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : t('common.unknown_error');
    reloadAfterFailure = deps.commitIfCurrent(cacheGeneration, () => {
      notify(
        t('codex_quota.reset_failed', {
          name: displayName(file.name),
          message: displayName(message),
        }),
        'error'
      );
    });
    return false;
  } finally {
    deps.setResetting(cacheKey, false);
    // After the in-flight flag clears, so the reload is not skipped as a concurrent probe.
    if (reloadAfterFailure) deps.reloadAfterFailure?.();
  }
}
