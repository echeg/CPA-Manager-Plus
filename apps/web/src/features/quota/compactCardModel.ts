/**
 * Display model for the compact quota card (Cards view). Pure and React-free:
 * it reads the same store state as the Ledger through the shared models, and
 * `nowMs` is passed in so relative times are testable.
 */

import type { TFunction } from 'i18next';
import type { CodexQuotaState } from '@/features/personal-quota-support/types';
import { formatDateTimeValue } from '@/features/quota/utils/format';
import {
  buildResetDisplay,
  resolveQuotaErrorMessage,
  resolveResetMs,
} from '@/features/quota/utils/quota';
import type { ResetDisplay } from '@/features/quota/utils/quota/relativeTime';
import { getQuotaDisplayName } from '@/features/quota/utils/quota/identity';
import { ledgerPlanLabel, ledgerWindows, maskQuotaName, maskQuotaText } from './ledgerModel';
import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { buildResetInventory, type ResetInventory } from './resetInventory';

export type CompactTone = 'high' | 'medium' | 'low' | 'unknown';

export interface CompactChip {
  kind: 'plan' | 'renewal' | 'credits';
  label: string;
  value: string;
  detail?: string;
}

export interface CompactWindowRow {
  id: string;
  label: string;
  remaining: number | null;
  tone: CompactTone;
  reset: ResetDisplay | null;
}

export interface CompactCardModel {
  provider: QuotaProviderType;
  name: string;
  enabled: boolean;
  state: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  chips: CompactChip[];
  windows: CompactWindowRow[];
  resets: ResetInventory | null;
}

export const compactTone = (remaining: number | null): CompactTone =>
  remaining === null ? 'unknown' : remaining >= 70 ? 'high' : remaining >= 30 ? 'medium' : 'low';

function formatCredits(balance: string, locale: string | undefined) {
  const value = Number(balance);
  return Number.isFinite(value) ? Math.round(value).toLocaleString(locale) : balance;
}

function codexChips(
  quota: CodexQuotaState,
  t: TFunction,
  nowMs: number,
  locale: string | undefined
): CompactChip[] {
  const chips: CompactChip[] = [];
  const until = quota.subscriptionActiveUntil ?? null;
  if (until !== null && until !== '') {
    const untilMs = resolveResetMs([until]);
    const display = buildResetDisplay(
      untilMs === null ? formatDateTimeValue(until) : null,
      untilMs,
      nowMs,
      locale
    );
    if (display) {
      chips.push({
        kind: 'renewal',
        label: t('codex_quota.expires_label'),
        value: display.absolute,
        detail: display.relative ?? undefined,
      });
    }
  }
  if (quota.creditsUnlimited === true || quota.creditBalance) {
    chips.push({
      kind: 'credits',
      label: t('codex_quota.credit_balance_label'),
      value: quota.creditsUnlimited
        ? t('codex_quota.credit_unlimited')
        : formatCredits(quota.creditBalance ?? '', locale),
    });
  }
  return chips;
}

export function buildCompactCardModel({
  entry,
  quota,
  t,
  nowMs,
  showEmails,
  locale,
}: {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  t: TFunction;
  nowMs: number;
  showEmails: boolean;
  locale?: string;
}): CompactCardModel {
  const provider = entry.type;
  const rawName = getQuotaDisplayName(entry.file);
  const base = {
    provider,
    name: showEmails ? rawName : maskQuotaName(rawName),
    enabled: !entry.file.disabled,
    chips: [] as CompactChip[],
    windows: [] as CompactWindowRow[],
    resets: null,
  };
  const status = (quota as { status?: string } | undefined)?.status;
  if (!quota || !status || status === 'idle') return { ...base, state: 'idle' };
  if (status === 'loading') return { ...base, state: 'loading' };
  if (status === 'error') {
    const failure = quota as { error?: string; errorStatus?: number };
    const message = resolveQuotaErrorMessage(
      t,
      failure.errorStatus,
      failure.error || t('common.unknown_error')
    );
    return { ...base, state: 'error', error: showEmails ? message : maskQuotaText(message) };
  }

  const plan = ledgerPlanLabel(provider, quota, t);
  const chips: CompactChip[] = plan
    ? [{ kind: 'plan', label: t('codex_quota.plan_label'), value: plan }]
    : [];
  if (provider === 'codex') chips.push(...codexChips(quota as CodexQuotaState, t, nowMs, locale));

  return {
    ...base,
    state: 'success',
    chips,
    windows: ledgerWindows(provider, quota, t).map((window) => ({
      id: window.id,
      label: window.label,
      remaining: window.remaining,
      tone: compactTone(window.remaining),
      reset: buildResetDisplay(null, window.resetAtMs, nowMs, locale),
    })),
    resets: buildResetInventory(provider, quota, nowMs),
  };
}
