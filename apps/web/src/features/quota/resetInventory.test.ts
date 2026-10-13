import { describe, expect, test } from 'vitest';
import { buildResetInventory } from '@/features/quota/resetInventory';
import type { AnthropicResetGrant } from '@/features/personal-quota-support/services/api/claudeResetGrants';
import type {
  ClaudeQuotaState,
  CodexQuotaState,
  CodexRateLimitResetCredit,
} from '@/features/personal-quota-support/types';

const NOW = Date.parse('2026-10-08T12:00:00Z');

const credit = (overrides: Partial<CodexRateLimitResetCredit>): CodexRateLimitResetCredit => ({
  id: 'credit',
  status: 'available',
  grantedAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-22T00:00:00Z',
  ...overrides,
});

const codexQuota = (overrides: Partial<CodexQuotaState> = {}): CodexQuotaState => ({
  status: 'success',
  windows: [],
  rateLimitResetCredits: [],
  ...overrides,
});

const grant = (overrides: Partial<AnthropicResetGrant>): AnthropicResetGrant => ({
  id: 'grant',
  label: 'Launch reset',
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: '2026-10-01T00:00:00Z',
  endsAt: '2026-10-22T16:00:00Z',
  clears: ['five_hour', 'seven_day'],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  ...overrides,
});

const claudeQuota = (overrides: Partial<ClaudeQuotaState> = {}): ClaudeQuotaState => ({
  status: 'success',
  windows: [],
  resetGrants: [],
  ...overrides,
});

describe('buildResetInventory — Codex', () => {
  test('lists available, unexpired credits soonest first with their titles', () => {
    const inventory = buildResetInventory(
      'codex',
      codexQuota({
        rateLimitResetCredits: [
          credit({ id: 'late', expiresAt: '2026-10-29T00:00:00Z', title: 'Full reset' }),
          credit({ id: 'soon', expiresAt: '2026-10-22T00:00:00Z' }),
          credit({ id: 'expired', expiresAt: '2026-10-08T11:59:59Z' }),
          credit({ id: 'at-now', expiresAt: '2026-10-08T12:00:00Z' }),
          credit({ id: 'garbage', expiresAt: 'not a date' }),
          credit({ id: 'used', status: 'used', expiresAt: '2026-10-25T00:00:00Z' }),
        ],
      }),
      NOW
    );

    expect(inventory).toEqual({
      items: [
        { id: 'soon', expiresAtMs: Date.parse('2026-10-22T00:00:00Z') },
        {
          id: 'late',
          expiresAtMs: Date.parse('2026-10-29T00:00:00Z'),
          label: 'Full reset',
        },
      ],
    });
  });

  test('breaks expiry ties by id and falls back to an index-based id', () => {
    const inventory = buildResetInventory(
      'codex',
      codexQuota({
        rateLimitResetCredits: [credit({ id: 'b' }), credit({ id: '' }), credit({ id: 'a' })],
      }),
      NOW
    );

    const ids = inventory?.items.map((item) => item.id) ?? [];
    expect(ids).toHaveLength(3);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    const fallback = ids.find((id) => id !== 'a' && id !== 'b');
    expect(fallback).toBeTruthy();
    expect(fallback).toContain('1');
    expect(ids).toEqual([...ids].sort());
  });

  test('reports a credits read error with no items', () => {
    expect(
      buildResetInventory(
        'codex',
        codexQuota({
          rateLimitResetCredits: [credit({ id: 'stale' })],
          rateLimitResetCreditsError: 'credits failed',
        }),
        NOW
      )
    ).toEqual({ items: [], error: 'credits failed' });
  });

  test('treats missing credits as an empty inventory', () => {
    expect(buildResetInventory('codex', { status: 'success', windows: [] }, NOW)).toEqual({
      items: [],
    });
  });
});

describe('buildResetInventory — Claude', () => {
  test('maps grants with resets left and drops spent or expired ones', () => {
    const inventory = buildResetInventory(
      'claude',
      claudeQuota({
        resetGrants: [
          grant({ id: 'open-ended', endsAt: null, label: 'Open ended' }),
          grant({
            id: 'launch',
            label: 'Claude Opus 5.5 launch',
            resetsTotal: 2,
            resetsLeft: 1,
            endsAt: '2026-10-22T16:00:00Z',
          }),
          grant({ id: 'spent', resetsLeft: 0 }),
          grant({ id: 'expired', endsAt: '2026-10-08T11:00:00Z' }),
          grant({ id: 'garbage', endsAt: 'soon' }),
          grant({
            id: 'paused',
            paused: true,
            usableNow: false,
            startsAt: '2026-10-20T00:00:00Z',
            endsAt: '2026-10-21T00:00:00Z',
            clears: ['five_hour'],
          }),
        ],
      }),
      NOW
    );

    expect(inventory).toEqual({
      items: [
        {
          id: 'paused',
          expiresAtMs: Date.parse('2026-10-21T00:00:00Z'),
          label: 'Launch reset',
          left: 1,
          total: 1,
          clears: ['five_hour'],
        },
        {
          id: 'launch',
          expiresAtMs: Date.parse('2026-10-22T16:00:00Z'),
          label: 'Claude Opus 5.5 launch',
          left: 1,
          total: 2,
          clears: ['five_hour', 'seven_day'],
        },
        {
          id: 'open-ended',
          expiresAtMs: null,
          label: 'Open ended',
          left: 1,
          total: 1,
          clears: ['five_hour', 'seven_day'],
        },
      ],
    });
  });

  test('sorts several open-ended grants by id and falls back to an index id', () => {
    const inventory = buildResetInventory(
      'claude',
      claudeQuota({
        resetGrants: [
          grant({ id: 'z', endsAt: null }),
          grant({ id: '', endsAt: null }),
          grant({ id: 'y', endsAt: '2026-10-30T00:00:00Z' }),
        ],
      }),
      NOW
    );

    const ids = inventory?.items.map((item) => item.id) ?? [];
    expect(ids[0]).toBe('y');
    expect(ids).toHaveLength(3);
    expect(ids[1]).toContain('1');
    expect(ids[2]).toBe('z');
  });

  test('omits an empty label', () => {
    const inventory = buildResetInventory(
      'claude',
      claudeQuota({ resetGrants: [grant({ label: '' })] }),
      NOW
    );
    expect(inventory?.items[0]).not.toHaveProperty('label');
  });

  test('reports a grants read failure without touching the rest of the state', () => {
    expect(
      buildResetInventory(
        'claude',
        claudeQuota({ resetGrants: null, resetGrantsError: 'grants failed' }),
        NOW
      )
    ).toEqual({ items: [], error: 'grants failed' });

    const withoutMessage = buildResetInventory('claude', claudeQuota({ resetGrants: null }), NOW);
    expect(withoutMessage?.items).toEqual([]);
    expect(withoutMessage).toHaveProperty('error');
  });

  test('treats grants that were never loaded as an empty inventory', () => {
    expect(buildResetInventory('claude', { status: 'success', windows: [] }, NOW)).toEqual({
      items: [],
    });
  });
});

describe('buildResetInventory — unsupported input', () => {
  test('returns null for quota that is not loaded successfully', () => {
    for (const status of ['idle', 'loading', 'error'] as const) {
      expect(buildResetInventory('codex', codexQuota({ status }), NOW)).toBeNull();
      expect(buildResetInventory('claude', claudeQuota({ status }), NOW)).toBeNull();
    }
    expect(buildResetInventory('codex', undefined, NOW)).toBeNull();
    expect(buildResetInventory('claude', null, NOW)).toBeNull();
  });

  test('returns null for providers without resets', () => {
    for (const provider of ['antigravity', 'devin', 'kimi', 'xai', 'meta'] as const) {
      expect(
        buildResetInventory(
          provider,
          { status: 'success', windows: [], rateLimitResetCredits: [credit({})] },
          NOW
        )
      ).toBeNull();
    }
  });
});
