import { beforeAll, describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type { AuthFileItem, CodexQuotaState } from '@/features/personal-quota-support/types';
import { QuotaLedger } from '@/features/quota/components/QuotaLedger';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import { formatMonthDay } from '@/features/quota/resetActions';
import { formatInstantShort } from '@/features/quota/utils/quota';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

// Far future so the test does not depend on the real clock.
const now = Date.UTC(2100, 9, 8, 12);
const DAY = 24 * 60 * 60 * 1000;
const UNTIL = '2100-10-14T09:00:00Z';

const codexQuota: CodexQuotaState = {
  status: 'success',
  windows: [
    { id: 'five-hour', label: '5-hour limit', usedPercent: 50, resetLabel: '-', resetAtMs: now },
    {
      id: 'weekly',
      label: 'Weekly limit',
      usedPercent: 80,
      resetLabel: '-',
      resetAtMs: now + 6 * DAY,
    },
  ],
};

const renderLedger = (
  fileFields: Partial<AuthFileItem>,
  options: { name?: string; showEmails?: boolean; quota?: CodexQuotaState } = {}
) => {
  const entries: QuotaFileEntry[] = [
    {
      type: 'codex',
      file: { name: options.name ?? 'codex-a.json', type: 'codex', ...fileFields },
    },
  ];
  return renderToStaticMarkup(
    createElement(QuotaLedger, {
      entries,
      summaryEntries: entries,
      quotaFor: () => (options.quota ?? codexQuota) as QuotaCardState,
      resolvedTheme: 'light',
      showEmails: options.showEmails ?? true,
      canRefresh: true,
      onRefresh: () => {},
      now,
    })
  );
};

const badgeOf = (markup: string): string | null => {
  const match = markup.match(/<span[^>]*data-reserve-badge[^>]*>[\s\S]*?<\/span>/);
  return match ? match[0] : null;
};

const decode = (html: string) =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

describe('Ledger quota reserve', () => {
  test('shows no badge or tick without a reserve', () => {
    const markup = renderLedger({});
    expect(badgeOf(markup)).toBeNull();
    expect(markup).not.toContain('data-reserve-tick');
  });

  test('a configured but inactive reserve is a muted badge', () => {
    const badge = badgeOf(
      renderLedger({ quotaReserve: { percent: 25, mode: 'soft' }, quotaReserveActive: false })
    );
    expect(badge).toContain('Reserve 25% · soft');
    expect(badge).not.toContain('data-tone');
    expect(decode(badge!)).toContain('Keeps 25% of every window for services outside the proxy');
  });

  test('an active hard reserve is an amber "Held until" badge', () => {
    const badge = badgeOf(
      renderLedger({
        quotaReserve: { percent: 25, mode: 'hard' },
        quotaReserveActive: true,
        quotaReserveUntil: UNTIL,
      })
    );
    expect(badge).toContain(`Held until ${formatMonthDay(Date.parse(UNTIL))} · hard`);
    expect(badge).toContain('data-tone="warn"');
    expect(decode(badge!)).toContain(
      `Proxy won't start new sessions on this account until ${formatInstantShort(Date.parse(UNTIL))}; existing sessions continue`
    );
  });

  test('an active soft reserve explains the last-resort behavior', () => {
    const badge = decode(
      badgeOf(
        renderLedger({
          quotaReserve: { percent: 40, mode: 'soft' },
          quotaReserveActive: true,
          quotaReserveUntil: UNTIL,
        })
      )!
    );
    expect(badge).toContain(`Held until ${formatMonthDay(Date.parse(UNTIL))} · soft`);
    expect(badge).toContain('only when no other account is available');
    expect(badge).toContain('existing sessions continue');
  });

  test('an active reserve without an expiry still reads as held', () => {
    const badge = decode(
      badgeOf(
        renderLedger({ quotaReserve: { percent: 25, mode: 'hard' }, quotaReserveActive: true })
      )!
    );
    expect(badge).toContain('Held · hard');
    expect(badge).not.toContain('until 10/');
  });

  test('ticks every window meter at the reserve percent', () => {
    const markup = renderLedger({ quotaReserve: { percent: 25, mode: 'soft' } });
    const ticks = markup.match(/<[a-z]+[^>]*data-reserve-tick[^>]*>/g) ?? [];
    // Two windows in the row; the provider summary meters carry no tick.
    expect(ticks).toHaveLength(2);
    ticks.forEach((tick) => expect(tick).toContain('left:25%'));
  });

  test('windows the backend verdict ignores get no tick', () => {
    const quota: CodexQuotaState = {
      ...codexQuota,
      windows: [
        ...codexQuota.windows,
        {
          id: 'code-review-weekly',
          label: 'Code review weekly limit',
          usedPercent: 90,
          resetLabel: '-',
          resetAtMs: now + DAY,
        },
      ],
    };
    const markup = renderLedger({ quotaReserve: { percent: 25, mode: 'soft' } }, { quota });
    expect(markup).toContain('Code review weekly limit');
    expect(markup.match(/data-reserve-tick/g)).toHaveLength(2);
  });

  test('masking still hides the credential email', () => {
    const markup = renderLedger(
      { quotaReserve: { percent: 25, mode: 'hard' }, quotaReserveActive: true },
      { name: 'person@example.com.json', showEmails: false }
    );
    expect(markup).not.toContain('person@example.com');
    expect(badgeOf(markup)).toContain('Held · hard');
  });

  test('adds no role="group"', () => {
    const markup = renderLedger({
      quotaReserve: { percent: 25, mode: 'hard' },
      quotaReserveActive: true,
      quotaReserveUntil: UNTIL,
    });
    // Only the Codex summary window.
    expect(markup.match(/role="group"/g)).toHaveLength(1);
  });
});
