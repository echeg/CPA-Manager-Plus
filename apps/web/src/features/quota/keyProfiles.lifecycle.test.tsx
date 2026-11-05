import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import {
  claudeFallbackApi,
  type ClaudeFallbackState,
} from '@/features/personal-quota-support/services/api/claudeFallback';
import {
  unsupportedRoutingProfiles,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { sha256Hex } from '@/utils/apiKeyHash';
import { FallbackSettingsEditor } from './components/FallbackSettingsEditor';
import { KeyProfileEditor } from './components/KeyProfileEditor';
import { QuotaSettingsBar } from './components/QuotaSettingsToolbar';
import { useKeyProfiles, type KeyProfilesState } from './hooks/useKeyProfiles';
import { useSubscriptionRouting } from './hooks/useSubscriptionRouting';
import { buildKeyRows, chainSummary } from './keyProfilesModel';
import { maskQuotaName } from './ledgerModel';

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? createElement('section', { 'data-modal': true }, children, footer) : null,
}));
vi.mock('./hooks/useKeyProfiles', () => ({ useKeyProfiles: vi.fn() }));
vi.mock('./hooks/useSubscriptionRouting', () => ({ useSubscriptionRouting: vi.fn() }));
vi.mock('./hooks/useCodexFastMode', () => ({
  useCodexFastMode: () => ({ enabled: false, saving: false, error: '', toggle: vi.fn() }),
}));
vi.mock('./hooks/useSubscriptionActivity', () => ({
  useSubscriptionActivity: () => ({ activity: [], activityState: 'ready' }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RAW_ALPHA = 'sk-live-RAWKEY-alpha-000111';
const RAW_BETA = 'sk-live-RAWKEY-beta-000222';
const RAW_KEYS = [RAW_ALPHA, RAW_BETA];

const files: AuthFileItem[] = [
  {
    name: 'claude-bob@example.com.json',
    email: 'bob@example.com',
    provider: 'claude',
    authIndex: 'claude-a',
  },
  {
    name: 'codex-alice@example.com.json',
    email: 'alice@example.com',
    provider: 'codex',
    authIndex: 'codex-a',
  },
];

const shared = (): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: { claude: 'claude-a' },
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  claudeFallback: {
    enabled: true,
    mode: 'auto',
    mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
  },
});

const betaProfile = (): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: { codex: 'codex-a' },
  selection: { primary: 'priority', tiebreak: 'fill-first' },
  claudeFallback: {
    enabled: false,
    mode: 'always',
    mappings: [{ from: 'claude-sonnet-*', to: 'gpt-6-sol' }],
  },
});

const profilesState = (overrides: Partial<RoutingProfilesState> = {}): RoutingProfilesState => ({
  supported: true,
  unsupportedBackend: false,
  shared: shared(),
  keys: [{ key: RAW_BETA, profile: betaProfile() }],
  selectionOptions: {
    narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
    pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
  },
  ...overrides,
});

const fallbackState = (): ClaudeFallbackState => ({
  supported: true,
  settings: shared().claudeFallback,
  models: { claude: ['claude-opus-5'], codex: ['gpt-6-astra', 'gpt-6-sol'] },
});

let keyProfiles: KeyProfilesState;
let renderer: ReactTestRenderer | undefined;

function makeKeyProfiles(
  state: RoutingProfilesState | null = profilesState(),
  overrides: Partial<KeyProfilesState> = {}
): KeyProfilesState {
  const rows = state
    ? buildKeyRows(
        [
          { key: RAW_ALPHA, profile: null },
          { key: RAW_BETA, profile: state.keys[0]?.profile ?? null },
        ],
        [{ apiKeyHash: sha256Hex(RAW_ALPHA).toLowerCase(), alias: 'Laptop' }]
      )
    : [];
  return {
    state,
    rows,
    count: rows.filter((row) => row.profile).length,
    total: rows.length,
    ttl: '1h',
    aliasesEditable: true,
    loading: false,
    saving: false,
    error: '',
    reload: vi.fn(),
    saveKeyProfile: vi.fn(async () => true),
    saveShared: vi.fn(async () => true),
    addKey: vi.fn(async () => ({ ok: true })),
    removeKey: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  keyProfiles = makeKeyProfiles();
  vi.mocked(useKeyProfiles).mockImplementation(() => keyProfiles);
  vi.mocked(useSubscriptionRouting).mockImplementation(
    () =>
      ({
        values: {
          strategy: 'round-robin',
          sessionAffinity: true,
          sessionAffinityTTL: '2h',
          preferredAccounts: {},
        },
        saving: false,
        error: '',
        saved: false,
        dirty: false,
        invalidTTL: false,
        blocked: false,
        options: [],
        slots: null,
        change: vi.fn(),
        save: vi.fn(),
        reload: vi.fn(),
      }) as unknown as ReturnType<typeof useSubscriptionRouting>
  );
  vi.spyOn(apiClient, 'getConnectionRevision').mockReturnValue(0);
  vi.spyOn(claudeFallbackApi, 'get').mockResolvedValue(fallbackState());
  vi.spyOn(claudeFallbackApi, 'save').mockImplementation(async (settings) => ({
    ...fallbackState(),
    settings,
  }));
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.mocked(useKeyProfiles).mockReset();
  vi.mocked(useSubscriptionRouting).mockReset();
});

const bar = (showEmails = false, disabled = false) =>
  createElement(QuotaSettingsBar, {
    disabled,
    files,
    showEmails,
    resolvedTheme: 'light',
  });

async function mount(showEmails = false) {
  await act(async () => {
    renderer = create(bar(showEmails));
  });
}

async function rerender(showEmails = false, disabled = false) {
  await act(async () => {
    renderer!.update(bar(showEmails, disabled));
  });
}

const root = () => renderer!.root;
const keysButton = () =>
  root()
    .findAllByType(Button)
    .find((button) => button.props['data-key-profiles']);
const modal = () => root().findAll((node) => node.props['data-key-profiles-modal']);
const keyRows = () => root().findAll((node) => node.type === 'li' && node.props['data-key-row']);
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
const toggleOf = (row: ReactTestInstance) =>
  row.findAllByType(Button).find((button) => button.props['data-key-toggle'])!;

async function openModal() {
  await act(async () => keysButton()!.props.onClick());
}

async function expandRow(index: number) {
  await act(async () => toggleOf(keyRows()[index]).props.onClick());
}

const resetButtons = () =>
  root()
    .findAllByType(Button)
    .filter((button) => button.props['data-key-reset']);

const editorSave = () =>
  root()
    .findByType(KeyProfileEditor)
    .findAllByType(Button)
    .find((button) => button.props['data-key-profile-save'])!;

describe('key profiles modal wiring', () => {
  test('passes the shared selection to the routing hook and shows the N/M button', async () => {
    await mount();
    expect(useSubscriptionRouting).toHaveBeenLastCalledWith(false, {
      supported: true,
      selection: shared().selection,
      selectionOptions: profilesState().selectionOptions,
      loading: false,
      failed: false,
      reload: keyProfiles.reload,
    });
    expect(text(keysButton()!)).toBe('Keys 1/2');
    expect(modal()).toHaveLength(0);
  });

  test('the button opens the modal and reloads the profiles', async () => {
    await mount();
    await openModal();
    expect(modal()).toHaveLength(1);
    expect(keyProfiles.reload).toHaveBeenCalledTimes(1);

    const rows = keyRows();
    expect(rows).toHaveLength(2);
    expect(text(rows[0])).toContain('Laptop');
    expect(text(rows[0])).toContain('Shared settings');
    expect(text(rows[1])).toContain('Own profile');

    const t = i18n.t.bind(i18n);
    const summaries = root().findAll((node) => node.type === 'p' && node.props['data-key-summary']);
    expect(text(summaries[0])).toBe(chainSummary(shared(), files, false, t));
    expect(text(summaries[1])).toBe(chainSummary(betaProfile(), files, false, t));
    expect(text(root().find((node) => node.props['data-key-profiles-shared']))).toContain(
      chainSummary(shared(), files, false, t)
    );
  });

  test('keeps the button while the profiles reload', async () => {
    await mount();
    // useKeyProfiles keeps the last loaded state while it reloads.
    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await rerender();
    expect(text(keysButton()!)).toBe('Keys 1/2');
  });

  test('a key editor cannot open from cached rows while the profiles reload', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await mount();
    await openModal();
    expect(toggleOf(keyRows()[1]).props.disabled).toBe(true);

    keyProfiles = makeKeyProfiles(profilesState());
    await rerender();
    expect(toggleOf(keyRows()[1]).props.disabled).toBe(false);
    await expandRow(1);

    // An open editor can still be collapsed during a later reload.
    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await rerender();
    expect(toggleOf(keyRows()[1]).props.disabled).toBe(false);
  });

  test('a failed first load locks the legacy strategy select', async () => {
    keyProfiles = makeKeyProfiles(null, { error: 'offline' });
    await mount();
    expect(useSubscriptionRouting).toHaveBeenLastCalledWith(
      false,
      expect.objectContaining({ supported: false, failed: true })
    );
  });

  test('editing and saving sends the draft for that key and collapses the editor', async () => {
    await mount();
    await openModal();
    await expandRow(1);
    const editor = root().findByType(KeyProfileEditor);
    expect(editor.props.models).toEqual(fallbackState().models);
    expect(editor.props.ttl).toBe('2h');
    expect(editor.props.variant).toBe('key');
    expect(editor.props.isNew).toBe(false);
    expect(editor.props.initial).toEqual(betaProfile());
    expect(editor.props.readOnly).toBe(false);

    await act(async () => editor.findAllByType(ToggleSwitch)[0].props.onChange(false));
    await act(async () => editorSave().props.onClick());

    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledWith(RAW_BETA, {
      ...betaProfile(),
      sessionAffinity: false,
    });
    expect(root().findAllByType(KeyProfileEditor)).toHaveLength(0);
  });

  test('a failed save keeps the editor open', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { saveKeyProfile: vi.fn(async () => false) });
    await mount();
    await openModal();
    await expandRow(1);
    await act(async () =>
      root().findByType(KeyProfileEditor).findAllByType(ToggleSwitch)[0].props.onChange(false)
    );
    await act(async () => editorSave().props.onClick());
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledTimes(1);
    expect(root().findAllByType(KeyProfileEditor)).toHaveLength(1);
  });

  test('a key without a profile opens a new draft copied from the shared settings', async () => {
    await mount();
    await openModal();
    await expandRow(0);
    const editor = root().findByType(KeyProfileEditor);
    expect(editor.props.isNew).toBe(true);
    expect(editor.props.initial).toEqual(shared());
    expect(editor.props.initial).not.toBe(keyProfiles.state!.shared);
    // Only a key with its own profile can go back to the shared settings.
    expect(resetButtons()).toHaveLength(0);
    await act(async () => editorSave().props.onClick());
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledWith(RAW_ALPHA, shared());
  });

  test('a reset to the shared settings saves null and collapses the editor', async () => {
    await mount();
    await openModal();
    expect(resetButtons()).toHaveLength(0);
    await expandRow(1);
    expect(resetButtons()).toHaveLength(1);
    await act(async () => resetButtons()[0].props.onClick());
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledWith(RAW_BETA, null);
    expect(root().findAllByType(KeyProfileEditor)).toHaveLength(0);
  });

  test('the reset is locked while saving, reloading, or read-only', async () => {
    for (const overrides of [{ saving: true }, { loading: true }]) {
      keyProfiles = makeKeyProfiles(profilesState());
      await mount();
      await openModal();
      await expandRow(1);
      keyProfiles = makeKeyProfiles(profilesState(), overrides);
      await rerender();
      expect(resetButtons()[0].props.disabled).toBe(true);
      await act(async () => renderer?.unmount());
    }
    keyProfiles = makeKeyProfiles(profilesState({ supported: false }));
    await mount();
    await openModal();
    await expandRow(1);
    expect(resetButtons()[0].props.disabled).toBe(true);
  });

  test('only one editor is open at a time', async () => {
    await mount();
    await openModal();
    await expandRow(0);
    await expandRow(1);
    expect(root().findAllByType(KeyProfileEditor)).toHaveLength(1);
    expect(toggleOf(keyRows()[0]).props['aria-expanded']).toBe(false);
    expect(toggleOf(keyRows()[1]).props['aria-expanded']).toBe(true);
  });

  test('a fallback save reloads the profiles, and the fallback loads once', async () => {
    await mount();
    const fallbackToggle = root()
      .findAllByType(ToggleSwitch)
      .find((toggle) => toggle.props.label === i18n.t('quota_management.fallback.title'))!;
    await act(async () => fallbackToggle.props.onChange(false));
    expect(claudeFallbackApi.save).toHaveBeenCalledWith({
      ...shared().claudeFallback,
      enabled: false,
    });
    expect(keyProfiles.reload).toHaveBeenCalledTimes(1);
    expect(claudeFallbackApi.get).toHaveBeenCalledTimes(1);
  });

  test('a failed fallback save does not reload the profiles', async () => {
    vi.mocked(claudeFallbackApi.save).mockRejectedValue(new Error('offline'));
    await mount();
    const fallbackToggle = root()
      .findAllByType(ToggleSwitch)
      .find((toggle) => toggle.props.label === i18n.t('quota_management.fallback.title'))!;
    await act(async () => fallbackToggle.props.onChange(false));
    expect(keyProfiles.reload).not.toHaveBeenCalled();
  });
});

describe('key profiles modal states and errors', () => {
  test('hides the button on a backend without /routing/profiles', async () => {
    keyProfiles = makeKeyProfiles(unsupportedRoutingProfiles());
    await mount();
    expect(keysButton()).toBeUndefined();
    expect(useSubscriptionRouting).toHaveBeenLastCalledWith(
      false,
      expect.objectContaining({ supported: false })
    );
  });

  test('hides the button until the first load, but shows it after a failed load', async () => {
    keyProfiles = makeKeyProfiles(null, { loading: true });
    await mount();
    expect(keysButton()).toBeUndefined();
    keyProfiles = makeKeyProfiles(null, { error: 'offline' });
    await rerender();
    expect(keysButton()).toBeDefined();
    await openModal();
    const alert = root().find((node) => node.type === 'div' && node.props.role === 'alert');
    expect(text(alert)).toContain('offline');
  });

  test('a disconnected panel disables the button and keeps the last counts', async () => {
    await mount();
    // useKeyProfiles keeps the state while disabled on the same connection.
    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await rerender(false, true);
    expect(useKeyProfiles).toHaveBeenLastCalledWith(true);
    expect(useSubscriptionRouting).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ loading: true })
    );
    expect(keysButton()!.props.disabled).toBe(true);
    expect(text(keysButton()!)).toBe('Keys 1/2');
  });

  test('is read-only when the backend reports supported: false', async () => {
    keyProfiles = makeKeyProfiles(profilesState({ supported: false }));
    await mount();
    await openModal();
    const notes = root().findAll((node) => node.type === 'p' && node.props.role === 'note');
    expect(notes.map(text).join(' ')).toContain('read-only');
    await expandRow(1);
    expect(root().findByType(KeyProfileEditor).props.readOnly).toBe(true);
    expect(editorSave().props.disabled).toBe(true);
  });

  test('shows the 400 and 422 messages', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), {
      error: i18n.t('quota_management.key_profiles.errors.unknown_key'),
    });
    await mount();
    await openModal();
    const alert = () => root().find((node) => node.type === 'div' && node.props.role === 'alert');
    expect(text(alert())).toContain('This key was removed on the Config page');

    keyProfiles = makeKeyProfiles(profilesState(), {
      error: 'routing.key-profiles.ab12cd34ef56.selection.primary: unknown slot "bogus"',
    });
    await rerender();
    expect(text(alert())).toContain('ab12cd34ef56.selection.primary: unknown slot');
  });

  test('masks account names when emails are hidden', async () => {
    await mount(false);
    await openModal();
    const masked = text(modal()[0]);
    expect(masked).not.toContain('bob@example.com');
    expect(masked).toContain(maskQuotaName('claude-bob@example.com.json'));
    await rerender(true);
    expect(text(modal()[0])).toContain('claude-bob@example.com.json');
  });

  test('masks emails in an error message when emails are hidden', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { error: 'failed for bob@example.com' });
    await mount(false);
    await openModal();
    const alert = root().find((node) => node.type === 'div' && node.props.role === 'alert');
    expect(text(alert)).not.toContain('bob@example.com');
  });

  test('shows the empty and loading states', async () => {
    keyProfiles = { ...makeKeyProfiles(profilesState({ keys: [] })), rows: [], total: 0 };
    await mount();
    await openModal();
    expect(text(modal()[0])).toContain('no client API keys');

    keyProfiles = makeKeyProfiles(null, { loading: true });
    await rerender();
    expect(text(modal()[0])).toContain('Loading routing profiles');
  });

  test('never renders a raw key in text, titles, or aria labels', async () => {
    await mount();
    await openModal();
    const check = () => {
      const json = JSON.stringify(renderer!.toJSON());
      const labels = root()
        .findAll((node) => typeof node.type === 'string')
        .flatMap((node) => [node.props.title, node.props['aria-label']])
        .filter((value): value is string => typeof value === 'string');
      for (const raw of RAW_KEYS) {
        expect(json).not.toContain(raw);
        for (const label of labels) expect(label).not.toContain(raw);
      }
    };
    check();
    await expandRow(0);
    expect(root().findAllByType(FallbackSettingsEditor)).toHaveLength(1);
    check();
    await expandRow(1);
    check();
  });
});
