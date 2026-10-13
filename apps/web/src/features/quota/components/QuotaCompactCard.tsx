import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import type { ResolvedTheme } from '@/features/personal-quota-support/types';
import { buildResetDisplay, formatInstantShort } from '@/features/quota/utils/quota';
import { resolveTimeZoneLabel } from '@/features/quota/utils/time/timezone';
import type { CompactCardModel } from '../compactCardModel';
import type { QuotaFileEntry } from '../logic';
import type { ResetInventoryItem } from '../resetInventory';
import { ProviderPill } from './ProviderPill';
import { ReserveBadge, ReserveMeter } from './QuotaReserveVisuals';
import styles from './QuotaCompactCard.module.scss';

interface Props {
  entry: QuotaFileEntry;
  model: CompactCardModel;
  resolvedTheme: ResolvedTheme;
  now: number;
  canRefresh: boolean;
  onRefresh: () => void;
  /** A reset or refresh for this credential is in flight. */
  busy?: boolean;
  /** "Use a reset…" flow rendered in the footer. */
  resetAction?: ReactNode;
  /** Opens the inline reserve editor from the reserve chip. */
  onReserveClick?: () => void;
  reserveExpanded?: boolean;
  /** Inline reserve editor, rendered under the chips while open. */
  reserveEditor?: ReactNode;
  /** Draft reserve percent shown on the ticks while editing. */
  reservePreview?: number;
}

function resetLabel(item: ResetInventoryItem, index: number, t: TFunction) {
  const label = item.label || t('quota_management.resets.unnamed', { index: index + 1 });
  return item.total !== undefined ? `${label} · ${item.left ?? item.total}/${item.total}` : label;
}

/** Compact account card in the Auth Files visual language (Cards view). */
export function QuotaCompactCard({
  entry,
  model,
  resolvedTheme,
  now,
  canRefresh,
  onRefresh,
  busy = false,
  resetAction,
  onReserveClick,
  reserveExpanded,
  reserveEditor,
  reservePreview,
}: Props) {
  const { t, i18n } = useTranslation();
  const reserve = reservePreview ?? entry.file.quotaReserve?.percent;
  const resets = model.resets;
  const loading = model.state === 'loading';

  return (
    <article
      className={styles.card}
      data-compact-card=""
      data-provider={model.provider}
      aria-busy={loading || busy}
    >
      <header className={styles.head}>
        <ProviderPill type={model.provider} resolvedTheme={resolvedTheme} />
        <span className={styles.name} title={model.name}>
          {model.name}
        </span>
        <span
          className={styles.dot}
          data-enabled={model.enabled ? 'true' : 'false'}
          title={t(
            model.enabled ? 'quota_management.compact.enabled' : 'quota_management.compact.disabled'
          )}
        />
      </header>

      {(model.chips.length > 0 || entry.file.quotaReserve || onReserveClick) && (
        <div className={styles.chips}>
          {model.chips.map((chip) => (
            <span className={styles.chip} key={chip.kind} data-chip={chip.kind}>
              {chip.label} <b>{chip.value}</b>
              {chip.detail && <span className={styles.chipDetail}> · {chip.detail}</span>}
            </span>
          ))}
          {entry.file.quotaReserve ? (
            <ReserveBadge file={entry.file} onClick={onReserveClick} expanded={reserveExpanded} />
          ) : (
            onReserveClick && (
              <button
                type="button"
                className={styles.setReserve}
                data-set-reserve=""
                aria-expanded={reserveExpanded}
                onClick={onReserveClick}
              >
                {t('quota_management.compact.set_reserve')}
              </button>
            )
          )}
        </div>
      )}

      {reserveEditor}

      {model.state === 'idle' && (
        <div className={styles.state}>{t('quota_management.ledger.load_hint')}</div>
      )}
      {model.state === 'loading' && <div className={styles.state}>{t('common.loading')}</div>}
      {model.state === 'error' && (
        <div className={styles.error} role="alert">
          {model.error}
        </div>
      )}

      {model.state === 'success' && model.windows.length > 0 && (
        <div className={styles.quota}>
          {model.windows.map((row) => (
            <div className={styles.row} key={row.id}>
              <div className={styles.rowHead}>
                <span className={styles.rowName}>{row.label}</span>
                <span className={styles.meta}>
                  <b data-tone={row.tone}>
                    {row.remaining === null ? '--' : `${Math.round(row.remaining)}%`}
                  </b>
                  {row.reset ? (
                    <>
                      {row.reset.absolute}
                      {row.reset.relative && (
                        <span className={styles.rel}> · {row.reset.relative}</span>
                      )}
                    </>
                  ) : (
                    <span className={styles.rel}>{t('quota_management.ledger.reset_unknown')}</span>
                  )}
                </span>
              </div>
              <ReserveMeter
                remaining={row.remaining}
                reserve={reserve}
                provider={model.provider}
                windowId={row.id}
              />
            </div>
          ))}
        </div>
      )}

      {resets?.error !== undefined && (
        <div className={styles.state}>{t('quota_management.resets.load_error')}</div>
      )}
      {resets && resets.items.length > 0 && (
        <div className={styles.resets} data-compact-resets="">
          <div className={styles.resetsTitle}>
            {model.provider === 'codex'
              ? t('quota_management.compact.resets_title_tz', { timezone: resolveTimeZoneLabel() })
              : t('quota_management.compact.resets_title')}
            <span> · {resets.items.reduce((sum, item) => sum + (item.left ?? 1), 0)}</span>
          </div>
          {resets.items.map((item, index) => {
            const display = buildResetDisplay(null, item.expiresAtMs, now, i18n.resolvedLanguage);
            return (
              <div
                className={styles.resetRow}
                key={item.id}
                data-reset-row=""
                data-soonest={index === 0 ? '' : undefined}
                title={item.expiresAtMs === null ? undefined : formatInstantShort(item.expiresAtMs)}
              >
                <span className={styles.resetName}>{resetLabel(item, index, t)}</span>
                <span className={styles.resetWhen}>
                  {display
                    ? [display.absolute, display.relative].filter(Boolean).join(' · ')
                    : t('quota_management.resets.no_expiry')}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <footer className={styles.foot}>
        <div className={styles.action}>{resetAction}</div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canRefresh || loading || busy}
          aria-label={t('quota_management.ledger.refresh_credential', { name: model.name })}
          onClick={onRefresh}
        >
          <IconRefreshCw size={15} />
        </Button>
      </footer>
    </article>
  );
}
