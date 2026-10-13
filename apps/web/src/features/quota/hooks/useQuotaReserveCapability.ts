import { useSyncExternalStore } from 'react';
import {
  getQuotaReserveMaxLevels,
  subscribeQuotaReserveCapabilities,
} from '@/features/personal-quota-support/services/api/quotaReserveCapabilities';

const getServerSnapshot = () => 1 as const;

export const useQuotaReserveCapability = () =>
  useSyncExternalStore(
    subscribeQuotaReserveCapabilities,
    getQuotaReserveMaxLevels,
    getServerSnapshot
  );
