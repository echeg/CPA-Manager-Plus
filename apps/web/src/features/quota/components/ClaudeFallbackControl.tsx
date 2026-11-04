import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconSettings } from '@/components/ui/icons';
import {
  validFallbackSettings,
  withSuggestions,
  type ClaudeFallbackSettings,
} from '@/features/personal-quota-support/services/api/claudeFallback';
import { useClaudeFallback, type ClaudeFallbackHookState } from '../hooks/useClaudeFallback';
import { maskQuotaText } from '../ledgerModel';
import { FallbackSettingsEditor } from './FallbackSettingsEditor';
import styles from './QuotaSettingsToolbar.module.scss';

/**
 * The toolbar fallback toggle and its settings modal. Pass `fallback` when the
 * parent owns the fallback state (it shares the models with the key profiles);
 * otherwise the control loads its own.
 */
export function ClaudeFallbackControl({
  disabled,
  showEmails,
  fallback,
}: {
  disabled: boolean;
  showEmails: boolean;
  fallback?: ClaudeFallbackHookState;
}) {
  if (fallback)
    return (
      <ClaudeFallbackEditor
        key={`${fallback.revision}-${disabled}`}
        fallback={fallback}
        disabled={disabled}
        showEmails={showEmails}
      />
    );
  return <OwnClaudeFallbackControl disabled={disabled} showEmails={showEmails} />;
}

function OwnClaudeFallbackControl({
  disabled,
  showEmails,
}: {
  disabled: boolean;
  showEmails: boolean;
}) {
  const fallback = useClaudeFallback(disabled);
  return (
    <ClaudeFallbackEditor
      key={`${fallback.revision}-${disabled}`}
      fallback={fallback}
      disabled={disabled}
      showEmails={showEmails}
    />
  );
}

function ClaudeFallbackEditor({
  fallback,
  disabled,
  showEmails,
}: {
  fallback: ClaudeFallbackHookState;
  disabled: boolean;
  showEmails: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ClaudeFallbackSettings | null>(null);
  const settings = fallback.state?.settings;
  const error = showEmails ? fallback.error : maskQuotaText(fallback.error);
  const unsupported = fallback.state?.supported === false;
  const toggle = (enabled: boolean) => {
    if (settings) void fallback.save({ ...withSuggestions(settings), enabled });
  };
  return (
    <>
      <div
        className={styles.group}
        title={t(`quota_management.fallback.${unsupported ? 'unsupported' : 'description'}`)}
      >
        <span
          className={styles.switch}
          data-switch="claude-fallback"
          data-state={settings?.enabled ? 'on' : 'off'}
        >
          <ToggleSwitch
            checked={settings?.enabled ?? false}
            disabled={fallback.blocked}
            onChange={toggle}
            label={t('quota_management.fallback.title')}
          />
        </span>
        {settings?.enabled && (
          <span className={styles.caption}>{t(`quota_management.fallback.${settings.mode}`)}</span>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={fallback.blocked}
          aria-label={t('quota_management.fallback.configure')}
          title={t('quota_management.fallback.configure')}
          onClick={() => settings && setDraft(withSuggestions(settings))}
        >
          <IconSettings size={16} />
        </Button>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}{' '}
          <Button
            size="sm"
            variant="secondary"
            disabled={fallback.saving || disabled}
            onClick={fallback.reload}
          >
            {t('common.refresh')}
          </Button>
        </div>
      )}
      <Modal
        open={draft !== null}
        title={t('quota_management.fallback.configure')}
        width={720}
        closeDisabled={fallback.saving}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="secondary" disabled={fallback.saving} onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={fallback.saving}
              disabled={!draft || fallback.blocked || !validFallbackSettings(draft)}
              onClick={() => {
                if (draft)
                  void fallback.save(draft).then((saved) => {
                    if (saved) setDraft(null);
                  });
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <FallbackSettingsEditor
            value={draft}
            models={fallback.state?.models ?? { claude: [], codex: [] }}
            disabled={fallback.saving}
            onChange={setDraft}
          >
            {error && (
              <p role="alert" className={styles.fieldError}>
                {error}
              </p>
            )}
          </FallbackSettingsEditor>
        )}
      </Modal>
    </>
  );
}
