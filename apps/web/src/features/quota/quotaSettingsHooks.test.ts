import { afterEach, beforeAll, describe, expect, vi, test } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { configApi } from '@/features/personal-quota-support/services/api/config';
import {
  readSubscriptionRouting,
  subscriptionRoutingPatch,
} from '@/features/personal-quota-support/services/api/subscriptionRouting';
import {
  activityStatusKey,
  errorText,
  invalidTTL,
  isPickerSlot,
  routingFormState,
  routingStrategyOptions,
  saveCodexFastMode,
  selectionSlotOptions,
  withPickerRule,
} from '@/features/quota/routingModel';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const t = ((key: string) => key) as TFunction;

describe('invalidTTL', () => {
  test.each(['', '   ', '0s', '0', '-5m', 'garbage', '1 hour'])('rejects %j', (ttl) => {
    expect(invalidTTL(ttl)).toBe(true);
  });

  test.each(['30m', '24h', ' 1h30m '])('accepts %j', (ttl) => {
    expect(invalidTTL(ttl)).toBe(false);
  });
});

describe('routing form state', () => {
  const baseline = readSubscriptionRouting({
    routingStrategy: 'earliest-reset',
    routingSessionAffinity: true,
    routingSessionAffinityTTL: '24h',
  });

  test('is clean and valid for unchanged values', () => {
    expect(routingFormState(baseline, baseline)).toEqual({ dirty: false, invalidTTL: false });
  });

  test('reports dirty edits and rejects non-positive or malformed TTLs', () => {
    expect(routingFormState({ ...baseline, strategy: 'fill-first' }, baseline).dirty).toBe(true);
    expect(routingFormState({ ...baseline, sessionAffinityTTL: '0s' }, baseline).invalidTTL).toBe(
      true
    );
    expect(
      routingFormState({ ...baseline, sessionAffinityTTL: 'one hour' }, baseline).invalidTTL
    ).toBe(true);
    expect(routingFormState({ ...baseline, sessionAffinityTTL: ' 1h30m ' }, baseline)).toEqual({
      dirty: true,
      invalidTTL: false,
    });
  });

  test('is clean and valid before settings load', () => {
    expect(routingFormState(null, null)).toEqual({ dirty: false, invalidTTL: false });
  });
});

describe('legacy routing patch', () => {
  test('sends routing.strategy, and no selection, for a strategy change', () => {
    const legacy = readSubscriptionRouting({ routingStrategy: 'fill-first' });
    const edited = { ...legacy, strategy: 'round-robin' };
    expect(routingFormState(edited, legacy).dirty).toBe(true);
    expect(subscriptionRoutingPatch(legacy, edited)).toEqual({ strategy: 'round-robin' });
  });

  test('ignores a stray selection, which only the Profiles modal writes', () => {
    const legacy = readSubscriptionRouting({ routingStrategy: 'fill-first' });
    const stray = { ...legacy, selection: { primary: 'priority' } };
    expect(routingFormState(stray, legacy).dirty).toBe(false);
    expect(subscriptionRoutingPatch(legacy, stray)).toEqual({});
  });
});

describe('selection slots', () => {
  const options = {
    narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
    pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
  };

  test('a picker primary drops the tiebreak and disables its slot', () => {
    expect(isPickerSlot('fill-first', options)).toBe(true);
    expect(isPickerSlot('reserves', options)).toBe(false);
    expect(withPickerRule({ primary: 'round-robin', tiebreak: 'priority' }, options)).toEqual({
      primary: 'round-robin',
    });
    expect(withPickerRule({ primary: 'priority', tiebreak: 'round-robin' }, options)).toEqual({
      primary: 'priority',
      tiebreak: 'round-robin',
    });
    expect(withPickerRule({ primary: 'priority', tiebreak: '' }, options)).toEqual({
      primary: 'priority',
    });
    const slots = selectionSlotOptions(i18n.t.bind(i18n) as TFunction, options, {
      primary: 'fill-first',
    });
    expect(slots.tiebreakDisabled).toBe(true);
  });

  test('lists every backend slot with English labels and an empty tiebreak', () => {
    const slots = selectionSlotOptions(i18n.t.bind(i18n) as TFunction, options, {
      primary: 'reserves',
      tiebreak: 'earliest-reset',
    });
    expect(slots.tiebreakDisabled).toBe(false);
    expect(slots.primary.map((option) => option.label)).toEqual([
      'Priority',
      'Reserves',
      'Earliest reset',
      'Most remaining',
      'Round-robin',
      'Weighted round-robin',
      'Fill-first',
    ]);
    expect(slots.tiebreak[0]).toEqual({ value: '', label: 'None' });
    expect(slots.tiebreak).toHaveLength(8);
  });

  test('keeps unknown stored slots selectable', () => {
    const slots = selectionSlotOptions(i18n.t.bind(i18n) as TFunction, options, {
      primary: 'plugin-slot',
      tiebreak: 'other-slot',
    });
    expect(slots.primary[slots.primary.length - 1]).toEqual({
      value: 'plugin-slot',
      label: 'plugin-slot',
    });
    expect(slots.tiebreak[slots.tiebreak.length - 1]).toEqual({
      value: 'other-slot',
      label: 'other-slot',
    });
  });
});

describe('routing strategy options', () => {
  test('lists the four known strategies with translated labels', () => {
    const options = routingStrategyOptions(t, 'earliest-reset');
    expect(options.map((option) => option.value)).toEqual([
      'round-robin',
      'weighted-round-robin',
      'fill-first',
      'earliest-reset',
    ]);
    expect(options[3].label).toBe(
      'config_management.visual.sections.network.strategy_earliest_reset'
    );
  });

  test('keeps an unknown server strategy selectable', () => {
    const options = routingStrategyOptions(t, 'custom-plugin');
    expect(options[options.length - 1]).toEqual({ value: 'custom-plugin', label: 'custom-plugin' });
    expect(routingStrategyOptions(t, undefined)).toHaveLength(4);
  });
});

describe('activity status', () => {
  test('maps polling state to the message key', () => {
    expect(activityStatusKey(true, 'ready')).toBe('quota_management.routing.activity_unavailable');
    expect(activityStatusKey(false, 'error')).toBe('quota_management.routing.activity_unavailable');
    expect(activityStatusKey(false, 'loading')).toBe('quota_management.routing.activity_loading');
    expect(activityStatusKey(false, 'ready')).toBe('quota_management.routing.no_activity');
  });
});

describe('error text', () => {
  test('uses the error message or a translated fallback', () => {
    expect(errorText(new Error('boom'), t)).toBe('boom');
    expect(errorText('nope', t)).toBe('common.unknown_error');
  });
});

describe('codex fast mode save', () => {
  test('writes the flag and returns the reloaded config value', async () => {
    const update = vi.spyOn(configApi, 'updateCodexFastMode').mockResolvedValue(undefined as never);
    spies.push(update);
    const fetchConfig = async () => ({ codexFastMode: true });
    await expect(saveCodexFastMode(true, fetchConfig as never)).resolves.toBe(true);
    expect(update).toHaveBeenLastCalledWith(true);
  });

  test('defaults a missing reloaded flag to off and propagates failures', async () => {
    const update = vi.spyOn(configApi, 'updateCodexFastMode').mockResolvedValue(undefined as never);
    spies.push(update);
    await expect(saveCodexFastMode(false, (async () => ({})) as never)).resolves.toBe(false);
    update.mockRejectedValue(new Error('denied'));
    await expect(saveCodexFastMode(true, (async () => ({})) as never)).rejects.toThrow('denied');
  });
});
