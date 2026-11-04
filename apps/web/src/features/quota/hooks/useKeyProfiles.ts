import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  apiClient,
  onQuotaConnectionChange,
} from '@/features/personal-quota-support/services/api/client';
import {
  clientApiKeys,
  mergeKeyRows,
  routingProfilesApi,
  InvalidRoutingConfigError,
  UnknownApiKeyError,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { useConfigStore } from '@/features/personal-quota-support/stores';
import { useApiKeyAliases } from '@/hooks/useApiKeyAliases';
import { buildKeyRows } from '../keyProfilesModel';
import { errorText } from '../routingModel';

/**
 * Loads the per-key routing profiles and the client key list of the loaded config,
 * and saves one key profile at a time. Results that arrive after the quota
 * connection changed, or after unmount, are dropped.
 */
export function useKeyProfiles(disabled: boolean) {
  const { t } = useTranslation();
  const revision = useSyncExternalStore(
    onQuotaConnectionChange,
    apiClient.getConnectionRevision,
    apiClient.getConnectionRevision
  );
  const fetchConfig = useConfigStore((store) => store.fetchConfig);
  const { aliases, available: aliasesAvailable } = useApiKeyAliases();
  const [state, setState] = useState<RoutingProfilesState | null>(null);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  // A save error survives the reload it triggers; a user reload or the next save clears it.
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const mounted = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A new connection drops the old one's profiles. On the same connection a reload,
  // or a pause while disabled, keeps the last loaded state, so the toolbar slots,
  // the Keys button and an open editor stay in place, also after a failed reload.
  useEffect(() => {
    setState(null);
    setApiKeys([]);
  }, [revision]);

  useEffect(() => {
    let active = true;
    setLoadError('');
    setLoading(true);
    if (disabled) return;
    const isCurrent = () => active && revision === apiClient.getConnectionRevision();
    // The first load shares the toolbar's cached config; a reload must see keys
    // added or removed on the Config page since then.
    void Promise.all([routingProfilesApi.get(), fetchConfig(reloadToken > 0)])
      .then(([profiles, config]) => {
        if (!isCurrent()) return;
        setApiKeys(clientApiKeys(config.raw));
        setState(profiles);
      })
      .catch((err: unknown) => {
        if (isCurrent()) setLoadError(errorText(err, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [disabled, fetchConfig, revision, reloadToken, t]);

  const refetch = useCallback(() => setReloadToken((value) => value + 1), []);
  const reload = useCallback(() => {
    setSaveError('');
    refetch();
  }, [refetch]);

  /** Write one key profile, or return the key to the shared settings with `null`. */
  const saveKeyProfile = async (key: string, profile: RoutingProfile | null) => {
    if (disabled || loading || !state?.supported || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    const isCurrent = () => mounted.current && revision === apiClient.getConnectionRevision();
    try {
      const saved = await routingProfilesApi.saveKeyProfile(key, profile, state.selectionOptions);
      if (!isCurrent()) return false;
      useConfigStore.getState().clearCache();
      setState(saved);
      return true;
    } catch (err) {
      if (isCurrent()) {
        if (err instanceof UnknownApiKeyError) {
          setSaveError(t('quota_management.key_profiles.errors.unknown_key'));
          refetch();
        } else {
          setSaveError(errorText(err, t));
          // A 422 leaves the file unchanged. Any other failure may follow a write
          // that landed, so reload the stored state for the row summaries.
          if (!(err instanceof InvalidRoutingConfigError)) refetch();
        }
      }
      return false;
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const rows = useMemo(
    () =>
      state ? buildKeyRows(mergeKeyRows(apiKeys, state.keys), aliasesAvailable ? aliases : []) : [],
    [state, apiKeys, aliases, aliasesAvailable]
  );
  const count = rows.filter((row) => row.profile !== null).length;

  return {
    state,
    rows,
    count,
    total: rows.length,
    loading,
    saving,
    error: saveError || loadError,
    reload,
    saveKeyProfile,
  };
}

export type KeyProfilesState = ReturnType<typeof useKeyProfiles>;
