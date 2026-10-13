import { beforeAll, describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type {
  ClaudeQuotaState,
  CodexQuotaState,
  XaiQuotaState,
} from '@/features/personal-quota-support/types';
import {
  ledgerWindows,
  maskQuotaName,
  maskQuotaText,
  summarizeLedgerWindows,
} from '@/features/quota/ledgerModel';
import type { QuotaFileEntry } from './logic';
import { QuotaLedger } from '@/features/quota/components/QuotaLedger';
import { QuotaTimeline } from '@/features/quota/components/QuotaTimeline';
import { buildResetDisplay } from '@/features/quota/utils/quota';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
const now = Date.UTC(2026, 9, 2);
const claudeQuota = (used: number, fable: number, reset: number): ClaudeQuotaState => ({
  status: 'success',
  planType: 'plan_max',
  windows: [
    {
      id: 'five-hour',
      label: '5-hour limit',
      usedPercent: 0,
      resetLabel: '-',
      resetAtMs: null,
      periodHours: 5,
    },
    {
      id: 'seven-day',
      label: '7-day limit',
      usedPercent: used,
      resetLabel: '-',
      resetAtMs: reset,
      periodHours: 168,
    },
    {
      id: 'seven-day-fable',
      label: '7-day Fable 5',
      usedPercent: fable,
      resetLabel: '-',
      resetAtMs: reset,
      periodHours: 168,
    },
  ],
});

describe('quota ledger', () => {
  test('redacts emails in feedback without removing the error explanation', () => {
    expect(maskQuotaText('Could not load alice@example.com because quota expired')).toBe(
      'Could not load a•••@e•••.com because quota expired'
    );
    expect(maskQuotaText('Refresh failed for "alice private"@пример.рф')).toBe(
      'Refresh failed for "•••@п•••.рф'
    );
  });
  test('sums the same window across accounts and excludes expired reset instants', () => {
    const rows = [claudeQuota(21, 42, now + 1000), claudeQuota(0, 0, now - 1000)].map((quota) =>
      ledgerWindows('claude', quota, i18n.t)
    );
    const summary = summarizeLedgerWindows(rows, now);
    expect(summary.primary?.id).toBe('seven-day-fable');
    expect(summary.remaining).toBe(158);
    expect(summary.capacity).toBe(200);
    expect(summary.resetAtMs).toBe(now + 1000);
  });

  test('unknown or missing observations do not appear as exhausted quota', () => {
    const rows = [ledgerWindows('claude', claudeQuota(0, 0, now + 1000), i18n.t), []];
    const summary = summarizeLedgerWindows(rows, now);
    expect(summary.remaining).toBeNull();
    expect(summary.knownCount).toBe(1);
    expect(summary.capacity).toBe(200);
    const codex: CodexQuotaState = {
      status: 'success',
      windows: [{ id: 'weekly', label: 'Weekly limit', usedPercent: null, resetLabel: '-' }],
    };
    expect(ledgerWindows('codex', codex, i18n.t)[0].remaining).toBeNull();
  });

  test('monthly xAI billing is not displayed as weekly capacity', () => {
    const quota = {
      status: 'success',
      billing: { periodType: 'monthly', usagePercent: 20 },
    } as XaiQuotaState;
    expect(ledgerWindows('xai', quota, i18n.t)).toEqual([]);
  });

  test.each([
    ['claude-alice@example.com.json', 'claude-a•••@e•••.com.json'],
    ['codex-алиса@пример.рф.json', 'codex-а•••@п•••.рф.json'],
    ["claude-alice'private@example.com.json", 'claude-a•••@e•••.com.json'],
    ['"alice private"@example.com', '"•••@e•••.com'],
    ['plain-credential.json', 'plain-credential.json'],
  ])('masks credential label %s', (source, expected) => {
    expect(maskQuotaName(source)).toBe(expected);
  });

  test('renders separate Claude weekly totals and masked accessible names', () => {
    const quotas = [
      claudeQuota(21, 42, now + 1000),
      claudeQuota(0, 0, now + 2000),
      claudeQuota(0, 0, now + 3000),
      claudeQuota(25, 49, now + 4000),
      claudeQuota(0, 0, now + 5000),
    ];
    const entries: QuotaFileEntry[] = quotas.map((_, index) => ({
      type: 'claude' as const,
      file: { name: `claude-alice${index}@example.com.json`, type: 'claude' },
    }));
    const props = {
      entries,
      summaryEntries: entries,
      quotaFor: (entry: (typeof entries)[number]) => quotas[entries.indexOf(entry)],
      resolvedTheme: 'dark' as const,
      showEmails: false,
      canRefresh: true,
      onRefresh: () => {},
    };
    const markup = renderToStaticMarkup(createElement(QuotaLedger, props));
    expect(markup).toContain('409%');
    expect(markup.match(/of 500%/g)).toHaveLength(2);
    expect(markup).toContain('454%');
    expect(markup.indexOf('aria-label="7-day limit"')).toBeLessThan(
      markup.indexOf('aria-label="7-day Fable 5"')
    );
    expect(markup).not.toContain('alice0');
    expect(markup).not.toContain('example.com');
    expect(markup).toContain('claude-a•••@e•••.com.json');
    const revealed = renderToStaticMarkup(
      createElement(QuotaLedger, { ...props, showEmails: true })
    );
    expect(revealed).toContain('claude-alice0@example.com.json');
    const failure = renderToStaticMarkup(
      createElement(QuotaLedger, {
        ...props,
        quotaFor: () => ({ status: 'error' as const, error: 'Could not load alice@example.com' }),
      })
    );
    expect(failure).not.toContain('alice@example.com');
    const timeline = renderToStaticMarkup(
      createElement(QuotaTimeline, {
        entries,
        quotaFor: props.quotaFor,
        resolvedTheme: 'dark',
        displayNameFor: maskQuotaName,
        now,
      })
    );
    expect(timeline).not.toContain('alice0');
    expect(timeline).not.toContain('example.com');
  });

  test('keeps ordinary weekly quota complete when a Fable observation is missing', () => {
    const ordinaryReset = Date.UTC(2100, 0, 2);
    const fableReset = Date.UTC(2100, 0, 4);
    const quotas = [claudeQuota(56, 80, ordinaryReset), claudeQuota(0, 0, ordinaryReset)];
    quotas[0].windows = quotas[0].windows.map((window) =>
      window.id === 'seven-day-fable' ? { ...window, resetAtMs: fableReset } : window
    );
    quotas[1].windows = quotas[1].windows.filter((window) => window.id !== 'seven-day-fable');
    const entries: QuotaFileEntry[] = quotas.map((_, index) => ({
      type: 'claude' as const,
      file: { name: `claude-${index}.json`, type: 'claude' },
    }));
    const props = {
      entries: [],
      summaryEntries: entries,
      quotaFor: (entry: (typeof entries)[number]) => quotas[entries.indexOf(entry)],
      resolvedTheme: 'light' as const,
      showEmails: false,
      canRefresh: true,
      onRefresh: () => {},
    };
    const markup = renderToStaticMarkup(createElement(QuotaLedger, props));
    const blocks = markup.split('role="group"').slice(1);
    expect(blocks).toHaveLength(2);
    const [ordinary, fable] = blocks;
    expect(ordinary).toContain('aria-label="7-day limit"');
    expect(ordinary).toContain('144%');
    expect(ordinary).toContain('of 200%');
    expect(ordinary).toContain('width:44%');
    expect(ordinary).toContain('width:100%');
    expect(ordinary).toContain(buildResetDisplay(null, ordinaryReset, now, 'en')!.absolute);
    expect(fable).toContain('aria-label="7-day Fable 5"');
    expect(fable).toContain('<strong>--</strong>');
    expect(fable).toContain('of 200%');
    expect(fable).toContain('width:20%');
    expect(fable).toContain('width:0%');
    expect(fable).toContain(buildResetDisplay(null, fableReset, now, 'en')!.absolute);
    expect(fable).toContain(i18n.t('quota_management.ledger.observed', { count: 1, total: 2 }));

    quotas[0].windows = quotas[0].windows.filter((window) => window.id !== 'seven-day-fable');
    const withoutFable = renderToStaticMarkup(createElement(QuotaLedger, props));
    expect(withoutFable.match(/role="group"/g)).toHaveLength(1);
    expect(withoutFable).toContain('144%');
    expect(withoutFable).not.toContain('7-day Fable 5');
  });
});
