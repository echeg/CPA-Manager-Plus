import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  claudeFallbackApi,
  suggestedFallbackMappings,
} from '@/features/personal-quota-support/services/api/claudeFallback';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import { clientKeysApi } from '@/features/personal-quota-support/services/api/clientKeys';
import {
  providersFromClaudeFallback,
  routingProfilesApi,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { subscriptionRoutingApi } from '@/features/personal-quota-support/services/api/subscriptionRouting';
import { providersApi } from '@/services/api/providers';
import { useConfigStore } from '@/features/personal-quota-support/stores/useConfigStore';
import type { Config } from '@/features/personal-quota-support/types';
import { withCodexSpeed } from './codexSpeedModel';
import { KeyProfileEditor } from './components/KeyProfileEditor';
import { ProviderRoutingBlock } from './components/ProviderRoutingBlock';
import { QuotaSettingsBar } from './components/QuotaSettingsToolbar';
import { Select } from './components/Select';
import { copyOfShared } from './keyProfilesModel';

// The bar, both modals and the real useKeyProfiles; only the network layer is stubbed.
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? createElement('section', { 'data-modal': true }, children, footer) : null,
}));
// An external panel: no alias service, and the alias state is known.
vi.mock('@/hooks/useApiKeyAliases', () => ({
  useApiKeyAliases: () => ({
    aliases: [],
    available: false,
    loading: false,
    serviceBase: '',
    managementKey: '',
    stateKnown: true,
    reload: () => undefined,
    replaceAliases: () => undefined,
    removeAlias: () => undefined,
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const KEY_A = 'sk-flow-alpha-0123456789';
const KEY_B = 'sk-flow-bravo-9876543210';
const KEY_NEW = 'sk-flow-new-000111222333';
// A raw upstream key as the provider key configs return it; only its mask may render.
const UPSTREAM_CODEX = 'sk-upstream-codex-RAW-55667788';

const profile = (primary: string): RoutingProfile => ({
  sessionAffinity: false,
  preferredAccounts: {},
  selection: { primary },
  providers: providersFromClaudeFallback({ enabled: false, mode: 'auto', mappings: [] }),
});

const profilesState = (bProfile: RoutingProfile): RoutingProfilesState => ({
  supported: true,
  unsupportedBackend: false,
  providersSupported: true,
  speedSupported: true,
  providerToggleSupported: false,
  apiCredentials: { claude: [], codex: [] },
  shared: { ...profile('reserves'), selection: { primary: 'reserves', tiebreak: 'round-robin' } },
  keys: [{ key: KEY_B, profile: bProfile }],
  selectionOptions: {
    narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
    pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
  },
});

let storedKeys: string[];
const initialConfigState = useConfigStore.getState();
let renderer: ReactTestRenderer | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** `GET /config` as the speed table reads it before a key write: the stored key list. */
const storedConfig = () => ({ access: { 'api-keys': [...storedKeys] } });

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  storedKeys = [KEY_A, KEY_B];
  vi.spyOn(apiClient, 'getConnectionRevision').mockReturnValue(0);
  useConfigStore.setState({
    fetchConfig: vi.fn(
      async (): Promise<Config> => ({
        raw: { access: { 'api-keys': [...storedKeys] } },
        routingSessionAffinityTTL: '1h',
      })
    ),
    clearCache: vi.fn(),
  });
  vi.spyOn(routingProfilesApi, 'get').mockResolvedValue(profilesState(profile('priority')));
  vi.spyOn(claudeFallbackApi, 'get').mockResolvedValue({
    supported: true,
    settings: { enabled: false, mode: 'auto', mappings: [] },
    models: { claude: [], codex: [] },
  });
  vi.spyOn(subscriptionRoutingApi, 'activity').mockResolvedValue([]);
  vi.spyOn(providersApi, 'getClaudeConfigs').mockResolvedValue([]);
  vi.spyOn(providersApi, 'getCodexConfigs').mockResolvedValue([
    { apiKey: UPSTREAM_CODEX, prefix: 'billing', authIndex: 'codex-key-1' },
  ]);
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  useConfigStore.setState(initialConfigState, true);
});

async function mount() {
  await act(async () => {
    renderer = create(
      createElement(QuotaSettingsBar, {
        disabled: false,
        files: [],
        showEmails: false,
        resolvedTheme: 'light',
      })
    );
  });
}

const root = () => renderer!.root;
const buttonWith = (attr: string, scope: ReactTestInstance = root()) =>
  scope.findAllByType(Button).find((button) => button.props[attr]);
const keyRows = () =>
  root().findAll((node) => node.type === 'li' && node.props['data-client-key-row']);
const editors = () => root().findAllByType(KeyProfileEditor);
const click = async (button: ReactTestInstance | undefined) => {
  await act(async () => button!.props.onClick());
};

describe('Profiles and Keys flow with the real key profiles hook', () => {
  test('Configure opens the key editor on the reloaded profile, not the cached one', async () => {
    await mount();
    expect(text(buttonWith('data-open-keys')!)).toContain('2');
    await click(buttonWith('data-open-keys'));
    expect(keyRows()).toHaveLength(2);

    // The navigation reloads; the editor must wait for it and copy the fresh profile.
    const reload = deferred<RoutingProfilesState>();
    vi.mocked(routingProfilesApi.get).mockReturnValueOnce(reload.promise);
    await click(buttonWith('data-client-key-configure', keyRows()[1]));
    expect(root().findAll((node) => node.props['data-routing-profiles-modal'])).toHaveLength(1);
    expect(editors()).toHaveLength(0);

    await act(async () => reload.resolve(profilesState(profile('earliest-reset'))));
    expect(editors()).toHaveLength(1);
    expect(editors()[0].props.variant).toBe('key');
    expect(editors()[0].props.initial.selection).toEqual({ primary: 'earliest-reset' });
    expect(buttonWith('data-profiles-back')).toBeDefined();
  });

  test('adding a key writes it and shows the new row after the refetch', async () => {
    const add = vi.spyOn(clientKeysApi, 'addClientKey').mockImplementation(async (key) => {
      storedKeys = [...storedKeys, key.trim()];
      return {};
    });
    await mount();
    await click(buttonWith('data-open-keys'));
    const input = root().find(
      (node) => node.type === 'input' && node.props['data-client-key-input']
    );
    await act(async () => input.props.onChange({ target: { value: KEY_NEW } }));
    await click(buttonWith('data-client-key-submit'));

    expect(add).toHaveBeenCalledExactlyOnceWith(KEY_NEW, undefined, expect.any(Object));
    expect(keyRows()).toHaveLength(3);
    expect(text(buttonWith('data-open-keys')!)).toContain('3');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(KEY_NEW);
  });
});

describe('provider routing saves with the real key profiles hook', () => {
  const codexKeys = {
    claude: [],
    codex: [{ authIndex: 'codex-key-1', label: 'codex-apikey', baseUrl: '', disabled: false }],
  };
  const withProviders = (
    state: RoutingProfilesState,
    providersSupported = true
  ): RoutingProfilesState => ({ ...state, providersSupported, apiCredentials: codexKeys });

  const openProfileEditor = async (rowAttr: 'data-profile-default' | 'data-profile-row') => {
    await click(buttonWith('data-open-profiles'));
    const row = root().find((node) => typeof node.type === 'string' && node.props[rowAttr]);
    await click(buttonWith('data-profile-edit', row));
    expect(editors()).toHaveLength(1);
  };
  // The editor fills an empty Claude mapping table with suggestions, and saves them.
  const withSuggested = (value: RoutingProfile): RoutingProfile => ({
    ...value,
    providers: {
      ...value.providers,
      claude: {
        ...value.providers.claude,
        fallback: { ...value.providers.claude.fallback, mappings: suggestedFallbackMappings() },
      },
    },
  });
  const editBlock = async (
    provider: 'claude' | 'codex',
    patch: (value: RoutingProfile['providers']['codex']) => RoutingProfile['providers']['codex']
  ) => {
    const block = root()
      .findAllByType(ProviderRoutingBlock)
      .find((item) => item.props.provider === provider)!;
    await act(async () => block.props.onChange(patch(block.props.value)));
  };

  test('a key profile in Codex API key mode sends the providers block', async () => {
    const before = profile('priority');
    vi.mocked(routingProfilesApi.get).mockResolvedValue(withProviders(profilesState(before)));
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({});
    await mount();
    await openProfileEditor('data-profile-row');

    await editBlock('codex', (value) => ({ ...value, mode: 'api', apiCredential: 'codex-key-1' }));
    expect(text(root().find((node) => node.props['data-key-profile-summary']))).toContain(
      'Codex: API key billing · sk******88'
    );
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(UPSTREAM_CODEX);

    const after: RoutingProfile = withSuggested({
      ...before,
      providers: {
        ...before.providers,
        codex: {
          mode: 'api',
          apiCredential: 'codex-key-1',
          fallback: { target: 'off', mode: 'auto', mappings: [] },
          speed: 'standard',
          ignoreClientTier: false,
          disabled: false,
        },
      },
    });
    vi.mocked(routingProfilesApi.get).mockResolvedValue(withProviders(profilesState(after)));
    await click(buttonWith('data-key-profile-save'));

    expect(patch).toHaveBeenCalledTimes(1);
    const body = patch.mock.calls[0][1] as {
      routing: { 'key-profiles': Record<string, Record<string, unknown>> };
    };
    const sent = body.routing['key-profiles'][KEY_B];
    expect(sent['claude-fallback']).toBeUndefined();
    expect(sent.providers).toEqual({
      claude: {
        mode: 'subscription',
        'api-credential': null,
        fallback: { target: 'off', mode: 'auto', mappings: suggestedFallbackMappings() },
      },
      // The backend serves `speed`, so the Codex block carries both fields.
      codex: {
        mode: 'api',
        'api-credential': 'codex-key-1',
        fallback: { target: 'off', mode: null, mappings: null },
        speed: 'standard',
        'ignore-client-tier': false,
      },
    });
    // The read-back matched, so the editor closed.
    expect(editors()).toHaveLength(0);
  });

  test('the default profile with a Codex API-key fallback sends target api and the key', async () => {
    vi.mocked(routingProfilesApi.get).mockResolvedValue(
      withProviders(profilesState(profile('priority')))
    );
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({});
    await mount();
    await openProfileEditor('data-profile-default');

    await editBlock('codex', (value) => ({
      ...value,
      apiCredential: 'codex-key-1',
      fallback: { ...value.fallback, target: 'api' },
    }));
    const shared = profilesState(profile('priority')).shared;
    const after: RoutingProfile = withSuggested({
      ...shared,
      providers: {
        ...shared.providers,
        codex: {
          mode: 'subscription',
          apiCredential: 'codex-key-1',
          fallback: { target: 'api', mode: 'auto', mappings: [] },
          speed: 'standard',
          ignoreClientTier: false,
          disabled: false,
        },
      },
    });
    vi.mocked(routingProfilesApi.get).mockResolvedValue(
      withProviders({ ...profilesState(profile('priority')), shared: after })
    );
    await click(buttonWith('data-key-profile-save'));

    const body = patch.mock.calls[0][1] as { routing: Record<string, unknown> };
    expect(body.routing['claude-fallback']).toBeUndefined();
    expect(body.routing.providers).toMatchObject({
      codex: { mode: 'subscription', 'api-credential': 'codex-key-1', fallback: { target: 'api' } },
    });
    expect(editors()).toHaveLength(0);
  });

  test('an old backend sends the legacy claude-fallback body', async () => {
    const before = profile('priority');
    vi.mocked(routingProfilesApi.get).mockResolvedValue(
      withProviders(profilesState(before), false)
    );
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({});
    await mount();
    await openProfileEditor('data-profile-row');
    expect(editors()[0].props.providersSupported).toBe(false);

    await act(async () => editors()[0].findAllByType(ToggleSwitch)[0].props.onChange(true));
    vi.mocked(routingProfilesApi.get).mockResolvedValue(
      withProviders(profilesState(withSuggested({ ...before, sessionAffinity: true })), false)
    );
    await click(buttonWith('data-key-profile-save'));

    const body = patch.mock.calls[0][1] as {
      routing: { 'key-profiles': Record<string, Record<string, unknown>> };
    };
    const sent = body.routing['key-profiles'][KEY_B];
    expect(sent.providers).toBeUndefined();
    expect(sent['claude-fallback']).toEqual({
      enabled: false,
      mode: 'auto',
      mappings: suggestedFallbackMappings(),
    });
    expect(sent['session-affinity']).toBe(true);
    expect(editors()).toHaveLength(0);
  });

  const codexBlock = () =>
    root()
      .findAllByType(ProviderRoutingBlock)
      .find((item) => item.props.provider === 'codex')!;
  const claudeBlock = () =>
    root()
      .findAllByType(ProviderRoutingBlock)
      .find((item) => item.props.provider === 'claude')!;
  /** `state` with KEY_B's profile replaced. */
  const withKeyBProfile = (state: RoutingProfilesState, bProfile: RoutingProfile) => ({
    ...state,
    keys: [{ key: KEY_B, profile: bProfile }],
  });

  test('a Codex speed edited in the Default profile is saved and shown again after a reload', async () => {
    const state = withProviders(profilesState(profile('priority')));
    vi.mocked(routingProfilesApi.get).mockResolvedValue(state);
    const after = withSuggested({
      ...state.shared,
      providers: {
        ...state.shared.providers,
        codex: { ...state.shared.providers.codex, speed: 'ultrafast', ignoreClientTier: true },
      },
    });
    // The backend stores what the PATCH sent, so the read-back and the next load see it.
    const patch = vi.spyOn(apiClient, 'patch').mockImplementation(async () => {
      vi.mocked(routingProfilesApi.get).mockResolvedValue({ ...state, shared: after });
      return {};
    });
    await mount();
    await openProfileEditor('data-profile-default');
    expect(codexBlock().props.speedSupported).toBe(true);
    expect(codexBlock().props.value.speed).toBe('standard');

    await editBlock('codex', (value) => ({ ...value, speed: 'ultrafast', ignoreClientTier: true }));
    await click(buttonWith('data-key-profile-save'));
    expect(patch).toHaveBeenCalledTimes(1);
    const body = patch.mock.calls[0][1] as { routing: { providers: Record<string, unknown> } };
    expect(body.routing.providers.codex).toMatchObject({
      speed: 'ultrafast',
      'ignore-client-tier': true,
    });
    expect(editors()).toHaveLength(0);

    // A fresh panel load shows the stored values in the editor and on the toolbar button.
    await act(async () => renderer?.unmount());
    await mount();
    expect(text(buttonWith('data-open-speed')!)).toBe('Codex speed: Ultrafast');
    await openProfileEditor('data-profile-default');
    expect(codexBlock().props.value).toMatchObject({ speed: 'ultrafast', ignoreClientTier: true });
  });

  test("a new key profile created in the editor inherits the Default profile's speed and flag", async () => {
    const base = withProviders(profilesState(profile('priority')));
    const shared: RoutingProfile = {
      ...base.shared,
      providers: {
        ...base.shared.providers,
        codex: { ...base.shared.providers.codex, speed: 'fast', ignoreClientTier: true },
      },
    };
    const state: RoutingProfilesState = { ...base, shared };
    vi.mocked(routingProfilesApi.get).mockResolvedValue(state);
    const patch = vi.spyOn(apiClient, 'patch').mockImplementation(async () => {
      vi.mocked(routingProfilesApi.get).mockResolvedValue({
        ...state,
        keys: [...state.keys, { key: KEY_A, profile: withSuggested(shared) }],
      });
      return {};
    });
    await mount();
    await click(buttonWith('data-open-profiles'));
    // KEY_A has no profile of its own, so "+ Profile for a key" offers it.
    const add = root()
      .find((node) => node.props['data-profile-add'])
      .findByType(Select);
    expect(add.props.options).toHaveLength(1);
    await act(async () => add.props.onChange(add.props.options[0].value));
    expect(editors()).toHaveLength(1);
    expect(editors()[0].props.isNew).toBe(true);
    expect(codexBlock().props.speedSupported).toBe(true);
    expect(codexBlock().props.value).toMatchObject({ speed: 'fast', ignoreClientTier: true });

    await click(buttonWith('data-key-profile-save'));
    expect(patch).toHaveBeenCalledTimes(1);
    const body = patch.mock.calls[0][1] as {
      routing: { 'key-profiles': Record<string, { providers: Record<string, unknown> }> };
    };
    expect(body.routing['key-profiles'][KEY_A].providers.codex).toMatchObject({
      speed: 'fast',
      'ignore-client-tier': true,
    });
    // The read-back matched, so the draft closed.
    expect(editors()).toHaveLength(0);
  });
  test('Claude switched off for a key is saved, read back and shown off after a reopen', async () => {
    const before = profile('priority');
    const state = { ...withProviders(profilesState(before)), providerToggleSupported: true };
    vi.mocked(routingProfilesApi.get).mockResolvedValue(state);
    const after = withSuggested({
      ...before,
      providers: {
        ...before.providers,
        claude: { ...before.providers.claude, disabled: true },
      },
    });
    // The backend stores what the PATCH sent, so the read-back and the next load see it.
    const patch = vi.spyOn(apiClient, 'patch').mockImplementation(async () => {
      vi.mocked(routingProfilesApi.get).mockResolvedValue(withKeyBProfile(state, after));
      return {};
    });
    await mount();
    await openProfileEditor('data-profile-row');
    const claudeToggle = () => claudeBlock().findByType(ToggleSwitch);
    expect(claudeToggle().props.checked).toBe(true);
    expect(claudeToggle().props.disabled).toBe(false);
    await act(async () => claudeToggle().props.onChange(false));
    await click(buttonWith('data-key-profile-save'));

    expect(patch).toHaveBeenCalledTimes(1);
    const body = patch.mock.calls[0][1] as {
      routing: { 'key-profiles': Record<string, { providers: Record<string, unknown> }> };
    };
    expect(body.routing['key-profiles'][KEY_B].providers).toMatchObject({
      claude: { mode: 'subscription', disabled: true },
      codex: { disabled: false },
    });
    expect(editors()).toHaveLength(0);

    // A fresh panel load shows the stored off state in the editor and its summary.
    await act(async () => renderer?.unmount());
    await mount();
    await openProfileEditor('data-profile-row');
    expect(claudeToggle().props.checked).toBe(false);
    expect(text(root().find((node) => node.props['data-key-profile-summary']))).toContain(
      i18n.t('quota_management.key_profiles.summary.provider_off', { provider: 'Claude' })
    );
  });
});

describe('Codex speed button and table with the real key profiles hook', () => {
  const withSharedSpeed = (
    state: RoutingProfilesState,
    speed: 'standard' | 'fast' | 'ultrafast',
    speedSupported = true
  ): RoutingProfilesState => ({
    ...state,
    speedSupported,
    shared: {
      ...state.shared,
      providers: {
        ...state.shared.providers,
        codex: { ...state.shared.providers.codex, speed },
      },
    },
  });
  const speedModal = () => root().findAll((node) => node.props['data-codex-speed-modal']);
  const speedOption = (rowKind: 'default' | 'key', speed: string) =>
    root()
      .findAll((node) => node.type === 'tr' && node.props['data-speed-row'] === rowKind)[0]
      .find((node) => node.type === 'button' && node.props['data-speed-option'] === speed);

  test('an older backend without speed gets no speed button', async () => {
    vi.mocked(routingProfilesApi.get).mockResolvedValue(
      withSharedSpeed(profilesState(profile('priority')), 'standard', false)
    );
    await mount();
    expect(buttonWith('data-open-profiles')).toBeDefined();
    expect(buttonWith('data-open-speed')).toBeUndefined();
  });

  test("the button names the Default profile's speed and opens the table", async () => {
    vi.mocked(routingProfilesApi.get).mockResolvedValue(
      withSharedSpeed(profilesState(profile('priority')), 'fast')
    );
    await mount();
    const button = buttonWith('data-open-speed');
    expect(text(button!)).toBe('Codex speed: Fast');
    expect(speedModal()).toHaveLength(0);

    await click(button);
    expect(speedModal()).toHaveLength(1);
    expect(
      root().findAll((node) => node.type === 'tr' && node.props['data-speed-row'])
    ).toHaveLength(3);
    expect(speedOption('default', 'fast').props['aria-pressed']).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(KEY_A);
  });

  test('the panel never calls the removed fast-mode path', async () => {
    const state = withSharedSpeed(profilesState(profile('priority')), 'fast');
    vi.mocked(routingProfilesApi.get).mockResolvedValue(state);
    const get = vi.spyOn(apiClient, 'get');
    // The stored config, read for the legacy Claude fallback check.
    const getRaw = vi
      .spyOn(apiClient, 'getRaw')
      .mockResolvedValue({ headers: { etag: '"cfg-1"' }, data: storedConfig() } as never);
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({});
    const patch = vi.spyOn(apiClient, 'patch').mockImplementation(async () => {
      vi.mocked(routingProfilesApi.get).mockResolvedValue(withSharedSpeed(state, 'ultrafast'));
      return {};
    });
    await mount();
    await click(buttonWith('data-open-speed'));
    await click(speedOption('default', 'ultrafast'));

    // The click wrote the Default speed alone through the routing PATCH, which merges it
    // into the stored profile, unconditionally.
    expect(getRaw).toHaveBeenCalledExactlyOnceWith('/config');
    expect(patch).toHaveBeenCalledExactlyOnceWith('/config', {
      routing: { providers: { codex: { speed: 'ultrafast' } } },
    });
    expect(root().findAll((node) => node.props['data-codex-speed-error'])).toHaveLength(0);
    expect(text(buttonWith('data-open-speed')!)).toBe('Codex speed: Ultrafast');
    for (const spy of [get, getRaw, put, patch]) {
      for (const call of spy.mock.calls) {
        expect(String(call[0])).not.toContain('fast-mode');
      }
    }
  });

  test('a click on a key on the Default profile saves a full copy with the new speed', async () => {
    const state = withSharedSpeed(profilesState(profile('priority')), 'fast');
    vi.mocked(routingProfilesApi.get).mockResolvedValue(state);
    const copy = withCodexSpeed(copyOfShared(state.shared), { speed: 'ultrafast' });
    // The config version the key write is conditional on.
    const getRaw = vi
      .spyOn(apiClient, 'getRaw')
      .mockResolvedValue({ headers: { etag: '"cfg-1"' }, data: storedConfig() } as never);
    // The empty write changes nothing and names the version it loaded.
    const patchRaw = vi
      .spyOn(apiClient, 'patchRaw')
      .mockResolvedValue({ headers: { etag: '"cfg-2"' }, data: {} } as never);
    // The copy is stored, so the read-back and the reload see it.
    const patch = vi.spyOn(apiClient, 'patch').mockImplementation(async () => {
      vi.mocked(routingProfilesApi.get).mockResolvedValue({
        ...state,
        keys: [...state.keys, { key: KEY_A, profile: copy }],
      });
      return {};
    });
    await mount();
    await click(buttonWith('data-open-speed'));
    // The first key row is KEY_A, which still uses the Default profile.
    const badge = () =>
      root().findAll((node) => node.type === 'span' && node.props['data-speed-badge'])[0].props[
        'data-speed-badge'
      ];
    expect(badge()).toBe('default');
    await click(speedOption('key', 'ultrafast'));

    expect(getRaw).toHaveBeenCalledExactlyOnceWith('/config');
    // An empty write conditional on the version read before the profiles makes CPA load
    // that version, so its Default is checked before the copy; CPA refuses either write
    // with 412 once another tab saved the config in between.
    expect(patchRaw).toHaveBeenCalledExactlyOnceWith(
      '/config',
      {},
      { headers: { 'If-Match': '"cfg-1"' } }
    );
    // The copy is the only other write.
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][2]).toEqual({ headers: { 'If-Match': '"cfg-2"' } });
    const body = patch.mock.calls[0][1] as {
      routing: { 'key-profiles': Record<string, Record<string, unknown>> };
    };
    const sent = body.routing['key-profiles'][KEY_A];
    // A complete copy of the Default profile, not only the changed field.
    expect(sent['session-affinity']).toBe(state.shared.sessionAffinity);
    expect(sent.selection).toEqual({ primary: 'reserves', tiebreak: 'round-robin' });
    expect(sent.providers).toMatchObject({
      claude: {
        mode: state.shared.providers.claude.mode,
        fallback: { target: state.shared.providers.claude.fallback.target },
      },
      codex: { mode: 'subscription', speed: 'ultrafast', 'ignore-client-tier': false },
    });
    // The read-back matched: no error, and the key now has its own profile.
    expect(root().findAll((node) => node.props['data-codex-speed-error'])).toHaveLength(0);
    expect(badge()).toBe('own');
    expect(speedOption('key', 'ultrafast').props['aria-pressed']).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(KEY_A);
  });

  test("a speed click on a key on the Default profile keeps the Default's stored disabled", async () => {
    const base = withSharedSpeed(profilesState(profile('priority')), 'fast');
    const state: RoutingProfilesState = {
      ...base,
      providerToggleSupported: true,
      shared: {
        ...base.shared,
        providers: {
          ...base.shared.providers,
          claude: { ...base.shared.providers.claude, disabled: true },
        },
      },
    };
    vi.mocked(routingProfilesApi.get).mockResolvedValue(state);
    const copy = withCodexSpeed(copyOfShared(state.shared), { speed: 'ultrafast' });
    vi.spyOn(apiClient, 'getRaw').mockResolvedValue({
      headers: { etag: '"cfg-1"' },
      data: storedConfig(),
    } as never);
    vi.spyOn(apiClient, 'patchRaw').mockResolvedValue({
      headers: { etag: '"cfg-2"' },
      data: {},
    } as never);
    const patch = vi.spyOn(apiClient, 'patch').mockImplementation(async () => {
      vi.mocked(routingProfilesApi.get).mockResolvedValue({
        ...state,
        keys: [...state.keys, { key: KEY_A, profile: copy }],
      });
      return {};
    });
    await mount();
    await click(buttonWith('data-open-speed'));
    await click(speedOption('key', 'ultrafast'));

    expect(patch).toHaveBeenCalledTimes(1);
    const body = patch.mock.calls[0][1] as {
      routing: { 'key-profiles': Record<string, { providers: Record<string, unknown> }> };
    };
    expect(body.routing['key-profiles'][KEY_A].providers).toMatchObject({
      claude: { disabled: true },
      codex: { speed: 'ultrafast', disabled: false },
    });
    expect(root().findAll((node) => node.props['data-codex-speed-error'])).toHaveLength(0);
  });

  test('a copy of a Default profile CPA has not reloaded yet is never written', async () => {
    // One edit of the file added KEY_A and moved the Default to another Codex account;
    // the key list reads the file, but CPA has not reloaded it, so the profiles still
    // hold the old Default.
    const loaded = withSharedSpeed(profilesState(profile('priority')), 'fast');
    const onDisk: RoutingProfilesState = {
      ...loaded,
      shared: { ...loaded.shared, preferredAccounts: { codex: 'codex-new' } },
    };
    vi.mocked(routingProfilesApi.get).mockResolvedValue(loaded);
    vi.spyOn(apiClient, 'getRaw').mockResolvedValue({
      headers: { etag: '"cfg-1"' },
      data: storedConfig(),
    } as never);
    // The empty write makes CPA load the version on disk, with the new Default.
    const patchRaw = vi.spyOn(apiClient, 'patchRaw').mockImplementation(async () => {
      vi.mocked(routingProfilesApi.get).mockResolvedValue(onDisk);
      return { headers: { etag: '"cfg-2"' }, data: {} } as never;
    });
    const patch = vi.spyOn(apiClient, 'patch');
    await mount();
    await click(buttonWith('data-open-speed'));
    await click(speedOption('key', 'ultrafast'));

    // Only the empty write: the copy of the old Default never reaches CPA, so no request
    // of KEY_A is routed by it, and there is nothing to take back.
    expect(patchRaw).toHaveBeenCalledExactlyOnceWith(
      '/config',
      {},
      {
        headers: { 'If-Match': '"cfg-1"' },
      }
    );
    expect(patch).not.toHaveBeenCalled();
    const error = root().findAll((node) => node.props['data-codex-speed-error']);
    expect(error).toHaveLength(1);
    expect(text(error[0])).toContain(
      'The configuration changed elsewhere after it was read, so nothing was saved. Check the current values and try again.'
    );
    // KEY_A stays on the Default profile, which now holds the new account.
    const badge = root().findAll(
      (node) => node.type === 'span' && node.props['data-speed-badge']
    )[0].props['data-speed-badge'];
    expect(badge).toBe('default');
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(KEY_A);
  });

  test('a click on a key with its own profile patches only its speed, conditional on the version', async () => {
    const state = withSharedSpeed(profilesState(profile('priority')), 'fast');
    vi.mocked(routingProfilesApi.get).mockResolvedValue(state);
    // The stored config, in the version the write names, holds KEY_B's own profile.
    const getRaw = vi.spyOn(apiClient, 'getRaw').mockResolvedValue({
      headers: { etag: '"cfg-2"' },
      data: {
        ...storedConfig(),
        routing: { 'key-profiles': { [KEY_B]: { selection: { primary: 'priority' } } } },
      },
    } as never);
    const patch = vi.spyOn(apiClient, 'patch').mockImplementation(async () => {
      vi.mocked(routingProfilesApi.get).mockResolvedValue({
        ...state,
        keys: [
          {
            key: KEY_B,
            profile: withCodexSpeed(state.keys[0].profile, { speed: 'ultrafast' }),
          },
        ],
      });
      return {};
    });
    await mount();
    await click(buttonWith('data-open-speed'));
    // Key rows follow the config order: KEY_A on the Default profile, then KEY_B.
    const keyBOption = (speed: string) =>
      root()
        .findAll((node) => node.type === 'tr' && node.props['data-speed-row'] === 'key')[1]
        .find((node) => node.type === 'button' && node.props['data-speed-option'] === speed);
    await click(keyBOption('ultrafast'));

    expect(getRaw).toHaveBeenCalledExactlyOnceWith('/config');
    // Only the speed is sent, merged into the stored profile; nothing else of the
    // profile the panel loaded can overwrite a newer stored value.
    expect(patch).toHaveBeenCalledExactlyOnceWith(
      '/config',
      {
        routing: { 'key-profiles': { [KEY_B]: { providers: { codex: { speed: 'ultrafast' } } } } },
      },
      { headers: { 'If-Match': '"cfg-2"' } }
    );
    expect(root().findAll((node) => node.props['data-codex-speed-error'])).toHaveLength(0);
    expect(keyBOption('ultrafast').props['aria-pressed']).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(KEY_B);
  });
});

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
}
