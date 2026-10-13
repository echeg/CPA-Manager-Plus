import { beforeAll, describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type { ClaudeQuotaState, CodexQuotaState } from '@/features/personal-quota-support/types';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { buildCompactCardModel } from '@/features/quota/compactCardModel';
import { QuotaCompactCard } from '@/features/quota/components/QuotaCompactCard';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

// Far-future instants keep relative labels stable regardless of the frozen SSR clock.
const now = Date.UTC(2036, 9, 8, 12);
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const codexEntry: QuotaFileEntry = {
  file: { name: 'codex-alice@example.com.json', type: 'codex', provider: 'codex' } as never,
  type: 'codex',
};
const claudeEntry: QuotaFileEntry = {
  file: {
    name: 'claude-bob@example.com.json',
    type: 'claude',
    provider: 'claude',
    quotaReserve: { percent: 40, mode: 'soft' },
  } as never,
  type: 'claude',
};

const codex = {
  status: 'success',
  planType: 'pro',
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
      id: 'a',
      status: 'available',
      grantedAt: iso(now),
      expiresAt: iso(now + 14 * day),
      title: 'Full reset',
    },
    {
      id: 'b',
      status: 'available',
      grantedAt: iso(now),
      expiresAt: iso(now + 21 * day),
      title: 'Full reset',
    },
  ],
} as CodexQuotaState;

const claude = {
  status: 'success',
  planType: 'plan_max',
  windows: [
    {
      id: 'five-hour',
      label: '5-hour limit',
      usedPercent: 15,
      resetLabel: '-',
      resetAtMs: now + 7_200_000,
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
      usedPercent: 2,
      resetLabel: '-',
      resetAtMs: now + 5 * day,
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

const render = (entry: QuotaFileEntry, quota: unknown, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(QuotaCompactCard, {
      entry,
      model: buildCompactCardModel({
        entry,
        quota: quota as never,
        t: i18n.t,
        nowMs: now,
        showEmails: false,
      }),
      resolvedTheme: 'dark',
      now,
      canRefresh: true,
      onRefresh: () => {},
      ...props,
    } as never)
  );

describe('compact quota card', () => {
  test('renders the Auth Files card header with a masked name', () => {
    const markup = render(codexEntry, codex);
    expect(markup).toContain('data-compact-card');
    expect(markup).toContain('data-provider="codex"');
    expect(markup).toContain('codex-a•••@e•••.com.json');
    expect(markup).not.toContain('alice@example.com');
    expect(markup).toContain('data-enabled="true"');
    expect(markup).not.toContain('role="group"');
  });

  test('shows plan chips and window rows with mono reset times', () => {
    const markup = render(codexEntry, codex);
    expect(markup).toContain(i18n.t('codex_quota.plan_label'));
    expect(markup).toContain(i18n.t('codex_quota.plan_pro'));
    expect(markup).toContain('Weekly limit');
    expect(markup).toContain('70%');
    expect(markup).toContain('in 5 days');
    expect(markup).toContain('data-tone="high"');
  });

  test('lists every reset with its expiry, soonest first and marked', () => {
    const markup = render(codexEntry, codex);
    expect(markup).toContain('data-compact-resets');
    expect(markup.match(/data-reset-row/g)).toHaveLength(2);
    expect(markup).toContain('data-soonest');
    expect(markup.indexOf('in 14 days')).toBeLessThan(markup.indexOf('in 21 days'));
    expect(markup).toContain('Full reset');
  });

  test('labels Claude grants with their remaining count and ticks the reserve', () => {
    const markup = render(claudeEntry, claude);
    expect(markup).toContain('Opus 5.5 launch');
    expect(markup).toContain('1/1');
    expect(markup).toContain('data-reserve-badge');
    expect(markup.match(/data-reserve-tick/g)).toHaveLength(2);
    expect(markup).toContain('left:40%');
  });

  test('previews a draft reserve percent on the ticks', () => {
    const markup = render(claudeEntry, claude, { reservePreview: 25 });
    expect(markup).toContain('left:25%');
    expect(markup).not.toContain('left:40%');
  });

  test('omits the resets box without resets and shows a muted line on a failed read', () => {
    expect(render(codexEntry, { ...codex, rateLimitResetCredits: [] })).not.toContain(
      'data-compact-resets'
    );
    const failed = render(claudeEntry, { ...claude, resetGrants: null, resetGrantsError: 'x' });
    expect(failed).toContain(i18n.t('quota_management.resets.load_error').replace("'", '&#x27;'));
  });

  test('renders idle, loading and error bodies', () => {
    expect(render(codexEntry, undefined)).toContain(i18n.t('quota_management.ledger.load_hint'));
    expect(render(codexEntry, { status: 'loading', windows: [] })).toContain('aria-busy="true"');
    const failed = render(codexEntry, { status: 'error', windows: [], error: 'boom' });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('boom');
  });

  test('has a labelled refresh button that respects availability', () => {
    const markup = render(codexEntry, codex);
    expect(markup).toContain(
      `aria-label="${i18n.t('quota_management.ledger.refresh_credential', { name: 'codex-a•••@e•••.com.json' })}"`
    );
    expect(render(codexEntry, codex, { canRefresh: false })).toMatch(
      /<button[^>]*disabled[^>]*aria-label="Refresh quota/
    );
  });
});
