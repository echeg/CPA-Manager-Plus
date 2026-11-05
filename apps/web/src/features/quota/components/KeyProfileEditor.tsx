import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  validFallbackSettings,
  withSuggestions,
} from '@/features/personal-quota-support/services/api/claudeFallback';
import type {
  RoutingProfile,
  RoutingSelectionOptions,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { getQuotaDisplayName } from '@/features/quota/utils/quota/identity';
import { chainSummary, copyOfShared, profileDirty } from '../keyProfilesModel';
import { maskQuotaName } from '../ledgerModel';
import {
  preferredAccountOptions,
  invalidTTL,
  selectionSlotOptions,
  withPickerRule,
  type RoutingProvider,
} from '../routingModel';
import { FallbackSettingsEditor } from './FallbackSettingsEditor';
import { Select } from './Select';
import styles from './KeyProfileEditor.module.scss';

const PROVIDERS: ReadonlyArray<{ id: RoutingProvider; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
];

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
  /** Saves the complete profile; the TTL is passed only when the default variant changed it. */
  onSave: (profile: RoutingProfile, ttl?: string) => void;
  onCancel: () => void;
}

/** The fallback editor fills an empty mapping list with suggestions, so the baseline does too. */
const withFallbackSuggestions = (profile: RoutingProfile): RoutingProfile => ({
  ...profile,
  claudeFallback: withSuggestions(profile.claudeFallback),
});

/** Editor for one routing profile: the four routing stages, plus the TTL for the default one. */
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

  const invalid =
    !draft.selection.primary.trim() || !validFallbackSettings(draft.claudeFallback) || ttlInvalid;
  // Creating a profile is a change even when the copy still equals the shared settings:
  // from then on the key no longer follows the default profile.
  const dirty = !baseline || profileDirty(draft, baseline, selectionOptions) || ttlChanged;

  const update = (patch: Partial<RoutingProfile>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const save = () => {
    if (readOnly || saving || !dirty || invalid) return;
    const profile = { ...draft, selection: withPickerRule(draft.selection, selectionOptions) };
    if (ttlChanged) onSave(profile, ttlDraft.trim());
    else onSave(profile);
  };

  const slots = selectionSlotOptions(t, selectionOptions, draft.selection);
  const summary = chainSummary(draft, files, showEmails, t);
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

      <section className={styles.stage} aria-labelledby={`${id}-accounts`}>
        <h4 id={`${id}-accounts`}>{t('quota_management.key_profiles.editor.accounts')}</h4>
        <div className={styles.row}>
          {PROVIDERS.map(({ id: provider, label }) => {
            const selected = draft.preferredAccounts[provider] ?? '';
            return (
              <Select
                key={provider}
                size="sm"
                className={styles.account}
                value={selected}
                options={preferredAccountOptions(provider, files, selected, displayName, t)}
                ariaLabel={t('quota_management.routing.preferred_account', {
                  provider: label,
                })}
                disabled={locked}
                onChange={(value) => {
                  const preferredAccounts = { ...draft.preferredAccounts };
                  if (value) preferredAccounts[provider] = value;
                  else delete preferredAccounts[provider];
                  update({ preferredAccounts });
                }}
              />
            );
          })}
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

      <section className={styles.stage} aria-labelledby={`${id}-fallback`}>
        <h4 id={`${id}-fallback`}>{t('quota_management.fallback.title')}</h4>
        <FallbackSettingsEditor
          value={draft.claudeFallback}
          models={models}
          disabled={locked}
          onChange={(claudeFallback) => update({ claudeFallback })}
        />
      </section>

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
