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
  ConfigChangedError,
  ConfigVersionUnavailableError,
  DefaultCopyUnconfirmedError,
  holdsCodexSpeed,
  LegacyClaudeFallbackError,
  mergeKeyRows,
  routingProfilesApi,
  InvalidRoutingConfigError,
  ProviderToggleChangedError,
  RoutingNotAppliedError,
  UnknownApiKeyError,
  wroteNothing,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { useConfigStore } from '@/features/personal-quota-support/stores';
import { useApiKeyAliases } from '@/hooks/useApiKeyAliases';
import { providersApi } from '@/services/api/providers';
import { codexSpeedUse, withCodexSpeed, type CodexSpeedPatch } from '../codexSpeedModel';
import { buildKeyRows, copyOfShared } from '../keyProfilesModel';
import {
  emptyApiKeyConfigs,
  summarizeKeyConfigs,
  type ApiKeyConfigSummaries,
} from '../providerRoutingModel';
import { errorText } from '../routingModel';

const DEFAULT_TTL = '1h';

/**
 * Result of a profile editor save: `saved` once CPA confirmed it; `unwritten` when it
 * failed and CPA stored nothing (it was refused before its write, or CPA's answer
 * refused the write, `wroteNothing`); `unconfirmed` when it failed in a way that leaves
 * open whether CPA stored it, such as a write without an answer or a failed read-back.
 */
export type ProfileSaveOutcome = 'saved' | 'unwritten' | 'unconfirmed';

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
 * The Claude and Codex API-key entries, reduced to what labels need. A failed list
 * is empty, so its labels fall back to the backend label and index.
 */
async function loadApiKeyConfigs(): Promise<ApiKeyConfigSummaries> {
  const [claude, codex] = await Promise.all([
    providersApi.getClaudeConfigs().then(summarizeKeyConfigs, () => []),
    providersApi.getCodexConfigs().then(summarizeKeyConfigs, () => []),
  ]);
  return { claude, codex };
}

/**
 * Loads the per-key routing profiles, the client key list, the global sticky TTL
 * of the loaded config, and the provider API-key entries for API-key labels.
 * Saves one key profile or the shared profile at a time, and adds or removes
 * client keys. Results that arrive after the quota connection
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
    reload: reloadAliases,
    replaceAliases,
    removeAlias,
  } = useApiKeyAliases();
  const [state, setState] = useState<RoutingProfilesState | null>(null);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [ttl, setTtl] = useState(DEFAULT_TTL);
  const [apiKeyConfigs, setApiKeyConfigs] = useState<ApiKeyConfigSummaries>(emptyApiKeyConfigs);
  const [loadError, setLoadError] = useState('');
  // A save error survives the reload it triggers; a user reload that loads, or the next
  // save, clears it. A user reload that fails keeps it, since the rows it explains, such
  // as a "Default" badge beside a copy CPA did not confirm, were not reloaded either.
  const [saveError, setSaveError] = useState('');
  const userReloadPending = useRef(false);
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
    setApiKeyConfigs(emptyApiKeyConfigs());
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
        if (userReloadPending.current) {
          userReloadPending.current = false;
          setSaveError('');
        }
      })
      .catch((err: unknown) => {
        if (isCurrent()) setLoadError(errorText(err, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // Labels only: loaded beside the profiles so a slow or failed list never holds
    // the editor back.
    void loadApiKeyConfigs().then((configs) => {
      if (isCurrent()) setApiKeyConfigs(configs);
    });
    return () => {
      active = false;
    };
  }, [disabled, fetchConfig, revision, reloadToken, t]);

  const refetch = useCallback(() => setReloadToken((value) => value + 1), []);
  // A user reload, or opening a modal, also retries an alias list that is not known:
  // until it loads, a manager-hosted panel can neither delete a key nor save an alias.
  // A known list is kept, so the alias input does not turn off during every reload.
  const reload = useCallback(() => {
    userReloadPending.current = true;
    refetch();
    if (!aliasStateKnown) reloadAliases();
  }, [aliasStateKnown, refetch, reloadAliases]);

  const isCurrent = () => mounted.current && revision === apiClient.getConnectionRevision();

  /**
   * Claim the single write slot; false while disabled, loading or another write runs.
   * A callback kept past an unmount or a connection change, such as the `onConfirm`
   * of a delete confirmation, is refused before it sends a request: the services pin
   * the connection that is current when they are called, which would be the new one.
   */
  const beginWrite = () => {
    if (!isCurrent() || disabled || loading || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    // The error a pending user reload would clear is gone; keep the one this write sets.
    userReloadPending.current = false;
    return true;
  };
  const endWrite = () => {
    savingRef.current = false;
    if (mounted.current) setSaving(false);
  };

  /** Show a write error. Call only while the write's connection is current. */
  const failWrite = (err: unknown) => {
    const domain = clientKeyErrorText(err, t);
    if (domain) {
      // Rejected before any write, so the stored state is unchanged.
      setSaveError(domain);
      // Load the alias list again, so a retry passes once the alias service answers.
      if (err instanceof AliasStateUnknownError) reloadAliases();
    } else if (err instanceof UnknownApiKeyError) {
      setSaveError(t('quota_management.key_profiles.errors.unknown_key'));
      refetch();
    } else if (err instanceof ConfigChangedError) {
      // A conditional write found a newer config and wrote nothing: show the stored state.
      setSaveError(t('quota_management.key_profiles.errors.config_changed'));
      refetch();
    } else if (err instanceof RoutingNotAppliedError) {
      // Written, but CPA does not route by it now: show the stored state, read-only.
      // CPA still applies most of the Default profile there, so its text names the parts.
      setSaveError(
        t(
          err.profile === 'default'
            ? 'quota_management.key_profiles.errors.not_applied_default'
            : 'quota_management.key_profiles.errors.not_applied'
        )
      );
      refetch();
    } else if (err instanceof ProviderToggleChangedError) {
      // Written without the flags the backend serves now: reload, so the editor starts
      // over from the stored profile with the switch.
      setSaveError(t('quota_management.key_profiles.errors.toggle_unsent'));
      refetch();
    } else if (err instanceof ConfigVersionUnavailableError) {
      // Refused before any write, so the stored state is unchanged.
      setSaveError(t('quota_management.key_profiles.errors.config_version_missing'));
    } else if (err instanceof LegacyClaudeFallbackError) {
      // Refused before any write, so the stored state is unchanged.
      setSaveError(
        t(
          err.profile === 'default'
            ? 'quota_management.key_profiles.errors.legacy_fallback_default'
            : 'quota_management.key_profiles.errors.legacy_fallback_key'
        )
      );
    } else if (err instanceof DefaultCopyUnconfirmedError) {
      // The key may keep the copy: reload the stored state, so its row can tell. The
      // text claims no reload: one that fails adds `reload_failed` to it.
      setSaveError(t('quota_management.key_profiles.errors.copy_unconfirmed'));
      refetch();
    } else {
      setSaveError(errorText(err, t));
      // A 422 leaves the file unchanged. Any other failure may follow a write
      // that landed, so reload the stored state for the row summaries.
      if (!(err instanceof InvalidRoutingConfigError)) refetch();
    }
  };

  /**
   * Write one key profile, or return the key to the shared settings with `null`.
   * `opened` is the profile the editor started from; only a provider it had off is
   * written as switched on (`sentDisabled`).
   */
  const saveKeyProfile = async (
    key: string,
    profile: RoutingProfile | null,
    opened: RoutingProfile | null = null
  ): Promise<ProfileSaveOutcome> => {
    if (!state?.supported || !beginWrite()) return 'unwritten';
    try {
      const saved = await routingProfilesApi.saveKeyProfile(
        key,
        profile,
        state.selectionOptions,
        state.providersSupported,
        state.speedSupported,
        state.providerToggleSupported,
        opened
      );
      // Stored, but its result is dropped with the connection or the panel.
      if (!isCurrent()) return 'unconfirmed';
      useConfigStore.getState().clearCache();
      setState(saved);
      return 'saved';
    } catch (err) {
      if (isCurrent()) failWrite(err);
      return wroteNothing(err) ? 'unwritten' : 'unconfirmed';
    } finally {
      endWrite();
    }
  };

  /**
   * Write the shared profile, and the global TTL when passed, then reload profiles
   * and config. Not gated on `supported`: the shared values stay editable in Home
   * or scheduler-plugin mode, as the toolbar allowed before. `opened` is the profile
   * the editor started from, as for `saveKeyProfile`. There CPA ignores `disabled` and
   * the editor locks the Enabled switches, so the save sends no flag at all and the
   * merge keeps the stored ones; an editor opened before a reload would otherwise
   * write the flags it opened with over newer ones. A state loaded before a scheduler
   * plugin took over still sends them, so the API method rereads the profiles first
   * and then writes nothing.
   */
  const saveShared = async (
    profile: RoutingProfile,
    nextTTL?: string,
    opened: RoutingProfile | null = null
  ): Promise<ProfileSaveOutcome> => {
    if (!state || state.unsupportedBackend || !beginWrite()) return 'unwritten';
    try {
      const saved = await routingProfilesApi.saveSharedProfile(
        profile,
        nextTTL,
        state.selectionOptions,
        state.providersSupported,
        state.speedSupported,
        state.supported && state.providerToggleSupported,
        opened
      );
      // Stored, but its result is dropped with the connection or the panel.
      if (!isCurrent()) return 'unconfirmed';
      useConfigStore.getState().clearCache();
      setState(saved);
      if (nextTTL !== undefined) setTtl(nextTTL.trim());
      refetch();
      return 'saved';
    } catch (err) {
      if (isCurrent()) failWrite(err);
      return wroteNothing(err) ? 'unwritten' : 'unconfirmed';
    } finally {
      endWrite();
    }
  };

  /**
   * Change only the Codex speed and / or flag of the shared profile (`key` null) or of
   * one key profile, as the speed table does on a click; resolves true when it wrote.
   * The profiles are read again first, and the change is decided on the stored state
   * rather than on the snapshot the table was opened with:
   * - a key that the config read before the profiles no longer lists was deleted
   *   elsewhere: nothing is written, and the key list is reloaded (`UnknownApiKeyError`);
   * - nothing is written, and the stored state is shown, when the reread shows that the
   *   change no longer applies (no speed, key profiles not used, a Codex switched off, or
   *   a speed CPA puts on no request) or that the row already gets the requested values, so a key on the
   *   Default profile is not detached by a click on the value it already inherits;
   * - the Default profile gets a PATCH of the changed field alone, which keeps every
   *   other field, also one changed elsewhere after the reread;
   * - a key write is conditional on the config version read before the profiles, so a
   *   change saved elsewhere after the reread fails it (`ConfigChangedError`) instead of
   *   being undone. A key that owns a profile in that version gets a PATCH of the changed
   *   field alone: the version guarantees the profile still exists, so the merge cannot
   *   create one holding only that field, and no other field is sent. A key without its
   *   own profile gets a complete copy of the stored Default profile, written only once
   *   CPA has loaded the version and shows the Default that was copied, since the
   *   profiles CPA had loaded can be behind an edit of the file; a copy CPA does not
   *   confirm is reported, not deleted (`saveKeyDefaultCopy`,
   *   `DefaultCopyUnconfirmedError`). When the version and the profiles disagree on
   *   whether the key owns a profile, the profiles are behind such an edit, so nothing is
   *   written either. A config read without a usable version (no ETag, or a weak,
   *   wildcard or list value) refuses the key write (`ConfigVersionUnavailableError`):
   *   unconditional, it could undo a change saved elsewhere after the reread, or bring
   *   back a profile deleted meanwhile;
   * - a write is refused (`LegacyClaudeFallbackError`) while the Default profile, or the
   *   key's own profile for a key speed write, keeps its Claude fallback in the legacy
   *   block beside an empty `providers.claude.fallback`: CPA would drop that block and
   *   turn the fallback off, while a save of the whole profile in the editor keeps it.
   */
  const saveCodexSpeed = async (key: string | null, patch: CodexSpeedPatch) => {
    if (!state || state.unsupportedBackend || (key !== null && !state.supported)) return false;
    if (!beginWrite()) return false;
    try {
      // Read first, so the profiles below are at least as new as this version.
      const snapshot = await routingProfilesApi.configSnapshot();
      if (!isCurrent()) return false;
      // Also before a click that writes nothing, which would leave a deleted key shown.
      if (key !== null && !snapshot.clientKeys.has(key)) throw new UnknownApiKeyError();
      if (key !== null && !snapshot.version) throw new ConfigVersionUnavailableError();
      const stored = await routingProfilesApi.get();
      if (!isCurrent()) return false;
      if (
        stored.unsupportedBackend ||
        !stored.speedSupported ||
        (key !== null && !stored.supported)
      ) {
        setState(stored);
        return false;
      }
      const own =
        key === null ? null : (stored.keys.find((entry) => entry.key === key)?.profile ?? null);
      // `/config` reads the file, `/routing/profiles` the config CPA has loaded; they
      // differ until the hot reload after an edit of the file.
      if (key !== null && snapshot.profiledKeys.has(key) !== (own !== null))
        throw new ConfigChangedError();
      // What the row's requests get now. Under `supported: false` only the Default row
      // gets this far, and CPA ignores its stored mode and `disabled`, as in `buildSpeedRows`.
      const { providers } = own ?? stored.shared;
      if (
        (stored.supported && providers.codex.disabled) ||
        codexSpeedUse(providers, !stored.supported) === 'unused' ||
        holdsCodexSpeed(providers.codex, patch)
      ) {
        setState(stored);
        return false;
      }
      // Every routing write runs CPA's legacy merge on the shared profile, and a key
      // speed write on that key's own profile too; the copy carries its whole fallback.
      const legacy = snapshot.legacyClaudeFallback;
      if (legacy.shared) throw new LegacyClaudeFallbackError('default');
      if (key !== null && legacy.keys.has(key)) throw new LegacyClaudeFallbackError('key');
      const { version } = snapshot;
      const saved =
        key === null
          ? await routingProfilesApi.saveSharedCodexSpeed(patch)
          : own
            ? await routingProfilesApi.saveKeyCodexSpeed(key, patch, version)
            : await routingProfilesApi.saveKeyDefaultCopy(
                key,
                withCodexSpeed(copyOfShared(stored.shared), patch),
                stored,
                version
              );
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
  // `addKey` refuses an alias unless the service is reachable and its state is known.
  const aliasesEditable = Boolean(aliasServiceBase) && aliasStateKnown;
  // A failed write reloads the stored state to show its outcome. When that reload fails
  // too, the rows are still those of an earlier load: say so beside the write error
  // instead of letting the write error hide it.
  const error =
    saveError && loadError
      ? `${saveError} ${t('quota_management.key_profiles.errors.reload_failed', { message: loadError })}`
      : saveError || loadError;

  return {
    state,
    rows,
    apiKeyConfigs,
    total: rows.length,
    ttl,
    aliasesEditable,
    loading,
    saving,
    error,
    reload,
    saveKeyProfile,
    saveShared,
    saveCodexSpeed,
    addKey,
    removeKey,
  };
}

export type KeyProfilesState = ReturnType<typeof useKeyProfiles>;
