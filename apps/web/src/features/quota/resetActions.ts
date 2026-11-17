/**
 * The Ledger's use-a-reset copy and state, React-free so it can be tested
 * without the drawer. `QuotaLedgerResets.tsx` renders what these build.
 */

import type { TFunction } from 'i18next';
import type {
  AnthropicResetGrant,
  AnthropicResetWindow,
} from '@/features/personal-quota-support/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/features/quota/utils/quota';
import { maskQuotaText } from './ledgerModel';
import type { ResetGrantChoice, ResetGrantChoiceReason } from './providers/claude/selectResetGrant';
import type { ResetInventoryItem } from './resetInventory';

/** Resets a subscription holds: a Codex credit is one, a Claude grant counts its `left`. */
export const countResets = (items: readonly ResetInventoryItem[]): number =>
  items.reduce((sum, item) => sum + (item.left ?? 1), 0);

/** `MM/DD`, browser-local — the chip's short form of `formatInstantShort`. */
export const formatMonthDay = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });

/**
 * A reset's name in the "Resets expire" list and the Claude picker. Unnamed
 * resets are numbered by their position (0-based `index`) in that list.
 */
export const resetItemLabel = (
  t: TFunction,
  item: { label?: string },
  index: number,
  showEmails: boolean
): string => {
  if (!item.label) return t('quota_management.resets.unnamed', { index: index + 1 });
  return showEmails ? item.label : maskQuotaText(item.label);
};

/** "2 of 3 left · clears 5-hour + 7-day"; null for a Codex credit (no count). */
export const claudeResetDetail = (
  t: TFunction,
  item: { left?: number; total?: number; clears?: readonly AnthropicResetWindow[] }
): string | null => {
  if (item.left === undefined) return null;
  const windows = (item.clears ?? [])
    .map((window) => t(`quota_management.resets.windows.${window}`))
    .join(' + ');
  return t(
    windows ? 'quota_management.resets.claude_left' : 'quota_management.resets.claude_left_only',
    { left: item.left, total: item.total ?? item.left, windows }
  );
};

/** One radio in the Claude confirm step. */
export type ResetActionChoice = {
  id: string;
  label: string;
  detail: string;
  usable: boolean;
  /** Why an unusable choice cannot be picked; translated. */
  reason?: string;
  /** Upstream's `next_grant_id`. */
  recommended: boolean;
  /** The grant Confirm would spend. */
  selected: boolean;
};

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
  /** Claude: grants to pick from; present only when there is a real choice. */
  choices?: ResetActionChoice[];
  onChoose?: (id: string) => void;
  /** Drops the pick when the confirm step closes, so reopening starts from the default. */
  onClearChoice?: () => void;
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
  /** Absent before the read and while a claim is pending. */
  choices?: ResetGrantChoice[];
  choose: (id: string | undefined) => void;
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

/** Per-grant reasons have short keys; account-wide ones reuse the `claude_reset.*` sentences. */
const PER_GRANT_REASONS: ReadonlySet<ResetGrantChoiceReason> = new Set([
  'paused',
  'not_usable',
  'not_limited',
  'not_started',
]);

const choiceReason = (t: TFunction, reason: ResetGrantChoiceReason | undefined) => {
  if (!reason) return undefined;
  return PER_GRANT_REASONS.has(reason)
    ? t(`quota_management.resets.choice.reason.${reason}`)
    : t(`claude_reset.${reason}`);
};

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
    // Cleared on every close, even with no list shown, so a stale pick never
    // resurfaces after a refresh brings its grant back.
    onClearChoice: () => handle.choose(undefined),
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
  const choices = handle.choices ?? [];
  // The same position numbering as the "Resets expire" list, which shares this order.
  const labelOf = (target: AnthropicResetGrant) =>
    resetItemLabel(
      t,
      target,
      Math.max(
        0,
        choices.findIndex((choice) => choice.grant.id === target.id)
      ),
      showEmails
    );
  const picker =
    choices.length >= 2 && choices.some((choice) => choice.usable)
      ? {
          choices: choices.map(
            (choice): ResetActionChoice => ({
              id: choice.grant.id,
              label: labelOf(choice.grant),
              detail:
                claudeResetDetail(t, {
                  left: choice.grant.resetsLeft,
                  total: choice.grant.resetsTotal,
                  clears: choice.grant.clears,
                }) ?? '',
              usable: choice.usable,
              ...(choice.reason ? { reason: choiceReason(t, choice.reason) } : {}),
              recommended: choice.recommended,
              selected: choice.grant.id === grant?.id,
            })
          ),
          onChoose: (id: string) => handle.choose(id),
        }
      : {};
  let consequence = handle.confirmMessage;
  if (grant) {
    const label = labelOf(grant);
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
    ...picker,
    label: t('quota_management.resets.use'),
    consequence,
    note: handle.count === null ? undefined : remainingNote(t, handle.count - 1),
    confirmLabel: t('quota_management.resets.confirm_button'),
  };
}
