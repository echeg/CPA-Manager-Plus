/** Typed quota style contract. The host binds its CSS module with bindQuotaClasses; missing classes fail immediately instead of rendering undefined classes. */

export interface QuotaClassMap {
  // Quota rows shared by providers.
  quotaRow: string;
  quotaRowHeader: string;
  quotaModel: string;
  quotaMeta: string;
  quotaPercent: string;
  quotaReset: string;
  quotaResetRelative: string;
  quotaResetRelativeSoon: string;
  quotaAmount: string;
  quotaMessage: string;
  // Plan chips use Codex names shared with Claude, Antigravity, Kimi and xAI.
  // Premium gold and elite platinum badges preserve the approved source styling.
  codexPlan: string;
  codexPlanItem: string;
  codexPlanLabel: string;
  codexPlanValue: string;
  premiumPlanValue: string;
  elitePlanValue: string;
  // Codex reset credits.
  codexResetCredits: string;
  codexResetCreditsTitle: string;
  codexResetCreditRow: string;
  codexResetCreditRowSoon: string;
  codexResetCreditLabel: string;
  codexResetCreditTime: string;
  codexResetCreditsError: string;
  // Antigravity groups.
  antigravityQuotaGroup: string;
  antigravityQuotaGroupHeader: string;
  antigravityQuotaGroupTitle: string;
  antigravityQuotaGroupDescription: string;
  // QuotaMeter bars.
  quotaBar: string;
  quotaBarFill: string;
  quotaBarFillHigh: string;
  quotaBarFillMedium: string;
  quotaBarFillLow: string;
}

export const QUOTA_CLASS_KEYS: readonly (keyof QuotaClassMap)[] = [
  'quotaRow',
  'quotaRowHeader',
  'quotaModel',
  'quotaMeta',
  'quotaPercent',
  'quotaReset',
  'quotaResetRelative',
  'quotaResetRelativeSoon',
  'quotaAmount',
  'quotaMessage',
  'codexPlan',
  'codexPlanItem',
  'codexPlanLabel',
  'codexPlanValue',
  'premiumPlanValue',
  'elitePlanValue',
  'codexResetCredits',
  'codexResetCreditsTitle',
  'codexResetCreditRow',
  'codexResetCreditRowSoon',
  'codexResetCreditLabel',
  'codexResetCreditTime',
  'codexResetCreditsError',
  'antigravityQuotaGroup',
  'antigravityQuotaGroupHeader',
  'antigravityQuotaGroupTitle',
  'antigravityQuotaGroupDescription',
  'quotaBar',
  'quotaBarFill',
  'quotaBarFillHigh',
  'quotaBarFillMedium',
  'quotaBarFillLow',
];

/** Bind a CSS module to its typed contract; identify missing keys using the source label. */
export function bindQuotaClasses(module: Record<string, string>, source: string): QuotaClassMap {
  const missing = QUOTA_CLASS_KEYS.filter((key) => !module[key]);
  if (missing.length > 0) {
    throw new Error(`[quota] ${source} missing quota contract class names: ${missing.join(', ')}`);
  }
  const bound = {} as Record<keyof QuotaClassMap, string>;
  for (const key of QUOTA_CLASS_KEYS) {
    bound[key] = module[key];
  }
  return bound;
}

export interface QuotaBodyProps<TState> {
  quota: TState;
  classes: QuotaClassMap;
}
