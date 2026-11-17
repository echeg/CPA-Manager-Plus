import { describe, expect, test } from 'vitest';
import type {
  AnthropicResetGrant,
  AnthropicResetGrantStatus,
} from '@/features/personal-quota-support/services/api/claudeResetGrants';
import type { ClaudeQuotaState } from '@/features/personal-quota-support/types';
import {
  resetGrantBlockReason,
  resetGrantChoices,
  resolveSelectedGrantId,
  selectResetGrant,
} from '@/features/quota/providers/claude/selectResetGrant';
import { buildResetInventory } from '@/features/quota/resetInventory';

const NOW = Date.parse('2026-11-17T12:00:00Z');

const grant = (overrides: Partial<AnthropicResetGrant>): AnthropicResetGrant => ({
  id: 'grant',
  label: 'Launch reset',
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2026-12-11T00:00:00Z',
  clears: ['five_hour', 'seven_day'],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  ...overrides,
});

const status = (overrides: Partial<AnthropicResetGrantStatus> = {}): AnthropicResetGrantStatus => ({
  eligible: true,
  ineligibleReason: null,
  atLimit: true,
  grants: [],
  nextGrantId: null,
  weeklyResetsAt: null,
  cooldownUntil: null,
  ...overrides,
});

const ids = (choices: ReturnType<typeof resetGrantChoices>) => choices.map((c) => c.grant.id);

describe('resetGrantChoices', () => {
  test('orders choices like the "Resets expire" list', () => {
    const grants = [
      grant({ id: 'open', endsAt: null }),
      grant({ id: 'late', endsAt: '2027-03-09T00:00:00Z' }),
      grant({ id: 'b-tie', endsAt: '2026-12-11T00:00:00Z' }),
      grant({ id: 'a-tie', endsAt: '2026-12-11T00:00:00Z' }),
      grant({ id: 'soon', endsAt: '2026-11-20T00:00:00Z' }),
    ];
    const quota: ClaudeQuotaState = { status: 'success', windows: [], resetGrants: grants };
    const inventory = buildResetInventory('claude', quota, NOW);

    const order = ids(resetGrantChoices(status({ grants }), NOW));

    expect(order).toEqual(['soon', 'a-tie', 'b-tie', 'late', 'open']);
    expect(order).toEqual(inventory?.items.map((item) => item.id));
  });

  test('marks only the upstream next grant as recommended', () => {
    const choices = resetGrantChoices(
      status({ grants: [grant({ id: 'a' }), grant({ id: 'b' })], nextGrantId: 'b' }),
      NOW
    );
    expect(choices.map((c) => [c.grant.id, c.recommended])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  test('keeps unusable grants with their per-grant reason', () => {
    const choices = resetGrantChoices(
      status({
        atLimit: false,
        grants: [
          grant({ id: 'ok' }),
          grant({ id: 'paused', paused: true }),
          grant({ id: 'not-usable', usableNow: false }),
          grant({ id: 'needs-limit', useRequiresLimit: true }),
          grant({ id: 'later', startsAt: '2026-11-30T00:00:00Z' }),
        ],
      }),
      NOW
    );
    expect(Object.fromEntries(choices.map((c) => [c.grant.id, [c.usable, c.reason]]))).toEqual({
      ok: [true, undefined],
      paused: [false, 'paused'],
      'not-usable': [false, 'not_usable'],
      'needs-limit': [false, 'not_limited'],
      later: [false, 'not_started'],
    });
  });

  test('cooldown marks every choice unusable', () => {
    const choices = resetGrantChoices(
      status({
        cooldownUntil: '2026-11-17T13:00:00Z',
        grants: [grant({ id: 'a' }), grant({ id: 'b', paused: true })],
      }),
      NOW
    );
    expect(choices.map((c) => [c.usable, c.reason])).toEqual([
      [false, 'cooldown'],
      [false, 'cooldown'],
    ]);
  });

  test('an ineligible account marks every choice unusable', () => {
    const choices = resetGrantChoices(
      status({ eligible: false, grants: [grant({ id: 'a' }), grant({ id: 'b' })] }),
      NOW
    );
    expect(choices.every((c) => !c.usable && c.reason === 'ineligible')).toBe(true);
  });

  test('upstream blockers outrank not_started', () => {
    const [choice] = resetGrantChoices(
      status({ grants: [grant({ id: 'a', paused: true, startsAt: '2026-11-30T00:00:00Z' })] }),
      NOW
    );
    expect(choice.reason).toBe('paused');
  });

  test('drops spent, lapsed and unreadable-expiry grants', () => {
    const choices = resetGrantChoices(
      status({
        grants: [
          grant({ id: 'spent', resetsLeft: 0 }),
          grant({ id: 'lapsed', endsAt: '2026-11-01T00:00:00Z' }),
          grant({ id: 'garbled', endsAt: 'not a date' }),
          grant({ id: 'kept' }),
        ],
      }),
      NOW
    );
    expect(ids(choices)).toEqual(['kept']);
  });
});

describe('selectResetGrant', () => {
  test('picks the recommended grant when it is usable', () => {
    const picked = selectResetGrant(
      status({ grants: [grant({ id: 'a' }), grant({ id: 'b' })], nextGrantId: 'b' }),
      NOW
    );
    expect(picked?.id).toBe('b');
  });

  test('falls back to the lowest usable id, not the soonest expiry', () => {
    const picked = selectResetGrant(
      status({
        grants: [
          grant({ id: 'z-soon', endsAt: '2026-11-20T00:00:00Z' }),
          grant({ id: 'm-late', endsAt: '2027-03-09T00:00:00Z' }),
          grant({ id: 'a-paused', paused: true }),
        ],
        nextGrantId: 'a-paused',
      }),
      NOW
    );
    expect(picked?.id).toBe('m-late');
  });

  test('returns undefined during cooldown', () => {
    const blocked = status({ cooldownUntil: '2026-11-17T13:00:00Z', grants: [grant({ id: 'a' })] });
    expect(selectResetGrant(blocked, NOW)).toBeUndefined();
    expect(resetGrantBlockReason(blocked, NOW)).toBe('cooldown');
  });
});

describe('resolveSelectedGrantId', () => {
  const two = status({ grants: [grant({ id: 'a' }), grant({ id: 'b' })], nextGrantId: 'b' });

  test('a pending grant wins, with or without a status', () => {
    expect(
      resolveSelectedGrantId({ status: two, pendingGrantId: 'c', chosenGrantId: 'a', now: NOW })
    ).toBe('c');
    expect(resolveSelectedGrantId({ status: null, pendingGrantId: 'c', now: NOW })).toBe('c');
  });

  test('a usable chosen grant wins over the default', () => {
    expect(resolveSelectedGrantId({ status: two, chosenGrantId: 'a', now: NOW })).toBe('a');
  });

  test('a missing or unusable chosen grant falls back to the default', () => {
    expect(resolveSelectedGrantId({ status: two, chosenGrantId: 'gone', now: NOW })).toBe('b');
    const pausedA = status({
      grants: [grant({ id: 'a', paused: true }), grant({ id: 'b' })],
      nextGrantId: 'b',
    });
    expect(resolveSelectedGrantId({ status: pausedA, chosenGrantId: 'a', now: NOW })).toBe('b');
    expect(resolveSelectedGrantId({ status: two, now: NOW })).toBe('b');
  });

  test('no status and nothing pending selects nothing', () => {
    expect(resolveSelectedGrantId({ status: undefined, chosenGrantId: 'a', now: NOW })).toBe(
      undefined
    );
  });
});
