/** Credential refresh and manual reset actions with session-scoped cache guards. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
} from '@/features/personal-quota-support/stores';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { getStatusFromError } from '@/features/quota/utils/quota';
import { getQuotaCacheKey } from '@/features/quota/utils/quota/identity';
import { enrichQuotaInBackground } from '../quotaEnrichment';
import { executeQuotaReset, resetFnIfAllowed, type QuotaResetFn } from './quotaReset';
import { getQuotaMap, getQuotaSetter, type QuotaAdapter, type QuotaCardState } from '../providers';

const getQuotaState = (adapter: QuotaAdapter, file: AuthFileItem): QuotaCardState | undefined =>
  getQuotaMap(adapter)[getQuotaCacheKey(file)];

const unchangedName = (name: string) => name;

export function useQuotaActions(
  disableControls: boolean,
  displayNameFor: (name: string) => string = unchangedName,
  afterProbe?: (file: AuthFileItem) => void
) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingKeys, setResettingKeys] = useState<ReadonlySet<string>>(() => new Set());
  // The guards read this synchronously, so a second click before the re-render cannot
  // spend another reset, and one credential's reset never unblocks another's.
  const resettingRef = useRef(resettingKeys);
  const setResetting = useCallback((cacheKey: string, resetting: boolean) => {
    const next = new Set(resettingRef.current);
    if (resetting) next.add(cacheKey);
    else next.delete(cacheKey);
    resettingRef.current = next;
    setResettingKeys(next);
  }, []);
  const displayNameRef = useRef(displayNameFor);
  useEffect(() => {
    // Pending responses must use the current privacy choice when they finish.
    displayNameRef.current = displayNameFor;
  }, [displayNameFor]);
  // Every view's refresh and reset settle here, so follow-up reads cannot depend on the view.
  const afterProbeRef = useRef(afterProbe);
  useEffect(() => {
    afterProbeRef.current = afterProbe;
  }, [afterProbe]);

  const refreshQuota = useCallback(
    async (file: AuthFileItem, adapter: QuotaAdapter, options?: { silent?: boolean }) => {
      if (disableControls || file.disabled) return;
      const cacheKey = getQuotaCacheKey(file);
      if (resettingRef.current.has(cacheKey)) return;
      if (getQuotaState(adapter, file)?.status === 'loading') return;
      const cacheGeneration = captureQuotaCacheGeneration(file.name);
      const setQuota = getQuotaSetter(adapter);

      setQuota((prev) => ({
        ...prev,
        [cacheKey]: adapter.buildLoadingState(),
      }));

      try {
        const data = await adapter.fetchQuota(file, t);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          const successState = adapter.buildSuccessState(data);
          setQuota((prev) => ({
            ...prev,
            [cacheKey]: successState,
          }));
          void enrichQuotaInBackground(adapter, file, data, successState, t);
          if (options?.silent) return;
          showNotification(
            t('auth_files.quota_refresh_success', { name: displayNameRef.current(file.name) }),
            'success'
          );
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({
            ...prev,
            [cacheKey]: adapter.buildErrorState(message, status),
          }));
          showNotification(
            t('auth_files.quota_refresh_failed', {
              name: displayNameRef.current(file.name),
              message: displayNameRef.current(message),
            }),
            'error'
          );
        });
      }
      afterProbeRef.current?.(file);
    },
    [disableControls, showNotification, t]
  );

  // Shared guards: returns the reset call only when this credential may spend a reset now.
  const resetFnFor = useCallback(
    (file: AuthFileItem, adapter: QuotaAdapter) =>
      resetFnIfAllowed(file, adapter, {
        disableControls,
        quotaStatus: getQuotaState(adapter, file)?.status,
        resettingKeys: resettingRef.current,
      }),
    [disableControls]
  );

  const runReset = useCallback(
    (file: AuthFileItem, adapter: QuotaAdapter, resetQuotaFn: QuotaResetFn) => {
      let reloading = false;
      return executeQuotaReset({
        file,
        adapter,
        resetQuotaFn,
        setQuota: getQuotaSetter(adapter),
        setResetting,
        notify: showNotification,
        t,
        displayName: (name) => displayNameRef.current(name),
        captureGeneration: captureQuotaCacheGeneration,
        commitIfCurrent: commitIfQuotaCacheCurrent,
        // A stale available count must not offer to spend another reset.
        reloadAfterFailure: () => {
          reloading = true;
          void refreshQuota(file, adapter, { silent: true });
        },
      }).finally(() => {
        // The reload reports its own probe once the fresh quota settles.
        if (!reloading) afterProbeRef.current?.(file);
      });
    },
    [refreshQuota, setResetting, showNotification, t]
  );

  const resetQuota = useCallback(
    (file: AuthFileItem, adapter: QuotaAdapter) => {
      const resetQuotaFn = resetFnFor(file, adapter);
      if (!resetQuotaFn) return;

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.personal_reset_confirm_message', {
          name: displayNameRef.current(file.name),
        }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          await runReset(file, adapter, resetQuotaFn);
        },
      });
    },
    [resetFnFor, runReset, showConfirmation, t]
  );

  /** Inline (Ledger) variant: the caller already collected confirmation. */
  const performReset = useCallback(
    async (file: AuthFileItem, adapter: QuotaAdapter): Promise<boolean> => {
      const resetQuotaFn = resetFnFor(file, adapter);
      if (!resetQuotaFn) return false;
      return runReset(file, adapter, resetQuotaFn);
    },
    [resetFnFor, runReset]
  );

  return { resettingKeys, refreshQuota, resetQuota, performReset };
}
