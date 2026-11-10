import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  providersFromClaudeFallback,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { useNotificationStore } from '@/stores';
import { sha256Hex } from '@/utils/apiKeyHash';
import { KeyProfileEditor } from './components/KeyProfileEditor';
import {
  RoutingProfilesModal,
  type RoutingProfilesModalProps,
} from './components/RoutingProfilesModal';
import { Select } from './components/Select';
import type { KeyProfilesState } from './hooks/useKeyProfiles';
import { buildKeyRows, chainSummary } from './keyProfilesModel';

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? createElement('section', { 'data-modal': true }, children, footer) : null,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RAW_ALPHA = 'sk-live-RAWKEY-alpha-000111';
const RAW_BETA = 'sk-live-RAWKEY-beta-000222';
const RAW_GAMMA = 'sk-live-RAWKEY-gamma-000333';
const RAW_KEYS = [RAW_ALPHA, RAW_BETA, RAW_GAMMA];

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

const models = { claude: ['claude-opus-5'], codex: ['gpt-6-astra', 'gpt-6-sol'] };

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

type ModalHook = RoutingProfilesModalProps['keyProfiles'];

/** Stands in for `useKeyProfiles`: alpha (aliased) and gamma on the default, beta with a profile. */
function makeKeyProfiles(
  state: RoutingProfilesState | null = profilesState(),
  overrides: Partial<KeyProfilesState> = {}
): ModalHook {
  const profileOf = (key: string) => state?.keys.find((row) => row.key === key)?.profile ?? null;
  const rows = state
    ? buildKeyRows(
        RAW_KEYS.map((key) => ({ key, profile: profileOf(key) })),
        [{ apiKeyHash: sha256Hex(RAW_ALPHA).toLowerCase(), alias: 'Laptop' }]
      )
    : [];
  return {
    state,
    rows,
    ttl: '1h',
    loading: false,
    saving: false,
    error: '',
    reload: vi.fn(),
    saveKeyProfile: vi.fn(async () => true),
    saveShared: vi.fn(async () => true),
    apiKeyConfigs: { claude: [], codex: [] },
    ...overrides,
  };
}

const showConfirmation = vi.fn();
let keyProfiles: ModalHook;
let renderer: ReactTestRenderer | undefined;
let props: Partial<RoutingProfilesModalProps>;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  keyProfiles = makeKeyProfiles();
  props = {};
  showConfirmation.mockReset();
  useNotificationStore.setState({ showConfirmation });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

const modal = () =>
  createElement(RoutingProfilesModal, {
    open: true,
    onClose: vi.fn(),
    keyProfiles,
    files,
    showEmails: false,
    models,
    ...props,
  });

async function mount() {
  await act(async () => {
    renderer = create(modal());
  });
}

async function rerender() {
  await act(async () => {
    renderer!.update(modal());
  });
}

const root = () => renderer!.root;
const text = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
const buttonIn = (node: ReactTestInstance, attr: string) =>
  node.findAllByType(Button).find((button) => button.props[attr]);
const defaultRow = () => root().find((node) => node.props['data-profile-default']);
const keyRows = () =>
  root().findAll((node) => node.type === 'li' && Boolean(node.props['data-profile-row']));
const editors = () => root().findAllByType(KeyProfileEditor);
const editorSave = () => buttonIn(editors()[0], 'data-key-profile-save')!;
const editorCancel = () =>
  editors()[0]
    .findAllByType(Button)
    .find((button) => text(button) === i18n.t('common.cancel'))!;
const addSelect = () => {
  const section = root().findAll((node) => node.props['data-profile-add']);
  return section.length ? section[0].findByType(Select) : undefined;
};

const click = async (button: ReactTestInstance | undefined) => {
  await act(async () => button!.props.onClick());
};

describe('routing profiles modal rows', () => {
  test('shows the default row and one row per key with its own profile', async () => {
    await mount();
    const t = i18n.t.bind(i18n);
    expect(text(defaultRow())).toContain('Default');
    expect(text(defaultRow())).toContain(chainSummary(shared(), files, false, t));
    const rows = keyRows();
    expect(rows).toHaveLength(1);
    expect(text(rows[0])).toContain(chainSummary(betaProfile(), files, false, t));
    expect(editors()).toHaveLength(0);
  });

  test('summaries and editors name API keys from the credentials and key configs', async () => {
    const apiCredentials = {
      claude: [],
      codex: [{ authIndex: 'codex-key-1', label: 'codex-apikey', baseUrl: '', disabled: false }],
    };
    const apiKeyConfigs = {
      claude: [],
      codex: [{ authIndex: 'codex-key-1', name: 'billing', masked: 'sk-c...9999', baseUrl: '' }],
    };
    const beta: RoutingProfile = {
      ...betaProfile(),
      providers: {
        ...betaProfile().providers,
        codex: {
          mode: 'api',
          apiCredential: 'codex-key-1',
          fallback: { target: 'off', mode: 'auto', mappings: [] },
        },
      },
    };
    keyProfiles = makeKeyProfiles(
      profilesState({ apiCredentials, keys: [{ key: RAW_BETA, profile: beta }] }),
      { apiKeyConfigs }
    );
    await mount();
    expect(text(keyRows()[0])).toContain('Codex: API key billing · sk-c...9999');

    await click(buttonIn(keyRows()[0], 'data-profile-edit'));
    expect(editors()[0].props.providersSupported).toBe(true);
    expect(editors()[0].props.apiKeys).toEqual({
      apiCredentials,
      providerConfigs: apiKeyConfigs,
    });
    await click(buttonIn(keyRows()[0], 'data-profile-edit'));

    await click(buttonIn(defaultRow(), 'data-profile-edit'));
    expect(editors()[0].props.apiKeys.providerConfigs).toBe(apiKeyConfigs);
  });

  test('an old backend reaches the editors as providersSupported: false', async () => {
    keyProfiles = makeKeyProfiles(profilesState({ providersSupported: false }));
    await mount();
    await click(buttonIn(defaultRow(), 'data-profile-edit'));
    expect(editors()[0].props.providersSupported).toBe(false);
  });

  test('the default row edits the shared profile and the TTL through saveShared', async () => {
    await mount();
    await click(buttonIn(defaultRow(), 'data-profile-edit'));
    const editor = editors()[0];
    expect(editor.props.variant).toBe('default');
    expect(editor.props.ttl).toBe('1h');
    expect(editor.props.readOnly).toBe(false);
    expect(editor.props.fallbackReadOnly).toBe(false);
    expect(editor.props.initial).toEqual(shared());

    await act(async () => editor.findAllByType(ToggleSwitch)[0].props.onChange(false));
    await click(editorSave());
    expect(keyProfiles.saveShared).toHaveBeenCalledWith(
      { ...shared(), sessionAffinity: false },
      undefined
    );
    expect(editors()).toHaveLength(0);

    await click(buttonIn(defaultRow(), 'data-profile-edit'));
    const ttl = editors()[0].find(
      (node) => node.type === 'input' && node.props['data-key-profile-ttl']
    );
    await act(async () => ttl.props.onChange({ target: { value: '24h' } }));
    await click(editorSave());
    expect(keyProfiles.saveShared).toHaveBeenLastCalledWith(shared(), '24h');
  });

  test('a failed shared save keeps the editor open', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { saveShared: vi.fn(async () => false) });
    await mount();
    await click(buttonIn(defaultRow(), 'data-profile-edit'));
    await act(async () => editors()[0].findAllByType(ToggleSwitch)[0].props.onChange(false));
    await click(editorSave());
    expect(editors()).toHaveLength(1);
  });

  test('a key row saves its profile through saveKeyProfile', async () => {
    await mount();
    await click(buttonIn(keyRows()[0], 'data-profile-edit'));
    const editor = editors()[0];
    expect(editor.props.variant).toBe('key');
    expect(editor.props.isNew).toBe(false);
    expect(editor.props.initial).toEqual(betaProfile());
    await act(async () => editor.findAllByType(ToggleSwitch)[0].props.onChange(false));
    await click(editorSave());
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledWith(RAW_BETA, {
      ...betaProfile(),
      sessionAffinity: false,
    });
    expect(editors()).toHaveLength(0);
  });

  test('only one editor is open at a time', async () => {
    await mount();
    await click(buttonIn(defaultRow(), 'data-profile-edit'));
    await click(buttonIn(keyRows()[0], 'data-profile-edit'));
    expect(editors()).toHaveLength(1);
    expect(editors()[0].props.variant).toBe('key');
    expect(buttonIn(defaultRow(), 'data-profile-edit')!.props['aria-expanded']).toBe(false);
  });

  test('a reset asks for confirmation and then saves null', async () => {
    await mount();
    await click(buttonIn(keyRows()[0], 'data-profile-edit'));
    await click(buttonIn(keyRows()[0], 'data-profile-reset'));
    expect(showConfirmation).toHaveBeenCalledTimes(1);
    // Nothing is written until the confirmation is accepted.
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();

    const options = showConfirmation.mock.calls[0][0];
    expect(options.variant).toBe('danger');
    for (const raw of RAW_KEYS) expect(JSON.stringify(options)).not.toContain(raw);
    await act(async () => options.onConfirm());
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledWith(RAW_BETA, null);
    expect(editors()).toHaveLength(0);
  });

  test('"+ Profile for a key" lists keys on the default and opens a new draft', async () => {
    await mount();
    const select = addSelect()!;
    expect(select.props.options.map((option: { label: string }) => option.label)).toEqual([
      'Laptop',
      keyProfiles.rows[2].masked,
    ]);
    await act(async () => select.props.onChange(sha256Hex(RAW_ALPHA).toLowerCase()));

    const editor = editors()[0];
    expect(editor.props.isNew).toBe(true);
    expect(editor.props.variant).toBe('key');
    expect(editor.props.initial).toEqual(shared());
    expect(editor.props.initial).not.toBe(keyProfiles.state!.shared);
    expect(text(root().find((node) => node.props['data-profile-draft']))).toContain('Laptop');

    await click(editorSave());
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledWith(RAW_ALPHA, shared());
    expect(editors()).toHaveLength(0);
  });

  test('"+" is hidden when every key has a profile', async () => {
    keyProfiles = makeKeyProfiles(
      profilesState({
        keys: RAW_KEYS.map((key) => ({ key, profile: betaProfile() })),
      })
    );
    await mount();
    expect(keyRows()).toHaveLength(3);
    expect(addSelect()).toBeUndefined();
  });

  test('shows a hint when no key has its own profile', async () => {
    keyProfiles = makeKeyProfiles(profilesState({ keys: [] }));
    await mount();
    expect(keyRows()).toHaveLength(0);
    expect(text(root().find((node) => node.props['data-routing-profiles-modal']))).toContain(
      'No key has its own profile yet.'
    );
  });
});

describe('routing profiles modal focus and navigation', () => {
  test('focus on a key on the default opens a new draft, and Cancel makes no call', async () => {
    props = { focus: RAW_ALPHA };
    await mount();
    const editor = editors()[0];
    expect(editor.props.isNew).toBe(true);
    expect(editor.props.initial).toEqual(shared());
    await click(editorCancel());
    expect(editors()).toHaveLength(0);
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();
    expect(keyProfiles.saveShared).not.toHaveBeenCalled();

    // A later render does not reopen the closed editor.
    keyProfiles = makeKeyProfiles();
    await rerender();
    expect(editors()).toHaveLength(0);
  });

  test('focus on a key with a profile opens its editor', async () => {
    props = { focus: RAW_BETA };
    await mount();
    const editor = editors()[0];
    expect(editor.props.isNew).toBe(false);
    expect(editor.props.initial).toEqual(betaProfile());
    expect(buttonIn(keyRows()[0], 'data-profile-edit')!.props['aria-expanded']).toBe(true);
  });

  test('focus waits for the profiles to finish loading', async () => {
    props = { focus: RAW_BETA };
    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await mount();
    expect(editors()).toHaveLength(0);
    keyProfiles = makeKeyProfiles();
    await rerender();
    expect(editors()).toHaveLength(1);
  });

  test('a focus on a key that is no longer listed opens no editor', async () => {
    props = { focus: 'sk-live-RAWKEY-deleted-000444' };
    await mount();
    expect(editors()).toHaveLength(0);
    expect(root().findAll((node) => node.props['data-profile-draft'])).toHaveLength(0);
  });

  test('closing and reopening applies the focus again', async () => {
    props = { focus: RAW_BETA };
    await mount();
    await click(editorCancel());
    props = { focus: RAW_BETA, open: false };
    await rerender();
    props = { focus: RAW_BETA };
    await rerender();
    expect(editors()).toHaveLength(1);
  });

  test('the back button appears only when opened from the Keys modal', async () => {
    await mount();
    expect(root().findAll((node) => node.props['data-profiles-back'])).toHaveLength(0);

    const onBackToKeys = vi.fn();
    props = { onBackToKeys };
    await rerender();
    const back = root()
      .findAllByType(Button)
      .find((button) => button.props['data-profiles-back'])!;
    expect(text(back)).toBe('← Back to keys');
    await click(back);
    expect(onBackToKeys).toHaveBeenCalledTimes(1);
  });
});

describe('routing profiles modal states', () => {
  test('supported: false keeps only the default row editable', async () => {
    keyProfiles = makeKeyProfiles(profilesState({ supported: false }));
    props = { focus: RAW_ALPHA };
    await mount();
    // A key on the default cannot get a new draft in this mode.
    expect(editors()).toHaveLength(0);
    const notes = root().findAll((node) => node.type === 'p' && node.props.role === 'note');
    expect(notes.map(text).join(' ')).toContain('read-only');
    expect(addSelect()).toBeUndefined();
    expect(buttonIn(keyRows()[0], 'data-profile-reset')).toBeUndefined();

    await click(buttonIn(keyRows()[0], 'data-profile-edit'));
    expect(editors()[0].props.readOnly).toBe(true);
    expect(editorSave().props.disabled).toBe(true);

    await click(buttonIn(defaultRow(), 'data-profile-edit'));
    expect(editors()[0].props.variant).toBe('default');
    expect(editors()[0].props.readOnly).toBe(false);
    // CPA ignores mode and fallback in this mode, so the default editor locks those only.
    expect(editors()[0].props.fallbackReadOnly).toBe(true);
    expect(
      editors()[0].findAll(
        (node) => node.type === 'p' && node.props['data-provider-routing-locked']
      )
    ).toHaveLength(2);
    await act(async () => editors()[0].findAllByType(ToggleSwitch)[0].props.onChange(false));
    await click(editorSave());
    expect(keyProfiles.saveShared).toHaveBeenCalledWith(
      { ...shared(), sessionAffinity: false },
      undefined
    );
  });

  test('Edit is disabled while the profiles reload unless that editor is open', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await mount();
    expect(buttonIn(defaultRow(), 'data-profile-edit')!.props.disabled).toBe(true);
    expect(buttonIn(keyRows()[0], 'data-profile-edit')!.props.disabled).toBe(true);
    expect(buttonIn(keyRows()[0], 'data-profile-reset')!.props.disabled).toBe(true);
    expect(addSelect()!.props.disabled).toBe(true);

    keyProfiles = makeKeyProfiles();
    await rerender();
    await click(buttonIn(keyRows()[0], 'data-profile-edit'));

    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await rerender();
    expect(buttonIn(keyRows()[0], 'data-profile-edit')!.props.disabled).toBe(false);
    expect(buttonIn(defaultRow(), 'data-profile-edit')!.props.disabled).toBe(true);
    expect(editors()[0].props.saving).toBe(true);
  });

  test('shows the loading and error states', async () => {
    keyProfiles = makeKeyProfiles(null, { loading: true });
    await mount();
    const body = () => root().find((node) => node.props['data-routing-profiles-modal']);
    expect(text(body())).toContain('Loading routing profiles');

    keyProfiles = makeKeyProfiles(profilesState(), { error: 'failed for bob@example.com' });
    await rerender();
    const alert = root().find((node) => node.type === 'div' && node.props.role === 'alert');
    expect(text(alert)).not.toContain('bob@example.com');
    await click(buttonIn(alert, 'onClick'));
    expect(keyProfiles.reload).toHaveBeenCalledTimes(1);
  });

  test('never renders a raw key in text, titles, or aria labels', async () => {
    props = { onBackToKeys: vi.fn() };
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
      const select = addSelect();
      if (select) {
        for (const raw of RAW_KEYS) expect(JSON.stringify(select.props.options)).not.toContain(raw);
      }
    };
    check();
    await click(buttonIn(defaultRow(), 'data-profile-edit'));
    check();
    await click(buttonIn(keyRows()[0], 'data-profile-edit'));
    check();
    await act(async () => addSelect()!.props.onChange(sha256Hex(RAW_GAMMA).toLowerCase()));
    expect(editors()[0].props.isNew).toBe(true);
    check();
  });
});
