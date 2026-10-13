import { useTranslation } from 'react-i18next';
import { getTypeLabel } from '@/features/quota/authFiles/constants';
import { buildResetDisplay } from '@/features/quota/utils/quota';
import type { QuotaTotals } from '../quotaTotalsModel';
import styles from './QuotaTotalsStrip.module.scss';

const tone = (remaining: number | null) =>
  remaining === null ? 'unknown' : remaining >= 70 ? 'high' : remaining >= 30 ? 'medium' : 'low';

/** Slim per-provider window totals plus the resets every subscription still holds. */
export function QuotaTotalsStrip({ totals, now }: { totals: QuotaTotals; now: number }) {
  const { t, i18n } = useTranslation();
  if (totals.tiles.length === 0 && !totals.resets) return null;
  const when = (ms: number | null) => {
    const display = buildResetDisplay(null, ms, now, i18n.resolvedLanguage);
    return display ? [display.relative, display.absolute].filter(Boolean).join(' · ') : null;
  };

  return (
    <section
      className={styles.strip}
      data-quota-totals
      aria-label={t('quota_management.totals.title')}
    >
      {totals.tiles.map((tile) => {
        const reset = when(tile.resetAtMs);
        return (
          <div className={styles.tile} key={`${tile.provider}-${tile.windowId}`}>
            <div className={styles.top}>
              <span className={styles.name}>
                {getTypeLabel(t, tile.provider)} · {tile.label}
              </span>
              <span>{t('quota_management.meta_credentials', { count: tile.credentialCount })}</span>
            </div>
            <div className={styles.number}>
              {tile.remaining === null ? (
                <strong data-total-unknown>—</strong>
              ) : (
                <strong>{Math.round(tile.remaining)}%</strong>
              )}
              <span>{t('quota_management.totals.of_capacity', { capacity: tile.capacity })}</span>
            </div>
            <div className={styles.segments} aria-hidden="true">
              {tile.segments.map((segment, index) => (
                <span className={styles.track} key={index} data-total-segment>
                  <span
                    className={styles[tone(segment)]}
                    data-tone={tone(segment)}
                    style={{ width: `${segment ?? 0}%` }}
                  />
                </span>
              ))}
            </div>
            {reset && <div className={styles.foot}>{reset}</div>}
          </div>
        );
      })}
      {totals.resets && (
        <div className={styles.tile} data-total-resets>
          <div className={styles.top}>
            <span className={styles.name}>{t('quota_management.totals.resets_title')}</span>
          </div>
          <div className={styles.number}>
            <strong>{totals.resets.total}</strong>
            <span>
              {t('quota_management.totals.resets_split', {
                claude: totals.resets.byProvider.claude,
                codex: totals.resets.byProvider.codex,
              })}
            </span>
          </div>
          {totals.resets.soonestMs !== null && (
            <div className={styles.foot} data-tone="warn">
              {t('quota_management.totals.resets_next', { when: when(totals.resets.soonestMs) })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
