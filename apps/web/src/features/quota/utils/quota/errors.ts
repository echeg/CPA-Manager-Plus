/**
 * Quota error message resolution shared by the quota page and auth-files cards.
 */

import type { TFunction } from 'i18next';

/** Translate quota failures into useful messages: 404 suggests a backend upgrade, 403 a credential check. */
export const resolveQuotaErrorMessage = (
  t: TFunction,
  status: number | undefined,
  fallback: string
): string => {
  if (status === 404) return t('common.quota_update_required');
  if (status === 403) return t('common.quota_check_credential');
  return fallback;
};
