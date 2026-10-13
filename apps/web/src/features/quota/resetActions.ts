/**
 * The Ledger's use-a-reset copy and state, React-free so it can be tested
 * without the drawer. `QuotaLedgerResets.tsx` renders what these build.
 */

import type { TFunction } from 'i18next';
import type { AnthropicResetGrant } from '@/features/personal-quota-support/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/features/quota/utils/quota';
import { maskQuotaText } from './ledgerModel';
import type { ResetInventoryItem } from './resetInventory';

/** Resets a subscription holds: a Codex credit is one, a Claude grant counts its `left`. */
export const countResets = (items: readonly ResetInventoryItem[]): number =>
  items.reduce((sum, item) => sum + (item.left ?? 1), 0);

/** `MM/DD`, browser-local — the chip's short form of `formatInstantShort`. */
export const formatMonthDay = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });

/** What the drawer footer offers; built by `codexResetAction` / `claudeResetAction`. */
export type ResetAction = {
  /** First-step button ("Use a reset…" or the Claude same-claim retry). */
  label: string;
  blocked: boolean;
  /** A reset for this row is in flight. */
  busy: boolean;
  /** Inline explanation shown while the action is blocked or an outcome is unknown. */
  reason?: string;
  /** Retries an unknown-outcome claim; offered even when no reset is listed. */
  retry?: boolean;
  consequence: string;
  note?: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
};

type ActionState = Pick<ResetAction, 'blocked' | 'busy' | 'onConfirm'>;

/** The `useClaudeResetGrants` fields the Ledger reads. */
export type ClaudeResetHandle = {
  blocked: boolean;
  busy: boolean;
  message: string;
  blockReason?: string;
  buttonLabel: string;
  confirmMessage: string;
  count: number | null;
  selectedGrant?: AnthropicResetGrant;
  execute: () => Promise<void>;
};

/** "5-hour and 7-day"; an empty list means the grant names no specific windows. */
const joinWindows = (t: TFunction, names: string[]): string => {
  if (!names.length) return t('quota_management.resets.windows_eligible');
  if (names.length === 1) return names[0];
  return t('quota_management.resets.windows_and', {
    first: names.slice(0, -1).join(', '),
    last: names[names.length - 1],
  });
};

const remainingNote = (t: TFunction, remaining: number): string =>
  remaining <= 0
    ? t('quota_management.resets.cant_undo_none')
    : t(
        remaining === 1
          ? 'quota_management.resets.cant_undo_one'
          : 'quota_management.resets.cant_undo_many',
        { count: remaining }
      );

/** Codex spends one credit per subscription; OpenAI picks which, so there is no per-line action. */
export function codexResetAction(t: TFunction, count: number, state: ActionState): ResetAction {
  return {
    ...state,
    label: t('quota_management.resets.use'),
    consequence: t(
      count === 1
        ? 'quota_management.resets.confirm_codex_last'
        : 'quota_management.resets.confirm_codex',
      { count }
    ),
    note: remainingNote(t, count - 1),
    confirmLabel: t('quota_management.resets.confirm_button'),
  };
}

/** A pending (unknown-outcome) claim retries with the hook's own warning text. */
export function claudeResetAction(
  t: TFunction,
  handle: ClaudeResetHandle,
  { showEmails }: { showEmails: boolean }
): ResetAction {
  const base = {
    blocked: handle.blocked,
    busy: handle.busy,
    reason:
      handle.message || handle.blockReason
        ? t(`claude_reset.${handle.message || handle.blockReason}`)
        : undefined,
    onConfirm: () => handle.execute(),
  };
  if (handle.buttonLabel === 'retry') {
    const retry = t('claude_reset.retry');
    return {
      ...base,
      retry: true,
      label: retry,
      consequence: handle.confirmMessage,
      confirmLabel: retry,
    };
  }
  const grant = handle.selectedGrant;
  let consequence = handle.confirmMessage;
  if (grant) {
    const label = grant.label
      ? showEmails
        ? grant.label
        : maskQuotaText(grant.label)
      : t('quota_management.resets.unnamed', { index: 1 });
    const windows = joinWindows(
      t,
      grant.clears.map((window) => t(`quota_management.resets.windows.${window}`))
    );
    const endsAtMs = parseIsoToMs(grant.endsAt);
    consequence =
      endsAtMs === null
        ? t('quota_management.resets.confirm_claude_open', { label, windows })
        : t('quota_management.resets.confirm_claude', {
            label,
            windows,
            date: formatMonthDay(endsAtMs),
          });
  }
  return {
    ...base,
    label: t('quota_management.resets.use'),
    consequence,
    note: handle.count === null ? undefined : remainingNote(t, handle.count - 1),
    confirmLabel: t('quota_management.resets.confirm_button'),
  };
}
