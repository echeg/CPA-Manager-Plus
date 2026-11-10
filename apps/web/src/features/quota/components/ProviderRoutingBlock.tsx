import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedTabs, type SegmentedTabItem } from '@/components/ui/SegmentedTabs';
import {
  FALLBACK_TARGETS,
  type ApiProvider,
  type FallbackTarget,
  type ProviderMode,
  type ProviderRouting,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { providerFieldErrors, type ApiKeyOption } from '../providerRoutingModel';
import { FallbackModeMappings } from './FallbackSettingsEditor';
import { Select, type SelectOption } from './Select';
import toolbarStyles from './QuotaSettingsToolbar.module.scss';
import styles from './ProviderRoutingBlock.module.scss';

const PROVIDER_LABELS: Record<ApiProvider, string> = { claude: 'Claude', codex: 'Codex' };

/** The AI Providers page; the app uses a hash router, so a plain link needs no router context. */
const AI_PROVIDERS_HREF = '#/ai-providers';

export interface ProviderRoutingBlockProps {
  provider: ApiProvider;
  value: ProviderRouting;
  /** The preferred subscription's `auth_index`; `''` for Automatic. */
  preferred: string;
  preferredOptions: SelectOption[];
  /** From `apiCredentialOptions`; empty when the provider has no API key configured. */
  apiKeyOptions: ApiKeyOption[];
  models: { claude: string[]; codex: string[] };
  /** Nothing can be changed (read-only profile or a save in progress). */
  disabled: boolean;
  /** Mode and fallback are locked (`supported: false`); Preferred stays editable. */
  modeLocked: boolean;
  /** `false` on an older backend: only Subscription mode and the Codex target can be written. */
  providersSupported: boolean;
  onChange: (value: ProviderRouting) => void;
  onPreferredChange: (authIndex: string) => void;
}

/**
 * One provider's routing in a profile: Subscription mode with a preferred subscription
 * and a fallback target, or API key mode. Values hidden by the current mode or target
 * (the mapping table, the chosen key) stay in `value`, so switching back restores them.
 */
export function ProviderRoutingBlock({
  provider,
  value,
  preferred,
  preferredOptions,
  apiKeyOptions,
  models,
  disabled,
  modeLocked,
  providersSupported,
  onChange,
  onPreferredChange,
}: ProviderRoutingBlockProps) {
  const { t } = useTranslation();
  const id = useId();
  const label = PROVIDER_LABELS[provider];
  const noKeys = apiKeyOptions.length === 0;
  const routingLocked = disabled || modeLocked;
  const errors = providerFieldErrors(provider, value, providersSupported);

  // Why an "API key" choice is unavailable; `undefined` when it can be chosen.
  const apiUnavailable = !providersSupported
    ? t('quota_management.provider_routing.requires_backend')
    : noKeys
      ? t('quota_management.provider_routing.no_keys', { provider: label })
      : undefined;

  const modeItems: SegmentedTabItem<ProviderMode>[] = [
    { id: 'subscription', label: t('quota_management.provider_routing.mode_subscription') },
    {
      id: 'api',
      label: t('quota_management.provider_routing.mode_api'),
      disabled: Boolean(apiUnavailable),
      title: apiUnavailable,
    },
  ];
  const targetItems: SegmentedTabItem<FallbackTarget>[] = FALLBACK_TARGETS[provider].map(
    (target) => ({
      id: target,
      label: t(`quota_management.provider_routing.target_${target}`),
      ...(target === 'api' && apiUnavailable ? { disabled: true, title: apiUnavailable } : {}),
    })
  );
  // The mapping table shows its own error; a hidden one still blocks the save, so say why.
  const mappingsShown = value.mode !== 'api' && value.fallback.target === 'codex';

  const selectedKey = apiKeyOptions.find((option) => option.value === value.apiCredential.trim());
  const keyErrorId = `${id}-key-error`;
  const keyWarningId = `${id}-key-warning`;
  const keyHintId = `${id}-key-hint`;
  const keyWarning =
    selectedKey?.status === 'disabled'
      ? t('quota_management.provider_routing.key_disabled_warning')
      : selectedKey?.status === 'unknown'
        ? t('quota_management.provider_routing.key_unknown_warning')
        : '';

  const apiKeyField = (hint: string) => (
    <div className={styles.field} data-provider-api-key>
      <div className={styles.row}>
        <span className={styles.caption} id={`${id}-key`}>
          {t('quota_management.provider_routing.api_key')}
        </span>
        <Select
          size="sm"
          className={styles.select}
          value={value.apiCredential.trim()}
          options={apiKeyOptions}
          placeholder={t('quota_management.provider_routing.api_key_placeholder')}
          ariaLabel={t('quota_management.provider_routing.api_key_label', { provider: label })}
          ariaInvalid={errors.apiCredential ? true : undefined}
          ariaDescribedBy={
            [errors.apiCredential ? keyErrorId : '', keyWarning ? keyWarningId : '', keyHintId]
              .filter(Boolean)
              .join(' ') || undefined
          }
          disabled={routingLocked || !providersSupported || (noKeys && !value.apiCredential)}
          onChange={(apiCredential) => onChange({ ...value, apiCredential })}
        />
      </div>
      {errors.apiCredential && (
        <span id={keyErrorId} role="alert" className={styles.fieldError}>
          {t(errors.apiCredential)}
        </span>
      )}
      {keyWarning && (
        <p id={keyWarningId} className={styles.warning} data-provider-key-warning>
          {keyWarning}
        </p>
      )}
      <p id={keyHintId} className={styles.hint}>
        {hint}
      </p>
    </div>
  );

  const preferredRow = (
    <div className={styles.row}>
      <span className={styles.caption} id={`${id}-preferred`}>
        {t('quota_management.key_profiles.editor.accounts')}
      </span>
      <Select
        size="sm"
        className={styles.select}
        value={preferred}
        options={preferredOptions}
        ariaLabel={t('quota_management.routing.preferred_account', { provider: label })}
        disabled={disabled}
        onChange={onPreferredChange}
      />
    </div>
  );

  return (
    <section
      className={styles.block}
      aria-labelledby={`${id}-title`}
      data-provider-routing={provider}
    >
      <h4 id={`${id}-title`} className={styles.title}>
        {label}
      </h4>

      <div className={styles.field}>
        <SegmentedTabs
          items={modeItems}
          activeTab={value.mode}
          ariaLabel={t('quota_management.provider_routing.mode', { provider: label })}
          idBase={`${id}-mode`}
          className={styles.segmented}
          responsiveFullWidth={false}
          disabled={routingLocked || !providersSupported}
          onChange={(mode) => onChange({ ...value, mode })}
        />
        {modeLocked && (
          <p className={styles.hint} data-provider-routing-locked>
            {t('quota_management.provider_routing.locked')}
          </p>
        )}
        {!providersSupported && (
          <p className={styles.hint} data-provider-routing-old-backend>
            {t('quota_management.provider_routing.requires_backend')}
          </p>
        )}
        {providersSupported && noKeys && (
          <p className={styles.hint} data-provider-routing-no-keys>
            {t('quota_management.provider_routing.no_keys', { provider: label })}{' '}
            <a href={AI_PROVIDERS_HREF}>{t('quota_management.provider_routing.no_keys_link')}</a>
          </p>
        )}
      </div>

      {value.mode === 'api' ? (
        <>
          {/* CPA ignores the mode while it is locked, so the subscription still routes. */}
          {modeLocked && preferredRow}
          {apiKeyField(t('quota_management.provider_routing.api_mode_hint'))}
        </>
      ) : (
        <>
          {preferredRow}

          <div className={styles.row}>
            <span className={styles.caption}>
              {t('quota_management.provider_routing.fallback')}
            </span>
            <SegmentedTabs
              items={targetItems}
              activeTab={value.fallback.target}
              ariaLabel={t('quota_management.provider_routing.fallback_label', {
                provider: label,
              })}
              idBase={`${id}-target`}
              className={styles.segmented}
              responsiveFullWidth={false}
              disabled={routingLocked}
              onChange={(target) => onChange({ ...value, fallback: { ...value.fallback, target } })}
            />
          </div>

          {mappingsShown && (
            <div className={toolbarStyles.fallbackEditor} data-provider-codex-fallback>
              <FallbackModeMappings
                value={value.fallback}
                models={models}
                disabled={routingLocked}
                onChange={({ mode, mappings }) =>
                  onChange({ ...value, fallback: { ...value.fallback, mode, mappings } })
                }
              />
            </div>
          )}
          {value.fallback.target === 'api' &&
            apiKeyField(t('quota_management.provider_routing.api_fallback_hint'))}
        </>
      )}
      {errors.mappings && !mappingsShown && (
        <p role="alert" className={styles.fieldError} data-provider-hidden-mappings-error>
          {t('quota_management.provider_routing.errors.hidden_mappings')}
        </p>
      )}
    </section>
  );
}
