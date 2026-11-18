import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  CODEX_SPEEDS,
  type CodexSpeed,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { KeyProfilesState } from '../hooks/useKeyProfiles';
import {
  buildSpeedRows,
  withCodexSpeed,
  type CodexSpeedPatch,
  type SpeedRow,
} from '../codexSpeedModel';
import { copyOfShared } from '../keyProfilesModel';
import { maskQuotaText } from '../ledgerModel';
import styles from './CodexSpeedModal.module.scss';

export interface CodexSpeedModalProps {
  open: boolean;
  onClose: () => void;
  keyProfiles: Pick<
    KeyProfilesState,
    'state' | 'rows' | 'loading' | 'saving' | 'error' | 'reload' | 'saveKeyProfile' | 'saveShared'
  >;
  showEmails: boolean;
}

/**
 * The Codex speed and the "ignore the client tier" flag of the Default profile and of
 * every client key. A change is written at once; the rows always show the stored
 * values. A click on a key without its own profile gives it a full copy of the Default
 * profile with the new value. Rows show the alias, the CP name or the masked key only.
 */
export function CodexSpeedModal({ open, onClose, keyProfiles, showEmails }: CodexSpeedModalProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const { state, rows, loading, saving, error } = keyProfiles;
  const busy = saving || loading;
  const message = showEmails ? error : maskQuotaText(error);
  const speedRows = useMemo(() => (state ? buildSpeedRows(state, rows) : []), [state, rows]);

  const close = () => {
    if (!saving) onClose();
  };

  const write = (row: SpeedRow, patch: CodexSpeedPatch) => {
    if (!state || busy || row.disabledReason) return;
    const { keyRow } = row;
    if (!keyRow) {
      void keyProfiles.saveShared(withCodexSpeed(state.shared, patch));
      return;
    }
    // A key profile replaces the Default profile completely, so a new one is a full copy.
    void keyProfiles.saveKeyProfile(
      keyRow.key,
      withCodexSpeed(keyRow.profile ?? copyOfShared(state.shared), patch)
    );
  };

  const chooseSpeed = (row: SpeedRow, speed: CodexSpeed) => {
    if (speed !== row.speed) write(row, { speed });
  };

  const chooseFlag = (row: SpeedRow, ignoreClientTier: boolean) => {
    if (ignoreClientTier !== row.ignoreClientTier) write(row, { ignoreClientTier });
  };

  const rowLabel = (row: SpeedRow) =>
    row.keyRow ? row.keyRow.label : t('quota_management.codex_speed.table_default_row');

  // Why a row takes no input, or that its speed applies only to Claude's fallback to Codex.
  const reasonText = (row: SpeedRow) =>
    row.disabledReason === 'read_only'
      ? t('quota_management.codex_speed.table_reason_read_only')
      : row.disabledReason === 'api_mode'
        ? t('quota_management.codex_speed.table_reason_api_mode')
        : row.claudeFallbackOnly
          ? t('quota_management.codex_speed.claude_fallback_hint')
          : '';

  const renderRow = (row: SpeedRow) => {
    const label = rowLabel(row);
    const disabled = busy || Boolean(row.disabledReason);
    const reason = reasonText(row);
    const reasonId = `${baseId}-${row.id}-reason`;
    const { keyRow } = row;
    return (
      <tr key={row.id} className={styles.row} data-speed-row={keyRow ? 'key' : 'default'}>
        <th scope="row" className={styles.labelCell}>
          <span className={styles.labelLine}>
            <span className={styles.label}>{label}</span>
            {keyRow?.hasAlias && <code className={styles.masked}>{keyRow.masked}</code>}
            {keyRow && (
              <span
                className={keyRow.profile ? styles.badgeOwn : styles.badge}
                data-speed-badge={keyRow.profile ? 'own' : 'default'}
              >
                {keyRow.profile
                  ? t('quota_management.codex_speed.table_badge_own')
                  : t('quota_management.codex_speed.table_badge_default')}
              </span>
            )}
          </span>
          {reason && (
            <span
              id={reasonId}
              className={styles.reason}
              data-speed-reason={row.disabledReason || 'claude_fallback'}
            >
              {reason}
            </span>
          )}
        </th>
        <td className={styles.cell}>
          <div
            role="group"
            className={styles.speeds}
            aria-label={t('quota_management.codex_speed.table_speed_group', { label })}
            aria-describedby={reason ? reasonId : undefined}
            data-speed-group
          >
            {CODEX_SPEEDS.map((speed) => {
              const active = speed === row.speed;
              const name = t(`quota_management.codex_speed.speed_${speed}`);
              return (
                <button
                  key={speed}
                  type="button"
                  className={active ? `${styles.speed} ${styles.active}` : styles.speed}
                  aria-pressed={active}
                  aria-label={t('quota_management.codex_speed.table_speed_option', {
                    speed: name,
                    label,
                  })}
                  disabled={disabled}
                  data-speed-option={speed}
                  // A native button: a click, Enter or Space activates it, and arrow
                  // keys do nothing, so moving around the table never writes.
                  onClick={() => chooseSpeed(row, speed)}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </td>
        <td className={styles.cell} data-speed-flag>
          <ToggleSwitch
            checked={row.ignoreClientTier}
            disabled={disabled}
            ariaLabel={t('quota_management.codex_speed.table_flag_aria', { label })}
            onChange={(value) => chooseFlag(row, value)}
          />
        </td>
      </tr>
    );
  };

  return (
    <Modal
      open={open}
      title={t('quota_management.codex_speed.table_title')}
      width={760}
      closeDisabled={saving}
      onClose={close}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" disabled={saving} onClick={close}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className={styles.body} data-codex-speed-modal>
        {message && (
          <div className={styles.error} role="alert" data-codex-speed-error>
            {message}{' '}
            <Button size="sm" variant="secondary" disabled={busy} onClick={keyProfiles.reload}>
              {t('common.refresh')}
            </Button>
          </div>
        )}

        {!state ? (
          loading && (
            <p className={styles.hint}>{t('quota_management.codex_speed.table_loading')}</p>
          )
        ) : !state.speedSupported ? (
          // A reload reported a backend without speed. The toolbar button is gone, and
          // a save there would carry no speed, so the open table shows no controls.
          <p className={styles.notice} role="note" data-codex-speed-unsupported>
            {t('quota_management.codex_speed.table_unsupported')}
          </p>
        ) : (
          <>
            {!state.supported && rows.length > 0 && (
              <p className={styles.notice} role="note" data-codex-speed-read-only>
                {t('quota_management.codex_speed.table_read_only')}
              </p>
            )}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('quota_management.codex_speed.table_column_profile')}</th>
                    <th scope="col">{t('quota_management.codex_speed.row_label')}</th>
                    <th scope="col">{t('quota_management.codex_speed.table_column_flag')}</th>
                  </tr>
                </thead>
                <tbody>{speedRows.map(renderRow)}</tbody>
              </table>
            </div>
            {rows.length === 0 && (
              <p className={styles.hint} data-codex-speed-empty>
                {t('quota_management.codex_speed.table_empty')}
              </p>
            )}
            <p className={styles.hint}>{t('quota_management.codex_speed.ultrafast_hint')}</p>
            <p className={styles.hint}>
              {t('quota_management.codex_speed.ignore_client_tier_hint')}
            </p>
            <p className={styles.hint}>{t('quota_management.codex_speed.table_default_hint')}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
