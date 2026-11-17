import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import { authFilesApi } from '@/features/personal-quota-support/services/api/authFiles';
import {
  readClaudeResetGrants,
  type AnthropicResetGrant,
  type AnthropicResetGrantStatus,
} from '@/features/personal-quota-support/services/api/claudeResetGrants';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { ClaudeLedgerResetsDrawer } from './components/QuotaLedgerResets';
import { useClaudeResetGrants } from './providers/claude/ClaudeResetGrants';
import { resetGrantOperations } from './providers/claude/resetGrantOperations';

vi.mock('@/features/personal-quota-support/services/api/claudeResetGrants', async (original) => ({
  ...(await original<
    typeof import('@/features/personal-quota-support/services/api/claudeResetGrants')
  >()),
  readClaudeResetGrants: vi.fn(),
}));

// The real store persists to localStorage, which the node test environment lacks.
vi.mock('@/features/personal-quota-support/stores/useAuthStore', () => {
  const auth = { connectionStatus: 'connected' };
  const useAuthStore = (selector: (state: typeof auth) => unknown) => selector(auth);
  useAuthStore.getState = () => auth;
  return { useAuthStore };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 24 * 60 * 60 * 1000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const grant = (overrides: Partial<AnthropicResetGrant>): AnthropicResetGrant => ({
  id: 'grant',
  label: 'Launch reset',
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: iso(-DAY),
  endsAt: iso(30 * DAY),
  clears: ['five_hour', 'seven_day'],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  ...overrides,
});
const status = (grants: AnthropicResetGrant[]): AnthropicResetGrantStatus => ({
  eligible: true,
  ineligibleReason: null,
  atLimit: true,
  grants,
  nextGrantId: 'B',
  weeklyResetsAt: null,
  cooldownUntil: null,
});
const twoUsable = () => status([grant({ id: 'A' }), grant({ id: 'B', endsAt: iso(60 * DAY) })]);

const file: AuthFileItem = { name: 'claude-a.json', type: 'claude', authIndex: '1' };
let hook: ReturnType<typeof useClaudeResetGrants>;
const capture = (value: typeof hook) => {
  hook = value;
};
let renderer: ReactTestRenderer | undefined;

function Harness({ refreshToken }: { refreshToken: number }) {
  capture(useClaudeResetGrants(file, true, false, refreshToken, () => {}));
  return null;
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(Harness, { refreshToken: 0 }));
  });
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  vi.spyOn(apiClient, 'getConnectionRevision').mockReturnValue(0);
  vi.mocked(readClaudeResetGrants).mockResolvedValue(twoUsable());
  vi.spyOn(resetGrantOperations, 'inspect').mockReturnValue(undefined);
  vi.spyOn(resetGrantOperations, 'run').mockResolvedValue({ code: 'reset', unresolved: false });
  vi.spyOn(authFilesApi, 'resetCooldown').mockResolvedValue({
    status: 'ok',
    auth_index: '1',
    models: [],
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

describe('useClaudeResetGrants grant choice', () => {
  test('spends the chosen grant', async () => {
    await mount();
    expect(hook.choices?.map((choice) => choice.grant.id)).toEqual(['A', 'B']);
    await act(async () => hook.choose('A'));
    expect(hook.selectedGrant?.id).toBe('A');
    await act(async () => hook.execute());
    expect(resetGrantOperations.run).toHaveBeenCalledWith(expect.any(String), '1', 'A');
  });

  test('spends the recommended grant without a choice', async () => {
    await mount();
    expect(hook.selectedGrant?.id).toBe('B');
    await act(async () => hook.execute());
    expect(resetGrantOperations.run).toHaveBeenCalledWith(expect.any(String), '1', 'B');
  });

  test('falls back to the default when a refresh empties the chosen grant', async () => {
    await mount();
    await act(async () => hook.choose('A'));
    expect(hook.selectedGrant?.id).toBe('A');
    vi.mocked(readClaudeResetGrants).mockResolvedValue(
      status([grant({ id: 'A', resetsLeft: 0 }), grant({ id: 'B', endsAt: iso(60 * DAY) })])
    );
    await act(async () => renderer!.update(createElement(Harness, { refreshToken: 1 })));
    expect(hook.selectedGrant?.id).toBe('B');
    expect(hook.choices?.map((choice) => choice.grant.id)).toEqual(['B']);
  });

  test('a pending claim hides the choices and pins its grant', async () => {
    vi.mocked(resetGrantOperations.inspect).mockReturnValue({
      grantId: 'C',
      organization: 'org',
      requestId: 'request',
      createdAt: Date.now(),
    });
    await mount();
    expect(hook.choices).toBeUndefined();
    expect(hook.buttonLabel).toBe('retry');
    await act(async () => hook.choose('A'));
    await act(async () => hook.execute());
    expect(resetGrantOperations.run).toHaveBeenCalledWith(expect.any(String), '1', 'C');
  });

  test('choose(undefined) restores the default', async () => {
    await mount();
    await act(async () => hook.choose('A'));
    await act(async () => hook.choose(undefined));
    expect(hook.selectedGrant?.id).toBe('B');
    await act(async () => hook.execute());
    expect(resetGrantOperations.run).toHaveBeenCalledWith(expect.any(String), '1', 'B');
  });

  test('ignores a choice that is not a usable grant', async () => {
    vi.mocked(readClaudeResetGrants).mockResolvedValue(
      status([grant({ id: 'A', paused: true }), grant({ id: 'B', endsAt: iso(60 * DAY) })])
    );
    await mount();
    expect(hook.choices?.find((choice) => choice.grant.id === 'A')?.usable).toBe(false);
    await act(async () => hook.choose('A'));
    expect(hook.selectedGrant?.id).toBe('B');
  });
});

describe('Ledger drawer grant picker', () => {
  const onBusyChange = vi.fn();
  const drawer = (props: { loading?: boolean; refreshToken?: number } = {}) =>
    createElement(ClaudeLedgerResetsDrawer, {
      id: 'resets',
      inventory: {
        items: [
          { id: 'A', expiresAtMs: null, label: 'Full reset', left: 1 },
          { id: 'B', expiresAtMs: null, label: 'Fable reset', left: 1 },
        ],
      },
      loading: props.loading ?? false,
      showEmails: true,
      now: Date.now(),
      file,
      refreshToken: props.refreshToken ?? 0,
      enabled: true,
      disabled: false,
      displayName: 'claude-a',
      onRefresh: () => {},
      onBusyChange,
    });
  const find = (match: (node: ReactTestInstance) => boolean) => renderer!.root.find(match);
  const useButton = () =>
    find((node) => node.type === 'button' && node.props['data-resets-use'] === '');
  const radio = (id: string) => find((node) => node.type === 'input' && node.props.value === id);
  const confirmButton = () =>
    find((node) => node.type === 'button' && String(node.props.className).includes('btn-primary'));
  const text = () => JSON.stringify(renderer!.toJSON());

  beforeEach(() => {
    vi.mocked(readClaudeResetGrants).mockResolvedValue(
      status([
        grant({ id: 'A', label: 'Full reset' }),
        grant({ id: 'B', label: 'Fable reset', endsAt: iso(60 * DAY) }),
      ])
    );
  });

  test('a picked radio drives the consequence and the spent grant', async () => {
    await act(async () => {
      renderer = create(drawer());
    });
    act(() => useButton().props.onClick());
    expect(radio('B').props.checked).toBe(true);
    expect(text()).toContain('Spends 1 reset from Fable reset');
    act(() => radio('A').props.onChange());
    expect(radio('A').props.checked).toBe(true);
    expect(text()).toContain('Spends 1 reset from Full reset');
    await act(async () => confirmButton().props.onClick());
    expect(resetGrantOperations.run).toHaveBeenCalledWith(expect.any(String), '1', 'A');
  });

  test('the list locks while the claim is in flight', async () => {
    let finish!: (value: Awaited<ReturnType<typeof resetGrantOperations.run>>) => void;
    vi.mocked(resetGrantOperations.run).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await act(async () => {
      renderer = create(drawer());
    });
    act(() => useButton().props.onClick());
    act(() => radio('A').props.onChange());
    await act(async () => confirmButton().props.onClick());
    expect(find((node) => node.type === 'fieldset').props.disabled).toBe(true);
    expect(text()).toContain('Spends 1 reset from Full reset');
    await act(async () => {
      finish({ code: 'reset', unresolved: false });
    });
    expect(resetGrantOperations.run).toHaveBeenCalledWith(expect.any(String), '1', 'A');
  });

  test('a refresh during the confirm step does not keep the pick for the next open', async () => {
    await act(async () => {
      renderer = create(drawer());
    });
    act(() => useButton().props.onClick());
    act(() => radio('A').props.onChange());
    expect(radio('A').props.checked).toBe(true);
    // A row refresh hides the footer without Cancel, then a fresh read brings it back.
    await act(async () => renderer!.update(drawer({ loading: true })));
    await act(async () => renderer!.update(drawer({ refreshToken: 1 })));
    act(() => useButton().props.onClick());
    expect(radio('B').props.checked).toBe(true);
    expect(text()).toContain('Spends 1 reset from Fable reset');
  });
});
