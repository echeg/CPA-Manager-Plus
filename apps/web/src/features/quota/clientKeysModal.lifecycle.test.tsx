import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { Button } from '@/components/ui/Button';
import type {
  RoutingProfile,
  RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { useNotificationStore } from '@/stores';
import { sha256Hex } from '@/utils/apiKeyHash';
import { copyToClipboard } from '@/utils/clipboard';
import { ClientKeysModal, type ClientKeysModalProps } from './components/ClientKeysModal';
import { Select } from './components/Select';
import type { KeyProfilesState } from './hooks/useKeyProfiles';
import { buildKeyRows, chainSummary } from './keyProfilesModel';

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? createElement('section', { 'data-modal': true }, children, footer) : null,
}));
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }));
vi.mock('@/utils/apiKeyGenerator', () => ({
  generateClientKey: () => 'sk-GENERATED-RAWKEY-0123456789',
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RAW_ALPHA = 'sk-live-RAWKEY-alpha-000111';
const RAW_BETA = 'sk-live-RAWKEY-beta-000222';
const RAW_NEW = 'sk-live-RAWKEY-new-000999';
const RAW_GENERATED = 'sk-GENERATED-RAWKEY-0123456789';
const RAW_KEYS = [RAW_ALPHA, RAW_BETA, RAW_NEW, RAW_GENERATED];

const files: AuthFileItem[] = [
  {
    name: 'claude-bob@example.com.json',
    email: 'bob@example.com',
    provider: 'claude',
    authIndex: 'claude-a',
  },
];

const shared = (): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: { claude: 'claude-a' },
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  claudeFallback: { enabled: false, mode: 'auto', mappings: [] },
});

const betaProfile = (): RoutingProfile => ({
  sessionAffinity: false,
  preferredAccounts: {},
  selection: { primary: 'priority', tiebreak: 'fill-first' },
  claudeFallback: { enabled: false, mode: 'auto', mappings: [] },
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

type ModalHook = ClientKeysModalProps['keyProfiles'];

/** Stands in for `useKeyProfiles`: alpha (aliased) on the default, beta with its own profile. */
function makeKeyProfiles(
  state: RoutingProfilesState | null = profilesState(),
  overrides: Partial<KeyProfilesState> = {},
  keys: string[] = [RAW_ALPHA, RAW_BETA]
): ModalHook {
  const profileOf = (key: string) => state?.keys.find((row) => row.key === key)?.profile ?? null;
  const rows = state
    ? buildKeyRows(
        keys.map((key) => ({ key, profile: profileOf(key) })),
        [{ apiKeyHash: sha256Hex(RAW_ALPHA).toLowerCase(), alias: 'Laptop' }]
      )
    : [];
  return {
    state,
    rows,
    total: rows.length,
    aliasesEditable: true,
    loading: false,
    saving: false,
    error: '',
    reload: vi.fn(),
    saveKeyProfile: vi.fn(async () => true),
    addKey: vi.fn(async () => ({ ok: true })),
    removeKey: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

const showConfirmation = vi.fn();
let keyProfiles: ModalHook;
let renderer: ReactTestRenderer | undefined;
let onOpenProfiles: ReturnType<typeof vi.fn<(key: string) => void>>;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  keyProfiles = makeKeyProfiles();
  onOpenProfiles = vi.fn<(key: string) => void>();
  showConfirmation.mockReset();
  vi.mocked(copyToClipboard).mockReset().mockResolvedValue(true);
  useNotificationStore.setState({ showConfirmation });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

const modal = () =>
  createElement(ClientKeysModal, {
    open: true,
    onClose: vi.fn(),
    keyProfiles,
    files,
    showEmails: false,
    onOpenProfiles,
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
const byAttr = (attr: string) => root().find((node) => Boolean(node.props[attr]));
const buttonIn = (node: ReactTestInstance, attr: string) =>
  node.findAllByType(Button).find((button) => button.props[attr]);
const keyRows = () =>
  root().findAll((node) => node.type === 'li' && Boolean(node.props['data-client-key-row']));
const modeSelect = (row: ReactTestInstance) => row.findByType(Select);
const keyInput = () =>
  root().find((node) => node.type === 'input' && node.props['data-client-key-input']);
const aliasInput = () =>
  root().find((node) => node.type === 'input' && node.props['data-client-key-alias']);
const addButton = () => buttonIn(byAttr('data-client-key-add'), 'data-client-key-submit')!;

const click = async (button: ReactTestInstance | undefined) => {
  await act(async () => button!.props.onClick());
};
const type = async (input: ReactTestInstance, value: string) => {
  await act(async () => input.props.onChange({ target: { value } }));
};
const confirmLast = async () => {
  const options = showConfirmation.mock.calls[showConfirmation.mock.calls.length - 1][0];
  await act(async () => options.onConfirm());
};

describe('client keys modal rows', () => {
  test('rows show the alias or the mask, the profile choice and the summary', async () => {
    await mount();
    const t = i18n.t.bind(i18n);
    const rows = keyRows();
    expect(rows).toHaveLength(2);
    expect(text(rows[0])).toContain('Laptop');
    expect(text(rows[1])).toContain(keyProfiles.rows[1].masked);
    expect(modeSelect(rows[0]).props.value).toBe('default');
    expect(modeSelect(rows[1]).props.value).toBe('own');
    expect(text(rows[0])).toContain(chainSummary(shared(), files, false, t));
    expect(text(rows[1])).toContain(chainSummary(betaProfile(), files, false, t));
    // Configure only on the key with its own profile.
    expect(buttonIn(rows[0], 'data-client-key-configure')).toBeUndefined();
    await click(buttonIn(rows[1], 'data-client-key-configure'));
    expect(onOpenProfiles).toHaveBeenCalledExactlyOnceWith(RAW_BETA);
  });

  test('"Own profile" opens the Profiles modal and writes nothing', async () => {
    await mount();
    await act(async () => modeSelect(keyRows()[0]).props.onChange('own'));
    expect(onOpenProfiles).toHaveBeenCalledExactlyOnceWith(RAW_ALPHA);
    expect(showConfirmation).not.toHaveBeenCalled();
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();
  });

  test('"Default" asks for confirmation, then resets the key profile', async () => {
    await mount();
    await act(async () => modeSelect(keyRows()[1]).props.onChange('default'));
    expect(showConfirmation).toHaveBeenCalledTimes(1);
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();
    const options = showConfirmation.mock.calls[0][0];
    for (const raw of RAW_KEYS) expect(JSON.stringify(options)).not.toContain(raw);
    await confirmLast();
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledExactlyOnceWith(RAW_BETA, null);
    expect(onOpenProfiles).not.toHaveBeenCalled();
  });

  test('choosing the current mode does nothing', async () => {
    await mount();
    await act(async () => modeSelect(keyRows()[0]).props.onChange('default'));
    await act(async () => modeSelect(keyRows()[1]).props.onChange('own'));
    expect(showConfirmation).not.toHaveBeenCalled();
    expect(onOpenProfiles).not.toHaveBeenCalled();
  });

  test('delete after confirmation removes the raw key', async () => {
    await mount();
    await click(buttonIn(keyRows()[0], 'data-client-key-delete'));
    expect(keyProfiles.removeKey).not.toHaveBeenCalled();
    const options = showConfirmation.mock.calls[0][0];
    expect(options.variant).toBe('danger');
    expect(options.message).toContain('Laptop');
    for (const raw of RAW_KEYS) expect(JSON.stringify(options)).not.toContain(raw);
    await confirmLast();
    expect(keyProfiles.removeKey).toHaveBeenCalledExactlyOnceWith(RAW_ALPHA);
  });

  test('a cancelled delete makes no call', async () => {
    await mount();
    await click(buttonIn(keyRows()[0], 'data-client-key-delete'));
    await act(async () => showConfirmation.mock.calls[0][0].onCancel?.());
    expect(keyProfiles.removeKey).not.toHaveBeenCalled();
  });

  test('a delete alias warning is shown', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), {
      removeKey: vi.fn(async () => ({ ok: true, aliasWarning: 'alias left behind' })),
    });
    await mount();
    await click(buttonIn(keyRows()[0], 'data-client-key-delete'));
    await confirmLast();
    expect(text(byAttr('data-client-keys-warning'))).toBe('alias left behind');
  });

  test('the last key cannot be deleted', async () => {
    keyProfiles = makeKeyProfiles(profilesState({ keys: [] }), {}, [RAW_ALPHA]);
    await mount();
    const remove = buttonIn(keyRows()[0], 'data-client-key-delete')!;
    expect(remove.props.disabled).toBe(true);
    expect(remove.props.title).toBe('The last client key cannot be deleted.');
    expect(text(byAttr('data-client-keys-last'))).toBe('The last client key cannot be deleted.');
  });

  test('supported: false disables the profile choice but not add or delete', async () => {
    keyProfiles = makeKeyProfiles(profilesState({ supported: false }));
    await mount();
    for (const row of keyRows()) expect(modeSelect(row).props.disabled).toBe(true);
    const notes = root().findAll((node) => node.type === 'p' && node.props.role === 'note');
    expect(notes.map(text).join(' ')).toContain('read-only');
    expect(buttonIn(keyRows()[0], 'data-client-key-delete')!.props.disabled).toBe(false);
    await type(keyInput(), RAW_NEW);
    expect(addButton().props.disabled).toBe(false);
  });

  test('controls are disabled while the profiles reload', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await mount();
    expect(modeSelect(keyRows()[0]).props.disabled).toBe(true);
    expect(buttonIn(keyRows()[0], 'data-client-key-delete')!.props.disabled).toBe(true);
    await type(keyInput(), RAW_NEW);
    expect(addButton().props.disabled).toBe(true);
  });
});

describe('client keys modal add form', () => {
  test('Add sends the raw key and the alias, then clears both inputs', async () => {
    await mount();
    expect(keyInput().props.type).toBe('password');
    await type(keyInput(), RAW_NEW);
    await type(aliasInput(), '  Desk ');
    await click(addButton());
    expect(keyProfiles.addKey).toHaveBeenCalledExactlyOnceWith(RAW_NEW, 'Desk');
    expect(keyInput().props.value).toBe('');
    expect(aliasInput().props.value).toBe('');
  });

  test('an empty alias is not sent', async () => {
    await mount();
    await type(keyInput(), RAW_NEW);
    await click(addButton());
    expect(keyProfiles.addKey).toHaveBeenCalledExactlyOnceWith(RAW_NEW, undefined);
  });

  test('Add is disabled for an empty key', async () => {
    await mount();
    expect(addButton().props.disabled).toBe(true);
    await type(keyInput(), '   ');
    expect(addButton().props.disabled).toBe(true);
  });

  test('an alias warning keeps the key cleared and shows the warning', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), {
      addKey: vi.fn(async () => ({
        ok: true,
        aliasWarning: 'The key was saved, but its alias was not',
      })),
    });
    await mount();
    await type(keyInput(), RAW_NEW);
    await type(aliasInput(), 'Desk');
    await click(addButton());
    expect(keyInput().props.value).toBe('');
    expect(text(byAttr('data-client-keys-warning'))).toContain('its alias was not');
  });

  test('a duplicate error from the hook is shown and keeps the input', async () => {
    const duplicate = 'This key is already in the configuration.';
    keyProfiles = makeKeyProfiles(profilesState(), { addKey: vi.fn(async () => ({ ok: false })) });
    await mount();
    await type(keyInput(), RAW_ALPHA);
    await click(addButton());
    expect(keyInput().props.value).toBe(RAW_ALPHA);

    keyProfiles = { ...keyProfiles, error: duplicate };
    await rerender();
    const alert = root().find((node) => node.type === 'div' && node.props.role === 'alert');
    expect(text(alert)).toContain(duplicate);
    await click(buttonIn(alert, 'onClick'));
    expect(keyProfiles.reload).toHaveBeenCalledTimes(1);
  });

  test('errors are masked like the profiles modal', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { error: 'failed for bob@example.com' });
    await mount();
    const alert = root().find((node) => node.type === 'div' && node.props.role === 'alert');
    expect(text(alert)).not.toContain('bob@example.com');
  });

  test('Generate fills the input, and the show toggle reveals it', async () => {
    await mount();
    await click(buttonIn(byAttr('data-client-key-add'), 'data-client-key-generate'));
    expect(keyInput().props.value).toBe(RAW_GENERATED);
    expect(keyInput().props.type).toBe('password');
    const show = buttonIn(byAttr('data-client-key-add'), 'data-client-key-show')!;
    expect(show.props['aria-label']).toBe('Show the key');
    await click(show);
    expect(keyInput().props.type).toBe('text');
  });

  test('Copy copies the input and confirms it', async () => {
    await mount();
    const copy = () => buttonIn(byAttr('data-client-key-add'), 'data-client-key-copy')!;
    expect(copy().props.disabled).toBe(true);
    await type(keyInput(), RAW_NEW);
    await click(copy());
    expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(RAW_NEW);
    expect(text(byAttr('data-client-key-copy-status'))).toBe(
      'The key was copied to the clipboard.'
    );
    expect(keyInput().props.type).toBe('password');
  });

  test('a failed copy shows the fallback message and reveals the key', async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(false);
    await mount();
    await type(keyInput(), RAW_NEW);
    await click(buttonIn(byAttr('data-client-key-add'), 'data-client-key-copy'));
    expect(text(byAttr('data-client-key-copy-status'))).toBe(
      'Could not copy. Select the key and copy it manually.'
    );
    expect(keyInput().props.type).toBe('text');
  });

  test('the alias input is disabled without the alias service', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { aliasesEditable: false });
    await mount();
    expect(aliasInput().props.disabled).toBe(true);
    expect(text(byAttr('data-client-key-alias-hint'))).toContain('manager service');
    await type(keyInput(), RAW_NEW);
    await click(addButton());
    expect(keyProfiles.addKey).toHaveBeenCalledExactlyOnceWith(RAW_NEW, undefined);
  });

  test('with no client keys the add form and a hint are shown', async () => {
    keyProfiles = makeKeyProfiles(profilesState({ keys: [] }), {}, []);
    await mount();
    expect(keyRows()).toHaveLength(0);
    expect(text(byAttr('data-client-keys-empty'))).toBe('No client keys yet. Add one below.');
    expect(root().findAll((node) => node.props['data-client-key-add']).length).toBeGreaterThan(0);
  });
});

describe('client keys modal states', () => {
  test('shows the loading and unsupported states', async () => {
    keyProfiles = makeKeyProfiles(null, { loading: true });
    await mount();
    const body = () => byAttr('data-client-keys-modal');
    expect(text(body())).toContain('Loading client keys');

    keyProfiles = makeKeyProfiles({
      ...profilesState(),
      unsupportedBackend: true,
      supported: false,
    });
    await rerender();
    expect(text(body())).toContain('no per-key routing profiles');
    expect(root().findAll((node) => node.props['data-client-key-add'])).toHaveLength(0);
  });

  test('never renders a raw key in text, titles or aria labels once the input is cleared', async () => {
    await mount();
    const check = () => {
      const json = JSON.stringify(renderer!.toJSON());
      const labels = root()
        .findAll((node) => typeof node.type === 'string' || node.type === Select)
        .flatMap((node) => [
          node.props.title,
          node.props['aria-label'],
          node.props.ariaLabel,
          node.props.value,
        ])
        .filter((value): value is string => typeof value === 'string');
      for (const raw of RAW_KEYS) {
        expect(json).not.toContain(raw);
        for (const label of labels) expect(label).not.toContain(raw);
      }
    };
    check();
    await click(buttonIn(byAttr('data-client-key-add'), 'data-client-key-generate'));
    await click(buttonIn(byAttr('data-client-key-add'), 'data-client-key-show'));
    await click(addButton());
    expect(keyProfiles.addKey).toHaveBeenCalledWith(RAW_GENERATED, undefined);
    check();
  });
});
