/**
 * The Ledger's view of a subscription's manual resets: a compact chip under
 * the plan label and a full-width drawer under the row.
 *
 * They are separate exports because they live in different grid cells of
 * `LedgerRow`; the row owns the expanded state and the inventory, and passes
 * both down. Everything here renders from `buildResetInventory`, never from
 * `QuotaBody` classes — those bind at module init and break SSR tests.
 *
 * Using a reset is a two-step inline confirmation in the drawer footer. The
 * spending itself stays in the existing flows: Codex through the page's
 * `performReset`, Claude through `useClaudeResetGrants().execute()`, which
 * `ClaudeLedgerResetsDrawer` mounts only while its drawer is open.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { buildResetDisplay, formatInstantShort } from '@/features/quota/utils/quota';
import { DAY_MS } from '@/features/quota/utils/time/durations';
import { maskQuotaText } from '../ledgerModel';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import type { QuotaProviderType } from '../providers/types';
import { claudeResetAction, countResets, formatMonthDay, type ResetAction } from '../resetActions';
import type { ResetInventory, ResetInventoryItem } from '../resetInventory';
import styles from './QuotaLedgerResets.module.scss';

/** The chip turns amber when the soonest reset lapses within this window. */
const EXPIRY_WARNING_MS = 3 * DAY_MS;

const itemLabel = (
  t: TFunction,
  item: ResetInventoryItem,
  index: number,
  showEmails: boolean
): string => {
  if (!item.label) return t('quota_management.resets.unnamed', { index: index + 1 });
  return showEmails ? item.label : maskQuotaText(item.label);
};

type ChipProps = {
  inventory: ResetInventory | null;
  expanded: boolean;
  loading: boolean;
  controls: string;
  showEmails: boolean;
  now: number;
  /** A Claude claim's outcome is unknown; its retry lives in the drawer. */
  unresolved?: boolean;
  onToggle: () => void;
};

export function QuotaLedgerResetsChip({
  inventory,
  expanded,
  loading,
  controls,
  showEmails,
  now,
  unresolved = false,
  onToggle,
}: ChipProps) {
  const { t } = useTranslation();
  const items = inventory?.items ?? [];
  const count = countResets(items);
  // An open drawer or an unresolved claim keeps the toggle, so the drawer can be closed
  // through a refresh or a failed read and reopened to retry once the last reset is gone.
  const keepToggle = expanded || unresolved;

  if (!keepToggle && inventory?.error !== undefined) {
    const detail = showEmails ? inventory.error : maskQuotaText(inventory.error);
    return (
      <span className={styles.error} title={detail || undefined}>
        {t('quota_management.resets.load_error')}
      </span>
    );
  }
  if (!keepToggle && count === 0) return null;

  const soonest = items[0]?.expiresAtMs ?? null;
  let text: string;
  if (count > 0) {
    const many = count > 1;
    text =
      soonest === null
        ? t(
            many
              ? 'quota_management.resets.chip_many_open'
              : 'quota_management.resets.chip_one_open',
            {
              count,
            }
          )
        : t(many ? 'quota_management.resets.chip_many' : 'quota_management.resets.chip_one', {
            count,
            date: formatMonthDay(soonest),
          });
  } else if (unresolved) {
    text = t('quota_management.resets.chip_unresolved');
  } else if (loading) {
    text = t('quota_management.resets.loading');
  } else if (inventory?.error !== undefined || !inventory) {
    text = t('quota_management.resets.load_error');
  } else {
    text = t('quota_management.resets.empty');
  }
  const warn = unresolved || (soonest !== null && soonest - now <= EXPIRY_WARNING_MS);
  const title = items
    .map((item) =>
      item.expiresAtMs === null
        ? t('quota_management.resets.no_expiry')
        : formatInstantShort(item.expiresAtMs)
    )
    .join('\n');

  return (
    <button
      type="button"
      className={styles.chip}
      data-resets-chip=""
      data-tone={warn ? 'warn' : undefined}
      aria-expanded={expanded}
      aria-controls={controls}
      title={title || undefined}
      onClick={onToggle}
    >
      <span>{text}</span>
      <span className={styles.caret} aria-hidden="true">
        {expanded ? '▴' : '▾'}
      </span>
    </button>
  );
}

type ConfirmProps = {
  consequence: string;
  note?: string;
  confirmLabel: string;
  busy: boolean;
  /** Blocks the confirm button without the busy label (e.g. a stale Claude read). */
  blocked?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The second, amber step: Cancel takes focus, Esc cancels. */
export function QuotaLedgerResetsConfirm({
  consequence,
  note,
  confirmLabel,
  busy,
  blocked = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[data-resets-cancel]')?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || busy) return;
    event.stopPropagation();
    onCancel();
  };

  return (
    <div ref={ref} className={styles.confirm} data-resets-confirm="" onKeyDown={onKeyDown}>
      <p className={styles.consequence}>{consequence}</p>
      {note && <p className={styles.confirmNote}>{note}</p>}
      <div className={styles.confirmActions}>
        <Button
          variant="secondary"
          size="sm"
          data-resets-cancel=""
          disabled={busy}
          onClick={onCancel}
        >
          {t('quota_management.resets.cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={busy || blocked} onClick={onConfirm}>
          {busy ? t('quota_management.resets.using') : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/** "Use a reset…" then the inline confirm; shared by the Ledger drawer and the compact cards. */
export function ResetActionFooter({
  provider,
  action,
  initialConfirming = false,
  onClose,
  variant = 'drawer',
}: {
  provider: QuotaProviderType;
  action: ResetAction;
  /** Open straight on the confirm step (the first click happened elsewhere). */
  initialConfirming?: boolean;
  /** Called when the confirm step closes after Cancel, Esc or a finished reset. */
  onClose?: () => void;
  /** `card` drops the drawer divider and moves the Codex note into the button tooltip. */
  variant?: 'drawer' | 'card';
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(initialConfirming);
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (confirming || !returnFocus.current) return;
    returnFocus.current = false;
    ref.current?.querySelector<HTMLButtonElement>('[data-resets-use]')?.focus();
  }, [confirming]);
  const close = () => {
    returnFocus.current = true;
    setConfirming(false);
    onClose?.();
  };
  const confirm = () => {
    if (action.blocked || action.busy) return;
    void Promise.resolve(action.onConfirm()).finally(close);
  };

  return (
    <div ref={ref} className={variant === 'card' ? styles.footerCard : styles.footer}>
      {provider === 'codex' && variant === 'drawer' && (
        <span className={styles.note}>{t('quota_management.resets.codex_choice_note')}</span>
      )}
      {action.reason && <span className={styles.reason}>{action.reason}</span>}
      {confirming || action.busy ? (
        <QuotaLedgerResetsConfirm
          consequence={action.consequence}
          note={action.note}
          confirmLabel={action.confirmLabel}
          busy={action.busy}
          blocked={action.blocked}
          onConfirm={confirm}
          onCancel={close}
        />
      ) : (
        <Button
          variant="secondary"
          size="sm"
          data-resets-use=""
          disabled={action.blocked}
          title={
            provider === 'codex' && variant === 'card'
              ? t('quota_management.resets.codex_choice_note')
              : undefined
          }
          onClick={() => setConfirming(true)}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

type DrawerProps = {
  id: string;
  provider: QuotaProviderType;
  inventory: ResetInventory | null;
  loading: boolean;
  showEmails: boolean;
  now: number;
  /** The use-a-reset flow; without one the drawer only lists the resets. */
  action?: ResetAction;
};

function ResetLine({
  item,
  index,
  showEmails,
  now,
}: {
  item: ResetInventoryItem;
  index: number;
  showEmails: boolean;
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const display =
    item.expiresAtMs === null
      ? null
      : buildResetDisplay(null, item.expiresAtMs, now, i18n.resolvedLanguage);
  const windows = (item.clears ?? [])
    .map((window) => t(`quota_management.resets.windows.${window}`))
    .join(' + ');
  const claudeDetail =
    item.left === undefined
      ? null
      : t(
          windows
            ? 'quota_management.resets.claude_left'
            : 'quota_management.resets.claude_left_only',
          { left: item.left, total: item.total ?? item.left, windows }
        );

  return (
    <li className={styles.line}>
      <div className={styles.lineHeading}>
        <span className={styles.label}>{itemLabel(t, item, index, showEmails)}</span>
        {index === 0 && (
          <span className={styles.soonest}>{t('quota_management.resets.soonest')}</span>
        )}
      </div>
      {claudeDetail && <div className={styles.detail}>{claudeDetail}</div>}
      <div className={styles.expiry}>
        {display
          ? t('quota_management.resets.expires_line', {
              date: display.absolute,
              relative: display.relative,
            })
          : t('quota_management.resets.no_expiry')}
      </div>
    </li>
  );
}

export function QuotaLedgerResetsDrawer({
  id,
  provider,
  inventory,
  loading,
  showEmails,
  now,
  action,
}: DrawerProps) {
  const { t } = useTranslation();
  const items = inventory?.items ?? [];
  const title = t('quota_management.resets.title');

  let body;
  let listed = false;
  if (loading) {
    body = <p className={styles.status}>{t('quota_management.resets.loading')}</p>;
  } else if (!inventory || inventory.error !== undefined) {
    body = <p className={styles.status}>{t('quota_management.resets.load_error')}</p>;
  } else if (!items.length) {
    body = <p className={styles.status}>{t('quota_management.resets.empty')}</p>;
  } else {
    listed = true;
    body = (
      <>
        <p className={styles.hint}>{t('quota_management.resets.hint')}</p>
        <ul className={styles.list}>
          {items.map((item, index) => (
            <ResetLine key={item.id} item={item} index={index} showEmails={showEmails} now={now} />
          ))}
        </ul>
      </>
    );
  }
  // An unknown-outcome Claude claim stays retryable after the stored list stops showing it.
  const footer = action && (listed || (!loading && action.retry));

  return (
    <section id={id} className={styles.drawer} aria-label={title}>
      <div className={styles.header}>
        <strong>{title}</strong>{' '}
        {items.length > 0 && <span className={styles.count}>{countResets(items)}</span>}
      </div>
      {body}
      {footer && <ResetActionFooter provider={provider} action={action} />}
    </section>
  );
}

type ClaudeMountProps = {
  file: AuthFileItem;
  /** Changes when the stored quota changes, so the hook re-reads fresh status. */
  refreshToken: unknown;
  enabled: boolean;
  disabled: boolean;
  displayName: string;
  showEmails: boolean;
  onRefresh: () => void;
  onBusyChange: (busy: boolean) => void;
  children: (action: ResetAction) => ReactNode;
};

/**
 * Mounting this reads fresh grant status, so callers render it only while the
 * use-a-reset flow is open (an open drawer or an armed card).
 */
export function ClaudeResetActionMount({
  file,
  refreshToken,
  enabled,
  disabled,
  displayName,
  showEmails,
  onRefresh,
  onBusyChange,
  children,
}: ClaudeMountProps) {
  const { t } = useTranslation();
  const reset = useClaudeResetGrants(file, enabled, disabled, refreshToken, onRefresh, displayName);
  useEffect(() => {
    onBusyChange(reset.busy);
  }, [reset.busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  return <>{children(claudeResetAction(t, reset, { showEmails }))}</>;
}

type ClaudeDrawerProps = Omit<DrawerProps, 'provider' | 'action'> &
  Omit<ClaudeMountProps, 'children' | 'showEmails'>;

/** The drawer reads fresh grant status, so the row renders it only while open. */
export function ClaudeLedgerResetsDrawer({
  file,
  refreshToken,
  enabled,
  disabled,
  displayName,
  onRefresh,
  onBusyChange,
  ...drawer
}: ClaudeDrawerProps) {
  return (
    <ClaudeResetActionMount
      file={file}
      refreshToken={refreshToken}
      enabled={enabled}
      disabled={disabled}
      displayName={displayName}
      showEmails={drawer.showEmails}
      onRefresh={onRefresh}
      onBusyChange={onBusyChange}
    >
      {(action) => <QuotaLedgerResetsDrawer {...drawer} provider="claude" action={action} />}
    </ClaudeResetActionMount>
  );
}
