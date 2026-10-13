/**
 * Load quota across providers, committing faster providers first.
 * Deduplicate batches within a session and discard superseded responses.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/features/personal-quota-support/stores';
import { getStatusFromError } from '@/features/quota/utils/quota';
import { getQuotaCacheKey } from '@/features/quota/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from '../providers';
import { enrichQuotaInBackground } from '../quotaEnrichment';
import type { QuotaProviderType } from '../providers/types';

interface BatchFetchResult {
  name: string;
  cacheKey: string;
  status: 'success' | 'error';
  data?: unknown;
  error?: string;
  errorStatus?: number;
}

export function useQuotaBatchLoader() {
  const { t } = useTranslation();
  const [batchLoading, setBatchLoading] = useState(false);
  const loadingGenerationRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      // A previous visit must not overwrite a newer visit's quota or timestamp.
      requestIdRef.current += 1;
      loadingGenerationRef.current = null;
    },
    []
  );

  const loadQuota = useCallback(
    async (targets: QuotaFileEntry[]) => {
      const cacheGeneration = captureQuotaCacheGeneration();
      if (loadingGenerationRef.current === cacheGeneration.cacheGeneration) return;
      if (targets.length === 0) return;
      loadingGenerationRef.current = cacheGeneration.cacheGeneration;
      const requestId = ++requestIdRef.current;
      setBatchLoading(true);

      try {
        const groups = new Map<QuotaProviderType, QuotaFileEntry[]>();
        targets.forEach((entry) => {
          const group = groups.get(entry.type) ?? [];
          group.push(entry);
          groups.set(entry.type, group);
        });

        await Promise.all(
          Array.from(groups.entries()).map(async ([type, entries]) => {
            const adapter = QUOTA_ADAPTERS[type];
            const setQuota = getQuotaSetter(adapter);

            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              setQuota((prev) => {
                const nextState = { ...prev };
                entries.forEach(({ file }) => {
                  nextState[getQuotaCacheKey(file)] = adapter.buildLoadingState();
                });
                return nextState;
              });
            });

            const results = await Promise.all(
              entries.map(async ({ file }): Promise<BatchFetchResult> => {
                const cacheKey = getQuotaCacheKey(file);
                try {
                  const data = await adapter.fetchQuota(file, t);
                  return { name: file.name, cacheKey, status: 'success', data };
                } catch (err: unknown) {
                  const message = err instanceof Error ? err.message : t('common.unknown_error');
                  return {
                    name: file.name,
                    cacheKey,
                    status: 'error',
                    error: message,
                    errorStatus: getStatusFromError(err),
                  };
                }
              })
            );

            if (requestId !== requestIdRef.current) return;

            const committedStates = new Map<string, QuotaCardState>();
            setQuota((prev) => {
              const nextState = { ...prev };
              results.forEach((result) => {
                commitIfQuotaCacheCurrent(
                  cacheGeneration,
                  () => {
                    nextState[result.cacheKey] =
                      result.status === 'success'
                        ? adapter.buildSuccessState(result.data)
                        : adapter.buildErrorState(
                            result.error || t('common.unknown_error'),
                            result.errorStatus
                          );
                    committedStates.set(result.cacheKey, nextState[result.cacheKey]);
                  },
                  result.name
                );
              });
              return nextState;
            });
            results.forEach((result, index) => {
              const state = committedStates.get(result.cacheKey);
              if (result.status === 'success' && state) {
                void enrichQuotaInBackground(adapter, entries[index].file, result.data, state, t);
              }
            });
          })
        );
        // Record completion, including per-credential errors, only for this session.
        if (requestId === requestIdRef.current) {
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            useQuotaStore.getState().setLastRefreshAt(Date.now());
          });
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setBatchLoading(false);
          loadingGenerationRef.current = null;
        }
      }
    },
    [t]
  );

  return { batchLoading, loadQuota };
}
