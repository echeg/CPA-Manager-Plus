import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { useNotificationStore } from '@/stores';
import { sha256Hex } from '@/utils/apiKeyHash';
import { generateClientKey } from '@/utils/apiKeyGenerator';
import { copyToClipboard } from '@/utils/clipboard';
import type { KeyProfilesState } from '../hooks/useKeyProfiles';
import { chainSummary, type KeyDisplayRow } from '../keyProfilesModel';
import { maskQuotaText } from '../ledgerModel';
import { Select } from './Select';
import styles from './ClientKeysModal.module.scss';

export interface ClientKeysModalProps {
  open: boolean;
  onClose: () => void;
  keyProfiles: Pick<
    KeyProfilesState,
    | 'state'
    | 'rows'
    | 'total'
    | 'aliasesEditable'
    | 'loading'
    | 'saving'
    | 'error'
    | 'reload'
    | 'saveKeyProfile'
    | 'addKey'
    | 'removeKey'
  >;
  files: AuthFileItem[];
  showEmails: boolean;
  /** Opens the Profiles modal on this raw key: a new draft, or its own profile. */
  onOpenProfiles: (key: string) => void;
}

type ProfileMode = 'default' | 'own';
type CopyStatus = '' | 'copied' | 'failed';

const keyHash = (key: string) => sha256Hex(key).toLowerCase();
const prefix = 'quota_management.client_keys';

/**
 * Client keys with their profile choice, plus an add form. Rows show the alias or
 * the masked key only; the raw key appears solely in the add input before it is saved.
 */
export function ClientKeysModal({
  open,
  onClose,
  keyProfiles,
  files,
  showEmails,
  onOpenProfiles,
}: ClientKeysModalProps) {
  const { t } = useTranslation();
  const showConfirmation = useNotificationStore((store) => store.showConfirmation);
  const [draftKey, setDraftKey] = useState('');
  const [draftAlias, setDraftAlias] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('');
  const [warning, setWarning] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  const { state, rows, total, aliasesEditable, loading, saving, error } = keyProfiles;
  const mask = (value: string) => (showEmails ? value : maskQuotaText(value));
  const message = mask(error);
  const readOnly = state ? !state.supported : true;
  const busy = saving || loading;
  const lastKey = total <= 1;

  // The modal stays mounted while hidden. Hiding it drops its messages and hides the
  // draft key again, so a reopened modal shows no stale warning and no key in clear text.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setShowKey(false);
      setCopyStatus('');
      setWarning('');
    }
  }

  const close = () => {
    if (saving) return;
    // Closing discards the add form; switching to the Profiles modal keeps it.
    setDraftKey('');
    setDraftAlias('');
    onClose();
  };

  const updateKey = (value: string) => {
    setDraftKey(value);
    setCopyStatus('');
  };

  const generate = () => {
    updateKey(generateClientKey());
    setWarning('');
  };

  const copy = async () => {
    const copied = await copyToClipboard(draftKey);
    setCopyStatus(copied ? 'copied' : 'failed');
    // Without the clipboard the key has to be copied by hand, so show it.
    if (!copied) setShowKey(true);
  };

  const add = async () => {
    if (!draftKey.trim() || busy) return;
    setWarning('');
    const alias = draftAlias.trim();
    const result = await keyProfiles.addKey(draftKey, aliasesEditable && alias ? alias : undefined);
    if (!result.ok) return;
    // The key is written: clear it at once, so a retry cannot hit the duplicate check.
    setDraftKey('');
    setDraftAlias('');
    setShowKey(false);
    setCopyStatus('');
    if (result.aliasWarning) setWarning(result.aliasWarning);
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void add();
    }
  };

  const confirmDelete = (row: KeyDisplayRow) => {
    showConfirmation({
      title: t(`${prefix}.delete_confirm_title`),
      message: t(`${prefix}.delete_confirm`, { label: row.label }),
      confirmText: t(`${prefix}.delete`),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setWarning('');
        const result = await keyProfiles.removeKey(row.key);
        if (result.aliasWarning) setWarning(result.aliasWarning);
      },
    });
  };

  const changeMode = (row: KeyDisplayRow, mode: ProfileMode) => {
    const current: ProfileMode = row.profile ? 'own' : 'default';
    if (mode === current) return;
    if (mode === 'own') {
      // A draft opens in the Profiles modal; nothing is written until it is saved there.
      onOpenProfiles(row.key);
      return;
    }
    showConfirmation({
      title: t('quota_management.key_profiles.profiles.reset_confirm_title'),
      message: t('quota_management.key_profiles.profiles.reset_confirm', { label: row.label }),
      confirmText: t('quota_management.key_profiles.profiles.reset'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: () => void keyProfiles.saveKeyProfile(row.key, null),
    });
  };

  const modeOptions = [
    { value: 'default', label: t(`${prefix}.mode_default`) },
    { value: 'own', label: t(`${prefix}.mode_own`) },
  ];
  const showLabel = t(showKey ? `${prefix}.hide_key` : `${prefix}.show_key`);

  const addForm = (
    <section className={styles.add} data-client-key-add>
      <h4 className={styles.addTitle}>{t(`${prefix}.add_title`)}</h4>
      <div className={styles.addFields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t(`${prefix}.key_label`)}</span>
          <span className={styles.keyInput}>
            <input
              className="input"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              data-client-key-input
              placeholder={t(`${prefix}.key_placeholder`)}
              value={draftKey}
              disabled={saving}
              onChange={(event) => updateKey(event.target.value)}
              onKeyDown={submitOnEnter}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              iconOnly
              data-client-key-show
              aria-label={showLabel}
              title={showLabel}
              aria-pressed={showKey}
              onClick={() => setShowKey((value) => !value)}
            >
              {showKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </Button>
          </span>
        </label>
        <div className={styles.keyActions}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-client-key-generate
            disabled={saving}
            onClick={generate}
          >
            {t(`${prefix}.generate`)}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-client-key-copy
            disabled={!draftKey}
            onClick={() => void copy()}
          >
            {t(`${prefix}.copy`)}
          </Button>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t(`${prefix}.alias_label`)}</span>
          <input
            className="input"
            type="text"
            autoComplete="off"
            data-client-key-alias
            placeholder={t(`${prefix}.alias_placeholder`)}
            value={draftAlias}
            maxLength={120}
            disabled={saving || !aliasesEditable}
            title={aliasesEditable ? undefined : t(`${prefix}.alias_unavailable`)}
            onChange={(event) => setDraftAlias(event.target.value)}
            onKeyDown={submitOnEnter}
          />
        </label>
        <Button
          type="button"
          size="sm"
          className={styles.addButton}
          data-client-key-submit
          disabled={busy || !draftKey.trim()}
          loading={saving}
          onClick={() => void add()}
        >
          {t(`${prefix}.add`)}
        </Button>
      </div>
      {copyStatus && (
        <p
          className={copyStatus === 'copied' ? styles.hint : styles.warning}
          role="status"
          data-client-key-copy-status
        >
          {t(copyStatus === 'copied' ? `${prefix}.copied` : `${prefix}.copy_failed`)}
        </p>
      )}
      {!aliasesEditable && (
        <p className={styles.hint} data-client-key-alias-hint>
          {t(`${prefix}.alias_unavailable`)}
        </p>
      )}
    </section>
  );

  return (
    <Modal
      open={open}
      title={t(`${prefix}.title`)}
      width={860}
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
      <div className={styles.body} data-client-keys-modal>
        {message && (
          <div className={styles.error} role="alert">
            {message}{' '}
            <Button size="sm" variant="secondary" disabled={busy} onClick={keyProfiles.reload}>
              {t('common.refresh')}
            </Button>
          </div>
        )}
        {warning && (
          <p className={styles.warning} role="status" data-client-keys-warning>
            {mask(warning)}
          </p>
        )}

        {/* The toolbar renders this modal only on a backend that serves /routing/profiles. */}
        {!state ? (
          loading && <p className={styles.hint}>{t(`${prefix}.loading`)}</p>
        ) : (
          <>
            {readOnly && rows.length > 0 && (
              <p className={styles.notice} role="note">
                {t(`${prefix}.mode_read_only`)}
              </p>
            )}
            {rows.length === 0 ? (
              <p className={styles.hint} data-client-keys-empty>
                {t(`${prefix}.empty`)}
              </p>
            ) : (
              <ul className={styles.list}>
                {rows.map((row, index) => {
                  const mode: ProfileMode = row.profile ? 'own' : 'default';
                  const modeLabel = t(`${prefix}.mode_label`, { label: row.label });
                  const configureLabel = t(`${prefix}.configure_label`, { label: row.label });
                  const deleteLabel = lastKey
                    ? t(`${prefix}.last_key_hint`)
                    : t(`${prefix}.delete_label`, { label: row.label });
                  return (
                    <li
                      key={`${index}-${keyHash(row.key)}`}
                      className={styles.row}
                      data-client-key-row
                    >
                      <div className={styles.rowHead}>
                        <span className={styles.label}>{row.label}</span>
                        {row.hasAlias && <code className={styles.masked}>{row.masked}</code>}
                        <div className={styles.rowActions}>
                          <Select
                            size="sm"
                            className={styles.modeSelect}
                            value={mode}
                            options={modeOptions}
                            ariaLabel={modeLabel}
                            disabled={readOnly || busy}
                            onChange={(value) => changeMode(row, value as ProfileMode)}
                          />
                          {row.profile && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              data-client-key-configure
                              aria-label={configureLabel}
                              title={configureLabel}
                              disabled={saving}
                              onClick={() => onOpenProfiles(row.key)}
                            >
                              {t(`${prefix}.configure`)}
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            data-client-key-delete
                            aria-label={deleteLabel}
                            title={deleteLabel}
                            disabled={busy || lastKey}
                            onClick={() => confirmDelete(row)}
                          >
                            {t(`${prefix}.delete`)}
                          </Button>
                        </div>
                      </div>
                      <p className={styles.summary} data-client-key-summary>
                        {chainSummary(row.profile ?? state.shared, files, showEmails, t)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {lastKey && rows.length === 1 && (
              <p className={styles.hint} data-client-keys-last>
                {t(`${prefix}.last_key_hint`)}
              </p>
            )}
            {addForm}
          </>
        )}
      </div>
    </Modal>
  );
}
