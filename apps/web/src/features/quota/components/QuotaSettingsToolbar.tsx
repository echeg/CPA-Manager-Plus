import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/features/quota/components/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { RoutingProfilesState } from '@/features/personal-quota-support/services/api/routingProfiles';
import type { SubscriptionActivity } from '@/features/personal-quota-support/services/api/subscriptionRouting';
import type { AuthFileItem, ResolvedTheme } from '@/features/personal-quota-support/types';
import { getQuotaDisplayName } from '@/features/quota/utils/quota/identity';
import { useClaudeFallback } from '../hooks/useClaudeFallback';
import { useCodexFastMode, type CodexFastModeState } from '../hooks/useCodexFastMode';
import { useKeyProfiles } from '../hooks/useKeyProfiles';
import { useSubscriptionActivity } from '../hooks/useSubscriptionActivity';
import {
  useSubscriptionRouting,
  type SubscriptionRoutingState,
} from '../hooks/useSubscriptionRouting';
import { maskQuotaName, maskQuotaText } from '../ledgerModel';
import {
  activityStatusKey,
  latestSubscriptionActivity,
  preferredAccountOptions,
  providerAccountFiles,
  type ActivityState,
} from '../routingModel';
import { ProviderPill } from './ProviderPill';
import { ClaudeFallbackControl } from './ClaudeFallbackControl';
import { KeyProfilesModal } from './KeyProfilesModal';
import styles from './QuotaSettingsToolbar.module.scss';

const PROVIDERS = ['codex', 'claude'] as const;

type RoutingProps = Pick<
  SubscriptionRoutingState,
  | 'values'
  | 'saving'
  | 'error'
  | 'saved'
  | 'dirty'
  | 'invalidTTL'
  | 'blocked'
  | 'options'
  | 'slots'
  | 'change'
  | 'save'
  | 'reload'
>;

/** The "Keys N/M" button that opens the per-key routing profiles. */
export interface KeyProfilesButtonProps {
  /** Keys with their own profile. */
  count: number;
  /** All client keys. */
  total: number;
  /** True on a backend without `/routing/profiles`. */
  hidden: boolean;
  disabled: boolean;
  onOpen: () => void;
}

interface ToolbarProps {
  fallbackControl?: ReactNode;
  keyProfiles?: KeyProfilesButtonProps;
  routing: RoutingProps;
  fastMode: CodexFastModeState;
  activity: SubscriptionActivity[];
  activityState: ActivityState;
  files: AuthFileItem[];
  showEmails: boolean;
  /** True when the connection is not usable for this session. */
  disabled: boolean;
  resolvedTheme: ResolvedTheme;
}

/** Subscription switching and Codex Fast mode as one compact row. */
export function QuotaSettingsToolbar({
  routing,
  fastMode,
  activity,
  activityState,
  files,
  showEmails,
  disabled,
  resolvedTheme,
  fallbackControl,
  keyProfiles,
}: ToolbarProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { values, blocked, invalidTTL } = routing;
  const slots = routing.slots ?? null;
  const selection = values?.selection;
  const displayName = (file: AuthFileItem) => {
    const name = getQuotaDisplayName(file);
    return showEmails ? name : maskQuotaName(name);
  };
  const ttlErrorId = `${id}-ttl-error`;

  return (
    <section
      className={styles.bar}
      data-quota-settings
      aria-label={t('quota_management.routing.title')}
    >
      {slots ? (
        <div className={styles.group} title={t('quota_management.routing.selection_hint')}>
          <span className={styles.caption} id={`${id}-primary`}>
            {t('quota_management.routing.primary')}
          </span>
          <Select
            size="sm"
            className={styles.slot}
            value={selection?.primary ?? ''}
            options={slots.primary}
            ariaLabelledBy={`${id}-primary`}
            disabled={blocked}
            onChange={(primary) => routing.change({ selection: { ...selection, primary } })}
          />
          <span className={styles.caption} id={`${id}-tiebreak`}>
            {t('quota_management.routing.tiebreak')}
          </span>
          <Select
            size="sm"
            className={styles.slot}
            value={slots.tiebreakDisabled ? '' : (selection?.tiebreak ?? '')}
            options={slots.tiebreak}
            ariaLabelledBy={`${id}-tiebreak`}
            ariaDescribedBy={slots.tiebreakDisabled ? `${id}-tiebreak-hint` : undefined}
            disabled={blocked || slots.tiebreakDisabled}
            onChange={(tiebreak) =>
              routing.change({
                selection: { primary: selection?.primary ?? '', tiebreak: tiebreak || undefined },
              })
            }
          />
          {slots.tiebreakDisabled && (
            <span id={`${id}-tiebreak-hint`} className={styles.slotHint}>
              {t('quota_management.routing.tiebreak_inactive')}
            </span>
          )}
        </div>
      ) : (
        <div className={styles.group} title={t('quota_management.routing.description')}>
          <span className={styles.caption} id={`${id}-strategy`}>
            {t('quota_management.toolbar.switching')}
          </span>
          <Select
            size="sm"
            className={styles.strategy}
            value={values?.strategy ?? 'round-robin'}
            options={routing.options}
            ariaLabelledBy={`${id}-strategy`}
            disabled={blocked}
            onChange={(strategy) => routing.change({ strategy })}
          />
        </div>
      )}

      <div className={styles.group} title={t('quota_management.routing.ttl_hint')}>
        <span
          className={styles.switch}
          data-switch="affinity"
          data-state={values?.sessionAffinity ? 'on' : 'off'}
        >
          <ToggleSwitch
            checked={values?.sessionAffinity ?? false}
            disabled={blocked}
            onChange={(sessionAffinity) => routing.change({ sessionAffinity })}
            label={t('config_management.visual.sections.network.session_affinity')}
          />
        </span>
        <input
          className={`input ${styles.ttl}`}
          aria-label={t('config_management.visual.sections.network.session_affinity_ttl')}
          aria-invalid={invalidTTL}
          aria-describedby={invalidTTL ? ttlErrorId : undefined}
          placeholder="1h"
          value={values?.sessionAffinityTTL ?? ''}
          disabled={blocked}
          onChange={(event) => routing.change({ sessionAffinityTTL: event.target.value })}
        />
        {invalidTTL && (
          <span id={ttlErrorId} className={styles.fieldError}>
            {t('quota_management.routing.invalid_ttl')}
          </span>
        )}
      </div>

      <span className={styles.separator} aria-hidden="true" />

      {PROVIDERS.map((provider) => {
        const providerFiles = providerAccountFiles(provider, files);
        const preferred = values?.preferredAccounts ?? {};
        const selected = preferred[provider] ?? '';
        const options = preferredAccountOptions(provider, files, selected, displayName, t);
        const latest = latestSubscriptionActivity(activity, provider, providerFiles);
        const latestFile =
          latest && providerFiles.find((file) => String(file.authIndex) === latest.authIndex);
        const providerLabel = provider === 'codex' ? 'Codex' : 'Claude';
        return (
          <div
            className={styles.group}
            key={provider}
            title={t('quota_management.routing.manual_hint')}
          >
            <ProviderPill type={provider} resolvedTheme={resolvedTheme} />
            <Select
              size="sm"
              className={styles.account}
              value={selected}
              options={options}
              ariaLabel={t('quota_management.routing.preferred_account', {
                provider: providerLabel,
              })}
              disabled={blocked}
              onChange={(value) =>
                routing.change({ preferredAccounts: { ...preferred, [provider]: value } })
              }
            />
            {latestFile && latest && !disabled ? (
              <time
                className={styles.last}
                data-last-selected={provider}
                dateTime={latest.lastSelectedAt}
                title={`${t('quota_management.toolbar.last', {
                  name: displayName(latestFile),
                  time: new Date(latest.lastSelectedAt).toLocaleString(i18n.language),
                })} — ${t('quota_management.routing.activity_hint')}`}
              >
                {new Date(latest.lastSelectedAt).toLocaleTimeString(i18n.language, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            ) : (
              <span
                className={styles.last}
                data-last-selected={provider}
                title={t(activityStatusKey(disabled, activityState))}
              >
                —
              </span>
            )}
          </div>
        );
      })}

      <span className={styles.separator} aria-hidden="true" />

      <div className={styles.group} title={t('quota_management.codex_fast.description')}>
        <span
          className={styles.switch}
          data-switch="fast-mode"
          data-state={fastMode.enabled ? 'on' : 'off'}
        >
          <ToggleSwitch
            checked={fastMode.enabled ?? false}
            disabled={disabled || fastMode.saving || fastMode.enabled === null}
            onChange={(next) => void fastMode.toggle(next)}
            label={t('quota_management.codex_fast.title')}
          />
        </span>
      </div>

      {fallbackControl}

      {keyProfiles && !keyProfiles.hidden && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-key-profiles
          disabled={keyProfiles.disabled}
          title={t('quota_management.key_profiles.button_hint', {
            count: keyProfiles.count,
            total: keyProfiles.total,
          })}
          onClick={keyProfiles.onOpen}
        >
          {t('quota_management.key_profiles.button', {
            count: keyProfiles.count,
            total: keyProfiles.total,
          })}
        </Button>
      )}

      <div className={styles.actions}>
        {routing.saved && (
          <span className={styles.saved} role="status">
            {t('quota_management.routing.saved')}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          data-routing-save
          disabled={blocked || !routing.dirty || invalidTTL}
          loading={routing.saving}
          onClick={() => void routing.save()}
        >
          {t('common.save')}
        </Button>
      </div>

      {(routing.error || fastMode.error) && (
        <div className={styles.error} role="alert">
          {[routing.error, fastMode.error]
            .filter(Boolean)
            .map((message) => (showEmails ? message : maskQuotaText(message)))
            .join(' · ')}{' '}
          {routing.error && !values && (
            <Button variant="secondary" size="sm" onClick={routing.reload}>
              {t('common.refresh')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** The toolbar button state, kept across profile reloads so the button does not flicker. */
interface KeyProfilesButtonSnapshot {
  state: RoutingProfilesState;
  count: number;
  total: number;
}

/** Wires the toolbar to live routing, fast mode, activity, fallback and key profile state. */
export function QuotaSettingsBar({
  disabled,
  files,
  showEmails,
  resolvedTheme,
}: {
  disabled: boolean;
  files: AuthFileItem[];
  showEmails: boolean;
  resolvedTheme: ResolvedTheme;
}) {
  const keyProfiles = useKeyProfiles(disabled);
  const profilesState = keyProfiles.state;
  const routing = useSubscriptionRouting(disabled, {
    supported: profilesState ? !profilesState.unsupportedBackend : false,
    selection: profilesState?.shared.selection,
    selectionOptions: profilesState?.selectionOptions,
    loading: keyProfiles.loading,
    reload: keyProfiles.reload,
  });
  // A fallback change rewrites the shared profile, so the key summaries reload.
  const fallback = useClaudeFallback(disabled, keyProfiles.reload);
  const fastMode = useCodexFastMode(disabled);
  const { activity, activityState } = useSubscriptionActivity(disabled);
  const [modalOpen, setModalOpen] = useState(false);

  // The profiles reset to null while they reload; keep the last loaded button state.
  const [snapshot, setSnapshot] = useState<KeyProfilesButtonSnapshot | null>(null);
  if (profilesState && snapshot?.state !== profilesState) {
    setSnapshot({ state: profilesState, count: keyProfiles.count, total: keyProfiles.total });
  }
  const known = profilesState ? { count: keyProfiles.count, total: keyProfiles.total } : snapshot;
  const knownState = profilesState ?? snapshot?.state;

  const openModal = () => {
    setModalOpen(true);
    keyProfiles.reload();
  };

  return (
    <>
      <QuotaSettingsToolbar
        routing={routing}
        fastMode={fastMode}
        activity={activity}
        activityState={activityState}
        files={files}
        showEmails={showEmails}
        disabled={disabled}
        resolvedTheme={resolvedTheme}
        fallbackControl={
          <ClaudeFallbackControl disabled={disabled} showEmails={showEmails} fallback={fallback} />
        }
        keyProfiles={{
          count: known?.count ?? 0,
          total: known?.total ?? 0,
          // Hidden on an older backend and until the first load; a failed first load
          // still shows the button so the modal can report the error and retry.
          hidden: knownState ? knownState.unsupportedBackend : !keyProfiles.error,
          disabled,
          onOpen: openModal,
        }}
      />
      <KeyProfilesModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        keyProfiles={keyProfiles}
        files={files}
        showEmails={showEmails}
        models={fallback.state?.models ?? EMPTY_MODELS}
        sessionAffinityTTL={routing.values?.sessionAffinityTTL}
      />
    </>
  );
}

const EMPTY_MODELS = { claude: [], codex: [] };
