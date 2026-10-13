import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useCodexFastMode } from '../hooks/useCodexFastMode';
import styles from './CodexFastMode.module.scss';

/** Applies codex.fast-mode immediately; the server hot-reloads it for new requests. */
export function CodexFastMode({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const { enabled, saving, error, toggle } = useCodexFastMode(disabled);

  return (
    <section className={styles.panel} aria-label={t('quota_management.codex_fast.title')}>
      <div className={styles.row}>
        <ToggleSwitch
          checked={enabled ?? false}
          disabled={disabled || saving || enabled === null}
          onChange={(next) => void toggle(next)}
          label={<strong>{t('quota_management.codex_fast.title')}</strong>}
        />
        <span className={enabled ? styles.on : styles.off}>
          {enabled === null
            ? t('common.loading')
            : t(enabled ? 'quota_management.codex_fast.on' : 'quota_management.codex_fast.off')}
        </span>
      </div>
      <p>{t('quota_management.codex_fast.description')}</p>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
