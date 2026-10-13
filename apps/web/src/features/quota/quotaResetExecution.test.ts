import { describe, expect, test } from 'vitest';
import type { TFunction } from 'i18next';
import {
  executeQuotaReset,
  resetFnIfAllowed,
  type QuotaResetDeps,
} from '@/features/quota/hooks/quotaReset';
import type { QuotaCardState } from '@/features/quota/providers';
import type { AuthFileItem, NotificationType } from '@/features/personal-quota-support/types';

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key) as TFunction;
const file = { name: 'codex-a.json', type: 'codex', auth_index: 'a' } as AuthFileItem;

function setup(overrides: Partial<QuotaResetDeps<number>> = {}) {
  let quotas: Record<string, QuotaCardState> = {};
  const resetting = new Set<string>();
  const resettingDuringCall: string[][] = [];
  const notifications: Array<{ message: string; type: NotificationType }> = [];
  let generation = 1;
  const deps: QuotaResetDeps<number> = {
    file,
    adapter: {
      buildSuccessState: (data) => ({ status: 'success', data }) as unknown as QuotaCardState,
    },
    resetQuotaFn: async () => {
      resettingDuringCall.push([...resetting]);
      return { windows: 1 };
    },
    setQuota: (updater) => {
      quotas = updater(quotas);
    },
    setResetting: (cacheKey, on) => {
      if (on) resetting.add(cacheKey);
      else resetting.delete(cacheKey);
    },
    notify: (message, type) => notifications.push({ message, type }),
    t,
    displayName: (name) => `masked(${name})`,
    captureGeneration: () => generation,
    commitIfCurrent: (captured, commit) => {
      if (captured !== generation) return false;
      commit();
      return true;
    },
    ...overrides,
  };
  return {
    deps,
    notifications,
    resettingDuringCall,
    quotas: () => quotas,
    resetting: () => [...resetting],
    bumpGeneration: () => {
      generation += 1;
    },
  };
}

describe('executeQuotaReset', () => {
  test('commits the success state under the cache key and notifies success', async () => {
    const ctx = setup();
    await expect(executeQuotaReset(ctx.deps)).resolves.toBe(true);
    expect(ctx.quotas()).toEqual({
      'codex-a.json': { status: 'success', data: { windows: 1 } } as unknown as QuotaCardState,
    });
    expect(ctx.notifications).toEqual([
      {
        message: 'codex_quota.reset_success:{"name":"masked(codex-a.json)"}',
        type: 'success',
      },
    ]);
  });

  test('notifies failure and commits no state', async () => {
    const ctx = setup({
      resetQuotaFn: async () => {
        throw new Error('codex_quota.reset_not_confirmed');
      },
    });
    await expect(executeQuotaReset(ctx.deps)).resolves.toBe(false);
    expect(ctx.quotas()).toEqual({});
    expect(ctx.notifications).toEqual([
      {
        message:
          'codex_quota.reset_failed:{"name":"masked(codex-a.json)",' +
          '"message":"masked(codex_quota.reset_not_confirmed)"}',
        type: 'error',
      },
    ]);
  });

  test('falls back to the unknown error text for non-Error rejections', async () => {
    const ctx = setup({
      resetQuotaFn: () => Promise.reject('boom'),
    });
    await executeQuotaReset(ctx.deps);
    expect(ctx.notifications[0].message).toContain('"message":"masked(common.unknown_error)"');
  });

  test('stale cache generation commits nothing and stays silent', async () => {
    const ctx = setup();
    ctx.deps.resetQuotaFn = async () => {
      ctx.bumpGeneration();
      return { windows: 1 };
    };
    await expect(executeQuotaReset(ctx.deps)).resolves.toBe(false);
    expect(ctx.quotas()).toEqual({});
    expect(ctx.notifications).toEqual([]);
  });

  test('stale cache generation on failure stays silent', async () => {
    const ctx = setup();
    ctx.deps.resetQuotaFn = async () => {
      ctx.bumpGeneration();
      throw new Error('offline');
    };
    await executeQuotaReset(ctx.deps);
    expect(ctx.notifications).toEqual([]);
  });

  test('reloads quota after a current failure, once the in-flight flag clears', async () => {
    const reloads: string[][] = [];
    const ctx = setup({
      resetQuotaFn: async () => {
        throw new Error('codex_quota.reset_cooldown_failed');
      },
    });
    ctx.deps.reloadAfterFailure = () => reloads.push(ctx.resetting());
    await executeQuotaReset(ctx.deps);
    expect(reloads).toEqual([[]]);
  });

  test('skips the reload after success or a stale-generation failure', async () => {
    let reloads = 0;
    const ok = setup({ reloadAfterFailure: () => (reloads += 1) });
    await executeQuotaReset(ok.deps);

    const stale = setup({ reloadAfterFailure: () => (reloads += 1) });
    stale.deps.resetQuotaFn = async () => {
      stale.bumpGeneration();
      throw new Error('offline');
    };
    await executeQuotaReset(stale.deps);
    expect(reloads).toBe(0);
  });

  test('sets the resetting key during the call and clears it in finally', async () => {
    const ok = setup();
    await executeQuotaReset(ok.deps);
    expect(ok.resettingDuringCall).toEqual([['codex-a.json']]);
    expect(ok.resetting()).toEqual([]);

    const failed = setup();
    failed.deps.resetQuotaFn = async () => {
      failed.resettingDuringCall.push(failed.resetting());
      throw new Error('offline');
    };
    await executeQuotaReset(failed.deps);
    expect(failed.resettingDuringCall).toEqual([['codex-a.json']]);
    expect(failed.resetting()).toEqual([]);
  });

  test('keeps the key of another credential whose reset is still in flight', async () => {
    const ctx = setup();
    ctx.deps.resetQuotaFn = async () => {
      ctx.deps.setResetting('codex-b.json', true);
      return {};
    };
    await executeQuotaReset(ctx.deps);
    expect(ctx.resetting()).toEqual(['codex-b.json']);
  });
});

describe('resetFnIfAllowed', () => {
  const resetQuota = async () => ({});
  const allowed = { disableControls: false, resettingKeys: new Set<string>() };

  test('returns the adapter reset call when nothing blocks it', () => {
    expect(resetFnIfAllowed(file, { resetQuota }, allowed)).toBe(resetQuota);
    expect(
      resetFnIfAllowed(
        file,
        { resetQuota },
        { ...allowed, resettingKeys: new Set(['codex-b.json']) }
      )
    ).toBe(resetQuota);
  });

  test('blocks providers without resets, disabled controls and disabled files', () => {
    expect(resetFnIfAllowed(file, {}, allowed)).toBeNull();
    expect(
      resetFnIfAllowed(file, { resetQuota }, { ...allowed, disableControls: true })
    ).toBeNull();
    expect(resetFnIfAllowed({ ...file, disabled: true }, { resetQuota }, allowed)).toBeNull();
  });

  test('blocks while the quota loads or this credential already has a reset in flight', () => {
    expect(
      resetFnIfAllowed(file, { resetQuota }, { ...allowed, quotaStatus: 'loading' })
    ).toBeNull();
    expect(
      resetFnIfAllowed(
        file,
        { resetQuota },
        { ...allowed, resettingKeys: new Set(['codex-a.json']) }
      )
    ).toBeNull();
  });
});
