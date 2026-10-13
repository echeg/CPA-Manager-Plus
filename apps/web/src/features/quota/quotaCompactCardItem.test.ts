import { afterEach, beforeAll, describe, expect, vi, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type { ClaudeQuotaState, CodexQuotaState } from '@/features/personal-quota-support/types';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { resetGrantOperations } from '@/features/quota/providers/claude/resetGrantOperations';
import { QuotaCompactCardItem } from '@/features/quota/components/QuotaCompactCardItem';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const now = Date.UTC(2036, 9, 8, 12);
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const codexEntry: QuotaFileEntry = {
  file: { name: 'codex-a.json', type: 'codex', provider: 'codex', authIndex: 'c1' } as never,
  type: 'codex',
};
const claudeEntry: QuotaFileEntry = {
  file: { name: 'claude-a.json', type: 'claude', provider: 'claude', authIndex: 'a1' } as never,
  type: 'claude',
};

const codex = (credits: number) =>
  ({
    status: 'success',
    windows: [{ id: 'weekly', label: 'Weekly limit', usedPercent: 30, resetLabel: '-' }],
    rateLimitResetCredits: Array.from({ length: credits }, (_, index) => ({
      id: `c${index}`,
      status: 'available',
      grantedAt: iso(now),
      expiresAt: iso(now + (14 + index) * day),
    })),
  }) as CodexQuotaState;

const claude = (grants: number) =>
  ({
    status: 'success',
    windows: [
      { id: 'seven-day', label: '7-day limit', usedPercent: 45, resetLabel: '-', periodHours: 168 },
    ],
    resetGrants: Array.from({ length: grants }, (_, index) => ({
      id: `g${index}`,
      label: 'Opus 5.5 launch',
      resetsTotal: 1,
      resetsLeft: 1,
      startsAt: null,
      endsAt: iso(now + 14 * day),
      clears: ['five_hour', 'seven_day'],
      paused: false,
      usableNow: true,
      useRequiresLimit: false,
      percentUsed: {},
    })),
  }) as ClaudeQuotaState;

const render = (entry: QuotaFileEntry, quota: unknown, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(QuotaCompactCardItem, {
      entry,
      quota,
      resolvedTheme: 'dark',
      now,
      showEmails: false,
      canRefresh: true,
      codexResetting: false,
      onRefresh: () => {},
      onReset: async () => true,
      ...props,
    } as never)
  );

describe('compact card reset action', () => {
  test('Codex offers "Use a reset…" with the OpenAI choice note when resets exist', () => {
    const markup = render(codexEntry, codex(2));
    expect(markup).toContain('data-resets-use');
    expect(markup).toContain(i18n.t('quota_management.resets.use'));
    expect(markup).toContain(i18n.t('quota_management.resets.codex_choice_note'));
  });

  test('no reset action without resets', () => {
    expect(render(codexEntry, codex(0))).not.toContain('data-resets-use');
    expect(render(claudeEntry, claude(0))).not.toContain('data-resets-use');
  });

  test('a Codex reset in flight shows the busy confirm step and blocks refresh', () => {
    const markup = render(codexEntry, codex(2), { codexResetting: true });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain(i18n.t('quota_management.resets.using'));
    expect(markup).toMatch(/<button[^>]*disabled[^>]*aria-label="Refresh quota/);
  });

  test('Claude starts with a plain button and does not read grants until armed', () => {
    const markup = render(claudeEntry, claude(1));
    expect(markup).toContain('data-resets-use');
    expect(markup).not.toContain('data-resets-confirm');
  });

  test('an unresolved Claude claim stays reachable even without listed resets', () => {
    const unresolved = vi.spyOn(resetGrantOperations, 'hasUnresolved').mockReturnValue(true);
    spies.push(unresolved);
    const markup = render(claudeEntry, claude(0));
    expect(markup).toContain(i18n.t('quota_management.resets.chip_unresolved'));
    expect(markup).toContain(i18n.t('claude_reset.retry'));
    expect(markup).toContain('data-resets-use');
  });

  test('blocks the action for disabled credentials', () => {
    const markup = render(
      { ...codexEntry, file: { ...codexEntry.file, disabled: true } } as QuotaFileEntry,
      codex(2)
    );
    expect(markup).toMatch(/<button[^>]*disabled[^>]*data-resets-use/);
  });
});
