import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  apiClient as quotaApiClient,
  onQuotaConnectionChange,
} from '@/features/personal-quota-support/services/api/client';
import {
  usePanelFeatureAvailability,
  type PanelFeatureAvailability,
} from '@/hooks/usePanelFeatureAvailability';
import { usageServiceApi, type ApiKeyAlias } from '@/services/api/usageService';
import { useAuthStore } from '@/stores';

/**
 * Aliases live in the manager service, so they exist only when the panel is
 * hosted by the manager and that service answered. Returns '' otherwise.
 */
export function resolveAliasServiceBase(availability: PanelFeatureAvailability): string {
  return !availability.checking &&
    availability.panelHostConfirmed &&
    availability.panelHostMode === 'manager_embedded' &&
    availability.managerServiceAvailable
    ? availability.managerServiceBase
    : '';
}

const normalizeAliases = (items: unknown): ApiKeyAlias[] =>
  Array.isArray(items)
    ? items.map((item: ApiKeyAlias) => ({
        ...item,
        apiKeyHash: String(item?.apiKeyHash || '')
          .trim()
          .toLowerCase(),
      }))
    : [];

export function useApiKeyAliases() {
  const featureAvailability = usePanelFeatureAvailability();
  const managementKey = useAuthStore((state) => state.managementKey);
  const revision = useSyncExternalStore(
    onQuotaConnectionChange,
    quotaApiClient.getConnectionRevision,
    quotaApiClient.getConnectionRevision
  );
  const serviceBase = resolveAliasServiceBase(featureAvailability);
  const [aliases, setAliases] = useState<ApiKeyAlias[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => !cancelled && revision === quotaApiClient.getConnectionRevision();

    const load = async () => {
      setLoading(true);
      try {
        if (!serviceBase) {
          setAvailable(false);
          setAliases([]);
          return;
        }
        const response = await usageServiceApi.getApiKeyAliases(serviceBase, managementKey);
        if (!isCurrent()) return;
        setAvailable(true);
        setAliases(normalizeAliases(response?.items));
      } catch {
        if (!isCurrent()) return;
        setAvailable(false);
        setAliases([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [managementKey, serviceBase, revision, reloadToken]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  /** Apply the list returned by a successful alias save. */
  const replaceAliases = useCallback((items: unknown) => {
    setAvailable(true);
    setAliases(normalizeAliases(items));
  }, []);

  /** Drop one alias locally after the service deleted it. */
  const removeAlias = useCallback((apiKeyHash: string) => {
    const hash = apiKeyHash.trim().toLowerCase();
    setAliases((previous) => previous.filter((item) => item.apiKeyHash !== hash));
  }, []);

  return { aliases, available, loading, reload, replaceAliases, removeAlias };
}
