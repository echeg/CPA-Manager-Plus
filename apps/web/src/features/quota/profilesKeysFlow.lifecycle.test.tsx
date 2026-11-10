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
import { KeyProfileEditor } from './components/KeyProfileEditor';
import { ProviderRoutingBlock } from './components/ProviderRoutingBlock';
import { QuotaSettingsBar } from './components/QuotaSettingsToolbar';

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
        codexFastMode: false,
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
      codex: {
        mode: 'api',
        'api-credential': 'codex-key-1',
        fallback: { target: 'off', mode: null, mappings: null },
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
});

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
}
