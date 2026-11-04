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

type EditorMode = 'shared' | 'own';

export interface KeyProfileEditorProps {
  /** The key's stored profile, or null when it follows the shared settings. */
  profile: RoutingProfile | null;
  shared: RoutingProfile;
  files: AuthFileItem[];
  showEmails: boolean;
  selectionOptions: RoutingSelectionOptions;
  models: { claude: string[]; codex: string[] };
  saving: boolean;
  /** The backend reports `supported: false`; nothing can be changed. */
  readOnly: boolean;
  /** The global session-affinity TTL, shown as text because it is not per key. */
  sessionAffinityTTL?: string;
  /** Saves the complete profile, or null to return the key to the shared settings. */
  onSave: (profile: RoutingProfile | null) => void;
  onCancel: () => void;
}

/** The fallback editor fills an empty mapping list with suggestions, so the baseline does too. */
const withFallbackSuggestions = (profile: RoutingProfile): RoutingProfile => ({
  ...profile,
  claudeFallback: withSuggestions(profile.claudeFallback),
});

/** Editor for one client key: shared settings or its own copy of the four routing stages. */
export function KeyProfileEditor({
  profile,
  shared,
  files,
  showEmails,
  selectionOptions,
  models,
  saving,
  readOnly,
  sessionAffinityTTL,
  onSave,
  onCancel,
}: KeyProfileEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<EditorMode>(profile ? 'own' : 'shared');
  // A key without a profile gets its draft when the user switches to "own".
  const [draft, setDraft] = useState<RoutingProfile | null>(() =>
    profile ? withFallbackSuggestions(copyOfShared(profile)) : null
  );
  const baseline = useMemo(() => (profile ? withFallbackSuggestions(profile) : null), [profile]);
  const locked = readOnly || saving;

  const displayName = (file: AuthFileItem) => {
    const name = getQuotaDisplayName(file);
    return showEmails ? name : maskQuotaName(name);
  };

  const chooseMode = (next: EditorMode) => {
    if (locked || next === mode) return;
    if (next === 'own' && !draft) setDraft(withFallbackSuggestions(copyOfShared(shared)));
    setMode(next);
  };

  const ownDraft = mode === 'own' ? draft : null;
  const invalid =
    !!ownDraft &&
    (!ownDraft.selection.primary.trim() || !validFallbackSettings(ownDraft.claudeFallback));
  // Creating a profile is a change even when the copy still equals the shared settings:
  // from then on the key no longer follows the toolbar.
  const dirty = ownDraft
    ? !baseline || profileDirty(ownDraft, baseline, selectionOptions)
    : profile !== null;

  const update = (patch: Partial<RoutingProfile>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const save = () => {
    if (readOnly || saving || !dirty || invalid) return;
    onSave(
      ownDraft
        ? { ...ownDraft, selection: withPickerRule(ownDraft.selection, selectionOptions) }
        : null
    );
  };

  const slots = ownDraft ? selectionSlotOptions(t, selectionOptions, ownDraft.selection) : null;
  const summary = chainSummary(ownDraft ?? shared, files, showEmails, t);

  return (
    <div className={styles.editor} data-key-profile-editor>
      {readOnly && (
        <p className={styles.notice} role="note">
          {t('quota_management.key_profiles.editor.read_only')}
        </p>
      )}

      <div
        className={styles.segmented}
        role="radiogroup"
        aria-label={t('quota_management.key_profiles.editor.mode')}
      >
        {(['shared', 'own'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            data-mode={value}
            className={mode === value ? styles.segmentActive : styles.segment}
            disabled={locked}
            onClick={() => chooseMode(value)}
          >
            {t(`quota_management.key_profiles.editor.mode_${value}`)}
          </button>
        ))}
      </div>

      {!ownDraft || !slots ? (
        <p className={styles.hint}>{t('quota_management.key_profiles.editor.shared_hint')}</p>
      ) : (
        <>
          <section className={styles.stage} aria-labelledby={`${id}-sticky`}>
            <h4 id={`${id}-sticky`}>{t('quota_management.key_profiles.editor.sticky')}</h4>
            <div className={styles.row}>
              <ToggleSwitch
                checked={ownDraft.sessionAffinity}
                disabled={locked}
                onChange={(sessionAffinity) => update({ sessionAffinity })}
                label={t('config_management.visual.sections.network.session_affinity')}
              />
              {sessionAffinityTTL?.trim() && (
                <span className={styles.hint}>
                  {t('quota_management.key_profiles.editor.ttl', {
                    ttl: sessionAffinityTTL.trim(),
                  })}
                </span>
              )}
            </div>
          </section>

          <section className={styles.stage} aria-labelledby={`${id}-accounts`}>
            <h4 id={`${id}-accounts`}>{t('quota_management.key_profiles.editor.accounts')}</h4>
            <div className={styles.row}>
              {PROVIDERS.map(({ id: provider, label }) => {
                const selected = ownDraft.preferredAccounts[provider] ?? '';
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
                      const preferredAccounts = { ...ownDraft.preferredAccounts };
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
                value={ownDraft.selection.primary}
                options={slots.primary}
                ariaLabelledBy={`${id}-primary`}
                disabled={locked}
                onChange={(primary) => update({ selection: { ...ownDraft.selection, primary } })}
              />
              <span className={styles.caption} id={`${id}-tiebreak`}>
                {t('quota_management.routing.tiebreak')}
              </span>
              <Select
                size="sm"
                className={styles.slot}
                value={slots.tiebreakDisabled ? '' : (ownDraft.selection.tiebreak ?? '')}
                options={slots.tiebreak}
                ariaLabelledBy={`${id}-tiebreak`}
                ariaDescribedBy={slots.tiebreakDisabled ? `${id}-tiebreak-hint` : undefined}
                disabled={locked || slots.tiebreakDisabled}
                onChange={(tiebreak) =>
                  update({
                    selection: {
                      primary: ownDraft.selection.primary,
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
              value={ownDraft.claudeFallback}
              models={models}
              disabled={locked}
              onChange={(claudeFallback) => update({ claudeFallback })}
            />
          </section>
        </>
      )}

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
