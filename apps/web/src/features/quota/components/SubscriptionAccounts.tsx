import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/features/quota/components/Select';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { getQuotaDisplayName } from '@/features/quota/utils/quota/identity';
import { maskQuotaName } from '../ledgerModel';
import { activityStatusKey, latestSubscriptionActivity } from '../routingModel';
import { useSubscriptionActivity } from '../hooks/useSubscriptionActivity';
import styles from './SubscriptionRouting.module.scss';

const PROVIDERS = ['codex', 'claude'] as const;

interface Props {
  files: AuthFileItem[];
  showEmails: boolean;
  disabled: boolean;
  disconnected: boolean;
  preferredAccounts: Record<string, string>;
  onChange: (accounts: Record<string, string>) => void;
}

export function SubscriptionAccounts({
  files,
  showEmails,
  disabled,
  disconnected,
  preferredAccounts,
  onChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { activity, activityState } = useSubscriptionActivity(disconnected);

  const displayName = (file: AuthFileItem) => {
    const name = getQuotaDisplayName(file);
    return showEmails ? name : maskQuotaName(name);
  };

  return (
    <div className={styles.accounts}>
      {PROVIDERS.map((provider) => {
        const providerFiles = files.filter(
          (file) => (file.provider ?? file.type) === provider && String(file.authIndex ?? '')
        );
        const selected = preferredAccounts[provider] ?? '';
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
          <div className={styles.account} key={provider}>
            <label id={`${id}-${provider}`}>
              {t('quota_management.routing.preferred_account', { provider: providerLabel })}
            </label>
            <Select
              value={selected}
              options={options}
              ariaLabelledBy={`${id}-${provider}`}
              disabled={disabled}
              onChange={(value) => onChange({ ...preferredAccounts, [provider]: value })}
            />
            <div className={styles.activity}>
              <span>{t('quota_management.routing.last_selected')}</span>
              {latestFile && latest && !disconnected ? (
                <>
                  <strong>{displayName(latestFile)}</strong>
                  <time dateTime={latest.lastSelectedAt}>
                    {new Date(latest.lastSelectedAt).toLocaleString(i18n.language)}
                  </time>
                </>
              ) : (
                <strong>{t(activityStatusKey(disconnected, activityState))}</strong>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
