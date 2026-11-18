import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  providersFromClaudeFallback,
  type ProviderRouting,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { sha256Hex } from '@/utils/apiKeyHash';
import { CodexSpeedModal, type CodexSpeedModalProps } from './components/CodexSpeedModal';
import { buildKeyRows, copyOfShared } from './keyProfilesModel';
import { maskQuotaText } from './ledgerModel';

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? createElement('section', { 'data-modal': true }, children, footer) : null,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RAW_ALPHA = 'sk-live-RAWKEY-alpha-000111';
const RAW_BETA = 'sk-live-RAWKEY-beta-000222';
const RAW_KEYS = [RAW_ALPHA, RAW_BETA];

const codex = (overrides: Partial<ProviderRouting> = {}): ProviderRouting => ({
  mode: 'subscription',
  apiCredential: '',
  fallback: { target: 'off', mode: 'auto', mappings: [] },
  speed: 'standard',
  ignoreClientTier: false,
  ...overrides,
});

const withCodex = (base: RoutingProfile, routing: ProviderRouting): RoutingProfile => ({
  ...base,
  providers: { ...base.providers, codex: routing },
});

const shared = (routing: ProviderRouting = codex({ speed: 'fast' })): RoutingProfile =>
  withCodex(
    {
      sessionAffinity: true,
      preferredAccounts: { claude: 'claude-a' },
      selection: { primary: 'reserves', tiebreak: 'round-robin' },
      providers: providersFromClaudeFallback({
        enabled: true,
        mode: 'auto',
        mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
      }),
    },
    routing
  );

const betaProfile = (routing: ProviderRouting = codex({ speed: 'ultrafast' })): RoutingProfile =>
  withCodex(
    {
      sessionAffinity: false,
      preferredAccounts: {},
      selection: { primary: 'priority', tiebreak: 'fill-first' },
      providers: providersFromClaudeFallback({ enabled: false, mode: 'auto', mappings: [] }),
    },
    routing
  );

const profilesState = (overrides: Partial<RoutingProfilesState> = {}): RoutingProfilesState => ({
  supported: true,
  unsupportedBackend: false,
  providersSupported: true,
  speedSupported: true,
  apiCredentials: { claude: [], codex: [] },
  shared: shared(),
  keys: [{ key: RAW_BETA, profile: betaProfile() }],
  selectionOptions: {
    narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
    pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
  },
  ...overrides,
});

type ModalHook = CodexSpeedModalProps['keyProfiles'];

/** Stands in for `useKeyProfiles`: alpha (aliased) on the Default profile, beta with its own. */
function makeKeyProfiles(
  state: RoutingProfilesState | null = profilesState(),
  overrides: Partial<ModalHook> = {},
  keys: string[] = RAW_KEYS
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
    loading: false,
    saving: false,
    error: '',
    reload: vi.fn(),
    saveKeyProfile: vi.fn(async () => true),
    saveShared: vi.fn(async () => true),
    ...overrides,
  };
}

let keyProfiles: ModalHook;
let renderer: ReactTestRenderer | undefined;
let showEmails: boolean;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  keyProfiles = makeKeyProfiles();
  showEmails = false;
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

const modal = () =>
  createElement(CodexSpeedModal, { open: true, onClose: vi.fn(), keyProfiles, showEmails });

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
const rows = () =>
  root().findAll((node) => node.type === 'tr' && Boolean(node.props['data-speed-row']));
const speedButton = (row: ReactTestInstance, speed: string) =>
  row.find((node) => node.type === 'button' && node.props['data-speed-option'] === speed);
const speedButtons = (row: ReactTestInstance) =>
  row.findAll((node) => node.type === 'button' && Boolean(node.props['data-speed-option']));
const pressed = (row: ReactTestInstance) =>
  speedButtons(row)
    .filter((button) => button.props['aria-pressed'])
    .map((button) => button.props['data-speed-option']);
const flag = (row: ReactTestInstance) => row.findByType(ToggleSwitch);
const badge = (row: ReactTestInstance) =>
  row.find((node) => node.type === 'span' && Boolean(node.props['data-speed-badge'])).props[
    'data-speed-badge'
  ];
const click = async (button: ReactTestInstance) => {
  await act(async () => button.props.onClick());
};
const keyDown = async (button: ReactTestInstance, key: string) => {
  const preventDefault = vi.fn();
  await act(async () => button.props.onKeyDown({ key, preventDefault }));
  return preventDefault;
};
const allControls = () => [...rows().flatMap(speedButtons), ...rows().map((row) => flag(row))];

describe('codex speed modal rows', () => {
  test('the Default row comes first, keys follow with their badges and stored speeds', async () => {
    await mount();
    const [defaultRow, alpha, beta] = rows();
    expect(rows()).toHaveLength(3);
    expect(text(defaultRow)).toContain('Default profile');
    expect(defaultRow.findAll((node) => Boolean(node.props['data-speed-badge']))).toHaveLength(0);
    expect(text(alpha)).toContain('Laptop');
    expect(text(alpha)).toContain(keyProfiles.rows[0].masked);
    expect(text(beta)).toContain(keyProfiles.rows[1].masked);
    expect(badge(alpha)).toBe('default');
    expect(badge(beta)).toBe('own');
    expect(pressed(defaultRow)).toEqual(['fast']);
    expect(pressed(alpha)).toEqual(['fast']);
    expect(pressed(beta)).toEqual(['ultrafast']);
  });

  test('every control has an accessible name with its row label', async () => {
    await mount();
    const alpha = rows()[1];
    expect(speedButton(alpha, 'standard').props['aria-label']).toBe('Standard for Laptop');
    expect(flag(alpha).props.ariaLabel).toContain('Laptop');
    const group = alpha.find((node) => node.props.role === 'group');
    expect(group.props['aria-label']).toContain('Laptop');
    expect(speedButton(rows()[0], 'fast').props['aria-label']).toContain('Default profile');
  });

  test('no raw key is rendered or used as an id', async () => {
    await mount();
    const html = JSON.stringify(renderer!.toJSON());
    for (const raw of RAW_KEYS) expect(html).not.toContain(raw);
  });

  test('the loading and empty states', async () => {
    keyProfiles = makeKeyProfiles(null, { loading: true });
    await mount();
    expect(text(root())).toContain(i18n.t('quota_management.codex_speed.table_loading'));
    expect(rows()).toHaveLength(0);

    keyProfiles = makeKeyProfiles(profilesState({ keys: [] }), {}, []);
    await rerender();
    expect(rows()).toHaveLength(1);
    expect(root().findAll((node) => Boolean(node.props['data-codex-speed-empty']))).toHaveLength(1);
  });
});

describe('codex speed modal writes', () => {
  test('a click on the Default row saves the shared profile with the new speed', async () => {
    await mount();
    await click(speedButton(rows()[0], 'ultrafast'));
    expect(keyProfiles.saveShared).toHaveBeenCalledExactlyOnceWith(
      shared(codex({ speed: 'ultrafast' }))
    );
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();
  });

  test('a click on a key without a profile saves a full copy of the Default profile', async () => {
    await mount();
    await click(speedButton(rows()[1], 'standard'));
    const expected = withCodex(copyOfShared(shared()), codex({ speed: 'standard' }));
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledExactlyOnceWith(RAW_ALPHA, expected);
    // The copy keeps everything else of the Default profile, mappings included.
    const saved = vi.mocked(keyProfiles.saveKeyProfile).mock.calls[0][1]!;
    expect(saved.providers.claude.fallback.mappings).toEqual([
      { from: 'claude-opus-*', to: 'gpt-6-astra' },
    ]);
    expect(saved.selection).toEqual(shared().selection);
    expect(keyProfiles.saveShared).not.toHaveBeenCalled();
  });

  test('a click on a key with its own profile saves that profile', async () => {
    await mount();
    await click(speedButton(rows()[2], 'fast'));
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledExactlyOnceWith(
      RAW_BETA,
      betaProfile(codex({ speed: 'fast' }))
    );
  });

  test('the flag switch saves', async () => {
    await mount();
    await act(async () => flag(rows()[2]).props.onChange(true));
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledExactlyOnceWith(
      RAW_BETA,
      betaProfile(codex({ speed: 'ultrafast', ignoreClientTier: true }))
    );
    await act(async () => flag(rows()[0]).props.onChange(true));
    expect(keyProfiles.saveShared).toHaveBeenCalledExactlyOnceWith(
      shared(codex({ speed: 'fast', ignoreClientTier: true }))
    );
  });

  test('a click on the value a row already has does nothing', async () => {
    await mount();
    await click(speedButton(rows()[0], 'fast'));
    await click(speedButton(rows()[2], 'ultrafast'));
    await act(async () => flag(rows()[1]).props.onChange(false));
    expect(keyProfiles.saveShared).not.toHaveBeenCalled();
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();
  });

  test('arrow keys save nothing; Enter and Space save', async () => {
    await mount();
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Tab']) {
      const prevent = await keyDown(speedButton(rows()[0], 'standard'), key);
      expect(prevent).not.toHaveBeenCalled();
    }
    expect(keyProfiles.saveShared).not.toHaveBeenCalled();
    const prevent = await keyDown(speedButton(rows()[0], 'standard'), 'Enter');
    // The native click that would follow is prevented, so Enter writes once.
    expect(prevent).toHaveBeenCalled();
    expect(keyProfiles.saveShared).toHaveBeenCalledExactlyOnceWith(
      shared(codex({ speed: 'standard' }))
    );
    await keyDown(speedButton(rows()[2], 'standard'), ' ');
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledExactlyOnceWith(
      RAW_BETA,
      betaProfile(codex({ speed: 'standard' }))
    );
  });
});

describe('codex speed modal failure and disabled paths', () => {
  test('every control is disabled while saving or loading', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { saving: true });
    await mount();
    expect(allControls().every((control) => control.props.disabled)).toBe(true);
    await click(speedButton(rows()[1], 'ultrafast'));
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();

    keyProfiles = makeKeyProfiles(profilesState(), { loading: true });
    await rerender();
    expect(allControls().every((control) => control.props.disabled)).toBe(true);
  });

  test('a row in API key mode is disabled with the reason', async () => {
    const apiBeta = betaProfile(codex({ mode: 'api', speed: 'fast' }));
    keyProfiles = makeKeyProfiles(profilesState({ keys: [{ key: RAW_BETA, profile: apiBeta }] }));
    await mount();
    const [defaultRow, alpha, beta] = rows();
    expect(speedButtons(beta).every((button) => button.props.disabled)).toBe(true);
    expect(flag(beta).props.disabled).toBe(true);
    expect(text(beta)).toContain(i18n.t('quota_management.codex_speed.table_reason_api_mode'));
    expect(speedButtons(alpha).some((button) => button.props.disabled)).toBe(false);
    expect(speedButtons(defaultRow).some((button) => button.props.disabled)).toBe(false);
    // The stored value stays visible.
    expect(pressed(beta)).toEqual(['fast']);
    await click(speedButton(beta, 'ultrafast'));
    expect(keyProfiles.saveKeyProfile).not.toHaveBeenCalled();
  });

  test('under supported: false key rows are read-only and the Default row stays editable', async () => {
    keyProfiles = makeKeyProfiles(
      profilesState({ supported: false, shared: shared(codex({ mode: 'api', speed: 'fast' })) })
    );
    await mount();
    const [defaultRow, alpha, beta] = rows();
    for (const row of [alpha, beta]) {
      expect(speedButtons(row).every((button) => button.props.disabled)).toBe(true);
      expect(flag(row).props.disabled).toBe(true);
      expect(text(row)).toContain(i18n.t('quota_management.codex_speed.table_reason_read_only'));
    }
    expect(
      root().findAll((node) => Boolean(node.props['data-codex-speed-read-only']))
    ).toHaveLength(1);
    // CPA ignores the stored API key mode here, while the shared speed applies.
    expect(speedButtons(defaultRow).some((button) => button.props.disabled)).toBe(false);
    await click(speedButton(defaultRow, 'standard'));
    expect(keyProfiles.saveShared).toHaveBeenCalledExactlyOnceWith(
      shared(codex({ mode: 'api', speed: 'standard' }))
    );
  });

  test('after a failed write the row shows the stored speed and the error', async () => {
    keyProfiles = makeKeyProfiles(profilesState(), { saveKeyProfile: vi.fn(async () => false) });
    await mount();
    await click(speedButton(rows()[1], 'ultrafast'));
    expect(keyProfiles.saveKeyProfile).toHaveBeenCalledTimes(1);
    const error = 'Save failed for bob@example.com';
    keyProfiles = { ...keyProfiles, error };
    await rerender();
    expect(pressed(rows()[1])).toEqual(['fast']);
    expect(badge(rows()[1])).toBe('default');
    const alert = root().find((node) => Boolean(node.props['data-codex-speed-error']));
    expect(text(alert)).toContain(maskQuotaText(error));
    expect(text(alert)).not.toContain('bob@example.com');

    showEmails = true;
    await rerender();
    expect(text(root().find((node) => Boolean(node.props['data-codex-speed-error'])))).toContain(
      error
    );
  });

  test('a row disappears when the reloaded rows no longer hold its key', async () => {
    await mount();
    expect(rows()).toHaveLength(3);
    keyProfiles = makeKeyProfiles(profilesState({ keys: [] }), {}, [RAW_ALPHA]);
    await rerender();
    expect(rows()).toHaveLength(2);
    expect(text(rows()[1])).toContain('Laptop');
    const html = JSON.stringify(renderer!.toJSON());
    for (const raw of RAW_KEYS) expect(html).not.toContain(raw);
  });
});
