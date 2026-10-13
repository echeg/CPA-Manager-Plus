import { beforeAll, describe, expect, test } from 'vitest';
import i18n from '@/i18n';
import type { ClaudeQuotaState, CodexQuotaState } from '@/features/personal-quota-support/types';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { buildQuotaTotals } from '@/features/quota/quotaTotalsModel';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const now = Date.UTC(2026, 9, 8, 12);
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const claude = (used: number, fable: number, grants: ClaudeQuotaState['resetGrants'] = []) =>
  ({
    status: 'success',
    windows: [
      {
        id: 'five-hour',
        label: '5-hour limit',
        usedPercent: 3,
        resetLabel: '-',
        resetAtMs: now + 3_600_000,
        periodHours: 5,
      },
      {
        id: 'seven-day',
        label: '7-day limit',
        usedPercent: used,
        resetLabel: '-',
        resetAtMs: now + 5 * day,
        periodHours: 168,
      },
      {
        id: 'seven-day-fable',
        label: '7-day Fable 5',
        usedPercent: fable,
        resetLabel: '-',
        resetAtMs: now + 6 * day,
        periodHours: 168,
      },
    ],
    resetGrants: grants,
  }) as ClaudeQuotaState;

const grant = (endsAt: number, left = 1) => ({
  id: `g-${endsAt}`,
  label: 'Opus 5.5 launch',
  resetsTotal: left,
  resetsLeft: left,
  startsAt: null,
  endsAt: iso(endsAt),
  clears: ['five_hour' as const, 'seven_day' as const],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
});

const codex = (used: number | null, credits: number[] = []) =>
  ({
    status: 'success',
    windows: [
      {
        id: 'weekly',
        label: 'Weekly limit',
        usedPercent: used,
        resetLabel: '-',
        resetAtMs: now + 5 * day,
      },
    ],
    rateLimitResetCredits: credits.map((ms, index) => ({
      id: `c-${index}`,
      status: 'available',
      grantedAt: iso(now - day),
      expiresAt: iso(ms),
    })),
  }) as CodexQuotaState;

const entry = (name: string, type: 'claude' | 'codex'): QuotaFileEntry => ({
  file: { name, type, provider: type } as never,
  type,
});

const entries = [
  entry('claude-a.json', 'claude'),
  entry('claude-b.json', 'claude'),
  entry('codex-a.json', 'codex'),
  entry('codex-b.json', 'codex'),
];

const quotas: Record<string, unknown> = {
  'claude-a.json': claude(3, 0, [grant(now + 14 * day)]),
  'claude-b.json': claude(45, 2, [grant(now + 14 * day + 3_600_000)]),
  'codex-a.json': codex(30, [now + 15 * day, now + 21 * day, now + 29 * day]),
  'codex-b.json': codex(4, [now + 14 * day + 7_200_000, now + 21 * day, now + 29 * day]),
};
const quotaFor = (item: QuotaFileEntry) => quotas[item.file.name] as never;

describe('quota totals model', () => {
  test('sums Claude 7-day and 7-day Fable separately and Codex weekly', () => {
    const totals = buildQuotaTotals(entries, quotaFor, i18n.t, now);
    expect(
      totals.tiles.map((tile) => [tile.provider, tile.windowId, tile.remaining, tile.capacity])
    ).toEqual([
      ['claude', 'seven-day', 152, 200],
      ['claude', 'seven-day-fable', 198, 200],
      ['codex', 'weekly', 166, 200],
    ]);
    expect(totals.tiles[0].segments).toEqual([97, 55]);
    expect(totals.tiles[0].credentialCount).toBe(2);
    expect(totals.tiles[0].resetAtMs).toBe(now + 5 * day);
    expect(totals.tiles[2].label).toBe('Weekly limit');
  });

  test('reports unknown totals instead of zero when any account lacks data', () => {
    const totals = buildQuotaTotals(
      [entry('codex-a.json', 'codex'), entry('codex-x.json', 'codex')],
      (item) => (item.file.name === 'codex-a.json' ? codex(30) : codex(null)) as never,
      i18n.t,
      now
    );
    expect(totals.tiles[0].remaining).toBeNull();
    expect(totals.tiles[0].segments).toEqual([70, null]);
  });

  test('counts held resets per provider and finds the soonest expiry', () => {
    const { resets } = buildQuotaTotals(entries, quotaFor, i18n.t, now);
    expect(resets).toEqual({
      total: 8,
      byProvider: { claude: 2, codex: 6 },
      soonestMs: now + 14 * day,
    });
  });

  test('ignores failed reset reads, expired items and providers without resets', () => {
    const { resets, tiles } = buildQuotaTotals(
      [entry('codex-a.json', 'codex'), entry('claude-a.json', 'claude')],
      (item) =>
        (item.type === 'codex'
          ? { ...codex(30, [now - day]), rateLimitResetCreditsError: undefined }
          : { ...claude(3, 0), resetGrants: null, resetGrantsError: 'boom' }) as never,
      i18n.t,
      now
    );
    expect(resets).toBeNull();
    expect(tiles).toHaveLength(3);
  });

  test('omits providers without entries', () => {
    const totals = buildQuotaTotals([entry('codex-a.json', 'codex')], quotaFor, i18n.t, now);
    expect(totals.tiles.map((tile) => tile.provider)).toEqual(['codex']);
    expect(buildQuotaTotals([], quotaFor, i18n.t, now)).toEqual({ tiles: [], resets: null });
  });
});
