import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { withSuggestions } from '@/features/personal-quota-support/services/api/claudeFallback';
import type {
  ApiCredentials,
  RoutingProfile,
  RoutingSelectionOptions,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { getQuotaDisplayName } from '@/features/quota/utils/quota/identity';
import { chainSummary, copyOfShared, profileDirty } from '../keyProfilesModel';
import { maskQuotaName } from '../ledgerModel';
import {
  API_PROVIDERS,
  apiCredentialOptions,
  emptyApiKeyConfigs,
  hasProviderRoutingErrors,
  providerRoutingErrors,
  withApiModeNormalization,
  type ApiKeyConfigSummaries,
} from '../providerRoutingModel';
import {
  preferredAccountOptions,
  invalidTTL,
  selectionSlotOptions,
  withPickerRule,
} from '../routingModel';
import { ProviderRoutingBlock } from './ProviderRoutingBlock';
import { Select } from './Select';
import styles from './KeyProfileEditor.module.scss';

const NO_API_CREDENTIALS: ApiCredentials = { claude: [], codex: [] };
const NO_API_KEY_CONFIGS: ApiKeyConfigSummaries = emptyApiKeyConfigs();

export interface KeyProfileEditorProps {
  /** The profile to edit: the stored one, or for a new key profile a copy of the shared one. */
  initial: RoutingProfile;
  /** No profile is stored yet, so saving creates one even when nothing was edited. */
  isNew: boolean;
  /** `default` edits the shared profile and the global TTL; `key` edits one key's profile. */
  variant: 'default' | 'key';
  /** The global session-affinity TTL. */
  ttl: string;
  files: AuthFileItem[];
  showEmails: boolean;
  selectionOptions: RoutingSelectionOptions;
  models: { claude: string[]; codex: string[] };
  saving: boolean;
  /** Nothing can be changed, for example a key profile when the backend reports `supported: false`. */
  readOnly: boolean;
  /**
   * Only the provider mode and fallback are locked: CPA ignores them in Home or
   * scheduler-plugin mode (`supported: false`), where the default profile stays
   * editable. A save keeps the stored `providers` block.
   */
  fallbackReadOnly?: boolean;
  /** `false` on a backend without `providers`: API key choices are disabled. */
  providersSupported?: boolean;
  /** The API keys CPA can route to, per provider. */
  apiCredentials?: ApiCredentials;
  /** Provider key configs (masked) that name the API keys. */
  apiKeyConfigs?: ApiKeyConfigSummaries;
  /** Saves the complete profile; the TTL is passed only when the default variant changed it. */
  onSave: (profile: RoutingProfile, ttl?: string) => void;
  onCancel: () => void;
}

/** The fallback editor fills an empty mapping list with suggestions, so the baseline does too. */
const withFallbackSuggestions = (profile: RoutingProfile): RoutingProfile => {
  const claude = profile.providers.claude;
  const { mappings } = withSuggestions({
    enabled: false,
    mode: claude.fallback.mode,
    mappings: claude.fallback.mappings,
  });
  return {
    ...profile,
    providers: {
      ...profile.providers,
      claude: { ...claude, fallback: { ...claude.fallback, mappings } },
    },
  };
};

/**
 * Editor for one routing profile: the shared stages (sticky session, pool selection,
 * plus the TTL for the default profile), then one block per provider with its mode,
 * preferred subscription, fallback target and API key.
 */
export function KeyProfileEditor({
  initial,
  isNew,
  variant,
  ttl,
  files,
  showEmails,
  selectionOptions,
  models,
  saving,
  readOnly,
  fallbackReadOnly = false,
  providersSupported = true,
  apiCredentials = NO_API_CREDENTIALS,
  apiKeyConfigs = NO_API_KEY_CONFIGS,
  onSave,
  onCancel,
}: KeyProfileEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  // The editor copies the profile once; the caller remounts it to start over.
  const [draft, setDraft] = useState<RoutingProfile>(() =>
    withFallbackSuggestions(copyOfShared(initial))
  );
  const [ttlDraft, setTtlDraft] = useState(ttl);
  const baseline = useMemo(
    () => (isNew ? null : withFallbackSuggestions(initial)),
    [initial, isNew]
  );
  const locked = readOnly || saving;
  const editsTTL = variant === 'default';
  const ttlInvalid = editsTTL && invalidTTL(ttlDraft);
  const ttlChanged = editsTTL && ttlDraft.trim() !== ttl.trim();

  const displayName = (file: AuthFileItem) => {
    const name = getQuotaDisplayName(file);
    return showEmails ? name : maskQuotaName(name);
  };

  // A locked block saves the stored providers, so its draft cannot block the save.
  const routingInvalid =
    !fallbackReadOnly && hasProviderRoutingErrors(providerRoutingErrors(draft, providersSupported));
  const invalid = !draft.selection.primary.trim() || routingInvalid || ttlInvalid;
  // Creating a profile is a change even when the copy still equals the shared settings:
  // from then on the key no longer follows the default profile.
  const dirty = !baseline || profileDirty(draft, baseline, selectionOptions) || ttlChanged;

  const update = (patch: Partial<RoutingProfile>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const save = () => {
    if (readOnly || saving || !dirty || invalid) return;
    const profile = {
      ...draft,
      selection: withPickerRule(draft.selection, selectionOptions),
      providers: fallbackReadOnly ? initial.providers : withApiModeNormalization(draft.providers),
    };
    onSave(profile, ttlChanged ? ttlDraft.trim() : undefined);
  };

  const slots = selectionSlotOptions(t, selectionOptions, draft.selection);
  const summary = chainSummary(draft, files, showEmails, t, {
    apiCredentials,
    providerConfigs: apiKeyConfigs,
  });
  const ttlErrorId = `${id}-ttl-error`;

  return (
    <div className={styles.editor} data-key-profile-editor data-variant={variant}>
      {readOnly && (
        <p className={styles.notice} role="note">
          {t('quota_management.key_profiles.editor.read_only')}
        </p>
      )}

      <section className={styles.stage} aria-labelledby={`${id}-sticky`}>
        <h4 id={`${id}-sticky`}>{t('quota_management.key_profiles.editor.sticky')}</h4>
        <div className={styles.row}>
          <ToggleSwitch
            checked={draft.sessionAffinity}
            disabled={locked}
            onChange={(sessionAffinity) => update({ sessionAffinity })}
            label={t('config_management.visual.sections.network.session_affinity')}
          />
          {editsTTL ? (
            <>
              <input
                className={`input ${styles.ttl}`}
                data-key-profile-ttl
                title={t('quota_management.routing.ttl_hint')}
                aria-label={t('config_management.visual.sections.network.session_affinity_ttl')}
                aria-invalid={ttlInvalid}
                aria-describedby={ttlInvalid ? ttlErrorId : undefined}
                placeholder="1h"
                value={ttlDraft}
                disabled={locked}
                onChange={(event) => setTtlDraft(event.target.value)}
              />
              {ttlInvalid && (
                <span id={ttlErrorId} className={styles.fieldError}>
                  {t('quota_management.routing.invalid_ttl')}
                </span>
              )}
            </>
          ) : (
            ttl.trim() && (
              <span className={styles.hint}>
                {t('quota_management.key_profiles.editor.ttl', { ttl: ttl.trim() })}
              </span>
            )
          )}
        </div>
      </section>

      <section className={styles.stage} aria-labelledby={`${id}-selection`}>
        <h4 id={`${id}-selection`}>{t('quota_management.key_profiles.editor.selection')}</h4>
        <div className={styles.row}>
          <span className={styles.caption} id={`${id}-primary`}>
            {t('quota_management.routing.primary')}
          </span>
          <Select
            size="sm"
            className={styles.slot}
            value={draft.selection.primary}
            options={slots.primary}
            ariaLabelledBy={`${id}-primary`}
            disabled={locked}
            onChange={(primary) => update({ selection: { ...draft.selection, primary } })}
          />
          <span className={styles.caption} id={`${id}-tiebreak`}>
            {t('quota_management.routing.tiebreak')}
          </span>
          <Select
            size="sm"
            className={styles.slot}
            value={slots.tiebreakDisabled ? '' : (draft.selection.tiebreak ?? '')}
            options={slots.tiebreak}
            ariaLabelledBy={`${id}-tiebreak`}
            ariaDescribedBy={slots.tiebreakDisabled ? `${id}-tiebreak-hint` : undefined}
            disabled={locked || slots.tiebreakDisabled}
            onChange={(tiebreak) =>
              update({
                selection: {
                  primary: draft.selection.primary,
                  tiebreak: tiebreak || undefined,
                },
              })
            }
          />
          {slots.tiebreakDisabled && (
            <span id={`${id}-tiebreak-hint`} className={styles.hint}>
              {t('quota_management.routing.tiebreak_inactive')}
            </span>
          )}
        </div>
      </section>

      <div className={styles.providers}>
        {API_PROVIDERS.map((provider) => {
          const routing = draft.providers[provider];
          const preferred = draft.preferredAccounts[provider] ?? '';
          return (
            <ProviderRoutingBlock
              key={provider}
              provider={provider}
              value={routing}
              preferred={preferred}
              preferredOptions={preferredAccountOptions(provider, files, preferred, displayName, t)}
              apiKeyOptions={apiCredentialOptions(
                provider,
                apiCredentials,
                apiKeyConfigs,
                routing.apiCredential,
                t
              )}
              models={models}
              disabled={locked}
              modeLocked={fallbackReadOnly}
              providersSupported={providersSupported}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  providers: { ...current.providers, [provider]: value },
                }))
              }
              onPreferredChange={(value) =>
                setDraft((current) => {
                  const preferredAccounts = { ...current.preferredAccounts };
                  if (value) preferredAccounts[provider] = value;
                  else delete preferredAccounts[provider];
                  return { ...current, preferredAccounts };
                })
              }
            />
          );
        })}
      </div>

      <div className={styles.footer}>
        <p className={styles.summary} data-key-profile-summary>
          <span className={styles.caption}>
            {t('quota_management.key_profiles.editor.summary')}
          </span>{' '}
          {summary}
        </p>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            data-key-profile-save
            disabled={readOnly || !dirty || invalid}
            loading={saving}
            onClick={save}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
