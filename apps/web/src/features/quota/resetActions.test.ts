import { beforeAll, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import type {
  AnthropicResetGrant,
  AnthropicResetGrantStatus,
} from '@/features/personal-quota-support/services/api/claudeResetGrants';
import { maskQuotaText } from './ledgerModel';
import { resetGrantChoices, resolveSelectedGrantId } from './providers/claude/selectResetGrant';
import {
  claudeResetAction,
  claudeResetDetail,
  resetItemLabel,
  type ClaudeResetHandle,
} from './resetActions';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const t = (...args: Parameters<typeof i18n.t>) => i18n.t(...args);
const now = Date.UTC(2026, 10, 17);
const iso = (days: number) => new Date(now + days * 86_400_000).toISOString();

const grant = (id: string, overrides: Partial<AnthropicResetGrant> = {}): AnthropicResetGrant => ({
  id,
  label: '',
  resetsTotal: 2,
  resetsLeft: 1,
  startsAt: null,
  endsAt: iso(10),
  clears: ['five_hour', 'seven_day'],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  ...overrides,
});

const status = (
  grants: AnthropicResetGrant[],
  overrides: Partial<AnthropicResetGrantStatus> = {}
): AnthropicResetGrantStatus => ({
  eligible: true,
  ineligibleReason: null,
  atLimit: true,
  grants,
  nextGrantId: null,
  weeklyResetsAt: null,
  cooldownUntil: null,
  ...overrides,
});

/** A handle the way `useClaudeResetGrants` would build it from `value`. */
const handle = (
  value: AnthropicResetGrantStatus,
  chosenGrantId?: string,
  extra: Partial<ClaudeResetHandle> = {}
): ClaudeResetHandle => {
  const selected = resolveSelectedGrantId({ status: value, chosenGrantId, now });
  return {
    blocked: !selected,
    busy: false,
    message: '',
    buttonLabel: 'use',
    confirmMessage: 'confirm text',
    count: value.grants.reduce((sum, item) => sum + item.resetsLeft, 0),
    selectedGrant: value.grants.find((item) => item.id === selected),
    choices: resetGrantChoices(value, now),
    choose: vi.fn(),
    execute: vi.fn(async () => {}),
    ...extra,
  };
};

const action = (h: ClaudeResetHandle, showEmails = true) =>
  claudeResetAction(t as never, h, { showEmails });

describe('claudeResetAction choices', () => {
  test('no choices for a single grant', () => {
    const result = action(handle(status([grant('A')])));
    expect(result.choices).toBeUndefined();
    expect(result.onChoose).toBeUndefined();
  });

  test('no choices when no grant is usable', () => {
    const result = action(
      handle(status([grant('A', { paused: true }), grant('B', { paused: true })]))
    );
    expect(result.choices).toBeUndefined();
  });

  test('no choices for a retry', () => {
    const value = status([grant('A'), grant('B')]);
    const result = action(
      handle(value, undefined, {
        buttonLabel: 'retry',
        selectedGrant: undefined,
        message: 'unknown',
      })
    );
    expect(result.retry).toBe(true);
    expect(result.choices).toBeUndefined();
  });

  test('one usable and one paused grant give two choices', () => {
    const value = status([
      grant('A', { label: 'Full reset', endsAt: iso(5) }),
      grant('B', { label: 'Fable reset', paused: true, endsAt: iso(8) }),
    ]);
    const result = action(handle(value));
    expect(result.choices).toHaveLength(2);
    const [a, b] = result.choices!;
    expect(a).toMatchObject({ id: 'A', label: 'Full reset', usable: true, selected: true });
    expect(a.reason).toBeUndefined();
    expect(b).toMatchObject({
      id: 'B',
      usable: false,
      selected: false,
      reason: i18n.t('quota_management.resets.choice.reason.paused'),
    });
    expect(a.detail).toBe(
      claudeResetDetail(t as never, { left: 1, total: 2, clears: ['five_hour', 'seven_day'] })
    );
  });

  test('selected and recommended follow the hook', () => {
    const value = status([grant('A', { endsAt: iso(3) }), grant('B', { endsAt: iso(4) })], {
      nextGrantId: 'B',
    });
    const byDefault = action(handle(value)).choices!;
    expect(byDefault.map((c) => [c.id, c.recommended, c.selected])).toEqual([
      ['A', false, false],
      ['B', true, true],
    ]);
    const picked = action(handle(value, 'A')).choices!;
    expect(picked.map((c) => [c.id, c.recommended, c.selected])).toEqual([
      ['A', false, true],
      ['B', true, false],
    ]);
  });

  test('the consequence names the selected grant', () => {
    const value = status(
      [
        grant('A', { label: 'Full reset', endsAt: iso(3) }),
        grant('B', { label: 'Fable reset', endsAt: iso(4) }),
      ],
      { nextGrantId: 'A' }
    );
    expect(action(handle(value)).consequence).toContain('Full reset');
    const picked = action(handle(value, 'B')).consequence;
    expect(picked).toContain('Fable reset');
    expect(picked).not.toContain('Full reset');
  });

  test('unnamed grants are numbered by position in radio and consequence', () => {
    const value = status([grant('A', { endsAt: iso(3) }), grant('B', { endsAt: iso(4) })], {
      nextGrantId: 'A',
    });
    const second = i18n.t('quota_management.resets.unnamed', { index: 2 });
    const result = action(handle(value, 'B'));
    expect(result.choices!.map((c) => c.label)).toEqual([
      i18n.t('quota_management.resets.unnamed', { index: 1 }),
      second,
    ]);
    expect(result.choices![1].selected).toBe(true);
    expect(result.consequence).toContain(second);
  });

  test('labels are masked when emails are hidden', () => {
    const label = 'Reset for user@example.com';
    const value = status([grant('A', { label, endsAt: iso(3) }), grant('B', { endsAt: iso(4) })]);
    const result = action(handle(value), false);
    expect(result.choices![0].label).toBe(maskQuotaText(label));
    expect(result.choices![0].label).not.toContain('user@example.com');
    expect(result.consequence).not.toContain('user@example.com');
  });

  test('the note stays account-wide when the choice changes', () => {
    const value = status([
      grant('A', { resetsLeft: 1, endsAt: iso(3) }),
      grant('B', { resetsLeft: 3, resetsTotal: 3, endsAt: iso(4) }),
    ]);
    const byDefault = action(handle(value)).note;
    expect(byDefault).toBe(action(handle(value, 'B')).note);
    expect(byDefault).toBe(i18n.t('quota_management.resets.cant_undo_many', { count: 3 }));
  });

  test('onChoose and onClearChoice drive the hook', () => {
    const value = status([grant('A'), grant('B')]);
    const h = handle(value);
    const result = action(h);
    result.onChoose!('B');
    expect(h.choose).toHaveBeenLastCalledWith('B');
    result.onClearChoice!();
    expect(h.choose).toHaveBeenLastCalledWith(undefined);
  });
});

describe('shared label and detail helpers', () => {
  test('resetItemLabel numbers unnamed items and masks named ones', () => {
    expect(resetItemLabel(t as never, {}, 2, true)).toBe(
      i18n.t('quota_management.resets.unnamed', { index: 3 })
    );
    expect(resetItemLabel(t as never, { label: 'a@b.com' }, 0, false)).toBe(
      maskQuotaText('a@b.com')
    );
    expect(resetItemLabel(t as never, { label: 'a@b.com' }, 0, true)).toBe('a@b.com');
  });

  test('claudeResetDetail', () => {
    expect(claudeResetDetail(t as never, {})).toBeNull();
    expect(claudeResetDetail(t as never, { left: 1, total: 2 })).toBe(
      i18n.t('quota_management.resets.claude_left_only', { left: 1, total: 2 })
    );
  });
});
