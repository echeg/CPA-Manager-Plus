import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrantStatus,
} from '@/features/personal-quota-support/services/api/claudeResetGrants';

/** Prefer the upstream recommendation; otherwise use stable ID ordering. */
export function selectResetGrant(status: AnthropicResetGrantStatus, now: number) {
  if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return undefined;
  const usable = status.grants.filter(
    (grant) =>
      !anthropicResetGrantBlocker(status, grant.id) &&
      (!grant.startsAt || Date.parse(grant.startsAt) <= now) &&
      (!grant.endsAt || Date.parse(grant.endsAt) > now)
  );
  return (
    usable.find((grant) => grant.id === status.nextGrantId) ??
    usable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
  );
}

/** Why `selectResetGrant` found nothing to spend, as a `claude_reset.*` key; undefined when no resets are left. */
export function resetGrantBlockReason(status: AnthropicResetGrantStatus, now: number) {
  if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return 'cooldown';
  const blockers = status.grants
    .filter((grant) => grant.resetsLeft > 0)
    .map((grant) => anthropicResetGrantBlocker(status, grant.id));
  if (!blockers.length) return undefined;
  if (blockers.includes('ineligible')) return 'ineligible';
  if (blockers.includes('not_limited')) return 'not_limited';
  return 'unavailable';
}
