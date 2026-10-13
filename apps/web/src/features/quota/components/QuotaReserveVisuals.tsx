import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { formatInstantShort } from '@/features/quota/utils/quota';
import { reserveCoversWindow } from '../ledgerModel';
import type { QuotaProviderType } from '../providers/types';
import { formatMonthDay } from '../resetActions';
import styles from './QuotaReserveVisuals.module.scss';

/**
 * Remaining-quota bar with an optional reserve tick. With provider and window
 * id, the tick appears only on windows the backend's reserve verdict reads.
 */
export function ReserveMeter({
  remaining,
  reserve,
  provider,
  windowId,
}: {
  remaining: number | null;
  reserve?: number;
  provider?: QuotaProviderType;
  windowId?: string;
}) {
  const tone =
    remaining === null
      ? ''
      : remaining >= 70
        ? styles.high
        : remaining >= 30
          ? styles.medium
          : styles.low;
  const track = (
    <div className={styles.track} aria-hidden="true">
      <span className={tone} style={{ width: `${remaining ?? 0}%` }} />
    </div>
  );
  const covered =
    reserve !== undefined &&
    (provider === undefined || windowId === undefined || reserveCoversWindow(provider, windowId));
  if (!covered) return track;
  // On a window the verdict reads, the fill ends left of the tick when it is below the reserve.
  return (
    <div className={styles.meter}>
      {track}
      <i
        className={styles.reserveTick}
        data-reserve-tick=""
        style={{ left: `${reserve}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

/** Shows the backend's reserve verdict as-is; the UI never recomputes it. */
export function ReserveBadge({
  file,
  onClick,
  expanded,
}: {
  file: AuthFileItem;
  /** Turns the badge into a button, e.g. to open an inline reserve editor. */
  onClick?: () => void;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const reserve = file.quotaReserve;
  if (!reserve) return null;
  const hard = reserve.mode === 'hard';
  const mode = t(
    hard ? 'quota_management.reserve.mode_hard' : 'quota_management.reserve.mode_soft'
  );
  let text: string;
  let title: string;
  if (!file.quotaReserveActive) {
    text = t('quota_management.reserve.badge', { percent: reserve.percent, mode });
    title = t(hard ? 'quota_management.reserve.idle_hard' : 'quota_management.reserve.idle_soft', {
      percent: reserve.percent,
    });
  } else if (file.quotaReserveUntil) {
    // The API layer keeps only a parseable `quota_reserve_until`.
    const untilMs = Date.parse(file.quotaReserveUntil);
    text = t('quota_management.reserve.badge_held', { date: formatMonthDay(untilMs), mode });
    title = t(hard ? 'quota_management.reserve.held_hard' : 'quota_management.reserve.held_soft', {
      date: formatInstantShort(untilMs),
    });
  } else {
    text = t('quota_management.reserve.badge_held_open', { mode });
    title = t(
      hard ? 'quota_management.reserve.held_hard_open' : 'quota_management.reserve.held_soft_open'
    );
  }
  const tone = file.quotaReserveActive ? 'warn' : undefined;
  if (onClick) {
    return (
      <button
        type="button"
        className={`${styles.reserve} ${styles.reserveButton}`}
        data-reserve-badge=""
        data-tone={tone}
        title={title}
        aria-expanded={expanded}
        onClick={onClick}
      >
        {text}
      </button>
    );
  }
  return (
    <span className={styles.reserve} data-reserve-badge="" data-tone={tone} title={title}>
      {text}
    </span>
  );
}
