/**
 * The manual resets a subscription still holds, and when each one lapses.
 *
 * Codex reset credits and Claude reset grants are different upstream objects —
 * a credit is spent whole and always expires, a grant carries a count and may
 * be open-ended — but the question the Ledger asks of both is the same: how
 * many can I still use, and which one do I lose first. This reads both into one
 * list sorted by expiry, soonest first.
 *
 * Pure and React-free: `nowMs` is passed in and nothing here imports the
 * store; labels arrive already trimmed by the API readers. `CodexQuotaBody`, the
 * Timeline and `resetSchedule.ts` keep their own readers on purpose; this one
 * only serves the Ledger.
 */

import type {
  AnthropicResetGrant,
  AnthropicResetWindow,
} from '@/features/personal-quota-support/services/api/claudeResetGrants';
import type {
  ClaudeQuotaState,
  CodexQuotaState,
  CodexRateLimitResetCredit,
} from '@/features/personal-quota-support/types';
import { parseIsoToMs } from '@/features/quota/utils/quota';
import type { QuotaProviderType } from './providers/types';
import { resetCreditRowId } from './resetSchedule';

export interface ResetInventoryItem {
  /** Credit/grant id; index-based fallback when upstream sent none. */
  id: string;
  /** null = upstream gave no expiry (Claude only). */
  expiresAtMs: number | null;
  /** Codex credit title / Claude grant label. */
  label?: string;
  /** Claude: resets left on the grant. */
  left?: number;
  /** Claude: resets the grant started with. */
  total?: number;
  /** Claude: windows a claim clears. */
  clears?: AnthropicResetWindow[];
}

export interface ResetInventory {
  items: ResetInventoryItem[];
  /** Present when the resets could not be read; the items are then empty. */
  error?: string;
}

/** Soonest first; open-ended last; ties on id so the order is deterministic. */
const compareItems = (a: ResetInventoryItem, b: ResetInventoryItem): number => {
  if (a.expiresAtMs !== b.expiresAtMs) {
    if (a.expiresAtMs === null) return 1;
    if (b.expiresAtMs === null) return -1;
    return a.expiresAtMs - b.expiresAtMs;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const codexItems = (
  credits: readonly CodexRateLimitResetCredit[],
  nowMs: number
): ResetInventoryItem[] =>
  credits
    .map((credit, index): ResetInventoryItem | null => {
      if (credit.status !== 'available') return null;
      // A credit without a readable expiry cannot be placed or trusted.
      const expiresAtMs = parseIsoToMs(credit.expiresAt);
      if (expiresAtMs === null || expiresAtMs <= nowMs) return null;
      return {
        id: resetCreditRowId(credit, index),
        expiresAtMs,
        ...(credit.title ? { label: credit.title } : {}),
      };
    })
    .filter((item): item is ResetInventoryItem => item !== null);

const claudeItems = (grants: readonly AnthropicResetGrant[], nowMs: number): ResetInventoryItem[] =>
  grants
    .map((grant, index): ResetInventoryItem | null => {
      const left = grant.resetsLeft;
      if (!(left > 0)) return null;
      // `endsAt: null` is an open-ended grant; a present but unreadable one is
      // dropped rather than shown as open-ended.
      let expiresAtMs: number | null = null;
      if (grant.endsAt !== null) {
        expiresAtMs = parseIsoToMs(grant.endsAt);
        if (expiresAtMs === null || expiresAtMs <= nowMs) return null;
      }
      return {
        id: grant.id || `grant-${index}`,
        expiresAtMs,
        ...(grant.label ? { label: grant.label } : {}),
        left,
        total: grant.resetsTotal,
        clears: grant.clears,
      };
    })
    .filter((item): item is ResetInventoryItem => item !== null);

/**
 * Every usable reset on one credential, soonest expiry first.
 *
 * Returns null when the provider has no resets or the quota has not loaded
 * successfully — there is nothing to say yet, which is different from an
 * empty inventory. A failed resets read keeps the windows usable and comes
 * back as `{ items: [], error }`.
 */
export function buildResetInventory(
  provider: QuotaProviderType,
  quota: unknown,
  nowMs: number
): ResetInventory | null {
  if (provider !== 'codex' && provider !== 'claude') return null;
  const state = quota as { status?: string } | null | undefined;
  if (!state || state.status !== 'success') return null;

  if (provider === 'codex') {
    const codex = quota as CodexQuotaState;
    if (codex.rateLimitResetCreditsError) {
      return { items: [], error: codex.rateLimitResetCreditsError };
    }
    return { items: codexItems(codex.rateLimitResetCredits ?? [], nowMs).sort(compareItems) };
  }

  const claude = quota as ClaudeQuotaState;
  // `null` means the read failed; `undefined` means grants were never loaded.
  if (claude.resetGrants === null) {
    return { items: [], error: claude.resetGrantsError ?? '' };
  }
  return { items: claudeItems(claude.resetGrants ?? [], nowMs).sort(compareItems) };
}
