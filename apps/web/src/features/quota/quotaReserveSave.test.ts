import i18n from '@/i18n';
import { describe, expect, vi, test } from 'vitest';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { readQuotaReserveDraft } from '@/features/quota/authFiles/quotaReserve';
import { saveQuotaReserve } from '@/features/quota/quotaReserveSave';

const file = (patch: Partial<AuthFileItem> = {}) =>
  ({ name: 'claude-a.json', type: 'claude', provider: 'claude', ...patch }) as AuthFileItem;

const deps = (patch: Record<string, unknown> = {}) => ({
  patchFields: vi.fn(async () => ({})),
  reloadReserveVerdicts: vi.fn(async () => {}),
  isCurrent: () => true,
  ...patch,
});

const draftFor = (item: AuthFileItem) => readQuotaReserveDraft('claude', {}, item.quotaReserve)!;

describe('saveQuotaReserve', () => {
  test('enabling sends the reserve and reloads verdicts once', async () => {
    const d = deps();
    const result = await saveQuotaReserve(
      { file: file(), draft: { ...draftFor(file()), enabled: true, percent: '25', mode: 'hard' } },
      d
    );
    expect(result).toEqual({ status: 'saved' });
    expect(d.patchFields).toHaveBeenCalledWith('claude-a.json', {
      quota_reserve: { percent: 25, mode: 'hard' },
    });
    expect(d.reloadReserveVerdicts).toHaveBeenCalledTimes(1);
  });

  test('disabling always clears the stored reserve', async () => {
    const stored = file({ quotaReserve: { percent: 40, mode: 'soft' } });
    const d = deps();
    await saveQuotaReserve({ file: stored, draft: { ...draftFor(stored), enabled: false } }, d);
    expect(d.patchFields).toHaveBeenCalledWith('claude-a.json', { quota_reserve: null });
    const unreadable = deps();
    await saveQuotaReserve(
      { file: file(), draft: { ...draftFor(file()), enabled: false } },
      unreadable
    );
    expect(unreadable.patchFields).toHaveBeenCalledWith('claude-a.json', { quota_reserve: null });
  });

  test('an unchanged reserve sends nothing', async () => {
    const stored = file({ quotaReserve: { percent: 40, mode: 'soft' } });
    const d = deps();
    expect(await saveQuotaReserve({ file: stored, draft: draftFor(stored) }, d)).toEqual({
      status: 'unchanged',
    });
    expect(d.patchFields).not.toHaveBeenCalled();
  });

  test('an invalid percent is rejected before any request', async () => {
    const d = deps();
    for (const percent of ['0', '100', '2.5', 'abc', '']) {
      const result = await saveQuotaReserve(
        { file: file(), draft: { ...draftFor(file()), enabled: true, percent } },
        d
      );
      expect(result).toEqual({ status: 'invalid', error: 'auth_files.reserve.percent_invalid' });
    }
    expect(d.patchFields).not.toHaveBeenCalled();
  });

  test('a connection change after the write skips the reload', async () => {
    const d = deps({ isCurrent: () => false });
    const result = await saveQuotaReserve(
      { file: file(), draft: { ...draftFor(file()), enabled: true, percent: '25' } },
      d
    );
    expect(result).toEqual({ status: 'stale' });
    expect(d.reloadReserveVerdicts).not.toHaveBeenCalled();
  });

  test('only the stale staged-reserve conflict shows localized retry guidance', async () => {
    await i18n.changeLanguage('en');
    const conflict =
      'quota_reserve has multiple levels; include steps explicitly (use [] to remove additional levels)';
    for (const [status, message, expected] of [
      [
        409,
        conflict,
        'The reserve changed in another window. Close the editor and refresh this account before trying again.',
      ],
      [400, conflict, conflict],
      [409, 'another conflict', 'another conflict'],
    ] as const) {
      const d = deps({
        patchFields: vi.fn(async () => {
          throw Object.assign(new Error(message), { status });
        }),
      });
      const stored = file({ quotaReserve: { percent: 30, mode: 'soft' } });
      expect(
        await saveQuotaReserve({ file: stored, draft: { ...draftFor(stored), percent: '35' } }, d)
      ).toEqual({ status: 'error', message: expected });
      expect(d.reloadReserveVerdicts).not.toHaveBeenCalled();
    }
  });

  test('a rejected write reports the server message and does not reload', async () => {
    const d = deps({
      patchFields: vi.fn(async () => {
        throw new Error('quota reserve is supported for codex and claude');
      }),
    });
    const result = await saveQuotaReserve(
      { file: file(), draft: { ...draftFor(file()), enabled: true, percent: '25' } },
      d
    );
    expect(result).toEqual({
      status: 'error',
      message: 'quota reserve is supported for codex and claude',
    });
    expect(d.reloadReserveVerdicts).not.toHaveBeenCalled();
  });
});
