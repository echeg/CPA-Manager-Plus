import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/features/personal-quota-support/types';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { normalizePlanType, PREMIUM_CODEX_PLAN_TYPES } from '@/features/quota/utils/quota';

export interface LedgerWindow {
  id: string;
  label: string;
  remaining: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

export function ledgerPlanLabel(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined,
  t: TFunction
): string | null {
  if (!quota || quota.status !== 'success') return null;
  if (provider === 'claude') {
    const plan = (quota as ClaudeQuotaState).planType;
    return plan ? t(`claude_quota.${plan}`, { defaultValue: plan }) : null;
  }
  if (provider === 'codex') {
    const raw = (quota as CodexQuotaState).planType;
    const plan = normalizePlanType(raw);
    if (!plan) return null;
    if (plan === 'self_serve_business_prolite') return t('codex_quota.plan_business_premium');
    if (plan !== 'pro' && PREMIUM_CODEX_PLAN_TYPES.has(plan)) return t('codex_quota.plan_prolite');
    return t(`codex_quota.plan_${plan}`, { defaultValue: raw ?? plan });
  }
  if (provider === 'antigravity')
    return (quota as AntigravityQuotaState).subscription?.plan ?? null;
  if (provider === 'devin') return (quota as DevinQuotaState).plan;
  if (provider === 'meta') return (quota as MetaQuotaState).data?.planName ?? null;
  if (provider === 'xai') return (quota as XaiQuotaState).billing?.planLabel ?? null;
  return null;
}

const percent = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

const remaining = (used: number | null | undefined): number | null => {
  const normalized = percent(used);
  return normalized === null ? null : 100 - normalized;
};

/** A display model only: UI ordering never changes the server's routing policy. */
export function ledgerWindows(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined,
  t: TFunction
): LedgerWindow[] {
  if (quota?.status !== 'success') return [];
  if (provider === 'claude' || provider === 'codex') {
    return (quota as ClaudeQuotaState | CodexQuotaState).windows.map((window) => ({
      id: window.id,
      label: window.labelKey
        ? t(window.labelKey, ('labelParams' in window && window.labelParams) || {})
        : window.label,
      remaining: remaining(window.usedPercent),
      resetAtMs: window.resetAtMs ?? null,
      periodHours: window.periodHours ?? null,
    }));
  }
  if (provider === 'antigravity') {
    return (quota as AntigravityQuotaState).groups.flatMap((group) =>
      group.buckets.map((bucket) => ({
        id: `${group.id}:${bucket.id}`,
        label: `${group.label} · ${bucket.label}`,
        remaining: percent(bucket.remainingFraction * 100),
        resetAtMs: bucket.resetAtMs ?? null,
        periodHours: bucket.periodHours ?? null,
      }))
    );
  }
  if (provider === 'kimi') {
    return (quota as KimiQuotaState).rows.map((row) => ({
      id: row.id,
      label: row.labelKey ? t(row.labelKey, row.labelParams ?? {}) : (row.label ?? row.id),
      remaining: row.limit > 0 ? remaining((row.used / row.limit) * 100) : null,
      resetAtMs: row.resetAtMs ?? null,
      periodHours: row.periodHours ?? null,
    }));
  }
  if (provider === 'devin') {
    return (quota as DevinQuotaState).windows.map((window) => ({
      id: window.id,
      label: t(`devin_quota.${window.id}`),
      remaining: percent(window.remainingPercent),
      resetAtMs: window.resetAtMs,
      periodHours: window.periodHours,
    }));
  }
  if (provider === 'meta') {
    return ((quota as MetaQuotaState).data?.windows ?? []).map((window) => ({
      id: window.id,
      label: t(window.id === 'weekly' ? 'meta_quota.weekly' : 'meta_quota.window'),
      remaining: remaining(window.usedPercent),
      resetAtMs: window.resetAt === undefined ? null : window.resetAt * 1000,
      periodHours: window.durationMinutes === undefined ? null : window.durationMinutes / 60,
    }));
  }
  const billing = (quota as XaiQuotaState).billing;
  // Monthly billing is a spend cap, not a subscription rate-limit window.
  if (!billing || billing.periodType !== 'weekly') return [];
  return [
    {
      id: 'weekly',
      label: t('xai_quota.weekly_limit'),
      remaining: remaining(billing.usagePercent),
      resetAtMs: billing.resetAtMs ?? null,
      periodHours: billing.periodHours ?? 168,
    },
  ];
}

/** The windows the backend's reserve verdict reads (Codex primary/secondary, Claude 5h/7d). */
const RESERVE_WINDOW_IDS: Partial<Record<QuotaProviderType, readonly string[]>> = {
  codex: ['five-hour', 'weekly', 'monthly'],
  claude: ['five-hour', 'seven-day'],
};

/** Model-specific and additional limits never trip the reserve, so they get no tick. */
export const reserveCoversWindow = (provider: QuotaProviderType, windowId: string): boolean =>
  RESERVE_WINDOW_IDS[provider]?.includes(windowId) ?? false;

export function primaryLedgerWindow(windows: LedgerWindow[]): LedgerWindow | undefined {
  return (
    windows.find((window) => window.id === 'seven-day-fable') ??
    windows.find(
      (window) => window.id === 'seven-day' || window.id === 'weekly' || window.id === 'monthly'
    ) ??
    [...windows].sort((a, b) => (b.periodHours ?? 0) - (a.periodHours ?? 0))[0]
  );
}

export function summarizeLedgerWindows(rows: LedgerWindow[][], now: number) {
  const primary = primaryLedgerWindow(rows.flat());
  const windows = rows.map((row) => row.find((window) => window.id === primary?.id));
  const known = windows.filter(
    (window) => window?.remaining !== null && window?.remaining !== undefined
  );
  const resets = windows.flatMap((window) =>
    window?.resetAtMs && window.resetAtMs > now ? [window.resetAtMs] : []
  );
  return {
    primary,
    windows,
    knownCount: known.length,
    // Missing observations must never be presented as zero remaining capacity.
    remaining:
      known.length === rows.length && rows.length > 0
        ? known.reduce((total, window) => total + (window?.remaining ?? 0), 0)
        : null,
    capacity: rows.length * 100,
    resetAtMs: resets.length ? Math.min(...resets) : null,
  };
}

export function maskQuotaName(name: string): string {
  const suffix = name.endsWith('.json') ? '.json' : '';
  const source = suffix ? name.slice(0, -suffix.length) : name;
  const at = source.lastIndexOf('@');
  if (at < 0) return name;
  // Credential labels may contain internationalized or quoted email addresses.
  // Conservatively redact everything around @ except a known provider prefix.
  const local = source.slice(0, at);
  const domain = source.slice(at + 1);
  const prefix = local.match(/^(?:claude|codex|antigravity|kimi|xai|devin|meta)-/i)?.[0] ?? '';
  const initial = Array.from(local.slice(prefix.length))[0] ?? '';
  const labels = domain.split('.');
  const maskedDomain = labels
    .map((part, index) =>
      index === labels.length - 1 && labels.length > 1 && /^[\p{L}]{2,24}$/u.test(part)
        ? part
        : `${Array.from(part)[0] ?? ''}•••`
    )
    .join('.');
  return `${prefix}${initial}•••@${maskedDomain}${suffix}`;
}

/** Redact addresses in feedback while retaining the surrounding explanation. */
export function maskQuotaText(text: string): string {
  return text.replace(/(?:"[^"\r\n]*"|[^\s@<>()[\]{},;:"]+)@[^\s@<>()[\]{},;:"]+/gu, maskQuotaName);
}
