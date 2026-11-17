import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrant,
  type AnthropicResetGrantStatus,
} from '@/features/personal-quota-support/services/api/claudeResetGrants';
import { compareResetExpiry } from '@/features/quota/resetInventory';
import { parseIsoToMs } from '@/features/quota/utils/quota';

/**
 * Why one grant cannot be spent right now. `cooldown` and `ineligible` are
 * account-wide: they mark every choice unusable. `exhausted`/`unknown_grant`
 * never reach the picker because `resetGrantChoices` drops empty grants.
 */
export type ResetGrantChoiceReason =
  | 'cooldown'
  | 'ineligible'
  | 'paused'
  | 'not_usable'
  | 'not_limited'
  | 'not_started'
  | 'exhausted'
  | 'unknown_grant';

export interface ResetGrantChoice {
  grant: AnthropicResetGrant;
  usable: boolean;
  reason?: ResetGrantChoiceReason;
  /** Upstream's `next_grant_id`. */
  recommended: boolean;
}

const inCooldown = (status: AnthropicResetGrantStatus, now: number) =>
  !!status.cooldownUntil && Date.parse(status.cooldownUntil) > now;

/**
 * The one usability rule shared by the picker and `selectResetGrant`:
 * undefined when the grant can be spent now, otherwise the first reason in the
 * fixed order cooldown → upstream blocker → not started.
 */
export function resetGrantChoiceReason(
  status: AnthropicResetGrantStatus,
  grant: AnthropicResetGrant,
  now: number
): ResetGrantChoiceReason | undefined {
  if (inCooldown(status, now)) return 'cooldown';
  const blocker = anthropicResetGrantBlocker(status, grant.id);
  if (blocker) return blocker;
  if (grant.startsAt) {
    // An unreadable start cannot be proven to have passed.
    const startsAtMs = parseIsoToMs(grant.startsAt);
    if (startsAtMs === null || startsAtMs > now) return 'not_started';
  }
  return undefined;
}

/** Expiry in ms; null = open-ended; undefined = already lapsed or unreadable. */
const liveExpiry = (grant: AnthropicResetGrant, now: number): number | null | undefined => {
  if (grant.endsAt === null) return null;
  const endsAtMs = parseIsoToMs(grant.endsAt);
  return endsAtMs !== null && endsAtMs > now ? endsAtMs : undefined;
};

/**
 * Every grant the user could pick from: resets left and not lapsed, soonest
 * expiry first (the "Resets expire" order). Unusable ones stay, with a reason.
 */
export function resetGrantChoices(
  status: AnthropicResetGrantStatus,
  now: number
): ResetGrantChoice[] {
  return status.grants
    .flatMap((grant) => {
      if (!(grant.resetsLeft > 0)) return [];
      const expiresAtMs = liveExpiry(grant, now);
      if (expiresAtMs === undefined) return [];
      const reason = resetGrantChoiceReason(status, grant, now);
      const choice: ResetGrantChoice = {
        grant,
        usable: !reason,
        ...(reason ? { reason } : {}),
        recommended: grant.id === status.nextGrantId,
      };
      return [{ choice, expiresAtMs }];
    })
    .sort((a, b) =>
      compareResetExpiry(a.expiresAtMs, a.choice.grant.id, b.expiresAtMs, b.choice.grant.id)
    )
    .map(({ choice }) => choice);
}

/** Prefer the upstream recommendation; otherwise use stable ID ordering. */
export function selectResetGrant(status: AnthropicResetGrantStatus, now: number) {
  const usable = resetGrantChoices(status, now)
    .filter((choice) => choice.usable)
    .map((choice) => choice.grant);
  return (
    usable.find((grant) => grant.id === status.nextGrantId) ??
    usable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
  );
}

/**
 * Which grant a claim spends: a pending operation pins its grant (a retry may
 * not switch); otherwise the user's choice while it is still a usable choice;
 * otherwise the default from `selectResetGrant`.
 */
export function resolveSelectedGrantId({
  status,
  pendingGrantId,
  chosenGrantId,
  now,
}: {
  status: AnthropicResetGrantStatus | null | undefined;
  pendingGrantId?: string;
  chosenGrantId?: string;
  now: number;
}): string | undefined {
  if (pendingGrantId) return pendingGrantId;
  if (!status) return undefined;
  if (
    chosenGrantId !== undefined &&
    resetGrantChoices(status, now).some(
      (choice) => choice.usable && choice.grant.id === chosenGrantId
    )
  ) {
    return chosenGrantId;
  }
  return selectResetGrant(status, now)?.id;
}

/** Why `selectResetGrant` found nothing to spend, as a `claude_reset.*` key; undefined when no resets are left. */
export function resetGrantBlockReason(status: AnthropicResetGrantStatus, now: number) {
  if (inCooldown(status, now)) return 'cooldown';
  const blockers = status.grants
    .filter((grant) => grant.resetsLeft > 0)
    .map((grant) => anthropicResetGrantBlocker(status, grant.id));
  if (!blockers.length) return undefined;
  if (blockers.includes('ineligible')) return 'ineligible';
  if (blockers.includes('not_limited')) return 'not_limited';
  return 'unavailable';
}
