import { beforeAll, describe, expect, test } from 'vitest';
import i18n from '@/i18n';
import type { ClaudeQuotaState, CodexQuotaState } from '@/features/personal-quota-support/types';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { buildCompactCardModel } from '@/features/quota/compactCardModel';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const now = Date.UTC(2026, 9, 8, 12);
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const entry = (name: string, type: 'claude' | 'codex', patch = {}): QuotaFileEntry => ({
  file: { name, type, provider: type, ...patch } as never,
  type,
});

const codex: CodexQuotaState = {
  status: 'success',
  planType: 'pro',
  subscriptionActiveUntil: iso(now + 2 * day),
  creditBalance: '58849.9473250000',
  windows: [
    {
      id: 'weekly',
      label: 'Weekly limit',
      usedPercent: 30,
      resetLabel: '-',
      resetAtMs: now + 5 * day,
    },
  ],
  rateLimitResetCredits: [
    {
      id: 'b',
      status: 'available',
      grantedAt: iso(now - day),
      expiresAt: iso(now + 21 * day),
      title: 'Full reset',
    },
    {
      id: 'a',
      status: 'available',
      grantedAt: iso(now - day),
      expiresAt: iso(now + 14 * day),
      title: 'Full reset',
    },
    { id: 'old', status: 'available', grantedAt: iso(now - 40 * day), expiresAt: iso(now - day) },
  ],
} as CodexQuotaState;

const claude: ClaudeQuotaState = {
  status: 'success',
  planType: 'plan_max',
  windows: [
    {
      id: 'five-hour',
      label: '5-hour limit',
      usedPercent: 15,
      resetLabel: '-',
      resetAtMs: now + 2 * 3_600_000,
      periodHours: 5,
    },
    {
      id: 'seven-day',
      label: '7-day limit',
      usedPercent: 45,
      resetLabel: '-',
      resetAtMs: now + 5 * day,
      periodHours: 168,
    },
    {
      id: 'seven-day-fable',
      label: '7-day Fable 5',
      usedPercent: 80,
      resetLabel: '-',
      resetAtMs: null,
      periodHours: 168,
    },
  ],
  resetGrants: [
    {
      id: 'g1',
      label: 'Opus 5.5 launch',
      resetsTotal: 1,
      resetsLeft: 1,
      startsAt: null,
      endsAt: iso(now + 14 * day),
      clears: ['five_hour', 'seven_day'],
      paused: false,
      usableNow: true,
      useRequiresLimit: false,
      percentUsed: {},
    },
  ],
} as ClaudeQuotaState;

const build = (item: QuotaFileEntry, quota: unknown, showEmails = false) =>
  buildCompactCardModel({ entry: item, quota: quota as never, t: i18n.t, nowMs: now, showEmails });

describe('compact card model', () => {
  test('masks the account name unless emails are shown', () => {
    const item = entry('codex-alice@example.com.json', 'codex');
    expect(build(item, codex).name).toBe('codex-a•••@e•••.com.json');
    expect(build(item, codex, true).name).toBe('codex-alice@example.com.json');
  });

  test('builds Codex plan, renewal and rounded credit chips', () => {
    const model = build(entry('codex-a.json', 'codex'), codex);
    expect(model.state).toBe('success');
    expect(model.chips.map((chip) => chip.kind)).toEqual(['plan', 'renewal', 'credits']);
    expect(model.chips[0].value).toBe(i18n.t('codex_quota.plan_pro'));
    expect(model.chips[1].detail).toBe('in 2 days');
    expect(model.chips[2].value).toBe((58850).toLocaleString('en'));
  });

  test('shows unlimited credits and skips missing Codex fields', () => {
    const model = build(entry('codex-a.json', 'codex'), {
      ...codex,
      subscriptionActiveUntil: null,
      creditBalance: null,
      creditsUnlimited: true,
    });
    expect(model.chips.map((chip) => chip.kind)).toEqual(['plan', 'credits']);
    expect(model.chips[1].value).toBe(i18n.t('codex_quota.credit_unlimited'));
  });

  test('maps windows with remaining percent, tone and reset times', () => {
    const model = build(entry('claude-a.json', 'claude'), claude);
    expect(model.windows.map((row) => [row.id, row.remaining, row.tone])).toEqual([
      ['five-hour', 85, 'high'],
      ['seven-day', 55, 'medium'],
      ['seven-day-fable', 20, 'low'],
    ]);
    expect(model.windows[0].reset?.relative).toBe('in 2 hours');
    expect(model.windows[2].reset).toBeNull();
  });

  test('lists unexpired resets soonest first', () => {
    const codexModel = build(entry('codex-a.json', 'codex'), codex);
    expect(codexModel.resets?.items.map((item) => item.id)).toEqual(['a', 'b']);
    const claudeModel = build(entry('claude-a.json', 'claude'), claude);
    expect(claudeModel.resets?.items[0]).toMatchObject({
      label: 'Opus 5.5 launch',
      left: 1,
      total: 1,
    });
  });

  test('keeps a failed resets read separate from the windows', () => {
    const model = build(entry('claude-a.json', 'claude'), {
      ...claude,
      resetGrants: null,
      resetGrantsError: 'grants failed',
    });
    expect(model.windows).toHaveLength(3);
    expect(model.resets).toEqual({ items: [], error: 'grants failed' });
  });

  test('reports idle, loading and masked error states', () => {
    expect(build(entry('codex-a.json', 'codex'), undefined).state).toBe('idle');
    expect(build(entry('codex-a.json', 'codex'), { status: 'loading', windows: [] }).state).toBe(
      'loading'
    );
    const failed = build(entry('codex-a.json', 'codex'), {
      status: 'error',
      windows: [],
      error: 'token for alice@example.com expired',
    });
    expect(failed.state).toBe('error');
    expect(failed.error).toContain('a•••@e•••.com');
    expect(failed.error).not.toContain('alice@example.com');
    expect(failed.chips).toEqual([]);
  });

  test('marks disabled credentials', () => {
    expect(build(entry('codex-a.json', 'codex', { disabled: true }), codex).enabled).toBe(false);
    expect(build(entry('codex-a.json', 'codex'), codex).enabled).toBe(true);
  });
});
