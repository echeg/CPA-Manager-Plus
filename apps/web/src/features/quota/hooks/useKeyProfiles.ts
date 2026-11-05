import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  apiClient,
  onQuotaConnectionChange,
} from '@/features/personal-quota-support/services/api/client';
import {
  AliasStateUnknownError,
  clientKeysApi,
  DuplicateAliasError,
  DuplicateClientKeyError,
  InvalidAliasError,
  InvalidClientKeyError,
  LastClientKeyError,
  type ClientKeyAliasContext,
} from '@/features/personal-quota-support/services/api/clientKeys';
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

const DEFAULT_TTL = '1h';

/** Result of a key add or remove. `aliasWarning` is set when only the alias write failed. */
export interface ClientKeyWriteResult {
  ok: boolean;
  aliasWarning?: string;
}

/** Localized text for a client key domain error, or '' for any other error. */
function clientKeyErrorText(err: unknown, t: TFunction): string {
  const prefix = 'quota_management.client_keys.errors';
  if (err instanceof InvalidClientKeyError) return t(`${prefix}.invalid_key`);
  if (err instanceof DuplicateClientKeyError) return t(`${prefix}.duplicate_key`);
  if (err instanceof InvalidAliasError)
    return t(err.reason === 'empty' ? `${prefix}.alias_empty` : `${prefix}.alias_too_long`);
  if (err instanceof DuplicateAliasError) return t(`${prefix}.alias_duplicate`);
  if (err instanceof LastClientKeyError) return t(`${prefix}.last_key`);
  if (err instanceof AliasStateUnknownError) return t(`${prefix}.alias_state_unknown`);
  return '';
}

/**
 * Loads the per-key routing profiles, the client key list and the global sticky
 * TTL of the loaded config. Saves one key profile or the shared profile at a time,
 * and adds or removes client keys. Results that arrive after the quota connection
 * changed, or after unmount, are dropped.
 */
export function useKeyProfiles(disabled: boolean) {
  const { t } = useTranslation();
  const revision = useSyncExternalStore(
    onQuotaConnectionChange,
    apiClient.getConnectionRevision,
    apiClient.getConnectionRevision
  );
  const fetchConfig = useConfigStore((store) => store.fetchConfig);
  const {
    aliases,
    available: aliasesAvailable,
    serviceBase: aliasServiceBase,
    managementKey,
    stateKnown: aliasStateKnown,
    replaceAliases,
    removeAlias,
  } = useApiKeyAliases();
  const [state, setState] = useState<RoutingProfilesState | null>(null);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [ttl, setTtl] = useState(DEFAULT_TTL);
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
    setTtl(DEFAULT_TTL);
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
        setTtl(config.routingSessionAffinityTTL || DEFAULT_TTL);
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

  /** Claim the single write slot; false while disabled, loading or another write runs. */
  const beginWrite = () => {
    if (disabled || loading || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    return true;
  };
  const endWrite = () => {
    savingRef.current = false;
    if (mounted.current) setSaving(false);
  };
  const isCurrent = () => mounted.current && revision === apiClient.getConnectionRevision();

  /** Show a write error. Call only while the write's connection is current. */
  const failWrite = (err: unknown) => {
    const domain = clientKeyErrorText(err, t);
    if (domain) {
      // Rejected before any write, so the stored state is unchanged.
      setSaveError(domain);
    } else if (err instanceof UnknownApiKeyError) {
      setSaveError(t('quota_management.key_profiles.errors.unknown_key'));
      refetch();
    } else {
      setSaveError(errorText(err, t));
      // A 422 leaves the file unchanged. Any other failure may follow a write
      // that landed, so reload the stored state for the row summaries.
      if (!(err instanceof InvalidRoutingConfigError)) refetch();
    }
  };

  /** Write one key profile, or return the key to the shared settings with `null`. */
  const saveKeyProfile = async (key: string, profile: RoutingProfile | null) => {
    if (!state?.supported || !beginWrite()) return false;
    try {
      const saved = await routingProfilesApi.saveKeyProfile(key, profile, state.selectionOptions);
      if (!isCurrent()) return false;
      useConfigStore.getState().clearCache();
      setState(saved);
      return true;
    } catch (err) {
      if (isCurrent()) failWrite(err);
      return false;
    } finally {
      endWrite();
    }
  };

  /**
   * Write the shared profile, and the global TTL when passed, then reload profiles
   * and config. Not gated on `supported`: the shared values stay editable in Home
   * or scheduler-plugin mode, as the toolbar allowed before.
   */
  const saveShared = async (profile: RoutingProfile, nextTTL?: string) => {
    if (!state || state.unsupportedBackend || !beginWrite()) return false;
    try {
      const saved = await routingProfilesApi.saveSharedProfile(
        profile,
        nextTTL,
        state.selectionOptions
      );
      if (!isCurrent()) return false;
      useConfigStore.getState().clearCache();
      setState(saved);
      if (nextTTL !== undefined) setTtl(nextTTL.trim());
      refetch();
      return true;
    } catch (err) {
      if (isCurrent()) failWrite(err);
      return false;
    } finally {
      endWrite();
    }
  };

  const aliasContext = (): ClientKeyAliasContext => ({
    serviceBase: aliasServiceBase,
    managementKey,
    aliases,
    aliasStateKnown,
  });

  /** Add a client key with an optional alias. `ok` means the key itself was written. */
  const addKey = async (key: string, alias?: string): Promise<ClientKeyWriteResult> => {
    if (!beginWrite()) return { ok: false };
    try {
      const result = await clientKeysApi.addClientKey(key, alias, aliasContext());
      if (!isCurrent()) return { ok: false };
      if (result.aliases) replaceAliases(result.aliases);
      refetch();
      return result.aliasError
        ? {
            ok: true,
            aliasWarning: t('quota_management.client_keys.errors.alias_save_failed', {
              message: result.aliasError.message,
            }),
          }
        : { ok: true };
    } catch (err) {
      if (isCurrent()) failWrite(err);
      return { ok: false };
    } finally {
      endWrite();
    }
  };

  /** Remove a client key; the backend drops its routing profile with it. */
  const removeKey = async (key: string): Promise<ClientKeyWriteResult> => {
    if (!beginWrite()) return { ok: false };
    try {
      const result = await clientKeysApi.removeClientKey(key, aliasContext());
      if (!isCurrent()) return { ok: false };
      if (result.removedAliasHash) removeAlias(result.removedAliasHash);
      refetch();
      return result.aliasError
        ? {
            ok: true,
            aliasWarning: t('quota_management.client_keys.errors.alias_delete_failed', {
              message: result.aliasError.message,
            }),
          }
        : { ok: true };
    } catch (err) {
      if (isCurrent()) failWrite(err);
      return { ok: false };
    } finally {
      endWrite();
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
    ttl,
    loading,
    saving,
    error: saveError || loadError,
    reload,
    saveKeyProfile,
    saveShared,
    addKey,
    removeKey,
  };
}

export type KeyProfilesState = ReturnType<typeof useKeyProfiles>;
