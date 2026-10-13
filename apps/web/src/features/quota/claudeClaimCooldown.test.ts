import { afterEach, describe, expect, vi, test } from 'vitest';
import type { TFunction } from 'i18next';
import {
  clearClaudeCooldownAfterClaim,
  runClaudeClaim,
  type ClaudeClaimDeps,
} from '@/features/quota/providers/claude/claimCooldown';
import { apiClient, authFilesApi } from '@/features/personal-quota-support/services/api';
import {
  ANTHROPIC_RESET_RESULTS,
  type AnthropicResetSettledCode,
} from '@/features/personal-quota-support/services/api/claudeResetGrants';

const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
});

function setup() {
  const clear = vi.spyOn(authFilesApi, 'resetCooldown').mockResolvedValue({
    status: 'ok',
    auth_index: 'test-index',
    models: [],
  });
  mocks.push(clear);
  return clear;
}

const answer = (code: AnthropicResetSettledCode, unresolved = false) => ({ code, unresolved });
const revision = () => apiClient.getConnectionRevision();

describe('Claude claim proxy cooldown', () => {
  test.each(['reset', 'already_used'] as const)('clears once after a settled %s', async (code) => {
    const clear = setup();
    expect(await clearClaudeCooldownAfterClaim('test-index', answer(code), revision())).toBe(
      'cleared'
    );
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith('test-index');
  });

  test('never clears for refusals or unresolved outcomes', async () => {
    const clear = setup();
    for (const code of ANTHROPIC_RESET_RESULTS) {
      if (code === 'reset' || code === 'already_used') continue;
      expect(await clearClaudeCooldownAfterClaim('test-index', answer(code), revision())).toBe(
        'skipped'
      );
    }
    for (const code of ['auth_error', 'rate_limited'] as const) {
      expect(await clearClaudeCooldownAfterClaim('test-index', answer(code), revision())).toBe(
        'skipped'
      );
    }
    for (const code of ['reset', 'already_used'] as const) {
      expect(
        await clearClaudeCooldownAfterClaim('test-index', answer(code, true), revision())
      ).toBe('skipped');
    }
    expect(clear).not.toHaveBeenCalled();
  });

  test('skips when the connection changed after the claim', async () => {
    const clear = setup();
    expect(await clearClaudeCooldownAfterClaim('test-index', answer('reset'), revision() - 1)).toBe(
      'skipped'
    );
    expect(clear).not.toHaveBeenCalled();
  });

  test('does not report a stale acknowledgement after the connection changes mid-request', async () => {
    const start = revision();
    const clear = setup();
    const current = vi
      .spyOn(apiClient, 'getConnectionRevision')
      .mockReturnValueOnce(start)
      .mockReturnValue(start + 1);
    mocks.push(current);
    expect(await clearClaudeCooldownAfterClaim('test-index', answer('reset'), start)).toBe(
      'skipped'
    );
    expect(clear).toHaveBeenCalledTimes(1);
  });

  test('fails when the cooldown request throws', async () => {
    setup().mockRejectedValue(new Error('offline'));
    expect(await clearClaudeCooldownAfterClaim('test-index', answer('reset'), revision())).toBe(
      'failed'
    );
  });

  test('fails on a non-ok or mismatched acknowledgement', async () => {
    const clear = setup();
    clear.mockResolvedValueOnce({
      status: 'error' as 'ok',
      auth_index: 'test-index',
      models: [],
    });
    expect(await clearClaudeCooldownAfterClaim('test-index', answer('reset'), revision())).toBe(
      'failed'
    );
    clear.mockResolvedValueOnce({ status: 'ok', auth_index: 'other-index', models: [] });
    expect(
      await clearClaudeCooldownAfterClaim('test-index', answer('already_used'), revision())
    ).toBe('failed');
  });
});

describe('Claude claim execution', () => {
  const t = ((key: string) => key) as TFunction;

  function claimDeps(overrides: Partial<ClaudeClaimDeps> = {}) {
    const notifications: Array<[string, string]> = [];
    const deps: ClaudeClaimDeps = {
      claim: async () => answer('reset'),
      authIndex: 'test-index',
      revision: revision(),
      isCurrent: () => true,
      hasUnresolvedClaim: () => false,
      notify: (message, type) => notifications.push([message, type]),
      t,
      ...overrides,
    };
    return { deps, notifications };
  }

  test('a spent claim clears the cooldown and reports success', async () => {
    const clear = setup();
    const { deps, notifications } = claimDeps();
    await runClaudeClaim(deps);
    expect(clear).toHaveBeenCalledWith('test-index');
    expect(notifications).toEqual([['claude_reset.reset', 'success']]);
  });

  test('a failed cooldown clear adds a warning after the success', async () => {
    setup().mockRejectedValue(new Error('offline'));
    const { deps, notifications } = claimDeps({ claim: async () => answer('already_used') });
    await runClaudeClaim(deps);
    expect(notifications).toEqual([
      ['claude_reset.already_used', 'success'],
      ['quota_management.resets.cooldown_failed', 'warning'],
    ]);
  });

  test('refusals and unknown outcomes report an error without clearing', async () => {
    const clear = setup();
    const refused = claimDeps({ claim: async () => answer('rate_limited') });
    await runClaudeClaim(refused.deps);
    expect(refused.notifications).toEqual([['claude_reset.rate_limited', 'error']]);
    const unknown = claimDeps({ claim: async () => answer('reset', true) });
    await runClaudeClaim(unknown.deps);
    expect(unknown.notifications).toEqual([['claude_reset.unknown', 'error']]);
    expect(clear).not.toHaveBeenCalled();
  });

  test('a stale read still clears the cooldown but stays silent', async () => {
    const clear = setup();
    const { deps, notifications } = claimDeps({ isCurrent: () => false });
    await runClaudeClaim(deps);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(notifications).toEqual([]);
  });

  test('a thrown claim reports unknown while the journal holds it, blocked otherwise', async () => {
    const clear = setup();
    const fail = async () => {
      throw new Error('offline');
    };
    const pending = claimDeps({ claim: fail, hasUnresolvedClaim: () => true });
    await runClaudeClaim(pending.deps);
    expect(pending.notifications).toEqual([['claude_reset.unknown', 'error']]);
    const blocked = claimDeps({ claim: fail });
    await runClaudeClaim(blocked.deps);
    expect(blocked.notifications).toEqual([['claude_reset.blocked', 'error']]);
    const stale = claimDeps({ claim: fail, isCurrent: () => false });
    await runClaudeClaim(stale.deps);
    expect(stale.notifications).toEqual([]);
    expect(clear).not.toHaveBeenCalled();
  });
});
