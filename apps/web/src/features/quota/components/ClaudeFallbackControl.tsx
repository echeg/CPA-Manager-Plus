import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconSettings } from '@/components/ui/icons';
import {
  suggestedFallbackMappings,
  validFallbackSettings,
  type ClaudeFallbackSettings,
} from '@/features/personal-quota-support/services/api/claudeFallback';
import { useClaudeFallback } from '../hooks/useClaudeFallback';
import { maskQuotaText } from '../ledgerModel';
import { Select } from './Select';
import styles from './QuotaSettingsToolbar.module.scss';

export function ClaudeFallbackControl({
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
  fallback: ReturnType<typeof useClaudeFallback>;
  disabled: boolean;
  showEmails: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ClaudeFallbackSettings | null>(null);
  const id = useId();
  const settings = fallback.state?.settings;
  const withSuggestions = (value: ClaudeFallbackSettings) => ({
    ...value,
    mappings: value.mappings.length
      ? value.mappings.map((row) => ({ ...row }))
      : suggestedFallbackMappings(),
  });
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
          <div className={styles.fallbackEditor}>
            <ToggleSwitch
              checked={draft.enabled}
              disabled={fallback.saving}
              onChange={(enabled) => setDraft({ ...draft, enabled })}
              label={t('quota_management.fallback.title')}
            />
            <Select
              value={draft.mode}
              disabled={fallback.saving}
              ariaLabel={t('quota_management.fallback.mode')}
              options={[
                { value: 'auto', label: t('quota_management.fallback.auto') },
                { value: 'always', label: t('quota_management.fallback.always') },
              ]}
              onChange={(mode) =>
                setDraft({ ...draft, mode: mode as ClaudeFallbackSettings['mode'] })
              }
            />
            <p>{t(`quota_management.fallback.${draft.mode}_hint`)}</p>
            <p>{t('quota_management.fallback.mapping_hint')}</p>
            <datalist id={`${id}-claude`}>
              {fallback.state?.models.claude.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <datalist id={`${id}-codex`}>
              {fallback.state?.models.codex.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            {draft.mappings.map((row, index) => (
              <div className={styles.fallbackRow} key={index}>
                <input
                  className="input"
                  list={`${id}-claude`}
                  value={row.from}
                  disabled={fallback.saving}
                  aria-label={t('quota_management.fallback.source', { index: index + 1 })}
                  placeholder="claude-opus-*"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      mappings: draft.mappings.map((item, i) =>
                        i === index ? { ...item, from: event.target.value } : item
                      ),
                    })
                  }
                />
                <span aria-hidden="true">→</span>
                <input
                  className="input"
                  list={`${id}-codex`}
                  value={row.to}
                  disabled={fallback.saving}
                  aria-label={t('quota_management.fallback.target', { index: index + 1 })}
                  placeholder="gpt-6-astra"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      mappings: draft.mappings.map((item, i) =>
                        i === index ? { ...item, to: event.target.value } : item
                      ),
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={fallback.saving}
                  aria-label={t('quota_management.fallback.remove', { index: index + 1 })}
                  onClick={() =>
                    setDraft({ ...draft, mappings: draft.mappings.filter((_, i) => i !== index) })
                  }
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              disabled={fallback.saving}
              onClick={() =>
                setDraft({ ...draft, mappings: [...draft.mappings, { from: '', to: '' }] })
              }
            >
              {t('quota_management.fallback.add')}
            </Button>
            {!validFallbackSettings(draft) && (
              <p role="alert" className={styles.fieldError}>
                {t('quota_management.fallback.invalid')}
              </p>
            )}
            {error && (
              <p role="alert" className={styles.fieldError}>
                {error}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
