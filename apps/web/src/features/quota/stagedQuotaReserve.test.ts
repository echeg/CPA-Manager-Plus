import { beforeAll, describe, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import {
  normalizeAuthFilesResponse,
  parseAuthFileQuotaReserve,
} from '@/features/personal-quota-support/services/api/authFiles';
import {
  readQuotaReserveDraft,
  buildQuotaReservePatch,
  quotaReserveError,
} from './authFiles/quotaReserve';
import { saveQuotaReserve } from './quotaReserveSave';
import { mergeQuotaReserveVerdicts } from './logic';
import { ReserveBadge } from './components/QuotaReserveVisuals';
import type { AuthFileItem } from '@/features/personal-quota-support/types';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
const policy = { percent: 30, mode: 'soft' as const, steps: [15, 5] };
const configured: AuthFileItem = { name: 'account.json', type: 'codex', quotaReserve: policy };
const draft = () => ({ ...readQuotaReserveDraft('codex', {}, policy)!, touched: true });

describe('staged reserve validation and round trip', () => {
  test('preserves the complete policy through API normalization and an unchanged editor', () => {
    const normalized = normalizeAuthFilesResponse({
      files: [
        {
          name: 'account.json',
          quota_reserve: policy,
          quota_reserve_active: true,
          quota_reserve_level: 2,
        },
      ],
    }).files[0];
    expect(normalized.quotaReserve).toEqual(policy);
    expect(normalized.quotaReserveLevel).toBe(2);
    const value = readQuotaReserveDraft('codex', {}, normalized.quotaReserve)!;
    expect(value.steps).toEqual(['15', '5']);
    expect(buildQuotaReservePatch({}, { ...value, touched: true })).toEqual({});
  });

  test.each([
    [[], true],
    [[15], true],
    [[15, 5], true],
    [[29, 1], true],
    [null, false],
    [[15, 5, 1], false],
    [[30], false],
    [[31], false],
    [[15, 15], false],
    [[5, 15], false],
    [[0], false],
    [[1.5], false],
    [['x'], false],
  ])('reads only valid decreasing step lists %j', (steps, valid) => {
    expect(Boolean(parseAuthFileQuotaReserve({ percent: 30, mode: 'soft', steps }))).toBe(valid);
  });

  test('hard mode rejects extra thresholds while retaining an explicit collapse', () => {
    expect(parseAuthFileQuotaReserve({ percent: 30, mode: 'hard', steps: [15] })).toBeUndefined();
    expect(parseAuthFileQuotaReserve({ percent: 30, mode: 'hard', steps: [] })).toEqual({
      percent: 30,
      mode: 'hard',
      steps: [],
    });
  });

  test.each([
    [['', '5'], 'steps_gap_invalid'],
    [['30', '5'], 'steps_order_invalid'],
    [['15', '15'], 'steps_order_invalid'],
    [['15', '20'], 'steps_order_invalid'],
    [['15.5', '5'], 'steps_invalid'],
    [['0', ''], 'steps_invalid'],
  ])('rejects invalid editor steps %j before producing a patch', (steps, key) => {
    const value = { ...draft(), steps: steps as [string, string] };
    expect(quotaReserveError(value)).toBe(`auth_files.reserve.${key}`);
    expect(buildQuotaReservePatch({}, value)).toEqual({});
  });

  test('explicitly clears stages for single-soft and hard transitions', () => {
    expect(buildQuotaReservePatch({}, { ...draft(), steps: ['', ''] })).toEqual({
      quota_reserve: { percent: 30, mode: 'soft', steps: [] },
    });
    expect(buildQuotaReservePatch({}, { ...draft(), mode: 'hard' })).toEqual({
      quota_reserve: { percent: 30, mode: 'hard', steps: [] },
    });
    expect(buildQuotaReservePatch({}, { ...draft(), enabled: false })).toEqual({
      quota_reserve: null,
    });
  });

  test('changes only the policy and refreshes verdicts after saving stages', async () => {
    const patchFields = vi.fn(async () => undefined);
    const reloadReserveVerdicts = vi.fn();
    await expect(
      saveQuotaReserve(
        { file: configured, draft: { ...draft(), steps: ['12', '4'] } },
        { patchFields, reloadReserveVerdicts, isCurrent: () => true }
      )
    ).resolves.toEqual({ status: 'saved' });
    expect(patchFields).toHaveBeenCalledExactlyOnceWith('account.json', {
      quota_reserve: { percent: 30, mode: 'soft', steps: [12, 4] },
    });
    expect(reloadReserveVerdicts).toHaveBeenCalledTimes(1);
  });

  test.each([undefined, []])(
    'single-soft edits omit empty stages so concurrent new stages stay protected (%j)',
    (steps) => {
      const value = readQuotaReserveDraft('codex', {}, { percent: 30, mode: 'soft', steps })!;
      expect(buildQuotaReservePatch({}, { ...value, percent: '35', touched: true })).toEqual({
        quota_reserve: { percent: 35, mode: 'soft' },
      });
      expect(buildQuotaReservePatch({}, { ...value, mode: 'hard', touched: true })).toEqual({
        quota_reserve: { percent: 30, mode: 'hard' },
      });
    }
  );

  test('legacy single-soft remains unchanged and hard ignores hidden draft steps', () => {
    const value = readQuotaReserveDraft('claude', {}, { percent: 30, mode: 'soft' })!;
    expect(value.steps).toEqual(['', '']);
    expect(buildQuotaReservePatch({}, { ...value, touched: true })).toEqual({});
    expect(quotaReserveError({ ...draft(), mode: 'hard', steps: ['', 'bad'] })).toBeNull();
  });
});

describe('authoritative reserve tiers', () => {
  test('rejects malformed levels and drops levels without a policy', () => {
    for (const level of [-1, 4, 1.2, '2', null]) {
      const file = normalizeAuthFilesResponse({
        files: [{ name: 'a', quota_reserve: policy, quota_reserve_level: level }],
      }).files[0];
      expect(file.quotaReserveLevel).toBeUndefined();
    }
    expect(
      normalizeAuthFilesResponse({ files: [{ name: 'a', quota_reserve_level: 2 }] }).files[0]
        .quotaReserveLevel
    ).toBeUndefined();
  });

  test('updates tier-only and steps-only verdicts without changing other credential state', () => {
    const current = [{ ...configured, quotaReserveLevel: 1 as const, successCount: 12 }];
    const changed = mergeQuotaReserveVerdicts(current, [{ ...configured, quotaReserveLevel: 2 }]);
    expect(changed[0].quotaReserveLevel).toBe(2);
    expect(changed[0].successCount).toBe(12);
    const stepsChanged = mergeQuotaReserveVerdicts(changed, [
      { ...configured, quotaReserveLevel: 2, quotaReserve: { ...policy, steps: [10, 3] } },
    ]);
    expect(stepsChanged[0].quotaReserve?.steps).toEqual([10, 3]);
    expect(mergeQuotaReserveVerdicts(stepsChanged, stepsChanged)).toBe(stepsChanged);
  });

  test.each([0, 1, 2, 3] as const)(
    'displays reported tier %s with every configured threshold',
    (level) => {
      const markup = renderToStaticMarkup(
        createElement(ReserveBadge, {
          file: { ...configured, quotaReserveLevel: level, quotaReserveActive: level === 0 },
        })
      );
      expect(markup).toContain(`data-reserve-level="${level}"`);
      expect(markup).toContain(`${level === 0 ? 'normal' : `soft${level}`} · 30/15/5%`);
      expect(markup.includes('data-tone="warn"')).toBe(level > 0);
    }
  );

  test('does not invent a tier from an active flag when the server omits its level', () => {
    const markup = renderToStaticMarkup(
      createElement(ReserveBadge, { file: { ...configured, quotaReserveActive: true } })
    );
    expect(markup).not.toContain('data-reserve-level');
    expect(markup).toContain('soft · 30/15/5%');
    expect(markup).toContain('The server has not reported the current tier.');
  });
});
