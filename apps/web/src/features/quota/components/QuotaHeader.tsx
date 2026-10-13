import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useCountUp } from '@/features/quota/hooks/motion';
import { useNow } from '@/features/quota/hooks/useNow';
import { formatRelativeInstant } from '@/features/quota/utils/quota';
import { MINUTE_MS } from '@/features/quota/utils/time/durations';
import styles from './QuotaHeader.module.scss';

export type QuotaHeaderProps = {
  totalCount: number;
  loadedCount: number;
  attentionCount: number;
  refreshing: boolean;
  lastRefreshAt?: number | null;
  disableControls: boolean;
  onRefreshAll: () => void;
  showEmails?: boolean;
  onToggleEmails?: () => void;
  /** Injectable clock for tests/screenshots; defaults to the shared minute clock. */
  now?: number;
};

/**
 * Quota heading, credential counts, privacy toggle, and refresh action.
 * The page shell coordinates the data-reveal entrance sequence.
 */
export function QuotaHeader(props: QuotaHeaderProps) {
  const {
    totalCount,
    loadedCount,
    attentionCount,
    refreshing,
    lastRefreshAt,
    disableControls,
    onRefreshAll,
    showEmails,
    onToggleEmails,
    now: nowProp,
  } = props;
  const { t, i18n } = useTranslation();
  // Animate the loaded count as batches finish.
  const displayLoadedCount = useCountUp(loadedCount);
  const lastRefreshDate = lastRefreshAt == null ? null : new Date(lastRefreshAt);
  const validLastRefresh =
    lastRefreshDate && Number.isFinite(lastRefreshDate.getTime()) ? lastRefreshDate : null;
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const tick = useNow(nowProp === undefined && validLastRefresh !== null);
  const now = nowProp ?? tick;
  // The shared clock only advances once a minute, so a refresh that just
  // finished can sit slightly *ahead* of `now`. Anything under a minute old —
  // including that skew — reads "just now" rather than "in 1 minute".
  const lastRefreshLabel = validLastRefresh
    ? now - validLastRefresh.getTime() < MINUTE_MS
      ? t('quota_management.last_refresh_just_now')
      : t('quota_management.last_refresh', {
          time: formatRelativeInstant(validLastRefresh.getTime(), now, locale),
        })
    : null;

  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <h1 className={styles.title} data-reveal>
          {t('quota_management.title')}
        </h1>
        <p className={styles.meta} data-reveal>
          <span className={styles.metaTotal}>
            {t('quota_management.meta_credentials', { count: totalCount })}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span className={loadedCount > 0 ? styles.metaLoaded : styles.metaMuted}>
            {t('quota_management.meta_loaded', { count: displayLoadedCount })}
          </span>
          {attentionCount > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaAttention}>
                {t('quota_management.meta_attention', { count: attentionCount })}
              </span>
            </>
          )}
        </p>
      </div>
      <div className={styles.actions} data-reveal>
        {onToggleEmails && (
          <button
            type="button"
            className={styles.privacyAction}
            onClick={onToggleEmails}
            aria-pressed={showEmails}
          >
            {t(
              showEmails
                ? 'quota_management.ledger.hide_emails'
                : 'quota_management.ledger.show_emails'
            )}
          </button>
        )}
        <button
          type="button"
          className={styles.primaryAction}
          onClick={onRefreshAll}
          disabled={disableControls || refreshing}
          aria-busy={refreshing}
        >
          <IconRefreshCw size={14} className={refreshing ? styles.spinning : undefined} />
          <span className={styles.actionCopy}>
            <span>{t('quota_management.refresh_all_credentials')}</span>
            {validLastRefresh && (
              <time
                className={styles.lastRefresh}
                dateTime={validLastRefresh.toISOString()}
                title={validLastRefresh.toLocaleString(locale, {
                  dateStyle: 'full',
                  timeStyle: 'long',
                })}
              >
                {lastRefreshLabel}
              </time>
            )}
          </span>
        </button>
      </div>
    </header>
  );
}
