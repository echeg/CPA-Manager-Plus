import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { RoutingProfile } from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { sha256Hex } from '@/utils/apiKeyHash';
import type { KeyProfilesState } from '../hooks/useKeyProfiles';
import { chainSummary } from '../keyProfilesModel';
import { maskQuotaText } from '../ledgerModel';
import { KeyProfileEditor } from './KeyProfileEditor';
import styles from './KeyProfilesModal.module.scss';

export interface KeyProfilesModalProps {
  open: boolean;
  onClose: () => void;
  keyProfiles: Pick<
    KeyProfilesState,
    'state' | 'rows' | 'loading' | 'saving' | 'error' | 'reload' | 'saveKeyProfile'
  >;
  files: AuthFileItem[];
  showEmails: boolean;
  /** Fallback model suggestions from the toolbar's fallback state. */
  models: { claude: string[]; codex: string[] };
  /** The global session-affinity TTL, shown in the editor as text. */
  sessionAffinityTTL?: string;
}

/**
 * Lists every client key with its routing chain and opens one key editor at a time.
 * Raw keys stay in memory for saving; rows show the alias or the masked key only.
 */
export function KeyProfilesModal({
  open,
  onClose,
  keyProfiles,
  files,
  showEmails,
  models,
  sessionAffinityTTL,
}: KeyProfilesModalProps) {
  const { t } = useTranslation();
  // The raw key of the expanded row; it never leaves memory.
  const [expanded, setExpanded] = useState<string | null>(null);
  const { state, rows, loading, saving, error } = keyProfiles;
  const message = showEmails ? error : maskQuotaText(error);
  const readOnly = state ? !state.supported : true;

  const close = () => {
    if (saving) return;
    setExpanded(null);
    onClose();
  };

  const save = async (key: string, profile: RoutingProfile | null) => {
    if (await keyProfiles.saveKeyProfile(key, profile)) setExpanded(null);
  };

  return (
    <Modal
      open={open}
      title={t('quota_management.key_profiles.title')}
      width={860}
      closeDisabled={saving}
      onClose={close}
      footer={
        <Button variant="secondary" disabled={saving} onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      <div className={styles.body} data-key-profiles-modal>
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

        {!state ? (
          loading && <p className={styles.hint}>{t('quota_management.key_profiles.loading')}</p>
        ) : state.unsupportedBackend ? (
          <p className={styles.notice} role="note">
            {t('quota_management.key_profiles.unsupported')}
          </p>
        ) : (
          <>
            {readOnly && (
              <p className={styles.notice} role="note">
                {t('quota_management.key_profiles.editor.read_only')}
              </p>
            )}

            <section className={styles.shared} data-key-profiles-shared>
              <div className={styles.rowHead}>
                <span className={styles.label}>
                  {t('quota_management.key_profiles.shared_title')}
                </span>
                <span className={styles.hint}>
                  {t('quota_management.key_profiles.shared_hint')}
                </span>
              </div>
              <p className={styles.summary}>{chainSummary(state.shared, files, showEmails, t)}</p>
            </section>

            {rows.length === 0 ? (
              <p className={styles.hint}>{t('quota_management.key_profiles.empty')}</p>
            ) : (
              <ul className={styles.list}>
                {rows.map((row, index) => {
                  const isOpen = expanded === row.key;
                  const own = row.profile !== null;
                  const toggleLabel = t(
                    isOpen
                      ? 'quota_management.key_profiles.collapse_label'
                      : 'quota_management.key_profiles.edit_label',
                    { label: row.label }
                  );
                  return (
                    <li
                      key={`${index}-${sha256Hex(row.key)}`}
                      className={styles.row}
                      data-key-row
                      data-own={own ? 'true' : 'false'}
                    >
                      <div className={styles.rowHead}>
                        <span className={styles.label}>{row.label}</span>
                        {row.hasAlias && <code className={styles.masked}>{row.masked}</code>}
                        <span className={own ? styles.badgeOwn : styles.badge} data-badge>
                          {t(
                            own
                              ? 'quota_management.key_profiles.badge_own'
                              : 'quota_management.key_profiles.badge_shared'
                          )}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className={styles.toggle}
                          data-key-toggle
                          aria-expanded={isOpen}
                          aria-label={toggleLabel}
                          title={toggleLabel}
                          disabled={saving}
                          onClick={() => setExpanded(isOpen ? null : row.key)}
                        >
                          {t(
                            isOpen
                              ? 'quota_management.key_profiles.collapse'
                              : 'quota_management.key_profiles.edit'
                          )}
                        </Button>
                      </div>
                      <p className={styles.summary} data-key-summary>
                        {chainSummary(row.profile ?? state.shared, files, showEmails, t)}
                      </p>
                      {isOpen && (
                        <KeyProfileEditor
                          profile={row.profile}
                          shared={state.shared}
                          files={files}
                          showEmails={showEmails}
                          selectionOptions={state.selectionOptions}
                          models={models}
                          // A reload keeps the rows on screen; the editor waits for it
                          // because the hook refuses a save while the profiles load.
                          saving={saving || loading}
                          readOnly={readOnly}
                          sessionAffinityTTL={sessionAffinityTTL}
                          onSave={(profile) => void save(row.key, profile)}
                          onCancel={() => setExpanded(null)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
