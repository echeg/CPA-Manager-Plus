import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/features/quota/components/Select';
import { quotaReserveError, type QuotaReserveDraft } from '@/features/quota/authFiles/quotaReserve';
import type { AuthFileQuotaReserveMode } from '@/features/personal-quota-support/types/authFile';
import { useQuotaReserveCapability } from '../hooks/useQuotaReserveCapability';
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
  const errorId = useId();
  const maxLevels = useQuotaReserveCapability();
  const unsupportedStages =
    draft.mode === 'soft' && draft.steps.some((value) => value.trim()) && maxLevels < 3;
  const validation = unsupportedStages
    ? 'auth_files.reserve.stages_unsupported'
    : quotaReserveError(draft);
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
          <span>
            {t(
              draft.mode === 'soft'
                ? 'auth_files.reserve.soft_stage_label'
                : 'auth_files.reserve.percent_label',
              { level: 1 }
            )}
          </span>
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
            aria-describedby={validation ? errorId : undefined}
            onChange={(event) => onChange({ enabled: true, percent: event.target.value })}
          />
        </label>
        {draft.mode === 'soft' &&
          draft.steps.map((value, index) => (
            <label className={styles.percent} key={index}>
              <span>{t('auth_files.reserve.soft_stage_label', { level: index + 2 })}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={99}
                step={1}
                placeholder="—"
                value={value}
                disabled={saving || maxLevels < 3}
                aria-invalid={Boolean(validation)}
                aria-describedby={validation ? errorId : undefined}
                onChange={(event) => {
                  const steps: [string, string] = [...draft.steps];
                  steps[index] = event.target.value;
                  onChange({ enabled: true, steps });
                }}
              />
            </label>
          ))}
        <span className={styles.modeLabel} id={modeId}>
          {t('auth_files.reserve.mode_label')}
        </span>
        <Select
          size="sm"
          ariaLabelledBy={modeId}
          value={draft.mode}
          options={[
            {
              value: 'soft',
              label: t(
                maxLevels >= 3
                  ? 'auth_files.reserve.mode_soft_staged'
                  : 'auth_files.reserve.mode_soft'
              ),
            },
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
            : maxLevels >= 3
              ? 'auth_files.reserve.mode_soft_staged_hint'
              : 'auth_files.reserve.mode_soft_hint'
        )}
      </p>
      {draft.mode === 'soft' && (
        <p className={styles.hint}>
          {t(
            maxLevels < 3
              ? 'auth_files.reserve.stages_unsupported'
              : 'auth_files.reserve.steps_hint'
          )}
        </p>
      )}
      {validation && (
        <p className={styles.error} id={errorId} role="alert">
          {t(validation)}
        </p>
      )}
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
