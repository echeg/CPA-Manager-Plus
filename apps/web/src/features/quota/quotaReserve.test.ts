import { describe, expect, test } from 'vitest';
import { normalizeAuthFilesResponse } from '@/features/personal-quota-support/services/api/authFiles';
import type {
  AuthFileItem,
  AuthFilesResponse,
} from '@/features/personal-quota-support/types/authFile';

const normalize = (files: Array<Record<string, unknown>>): Map<string, AuthFileItem> => {
  const result = normalizeAuthFilesResponse({ files } as unknown as AuthFilesResponse);
  return new Map(result.files.map((file) => [file.name, file]));
};

describe('quota reserve normalization', () => {
  test('maps the backend reserve fields to camelCase', () => {
    const files = normalize([
      {
        name: 'held.json',
        quota_reserve: { percent: 25, mode: 'hard' },
        quota_reserve_active: true,
        quota_reserve_until: '2100-10-14T09:00:00Z',
      },
      {
        name: 'idle.json',
        quota_reserve: { percent: 40, mode: 'soft' },
        quota_reserve_active: false,
      },
    ]);

    const held = files.get('held.json');
    expect(held?.quotaReserve).toEqual({ percent: 25, mode: 'hard' });
    expect(held?.quotaReserveActive).toBe(true);
    expect(held?.quotaReserveUntil).toBe('2100-10-14T09:00:00Z');

    const idle = files.get('idle.json');
    expect(idle?.quotaReserve).toEqual({ percent: 40, mode: 'soft' });
    expect(idle?.quotaReserveActive).toBe(false);
    expect(idle?.quotaReserveUntil).toBeUndefined();
  });

  test('defaults a missing mode to soft, like the backend', () => {
    const files = normalize([{ name: 'a.json', quota_reserve: { percent: '30' } }]);
    expect(files.get('a.json')?.quotaReserve).toEqual({ percent: 30, mode: 'soft' });
  });

  test('older backends without the fields leave them undefined', () => {
    const file = normalize([{ name: 'old.json' }]).get('old.json');
    expect(file?.quotaReserve).toBeUndefined();
    expect(file?.quotaReserveActive).toBeUndefined();
    expect(file?.quotaReserveUntil).toBeUndefined();
  });

  test('invalid values become undefined', () => {
    const files = normalize([
      { name: 'null.json', quota_reserve: null },
      { name: 'string.json', quota_reserve: '25' },
      { name: 'array.json', quota_reserve: [25, 'soft'] },
      { name: 'zero.json', quota_reserve: { percent: 0, mode: 'soft' } },
      { name: 'hundred.json', quota_reserve: { percent: 100, mode: 'soft' } },
      { name: 'negative.json', quota_reserve: { percent: -5, mode: 'soft' } },
      { name: 'fraction.json', quota_reserve: { percent: 25.5, mode: 'soft' } },
      { name: 'nan.json', quota_reserve: { percent: 'many', mode: 'soft' } },
      { name: 'unknown-mode.json', quota_reserve: { percent: 25, mode: 'strict' } },
      { name: 'numeric-mode.json', quota_reserve: { percent: 25, mode: 1 } },
    ]);

    for (const [name, file] of files) {
      expect([name, file.quotaReserve]).toEqual([name, undefined]);
    }
  });

  test('ignores non-boolean verdicts and unparseable expiry', () => {
    const files = normalize([
      {
        name: 'a.json',
        quota_reserve: { percent: 25, mode: 'hard' },
        quota_reserve_active: 'true',
        quota_reserve_until: 'tomorrow-ish',
      },
      {
        name: 'b.json',
        quota_reserve: { percent: 25, mode: 'hard' },
        quota_reserve_active: true,
        quota_reserve_until: 1760000000,
      },
    ]);

    expect(files.get('a.json')?.quotaReserveActive).toBeUndefined();
    expect(files.get('a.json')?.quotaReserveUntil).toBeUndefined();
    expect(files.get('b.json')?.quotaReserveActive).toBe(true);
    expect(files.get('b.json')?.quotaReserveUntil).toBeUndefined();
  });

  test('a verdict without a reserve is dropped', () => {
    const file = normalize([
      { name: 'a.json', quota_reserve_active: true, quota_reserve_until: '2100-10-14T09:00:00Z' },
    ]).get('a.json');
    expect(file?.quotaReserve).toBeUndefined();
    expect(file?.quotaReserveActive).toBeUndefined();
    expect(file?.quotaReserveUntil).toBeUndefined();
  });
});
