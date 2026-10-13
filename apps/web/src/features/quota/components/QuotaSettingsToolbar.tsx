import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/features/quota/components/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { SubscriptionActivity } from '@/features/personal-quota-support/services/api/subscriptionRouting';
import type { AuthFileItem, ResolvedTheme } from '@/features/personal-quota-support/types';
import { getQuotaDisplayName } from '@/features/quota/utils/quota/identity';
import { useCodexFastMode, type CodexFastModeState } from '../hooks/useCodexFastMode';
import { useSubscriptionActivity } from '../hooks/useSubscriptionActivity';
import {
  useSubscriptionRouting,
  type SubscriptionRoutingState,
} from '../hooks/useSubscriptionRouting';
import { maskQuotaName, maskQuotaText } from '../ledgerModel';
import { activityStatusKey, latestSubscriptionActivity, type ActivityState } from '../routingModel';
import { ProviderPill } from './ProviderPill';
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

interface ToolbarProps {
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
}: ToolbarProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { values, blocked, invalidTTL } = routing;
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
        const providerFiles = files.filter(
          (file) => (file.provider ?? file.type) === provider && String(file.authIndex ?? '')
        );
        const preferred = values?.preferredAccounts ?? {};
        const selected = preferred[provider] ?? '';
        const options = [
          { value: '', label: t('quota_management.routing.automatic') },
          ...providerFiles.map((file) => ({
            value: String(file.authIndex),
            label:
              displayName(file) +
              (file.disabled ? ` · ${t('quota_management.routing.disabled_account')}` : ''),
          })),
        ];
        if (selected && !providerFiles.some((file) => String(file.authIndex) === selected)) {
          options.push({ value: selected, label: t('quota_management.routing.missing_account') });
        }
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

/** Wires the toolbar to live routing, fast mode and activity state. */
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
  const routing = useSubscriptionRouting(disabled);
  const fastMode = useCodexFastMode(disabled);
  const { activity, activityState } = useSubscriptionActivity(disabled);
  return (
    <QuotaSettingsToolbar
      routing={routing}
      fastMode={fastMode}
      activity={activity}
      activityState={activityState}
      files={files}
      showEmails={showEmails}
      disabled={disabled}
      resolvedTheme={resolvedTheme}
    />
  );
}
