import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/features/quota/components/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { CodexSpeed } from '@/features/personal-quota-support/services/api/routingProfiles';
import type { SubscriptionActivity } from '@/features/personal-quota-support/services/api/subscriptionRouting';
import type { AuthFileItem, ResolvedTheme } from '@/features/personal-quota-support/types';
import { getQuotaDisplayName } from '@/features/quota/utils/quota/identity';
import { useClaudeFallback } from '../hooks/useClaudeFallback';
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
import { ClientKeysModal } from './ClientKeysModal';
import { CodexSpeedModal } from './CodexSpeedModal';
import { RoutingProfilesModal } from './RoutingProfilesModal';
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
  | 'change'
  | 'save'
  | 'reload'
>;

/**
 * The Codex speed, Profiles and Keys buttons; set on a backend that serves
 * `/routing/profiles`.
 */
export interface ProfileButtonsProps {
  /** All client keys. */
  total: number;
  disabled: boolean;
  onOpenProfiles: () => void;
  onOpenKeys: () => void;
  /** The Default profile's Codex speed; unset on a backend without speed, so no button. */
  codexSpeed?: CodexSpeed;
  onOpenSpeed: () => void;
}

interface ToolbarProps {
  fallbackControl?: ReactNode;
  /** Renders the slim toolbar: Codex speed, last-routed indicators, Profiles and Keys. */
  profileButtons?: ProfileButtonsProps;
  routing: RoutingProps;
  activity: SubscriptionActivity[];
  activityState: ActivityState;
  files: AuthFileItem[];
  showEmails: boolean;
  /** True when the connection is not usable for this session. */
  disabled: boolean;
  resolvedTheme: ResolvedTheme;
}

interface LastRoutedProps {
  provider: (typeof PROVIDERS)[number];
  activity: SubscriptionActivity[];
  activityState: ActivityState;
  files: AuthFileItem[];
  disabled: boolean;
  displayName: (file: AuthFileItem) => string;
}

/** The time a provider last routed a request, with the account in the title. */
function LastRouted({
  provider,
  activity,
  activityState,
  files,
  disabled,
  displayName,
}: LastRoutedProps) {
  const { t, i18n } = useTranslation();
  const providerFiles = providerAccountFiles(provider, files);
  const latest = latestSubscriptionActivity(activity, provider, providerFiles);
  const latestFile =
    latest && providerFiles.find((file) => String(file.authIndex) === latest.authIndex);
  if (latestFile && latest && !disabled) {
    return (
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
    );
  }
  return (
    <span
      className={styles.last}
      data-last-selected={provider}
      title={t(activityStatusKey(disabled, activityState))}
    >
      —
    </span>
  );
}

/**
 * Subscription switching as one compact row. With `profileButtons` the shared routing
 * controls live in the Profiles modal, so the row keeps only the Codex speed button, the
 * last-routed indicators and the Profiles and Keys buttons.
 */
export function QuotaSettingsToolbar({
  routing,
  activity,
  activityState,
  files,
  showEmails,
  disabled,
  resolvedTheme,
  fallbackControl,
  profileButtons,
}: ToolbarProps) {
  const { t } = useTranslation();
  const id = useId();
  const { values, blocked, invalidTTL } = routing;
  const displayName = (file: AuthFileItem) => {
    const name = getQuotaDisplayName(file);
    return showEmails ? name : maskQuotaName(name);
  };
  const ttlErrorId = `${id}-ttl-error`;
  const lastRouted = (provider: (typeof PROVIDERS)[number]) => (
    <LastRouted
      provider={provider}
      activity={activity}
      activityState={activityState}
      files={files}
      disabled={disabled}
      displayName={displayName}
    />
  );

  if (profileButtons) {
    return (
      <section
        className={styles.bar}
        data-quota-settings
        data-toolbar="slim"
        aria-label={t('quota_management.routing.title')}
      >
        {profileButtons.codexSpeed && (
          <>
            <div className={styles.group}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-open-speed
                disabled={profileButtons.disabled}
                title={t('quota_management.codex_speed.button_hint')}
                onClick={profileButtons.onOpenSpeed}
              >
                {t('quota_management.codex_speed.button', {
                  speed: t(`quota_management.codex_speed.speed_${profileButtons.codexSpeed}`),
                })}
              </Button>
            </div>

            <span className={styles.separator} aria-hidden="true" />
          </>
        )}

        {PROVIDERS.map((provider) => (
          <div className={styles.group} key={provider}>
            <ProviderPill type={provider} resolvedTheme={resolvedTheme} />
            {lastRouted(provider)}
          </div>
        ))}

        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-open-profiles
            disabled={profileButtons.disabled}
            title={t('quota_management.key_profiles.profiles_button_hint')}
            onClick={profileButtons.onOpenProfiles}
          >
            {t('quota_management.key_profiles.profiles_button')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-open-keys
            disabled={profileButtons.disabled}
            title={t('quota_management.client_keys.button_hint', { count: profileButtons.total })}
            onClick={profileButtons.onOpenKeys}
          >
            {t('quota_management.client_keys.button', { count: profileButtons.total })}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className={styles.bar}
      data-quota-settings
      aria-label={t('quota_management.routing.title')}
    >
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
        const preferred = values?.preferredAccounts ?? {};
        const selected = preferred[provider] ?? '';
        const options = preferredAccountOptions(provider, files, selected, displayName, t);
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
            {lastRouted(provider)}
          </div>
        );
      })}

      {fallbackControl}

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

      {routing.error && (
        <div className={styles.error} role="alert">
          {showEmails ? routing.error : maskQuotaText(routing.error)}{' '}
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

type ModalName = 'keys' | 'profiles' | 'speed';

/**
 * Which modal is open. `focus` is the raw key the Profiles modal opens on (memory only);
 * it is armed once the reload started by the navigation is seen, so the editor copies
 * fresh rows rather than the cached ones. `fromKeys` renders "← Back to keys".
 */
interface Navigation {
  open: ModalName | null;
  focus?: string;
  focusArmed: boolean;
  fromKeys: boolean;
}

const CLOSED: Navigation = { open: null, focusArmed: false, fromKeys: false };

/** Wires the toolbar to live routing, activity, fallback and key profile state. */
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
  // The legacy routing form; on a backend with /routing/profiles the Profiles modal
  // is the only writer of the shared profile, so this form is not rendered there.
  const routing = useSubscriptionRouting(disabled);
  // The fallback control of the legacy toolbar, and the model lists of the editors.
  const fallback = useClaudeFallback(disabled);
  const { activity, activityState } = useSubscriptionActivity(disabled);
  const [nav, setNav] = useState<Navigation>(CLOSED);

  // The slim toolbar shows until a load reports a backend without /routing/profiles.
  const slim = profilesState ? !profilesState.unsupportedBackend : true;
  // Before the first load the buttons wait; a failed first load enables them, so the
  // modal can show the error and retry.
  const buttonsDisabled = disabled || (!profilesState && !keyProfiles.error);

  if (nav.focus && !nav.focusArmed && keyProfiles.loading) {
    setNav({ ...nav, focusArmed: true });
  }

  const navigate = (next: Navigation) => {
    setNav(next);
    keyProfiles.reload();
  };
  const openKeys = () => navigate({ open: 'keys', focusArmed: false, fromKeys: false });
  const openProfiles = () => navigate({ open: 'profiles', focusArmed: false, fromKeys: false });
  const openSpeed = () => navigate({ open: 'speed', focusArmed: false, fromKeys: false });
  const openProfilesForKey = (key: string) =>
    navigate({ open: 'profiles', focus: key, focusArmed: false, fromKeys: true });
  const close = () => setNav(CLOSED);
  const models = fallback.state?.models ?? EMPTY_MODELS;
  // The standalone control duplicates the default profile and cannot show the API-key
  // target, so a backend with per-provider routing edits the fallback in the profiles only.
  // Like `slim`, it assumes such a backend until a load reports an older one.
  const showFallbackControl = Boolean(profilesState && !profilesState.providersSupported);
  // No speed button until a load reports a backend that serves the Codex speed.
  const codexSpeed = profilesState?.speedSupported
    ? profilesState.shared.providers.codex.speed
    : undefined;

  return (
    <>
      <QuotaSettingsToolbar
        routing={routing}
        activity={activity}
        activityState={activityState}
        files={files}
        showEmails={showEmails}
        disabled={disabled}
        resolvedTheme={resolvedTheme}
        fallbackControl={
          showFallbackControl ? (
            <ClaudeFallbackControl
              disabled={disabled}
              showEmails={showEmails}
              fallback={fallback}
            />
          ) : undefined
        }
        profileButtons={
          slim
            ? {
                total: keyProfiles.total,
                disabled: buttonsDisabled,
                onOpenProfiles: openProfiles,
                onOpenKeys: openKeys,
                codexSpeed,
                onOpenSpeed: openSpeed,
              }
            : undefined
        }
      />
      {slim && (
        <>
          <RoutingProfilesModal
            open={nav.open === 'profiles'}
            onClose={close}
            keyProfiles={keyProfiles}
            files={files}
            showEmails={showEmails}
            models={models}
            focus={nav.focusArmed ? nav.focus : undefined}
            onBackToKeys={nav.fromKeys ? openKeys : undefined}
          />
          <ClientKeysModal
            open={nav.open === 'keys'}
            onClose={close}
            keyProfiles={keyProfiles}
            files={files}
            showEmails={showEmails}
            onOpenProfiles={openProfilesForKey}
          />
          <CodexSpeedModal
            open={nav.open === 'speed'}
            onClose={close}
            keyProfiles={keyProfiles}
            showEmails={showEmails}
          />
        </>
      )}
    </>
  );
}

const EMPTY_MODELS = { claude: [], codex: [] };
