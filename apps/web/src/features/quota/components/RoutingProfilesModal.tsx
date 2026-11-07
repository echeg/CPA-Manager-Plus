import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { RoutingProfile } from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { useNotificationStore } from '@/stores';
import { sha256Hex } from '@/utils/apiKeyHash';
import type { KeyProfilesState } from '../hooks/useKeyProfiles';
import { chainSummary, copyOfShared, type KeyDisplayRow } from '../keyProfilesModel';
import { maskQuotaText } from '../ledgerModel';
import { KeyProfileEditor } from './KeyProfileEditor';
import { Select } from './Select';
import styles from './RoutingProfilesModal.module.scss';

export interface RoutingProfilesModalProps {
  open: boolean;
  onClose: () => void;
  keyProfiles: Pick<
    KeyProfilesState,
    | 'state'
    | 'rows'
    | 'ttl'
    | 'loading'
    | 'saving'
    | 'error'
    | 'reload'
    | 'saveKeyProfile'
    | 'saveShared'
  >;
  files: AuthFileItem[];
  showEmails: boolean;
  /** Fallback model suggestions for the editors. */
  models: { claude: string[]; codex: string[] };
  /**
   * The raw key whose editor opens once the profiles are loaded: a new draft when the
   * key is on the default profile, its own profile otherwise. Kept in memory only.
   */
  focus?: string;
  /** Renders "← Back to keys" when the modal was opened from the Keys modal. */
  onBackToKeys?: () => void;
}

/** The open editor: the default profile, or one key by its raw key (memory only). */
type Editing = { kind: 'default' } | { kind: 'key'; key: string } | null;

const keyHash = (key: string) => sha256Hex(key).toLowerCase();

/**
 * The default (shared) profile with the global TTL, and every key that has its own
 * profile. One editor is open at a time. Rows show the alias, the CP instance name or
 * the masked key only.
 */
export function RoutingProfilesModal({
  open,
  onClose,
  keyProfiles,
  files,
  showEmails,
  models,
  focus,
  onBackToKeys,
}: RoutingProfilesModalProps) {
  const { t } = useTranslation();
  const showConfirmation = useNotificationStore((store) => store.showConfirmation);
  const [editing, setEditing] = useState<Editing>(null);
  // The focus already applied for this opening, so a reload does not reopen a closed editor.
  const [appliedFocus, setAppliedFocus] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  const { state, rows, ttl, loading, saving, error } = keyProfiles;
  const message = showEmails ? error : maskQuotaText(error);
  const readOnly = state ? !state.supported : true;

  const own = rows.filter((row) => row.profile !== null);
  const onDefault = rows.filter((row) => row.profile === null);

  // Adjusted during render rather than in an effect, so the editor opens in the same pass.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setEditing(null);
      setAppliedFocus(null);
    }
  }
  // An editor copies its profile once, so the focus waits for a finished load.
  if (open && focus && state && !loading && appliedFocus !== focus) {
    setAppliedFocus(focus);
    const row = rows.find((item) => item.key.trim() === focus.trim());
    if (row && !(row.profile === null && readOnly)) setEditing({ kind: 'key', key: row.key });
  }

  const close = () => {
    if (saving) return;
    onClose();
  };

  const isEditingKey = (key: string) => editing?.kind === 'key' && editing.key === key;
  // An editor copies the profile once when it opens, so it must not open from the
  // cached rows while a reload is still running; an open one can still be closed.
  const toggleDisabled = (isOpen: boolean) => saving || (loading && !isOpen);

  const saveKey = async (key: string, profile: RoutingProfile | null) => {
    if (await keyProfiles.saveKeyProfile(key, profile)) {
      setEditing((current) => (current?.kind === 'key' && current.key === key ? null : current));
    }
  };

  const saveDefault = async (profile: RoutingProfile, nextTTL?: string) => {
    const saved = await keyProfiles.saveShared(profile, nextTTL);
    if (saved) setEditing((current) => (current?.kind === 'default' ? null : current));
  };

  const confirmReset = (row: KeyDisplayRow) => {
    showConfirmation({
      title: t('quota_management.key_profiles.profiles.reset_confirm_title'),
      message: t('quota_management.key_profiles.profiles.reset_confirm', { label: row.label }),
      confirmText: t('quota_management.key_profiles.profiles.reset'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: () => saveKey(row.key, null),
    });
  };

  const keyEditor = (row: KeyDisplayRow) =>
    state && (
      <KeyProfileEditor
        // Keyed by the hash and the mode, so a row that gains or loses a profile starts over.
        key={`${keyHash(row.key)}-${row.profile ? 'own' : 'new'}`}
        initial={row.profile ?? copyOfShared(state.shared)}
        isNew={!row.profile}
        variant="key"
        ttl={ttl}
        files={files}
        showEmails={showEmails}
        selectionOptions={state.selectionOptions}
        models={models}
        // A reload keeps the rows on screen; the editor waits for it because the
        // hook refuses a save while the profiles load.
        saving={saving || loading}
        readOnly={readOnly}
        onSave={(profile) => void saveKey(row.key, profile)}
        onCancel={() => setEditing(null)}
      />
    );

  const draftRow =
    editing?.kind === 'key' ? onDefault.find((row) => row.key === editing.key) : undefined;
  const addOptions = onDefault.map((row) => ({ value: keyHash(row.key), label: row.label }));

  const editLabel = (isOpen: boolean, label: string) =>
    t(
      isOpen
        ? 'quota_management.key_profiles.collapse_label'
        : 'quota_management.key_profiles.edit_label',
      { label }
    );
  const editText = (isOpen: boolean) =>
    t(isOpen ? 'quota_management.key_profiles.collapse' : 'quota_management.key_profiles.edit');

  const defaultOpen = editing?.kind === 'default';
  const defaultLabel = editLabel(defaultOpen, t('quota_management.key_profiles.profiles.default'));

  return (
    <Modal
      open={open}
      title={t('quota_management.key_profiles.profiles.title')}
      width={860}
      closeDisabled={saving}
      onClose={close}
      footer={
        <div className={styles.footer}>
          {onBackToKeys && (
            <Button variant="secondary" data-profiles-back disabled={saving} onClick={onBackToKeys}>
              {t('quota_management.key_profiles.profiles.back')}
            </Button>
          )}
          <Button variant="secondary" disabled={saving} onClick={close}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className={styles.body} data-routing-profiles-modal>
        {message && (
          <div className={styles.error} role="alert">
            {message}{' '}
            <Button
              size="sm"
              variant="secondary"
              disabled={saving || loading}
              onClick={keyProfiles.reload}
            >
              {t('common.refresh')}
            </Button>
          </div>
        )}

        {/* The toolbar renders this modal only on a backend that serves /routing/profiles. */}
        {!state ? (
          loading && <p className={styles.hint}>{t('quota_management.key_profiles.loading')}</p>
        ) : (
          <>
            {readOnly && (
              <p className={styles.notice} role="note">
                {t('quota_management.key_profiles.editor.read_only')}
              </p>
            )}

            <section className={styles.defaultRow} data-profile-default>
              <div className={styles.rowHead}>
                <span className={styles.label}>
                  {t('quota_management.key_profiles.profiles.default')}
                </span>
                <span className={styles.hint}>
                  {t('quota_management.key_profiles.profiles.default_hint')}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className={styles.toggle}
                  data-profile-edit
                  aria-expanded={defaultOpen}
                  aria-label={defaultLabel}
                  title={defaultLabel}
                  disabled={toggleDisabled(defaultOpen)}
                  onClick={() => setEditing(defaultOpen ? null : { kind: 'default' })}
                >
                  {editText(defaultOpen)}
                </Button>
              </div>
              <p className={styles.summary} data-profile-summary>
                {chainSummary(state.shared, files, showEmails, t)}
              </p>
              {defaultOpen && (
                <KeyProfileEditor
                  key="default"
                  initial={state.shared}
                  isNew={false}
                  variant="default"
                  ttl={ttl}
                  files={files}
                  showEmails={showEmails}
                  selectionOptions={state.selectionOptions}
                  models={models}
                  saving={saving || loading}
                  // The shared values stay editable in Home or scheduler-plugin mode,
                  // except the fallback, which CPA ignores there.
                  readOnly={false}
                  fallbackReadOnly={readOnly}
                  onSave={(profile, nextTTL) => void saveDefault(profile, nextTTL)}
                  onCancel={() => setEditing(null)}
                />
              )}
            </section>

            {own.length === 0 ? (
              <p className={styles.hint}>{t('quota_management.key_profiles.profiles.none')}</p>
            ) : (
              <ul className={styles.list}>
                {own.map((row, index) => {
                  const isOpen = isEditingKey(row.key);
                  const label = editLabel(isOpen, row.label);
                  const resetLabel = t('quota_management.key_profiles.profiles.reset_label', {
                    label: row.label,
                  });
                  return (
                    <li
                      key={`${index}-${keyHash(row.key)}`}
                      className={styles.row}
                      data-profile-row
                    >
                      <div className={styles.rowHead}>
                        <span className={styles.label}>{row.label}</span>
                        {row.hasAlias && <code className={styles.masked}>{row.masked}</code>}
                        <div className={styles.rowActions}>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            data-profile-edit
                            aria-expanded={isOpen}
                            aria-label={label}
                            title={label}
                            disabled={toggleDisabled(isOpen)}
                            onClick={() =>
                              setEditing(isOpen ? null : { kind: 'key', key: row.key })
                            }
                          >
                            {editText(isOpen)}
                          </Button>
                          {!readOnly && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              data-profile-reset
                              aria-label={resetLabel}
                              title={resetLabel}
                              disabled={saving || loading}
                              onClick={() => confirmReset(row)}
                            >
                              {t('quota_management.key_profiles.profiles.reset')}
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className={styles.summary} data-profile-summary>
                        {chainSummary(row.profile ?? state.shared, files, showEmails, t)}
                      </p>
                      {isOpen && keyEditor(row)}
                    </li>
                  );
                })}
              </ul>
            )}

            {!readOnly && onDefault.length > 0 && (
              <section className={styles.add} data-profile-add>
                <Select
                  size="sm"
                  className={styles.addSelect}
                  value={draftRow ? keyHash(draftRow.key) : ''}
                  placeholder={t('quota_management.key_profiles.profiles.add')}
                  ariaLabel={t('quota_management.key_profiles.profiles.add_label')}
                  options={addOptions}
                  disabled={saving || loading}
                  onChange={(hash) => {
                    const row = onDefault.find((item) => keyHash(item.key) === hash);
                    if (row) setEditing({ kind: 'key', key: row.key });
                  }}
                />
              </section>
            )}

            {draftRow && (
              <section className={styles.row} data-profile-draft>
                <div className={styles.rowHead}>
                  <span className={styles.label}>{draftRow.label}</span>
                  {draftRow.hasAlias && <code className={styles.masked}>{draftRow.masked}</code>}
                  <span className={styles.badge}>
                    {t('quota_management.key_profiles.profiles.new_badge')}
                  </span>
                </div>
                {keyEditor(draftRow)}
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
