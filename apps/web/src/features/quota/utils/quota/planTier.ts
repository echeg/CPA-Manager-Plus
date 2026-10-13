import { normalizePlanType } from './parsers';

/** Map plan tiers to badge styles: elite platinum for Pro 200, premium gold for Pro 100 and paid Antigravity/xAI, plain text otherwise. */
export type CodexPlanTier = 'elite' | 'premium' | 'plain';

export const PREMIUM_CODEX_PLAN_TYPES = new Set([
  'pro',
  'prolite',
  'pro-lite',
  'pro_lite',
  'self_serve_business_prolite',
]);

// Pro 200 uses the platinum tier above premium gold.
// See the elitePlanValue badge styles.
export const ELITE_CODEX_PLAN_TYPE = 'pro';

/** Check elite before premium because pro matches both; otherwise Pro 200 would silently use the gold badge. */
export function resolvePlanTier(planType: string | null | undefined): CodexPlanTier {
  const normalized = normalizePlanType(planType);
  if (!normalized) return 'plain';
  if (normalized === ELITE_CODEX_PLAN_TYPE) return 'elite';
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return 'premium';
  return 'plain';
}
