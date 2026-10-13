/** React-free Kimi quota data. */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  KimiQuotaRow,
  KimiQuotaState,
} from '@/features/personal-quota-support/types';
import { apiCallApi, getApiCallErrorMessage } from '@/features/personal-quota-support/services/api';
import { resolveKimiQuotaUrl } from '@/features/personal-quota-support/services/api/kimiQuota';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
} from '@/features/personal-quota-support/stores/useQuotaStore';
import {
  KIMI_REQUEST_HEADERS,
  parseKimiUsagePayload,
  buildKimiQuotaRows,
  createStatusError,
  isKimiFile,
  isDisabledAuthFile,
} from '@/features/quota/utils/quota';
import { normalizeAuthIndex } from '@/features/quota/utils/authIndex';
import type { QuotaProviderData } from '../types';

const fetchKimiQuota = async (file: AuthFileItem, t: TFunction): Promise<KimiQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('kimi_quota.missing_auth_index'));
  }

  const generation = captureQuotaCacheGeneration(file.name);
  const assertCurrent = () => {
    if (!commitIfQuotaCacheCurrent(generation, () => {})) {
      throw new Error(t('kimi_quota.stale_request'));
    }
  };
  let url: string;
  try {
    url = await resolveKimiQuotaUrl(file);
  } catch {
    assertCurrent();
    throw new Error(t('kimi_quota.domain_unavailable'));
  }
  assertCurrent();

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url,
    header: { ...KIMI_REQUEST_HEADERS },
  });
  assertCurrent();

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kimi_quota.empty_data'));
  }

  return buildKimiQuotaRows(payload);
};

export const KIMI_CONFIG: QuotaProviderData<KimiQuotaState, KimiQuotaRow[]> = {
  type: 'kimi',
  i18nPrefix: 'kimi_quota',
  filterFn: (file) => isKimiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchKimiQuota,
  storeSelector: (state) => state.kimiQuota,
  storeSetter: 'setKimiQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (rows) => ({ status: 'success', rows }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
};
