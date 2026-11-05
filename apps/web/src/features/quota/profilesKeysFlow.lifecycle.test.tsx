import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { Button } from '@/components/ui/Button';
import { claudeFallbackApi } from '@/features/personal-quota-support/services/api/claudeFallback';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import { clientKeysApi } from '@/features/personal-quota-support/services/api/clientKeys';
import {
  routingProfilesApi,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { subscriptionRoutingApi } from '@/features/personal-quota-support/services/api/subscriptionRouting';
import { useConfigStore } from '@/features/personal-quota-support/stores/useConfigStore';
import type { Config } from '@/features/personal-quota-support/types';
import { KeyProfileEditor } from './components/KeyProfileEditor';
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

const profile = (primary: string): RoutingProfile => ({
  sessionAffinity: false,
  preferredAccounts: {},
  selection: { primary },
  claudeFallback: { enabled: false, mode: 'auto', mappings: [] },
});

const profilesState = (bProfile: RoutingProfile): RoutingProfilesState => ({
  supported: true,
  unsupportedBackend: false,
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

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join('');
}
