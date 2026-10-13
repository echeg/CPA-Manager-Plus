import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/features/quota/components/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { SubscriptionAccounts } from './SubscriptionAccounts';
import { useSubscriptionRouting } from '../hooks/useSubscriptionRouting';
import { maskQuotaText } from '../ledgerModel';
import styles from './SubscriptionRouting.module.scss';

export function SubscriptionRouting({
  disabled,
  files,
  showEmails,
}: {
  disabled: boolean;
  files: AuthFileItem[];
  showEmails: boolean;
}) {
  const { t } = useTranslation();
  const strategyId = useId();
  const {
    values,
    saving,
    error,
    saved,
    dirty,
    invalidTTL,
    blocked,
    options,
    strategyLabel,
    change,
    save,
    reload,
  } = useSubscriptionRouting(disabled);

  return (
    <section className={styles.panel} aria-label={t('quota_management.routing.title')}>
      <div className={styles.heading}>
        <h2>{t('quota_management.routing.title')}</h2>
        <span>{values ? strategyLabel : t('common.loading')}</span>
      </div>
      <div className={styles.content}>
        <p>{t('quota_management.routing.description')}</p>
        <div className={styles.fields}>
          <div className={styles.strategy}>
            <label id={strategyId}>
              {t('config_management.visual.sections.network.routing_strategy')}
            </label>
            <Select
              value={values?.strategy ?? 'round-robin'}
              options={options}
              ariaLabelledBy={strategyId}
              disabled={blocked}
              onChange={(strategy) => change({ strategy })}
            />
          </div>
          <div className={styles.affinity}>
            <ToggleSwitch
              checked={values?.sessionAffinity ?? false}
              disabled={blocked}
              onChange={(sessionAffinity) => change({ sessionAffinity })}
              label={t('config_management.visual.sections.network.session_affinity')}
            />
          </div>
          <Input
            label={t('config_management.visual.sections.network.session_affinity_ttl')}
            placeholder="1h"
            value={values?.sessionAffinityTTL ?? ''}
            disabled={blocked}
            title={t('quota_management.routing.ttl_hint')}
            error={invalidTTL ? t('quota_management.routing.invalid_ttl') : undefined}
            onChange={(event) => change({ sessionAffinityTTL: event.target.value })}
          />
        </div>
        <SubscriptionAccounts
          files={files}
          showEmails={showEmails}
          disabled={blocked}
          disconnected={disabled}
          preferredAccounts={values?.preferredAccounts ?? {}}
          onChange={(preferredAccounts) => change({ preferredAccounts })}
        />
        <p>{t('quota_management.routing.manual_hint')}</p>
        <p>{t('quota_management.routing.activity_hint')}</p>
        <div className={styles.actions}>
          <Button
            type="button"
            disabled={blocked || !dirty || invalidTTL}
            loading={saving}
            onClick={() => void save()}
          >
            {t('common.save')}
          </Button>
        </div>
        {error && (
          <div className={styles.error} role="alert">
            {showEmails ? error : maskQuotaText(error)}{' '}
            {!values && (
              <Button variant="secondary" size="sm" onClick={reload}>
                {t('common.refresh')}
              </Button>
            )}
          </div>
        )}
        {saved && (
          <div className={styles.saved} role="status">
            {t('quota_management.routing.saved')}
          </div>
        )}
      </div>
    </section>
  );
}
