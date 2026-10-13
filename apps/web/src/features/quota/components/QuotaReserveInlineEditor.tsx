import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/features/quota/components/Select';
import { quotaReserveError, type QuotaReserveDraft } from '@/features/quota/authFiles/quotaReserve';
import type { AuthFileQuotaReserveMode } from '@/features/personal-quota-support/types/authFile';
import styles from './QuotaReserveInlineEditor.module.scss';

interface Props {
  draft: QuotaReserveDraft;
  /** A reserve is stored, so it can be removed. */
  canRemove: boolean;
  saving: boolean;
  /** Save failure from the server. */
  error?: string;
  onChange: (value: Partial<QuotaReserveDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
}

/** Compact reserve editor shown inside a quota card; Esc and Cancel close it. */
export function QuotaReserveInlineEditor({
  draft,
  canRemove,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const modeId = useId();
  const validation = quotaReserveError(draft);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || saving) return;
    event.stopPropagation();
    onCancel();
  };

  return (
    <div
      ref={ref}
      className={styles.editor}
      data-reserve-editor=""
      role="region"
      aria-label={t('quota_management.reserve_editor.title')}
      onKeyDown={onKeyDown}
    >
      <div className={styles.fields}>
        <label className={styles.percent}>
          <span>{t('auth_files.reserve.percent_label')}</span>
          <input
            className="input"
            type="number"
            min={1}
            max={99}
            step={1}
            placeholder="25"
            value={draft.percent}
            disabled={saving}
            aria-invalid={Boolean(validation)}
            onChange={(event) => onChange({ enabled: true, percent: event.target.value })}
          />
        </label>
        <span className={styles.modeLabel} id={modeId}>
          {t('auth_files.reserve.mode_label')}
        </span>
        <Select
          size="sm"
          ariaLabelledBy={modeId}
          value={draft.mode}
          options={[
            { value: 'soft', label: t('auth_files.reserve.mode_soft') },
            { value: 'hard', label: t('auth_files.reserve.mode_hard') },
          ]}
          disabled={saving}
          onChange={(mode) => onChange({ enabled: true, mode: mode as AuthFileQuotaReserveMode })}
        />
      </div>
      <p className={styles.hint}>
        {t(
          draft.mode === 'hard'
            ? 'auth_files.reserve.mode_hard_hint'
            : 'auth_files.reserve.mode_soft_hint'
        )}
      </p>
      {validation && <p className={styles.error}>{t(validation)}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {canRemove && (
          <Button variant="ghost" size="sm" disabled={saving} onClick={onRemove}>
            {t('quota_management.reserve_editor.remove')}
          </Button>
        )}
        <span className={styles.spacer} />
        <Button variant="secondary" size="sm" disabled={saving} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          data-reserve-save=""
          disabled={Boolean(validation)}
          loading={saving}
          onClick={onSave}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
