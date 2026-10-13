import { afterEach, beforeAll, describe, expect, vi, test } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { configApi } from '@/features/personal-quota-support/services/api/config';
import { readSubscriptionRouting } from '@/features/personal-quota-support/services/api/subscriptionRouting';
import {
  activityStatusKey,
  errorText,
  routingFormState,
  routingStrategyOptions,
  saveCodexFastMode,
} from '@/features/quota/routingModel';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const t = ((key: string) => key) as TFunction;

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
