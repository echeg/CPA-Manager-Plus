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
  claudeFallbackOf,
  providersFromClaudeFallback,
  unsupportedRoutingProfiles,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { sha256Hex } from '@/utils/apiKeyHash';
import { ClaudeFallbackControl } from './components/ClaudeFallbackControl';
import { ClientKeysModal } from './components/ClientKeysModal';
import { KeyProfileEditor } from './components/KeyProfileEditor';
import { QuotaSettingsBar } from './components/QuotaSettingsToolbar';
import { RoutingProfilesModal } from './components/RoutingProfilesModal';
import { Select } from './components/Select';
import { useClaudeFallback } from './hooks/useClaudeFallback';
import { useKeyProfiles, type KeyProfilesState } from './hooks/useKeyProfiles';
import { useSubscriptionRouting } from './hooks/useSubscriptionRouting';
import { buildKeyRows } from './keyProfilesModel';

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? createElement('section', { 'data-modal': true }, children, footer) : null,
}));
vi.mock('./hooks/useKeyProfiles', () => ({ useKeyProfiles: vi.fn() }));
vi.mock('./hooks/useSubscriptionRouting', () => ({ useSubscriptionRouting: vi.fn() }));
vi.mock('./hooks/useClaudeFallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/useClaudeFallback')>();
  return { useClaudeFallback: vi.fn(actual.useClaudeFallback) };
});
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
  providers: providersFromClaudeFallback({
    enabled: true,
    mode: 'auto',
    mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
  }),
});

const betaProfile = (): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: { codex: 'codex-a' },
  selection: { primary: 'priority', tiebreak: 'fill-first' },
  providers: providersFromClaudeFallback({
    enabled: false,
    mode: 'always',
    mappings: [{ from: 'claude-sonnet-*', to: 'gpt-6-sol' }],
  }),
});

const profilesState = (overrides: Partial<RoutingProfilesState> = {}): RoutingProfilesState => ({
  supported: true,
  unsupportedBackend: false,
  providersSupported: true,
  apiCredentials: { claude: [], codex: [] },
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
  settings: claudeFallbackOf(shared()),
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

const bar = (disabled = false) =>
  createElement(QuotaSettingsBar, {
    disabled,
    files,
    showEmails: false,
    resolvedTheme: 'light',
  });

async function mount() {
  await act(async () => {
    renderer = create(bar());
  });
}

async function rerender(disabled = false) {
  await act(async () => {
    renderer!.update(bar(disabled));
  });
}

const root = () => renderer!.root;
const buttonWith = (attr: string, scope: ReactTestInstance = root()) =>
  scope.findAllByType(Button).find((button) => button.props[attr]);
const profilesButton = () => buttonWith('data-open-profiles');
const keysButton = () => buttonWith('data-open-keys');
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
const profilesModal = () => root().findByType(RoutingProfilesModal);
const keysModal = () => root().findByType(ClientKeysModal);
const keyRows = () =>
  root().findAll((node) => node.type === 'li' && node.props['data-client-key-row']);
const editors = () => root().findAllByType(KeyProfileEditor);

async function click(button: ReactTestInstance | undefined) {
  await act(async () => button!.props.onClick());
}

/** The reload a navigation starts: loading, then the fresh state. */
async function finishReload(state: RoutingProfilesState | null = profilesState()) {
  keyProfiles = makeKeyProfiles(state, { loading: true });
  await rerender();
  keyProfiles = makeKeyProfiles(state);
  await rerender();
}

describe('quota settings bar on a backend with /routing/profiles', () => {
  test('renders the slim toolbar with Profiles and Keys · N', async () => {
    await mount();
    const toolbar = root().find((node) => node.props['data-quota-settings']);
    expect(toolbar.props['data-toolbar']).toBe('slim');
    expect(text(profilesButton()!)).toBe('Profiles');
    expect(text(keysButton()!)).toBe('Keys · 2');
    expect(profilesButton()!.props.disabled).toBe(false);
    expect(keysButton()!.props.disabled).toBe(false);
    // The shared routing controls live in the Profiles modal now.
    expect(buttonWith('data-routing-save')).toBeUndefined();
    expect(root().findAllByType(ClaudeFallbackControl)).toHaveLength(0);
    expect(root().findAllByType(Select)).toHaveLength(0);
    // The fallback hook only supplies the editors' models; nothing reloads after its saves.
    expect(vi.mocked(useClaudeFallback).mock.calls.every((args) => args.length === 1)).toBe(true);
    expect(root().findAll((node) => node.props['data-last-selected'] === 'codex')).not.toHaveLength(
      0
    );
    expect(profilesModal().props.open).toBe(false);
    expect(keysModal().props.open).toBe(false);
  });

  test('stays slim with supported: false', async () => {
    keyProfiles = makeKeyProfiles(profilesState({ supported: false }));
    await mount();
    expect(text(keysButton()!)).toBe('Keys · 2');
    expect(profilesButton()!.props.disabled).toBe(false);
    expect(buttonWith('data-routing-save')).toBeUndefined();
  });

  test('disables both buttons before the first load and enables them after a failure', async () => {
    keyProfiles = makeKeyProfiles(null, { loading: true });
    await mount();
    expect(profilesButton()!.props.disabled).toBe(true);
    expect(keysButton()!.props.disabled).toBe(true);
    expect(buttonWith('data-routing-save')).toBeUndefined();

    keyProfiles = makeKeyProfiles(null, { error: 'offline' });
    await rerender();
    expect(profilesButton()!.props.disabled).toBe(false);
    expect(keysButton()!.props.disabled).toBe(false);
    await click(keysButton());
    const alert = root().find((node) => node.type === 'div' && node.props.role === 'alert');
    expect(text(alert)).toContain('offline');
  });

  test('a disconnected panel disables both buttons and keeps the last count', async () => {
    await mount();
    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await rerender(true);
    expect(useKeyProfiles).toHaveBeenLastCalledWith(true);
    expect(profilesButton()!.props.disabled).toBe(true);
    expect(keysButton()!.props.disabled).toBe(true);
    expect(text(keysButton()!)).toBe('Keys · 2');
  });

  test('each button opens its modal and reloads the profiles', async () => {
    await mount();
    await click(profilesButton());
    expect(profilesModal().props.open).toBe(true);
    expect(keysModal().props.open).toBe(false);
    expect(profilesModal().props.onBackToKeys).toBeUndefined();
    expect(profilesModal().props.focus).toBeUndefined();
    expect(profilesModal().props.models).toEqual(fallbackState().models);
    expect(keyProfiles.reload).toHaveBeenCalledTimes(1);

    await act(async () => profilesModal().props.onClose());
    expect(profilesModal().props.open).toBe(false);

    await click(keysButton());
    expect(keysModal().props.open).toBe(true);
    expect(profilesModal().props.open).toBe(false);
    expect(keyRows()).toHaveLength(2);
    expect(keyProfiles.reload).toHaveBeenCalledTimes(2);
  });

  test('Configure opens the Profiles modal on that key, and Back returns to the keys', async () => {
    await mount();
    await click(keysButton());
    await click(buttonWith('data-client-key-configure', keyRows()[1]));
    expect(keysModal().props.open).toBe(false);
    expect(profilesModal().props.open).toBe(true);
    expect(keyProfiles.reload).toHaveBeenCalledTimes(2);
    // The focus waits for the reload, so the editor does not copy the cached rows.
    expect(profilesModal().props.focus).toBeUndefined();
    expect(editors()).toHaveLength(0);

    await finishReload();
    expect(profilesModal().props.focus).toBe(RAW_BETA);
    expect(editors()).toHaveLength(1);
    expect(editors()[0].props.isNew).toBe(false);
    expect(editors()[0].props.initial).toEqual(betaProfile());

    await click(buttonWith('data-profiles-back'));
    expect(profilesModal().props.open).toBe(false);
    expect(keysModal().props.open).toBe(true);
    // finishReload installed a fresh hook stub, so Back is its first reload.
    expect(keyProfiles.reload).toHaveBeenCalledTimes(1);
    expect(profilesModal().props.onBackToKeys).toBeUndefined();
    expect(profilesModal().props.focus).toBeUndefined();
  });

  test('choosing "Own profile" opens a new draft for a key on the default', async () => {
    await mount();
    await click(keysButton());
    const select = keyRows()[0].findByType(Select);
    await act(async () => select.props.onChange('own'));
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();
    expect(profilesModal().props.open).toBe(true);

    await finishReload();
    expect(editors()).toHaveLength(1);
    expect(editors()[0].props.isNew).toBe(true);
    expect(editors()[0].props.initial).toEqual(shared());
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();
  });

  test('the toolbar Profiles button opens the modal without a focus or Back', async () => {
    await mount();
    await click(keysButton());
    await click(buttonWith('data-client-key-configure', keyRows()[1]));
    await act(async () => profilesModal().props.onClose());
    await click(profilesButton());
    await finishReload();
    expect(profilesModal().props.focus).toBeUndefined();
    expect(profilesModal().props.onBackToKeys).toBeUndefined();
    expect(editors()).toHaveLength(0);
  });

  test('never renders a raw key in text, titles, or aria labels', async () => {
    await mount();
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
    await click(keysButton());
    check();
    await click(buttonWith('data-client-key-configure', keyRows()[1]));
    await finishReload();
    check();
  });
});

describe('quota settings bar on a backend without /routing/profiles', () => {
  test('renders the legacy toolbar with no Profiles, no Keys and no modals', async () => {
    keyProfiles = makeKeyProfiles(unsupportedRoutingProfiles());
    await mount();
    const toolbar = root().find((node) => node.props['data-quota-settings']);
    expect(toolbar.props['data-toolbar']).toBeUndefined();
    expect(profilesButton()).toBeUndefined();
    expect(keysButton()).toBeUndefined();
    expect(buttonWith('data-routing-save')).toBeDefined();
    expect(root().findAllByType(ClaudeFallbackControl)).toHaveLength(1);
    expect(root().findAllByType(RoutingProfilesModal)).toHaveLength(0);
    expect(root().findAllByType(ClientKeysModal)).toHaveLength(0);
    expect(useSubscriptionRouting).toHaveBeenLastCalledWith(false);
  });

  test('a legacy fallback toggle saves without reloading the key profiles', async () => {
    keyProfiles = makeKeyProfiles(unsupportedRoutingProfiles());
    await mount();
    const toggle = root()
      .findAll((node) => node.props['data-switch'] === 'claude-fallback')[0]
      .findByType(ToggleSwitch);
    await act(async () => toggle.props.onChange(true));
    expect(claudeFallbackApi.save).toHaveBeenCalledTimes(1);
    expect(keyProfiles.reload).not.toHaveBeenCalled();
    expect(vi.mocked(useClaudeFallback).mock.calls.every((args) => args.length === 1)).toBe(true);
  });
});
