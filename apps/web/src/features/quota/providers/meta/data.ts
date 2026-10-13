import type { TFunction } from 'i18next';
import type { MetaQuotaData, MetaQuotaState } from '@/features/personal-quota-support/types';
import { apiCallApi } from '@/features/personal-quota-support/services/api/apiCall';
import { authFilesApi } from '@/features/personal-quota-support/services/api/authFiles';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
} from '@/features/personal-quota-support/stores/useQuotaStore';
import { isDisabledAuthFile, resolveAuthProvider } from '@/features/quota/utils/quota';
import type { QuotaProviderData } from '../types';
import { createMetaQuotaFetcher, MetaQuotaError } from './requests';

const fetchMetaQuota = createMetaQuotaFetcher({
  request: (payload) => apiCallApi.request(payload),
  downloadText: (name) => authFilesApi.downloadText(name),
  captureCurrent: (name) => {
    const generation = captureQuotaCacheGeneration(name);
    return () => commitIfQuotaCacheCurrent(generation, () => {});
  },
});

export const META_CONFIG: QuotaProviderData<MetaQuotaState, MetaQuotaData> = {
  type: 'meta',
  i18nPrefix: 'meta_quota',
  filterFn: (file) => resolveAuthProvider(file) === 'meta' && !isDisabledAuthFile(file),
  fetchQuota: async (file, t: TFunction) => {
    try {
      return await fetchMetaQuota(file);
    } catch (error: unknown) {
      if (error instanceof MetaQuotaError) {
        error.message = t(`meta_quota.${error.code}`, { status: error.status });
      }
      throw error;
    }
  },
  storeSelector: (state) => state.metaQuota,
  storeSetter: 'setMetaQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    error,
    errorStatus,
  }),
};
