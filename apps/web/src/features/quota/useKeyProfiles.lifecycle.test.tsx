import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import {
  AliasStateUnknownError,
  AliasWriteError,
  clientKeysApi,
  DuplicateAliasError,
  DuplicateClientKeyError,
  InvalidAliasError,
  InvalidClientKeyError,
  LastClientKeyError,
} from '@/features/personal-quota-support/services/api/clientKeys';
import {
  InvalidRoutingConfigError,
  UnknownApiKeyError,
  routingProfilesApi,
  unsupportedRoutingProfiles,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { useConfigStore } from '@/features/personal-quota-support/stores/useConfigStore';
import type { Config } from '@/features/personal-quota-support/types';
import type { ApiKeyAlias } from '@/services/api/usageService';
import { sha256Hex } from '@/utils/apiKeyHash';
import { useKeyProfiles, type KeyProfilesState } from './hooks/useKeyProfiles';

const aliasState = vi.hoisted(() => ({
  aliases: [] as ApiKeyAlias[],
  available: true,
  serviceBase: 'http://manager.local',
  stateKnown: true,
  replaced: [] as unknown[],
  removed: [] as string[],
}));
// A stateful stand-in, so an alias replaced after a key write shows without a remount.
vi.mock('@/hooks/useApiKeyAliases', async () => {
  const { useState } = await import('react');
  return {
    useApiKeyAliases: () => {
      const [aliases, setAliases] = useState<ApiKeyAlias[]>(aliasState.aliases);
      return {
        aliases,
        available: aliasState.available,
        loading: false,
        serviceBase: aliasState.serviceBase,
        managementKey: 'management-key',
        stateKnown: aliasState.stateKnown,
        reload: () => undefined,
        replaceAliases: (items: ApiKeyAlias[]) => {
          aliasState.replaced.push(items);
          setAliases(items);
        },
        removeAlias: (hash: string) => {
          aliasState.removed.push(hash);
          setAliases((previous) => previous.filter((item) => item.apiKeyHash !== hash));
        },
      };
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const KEY_A = 'sk-alpha-0123456789abcdef';
const KEY_B = 'sk-bravo-fedcba9876543210';
const KEY_C = 'sk-charlie-00112233445566';
const hashOf = (key: string) => sha256Hex(key).toLowerCase();
const initialConfigState = useConfigStore.getState();
let renderer: ReactTestRenderer | undefined;
let revision = 0;
let hook!: KeyProfilesState;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const sharedProfile = (): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: {},
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  claudeFallback: { enabled: true, mode: 'auto', mappings: [] },
});
const ownProfile = (): RoutingProfile => ({
  sessionAffinity: false,
  preferredAccounts: { claude: 'claude-1' },
  selection: { primary: 'priority', tiebreak: 'fill-first' },
  claudeFallback: { enabled: false, mode: 'auto', mappings: [] },
});
const profilesState = (keys: RoutingProfilesState['keys'] = []): RoutingProfilesState => ({
  supported: true,
  unsupportedBackend: false,
  shared: sharedProfile(),
  keys,
  selectionOptions: {
    narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
    pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
  },
});
const config = (keys: string[] = [KEY_A, KEY_B], ttl?: string): Config => ({
  raw: { access: { 'api-keys': keys } },
  codexFastMode: false,
  ...(ttl === undefined ? {} : { routingSessionAffinityTTL: ttl }),
});

const capture = (value: KeyProfilesState) => {
  hook = value;
};

async function mount(disabled = false) {
  function Harness() {
    capture(useKeyProfiles(disabled));
    return null;
  }
  await act(async () => {
    renderer = create(createElement(Harness));
  });
}

const unknownKeyMessage = 'This key was removed on the Config page. The key list was reloaded.';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  revision = 0;
  aliasState.aliases = [];
  aliasState.available = true;
  aliasState.serviceBase = 'http://manager.local';
  aliasState.stateKnown = true;
  aliasState.replaced = [];
  aliasState.removed = [];
  vi.spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
  useConfigStore.setState(initialConfigState, true);
  useConfigStore.setState({ fetchConfig: vi.fn(async () => config()) });
  vi.spyOn(routingProfilesApi, 'get').mockResolvedValue(
    profilesState([{ key: KEY_B, profile: ownProfile() }])
  );
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  useConfigStore.setState(initialConfigState, true);
});

describe('useKeyProfiles', () => {
  test('loads every client key with its profile and the N/M counts', async () => {
    aliasState.aliases = [{ apiKeyHash: sha256Hex(KEY_A).toLowerCase(), alias: 'Laptop' }];
    await mount();
    expect(hook.loading).toBe(false);
    expect(hook.error).toBe('');
    expect(hook.state?.supported).toBe(true);
    expect(hook.count).toBe(1);
    expect(hook.total).toBe(2);
    expect(hook.rows.map((row) => [row.key, row.profile !== null, row.hasAlias])).toEqual([
      [KEY_A, false, true],
      [KEY_B, true, false],
    ]);
    expect(hook.rows[0].label).toBe('Laptop');
    expect(hook.rows[1].label).toBe(hook.rows[1].masked);
    expect(hook.rows[1].label).not.toContain(KEY_B);
    // The first load shares the toolbar's cached config.
    expect(useConfigStore.getState().fetchConfig).toHaveBeenCalledExactlyOnceWith(false);
  });

  test('does not load while disabled', async () => {
    await mount(true);
    expect(routingProfilesApi.get).not.toHaveBeenCalled();
    expect(hook.state).toBeNull();
    expect(hook.rows).toEqual([]);
  });

  test('a key save replaces the state with the read-back result', async () => {
    const saved = profilesState([
      { key: KEY_A, profile: ownProfile() },
      { key: KEY_B, profile: ownProfile() },
    ]);
    const save = vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockResolvedValue(saved);
    const clearCache = vi.fn();
    useConfigStore.setState({ clearCache });
    await mount();
    let result = false;
    await act(async () => {
      result = await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(result).toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      KEY_A,
      ownProfile(),
      profilesState().selectionOptions
    );
    expect(hook.state).toBe(saved);
    expect(hook.count).toBe(2);
    expect(hook.saving).toBe(false);
    expect(clearCache).toHaveBeenCalled();
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(1);
  });

  test('a reset to the shared settings sends null', async () => {
    const save = vi
      .spyOn(routingProfilesApi, 'saveKeyProfile')
      .mockResolvedValue(profilesState([]));
    await mount();
    await act(async () => {
      await hook.saveKeyProfile(KEY_B, null);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(KEY_B, null, profilesState().selectionOptions);
    expect(hook.count).toBe(0);
    expect(hook.rows[1].profile).toBeNull();
  });

  test('ignores a second save while one is in flight', async () => {
    const pending = deferred<RoutingProfilesState>();
    const save = vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockReturnValue(pending.promise);
    await mount();
    let first!: Promise<boolean>;
    let second = true;
    await act(async () => {
      first = hook.saveKeyProfile(KEY_A, ownProfile());
      second = await hook.saveKeyProfile(KEY_B, null);
    });
    expect(second).toBe(false);
    expect(hook.saving).toBe(true);
    await act(async () => {
      pending.resolve(profilesState());
      await first;
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(hook.saving).toBe(false);
  });
});

describe('useKeyProfiles errors', () => {
  test('a backend without /routing/profiles is unsupported and does not save', async () => {
    vi.mocked(routingProfilesApi.get).mockResolvedValue(unsupportedRoutingProfiles());
    const save = vi.spyOn(routingProfilesApi, 'saveKeyProfile');
    await mount();
    expect(hook.state).toMatchObject({ supported: false, unsupportedBackend: true });
    expect(hook.error).toBe('');
    expect(hook.count).toBe(0);
    expect(hook.total).toBe(2);
    let result = true;
    await act(async () => {
      result = await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(result).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  test('keys stay masked when aliases are unavailable', async () => {
    aliasState.available = false;
    aliasState.aliases = [{ apiKeyHash: sha256Hex(KEY_A).toLowerCase(), alias: 'Laptop' }];
    await mount();
    expect(hook.rows.every((row) => !row.hasAlias && row.label === row.masked)).toBe(true);
    expect(JSON.stringify(hook.rows.map(({ label, masked }) => [label, masked]))).not.toMatch(
      /sk-alpha-0123456789abcdef|sk-bravo-fedcba9876543210/
    );
  });

  test('a load failure sets the error', async () => {
    vi.mocked(routingProfilesApi.get).mockRejectedValue(new Error('offline'));
    await mount();
    expect(hook.loading).toBe(false);
    expect(hook.state).toBeNull();
    expect(hook.error).toBe('offline');
  });

  test('a reload keeps the last loaded state while it runs and after it fails', async () => {
    await mount();
    const loaded = hook.state;
    const pending = deferred<RoutingProfilesState>();
    vi.mocked(routingProfilesApi.get).mockReturnValueOnce(pending.promise);
    await act(async () => hook.reload());
    expect(hook.loading).toBe(true);
    expect(hook.state).toBe(loaded);
    expect([hook.count, hook.total]).toEqual([1, 2]);
    await act(async () => pending.reject(new Error('offline')));
    expect(hook.loading).toBe(false);
    expect(hook.error).toBe('offline');
    expect(hook.state).toBe(loaded);
    expect([hook.count, hook.total]).toEqual([1, 2]);
  });

  test('a connection change drops the previous connection state', async () => {
    await mount();
    expect(hook.state).not.toBeNull();
    vi.mocked(routingProfilesApi.get).mockRejectedValue(new Error('offline'));
    revision += 1;
    await act(async () => hook.reload());
    expect(hook.state).toBeNull();
    expect([hook.count, hook.total]).toEqual([0, 0]);
    expect(hook.error).toBe('offline');
  });

  test('a 400 for a removed key reloads the list and keeps its message', async () => {
    vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockRejectedValue(new UnknownApiKeyError());
    const fetchConfig = vi
      .fn<(force?: boolean) => Promise<Config>>()
      .mockResolvedValue(config([KEY_B]))
      .mockResolvedValueOnce(config());
    useConfigStore.setState({ fetchConfig });
    await mount();
    let result = true;
    await act(async () => {
      result = await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(result).toBe(false);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
    expect(fetchConfig).toHaveBeenLastCalledWith(true);
    expect(hook.error).toBe(unknownKeyMessage);
    expect(hook.total).toBe(1);
    expect(hook.rows.map((row) => row.key)).toEqual([KEY_B]);
    // An explicit reload, such as reopening the modal, clears the message.
    await act(async () => hook.reload());
    expect(hook.error).toBe('');
  });

  test('a 422 shows the backend message and keeps the loaded state', async () => {
    const message = 'routing.key-profiles.ab12cd34ef56.selection.primary: unknown slot';
    vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockRejectedValue(
      new InvalidRoutingConfigError(message)
    );
    await mount();
    const loaded = hook.state;
    await act(async () => {
      await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(hook.error).toBe(message);
    expect(hook.state).toBe(loaded);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(1);
  });

  test('a failed read-back reloads the stored state', async () => {
    vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockRejectedValue(
      new Error('CPA did not retain the routing profile')
    );
    await mount();
    await act(async () => {
      await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    expect(hook.error).toBe('CPA did not retain the routing profile');
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
  });

  test('a connection change discards a stale load and loads again', async () => {
    const stale = deferred<RoutingProfilesState>();
    const fresh = profilesState([]);
    vi.mocked(routingProfilesApi.get).mockResolvedValue(fresh).mockReturnValueOnce(stale.promise);
    await mount();
    expect(hook.loading).toBe(true);
    revision += 1;
    await act(async () => {
      stale.resolve(profilesState([{ key: KEY_A, profile: ownProfile() }]));
    });
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
    expect(hook.state).toBe(fresh);
    expect(hook.count).toBe(0);
    expect(hook.error).toBe('');
  });

  test('a connection change discards a stale load error', async () => {
    const stale = deferred<RoutingProfilesState>();
    const fresh = profilesState([]);
    vi.mocked(routingProfilesApi.get).mockResolvedValue(fresh).mockReturnValueOnce(stale.promise);
    await mount();
    revision += 1;
    await act(async () => {
      stale.reject(new Error('old connection failed'));
    });
    expect(hook.state).toBe(fresh);
    expect(hook.error).toBe('');
  });

  test('a connection change discards a stale save result and error', async () => {
    const pending = deferred<RoutingProfilesState>();
    vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockReturnValue(pending.promise);
    const clearCache = vi.fn();
    useConfigStore.setState({ clearCache });
    await mount();
    let result!: Promise<boolean>;
    await act(async () => {
      result = hook.saveKeyProfile(KEY_A, ownProfile());
    });
    revision += 1;
    const stale = profilesState([
      { key: KEY_A, profile: ownProfile() },
      { key: KEY_B, profile: ownProfile() },
    ]);
    await act(async () => {
      pending.resolve(stale);
    });
    await expect(result).resolves.toBe(false);
    expect(hook.state).not.toBe(stale);
    expect(hook.count).toBe(1);
    expect(clearCache).not.toHaveBeenCalled();
    expect(hook.error).toBe('');
    expect(hook.saving).toBe(false);
  });
});

describe('useKeyProfiles shared profile', () => {
  test('ttl comes from the loaded config, with 1h when it is missing', async () => {
    await mount();
    expect(hook.ttl).toBe('1h');
    await act(async () => renderer?.unmount());
    useConfigStore.setState({ fetchConfig: vi.fn(async () => config(undefined, '30m')) });
    await mount();
    expect(hook.ttl).toBe('30m');
  });

  test('a shared save writes the profile and TTL, then reloads profiles and config', async () => {
    const saved = profilesState([{ key: KEY_B, profile: ownProfile() }]);
    const save = vi.spyOn(routingProfilesApi, 'saveSharedProfile').mockResolvedValue(saved);
    const fetchConfig = vi
      .fn<(force?: boolean) => Promise<Config>>()
      .mockResolvedValue(config(undefined, '24h'))
      .mockResolvedValueOnce(config(undefined, '30m'));
    useConfigStore.setState({ fetchConfig });
    await mount();
    expect(hook.ttl).toBe('30m');
    let result = false;
    await act(async () => {
      result = await hook.saveShared(ownProfile(), '24h');
    });
    expect(result).toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      ownProfile(),
      '24h',
      profilesState().selectionOptions
    );
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
    expect(fetchConfig).toHaveBeenLastCalledWith(true);
    expect(hook.ttl).toBe('24h');
    expect(hook.error).toBe('');
    expect(hook.saving).toBe(false);
  });

  test('a shared save works while per-key profiles are inert', async () => {
    vi.mocked(routingProfilesApi.get).mockResolvedValue({ ...profilesState(), supported: false });
    const save = vi
      .spyOn(routingProfilesApi, 'saveSharedProfile')
      .mockResolvedValue({ ...profilesState(), supported: false });
    await mount();
    let result = false;
    await act(async () => {
      result = await hook.saveShared(sharedProfile());
    });
    expect(result).toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      sharedProfile(),
      undefined,
      profilesState().selectionOptions
    );
  });

  test('a shared save is refused on a backend without /routing/profiles', async () => {
    vi.mocked(routingProfilesApi.get).mockResolvedValue(unsupportedRoutingProfiles());
    const save = vi.spyOn(routingProfilesApi, 'saveSharedProfile');
    await mount();
    let result = true;
    await act(async () => {
      result = await hook.saveShared(sharedProfile());
    });
    expect(result).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  test('a failed shared save keeps its message through the reload it triggers', async () => {
    vi.spyOn(routingProfilesApi, 'saveSharedProfile').mockRejectedValue(
      new Error('CPA did not retain the routing profile')
    );
    await mount();
    await act(async () => {
      await hook.saveShared(sharedProfile(), '2h');
    });
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
    expect(hook.loading).toBe(false);
    expect(hook.error).toBe('CPA did not retain the routing profile');
    expect(hook.ttl).toBe('1h');
  });
});

describe('useKeyProfiles client keys', () => {
  test('aliases are editable only with a known alias state on a reachable service', async () => {
    await mount();
    expect(hook.aliasesEditable).toBe(true);
    await act(async () => renderer!.unmount());

    aliasState.stateKnown = false;
    await mount();
    expect(hook.aliasesEditable).toBe(false);
    await act(async () => renderer!.unmount());

    aliasState.stateKnown = true;
    aliasState.serviceBase = '';
    await mount();
    expect(hook.aliasesEditable).toBe(false);
  });

  test('adding a key reloads config and profiles and shows its alias on the new row', async () => {
    const add = vi
      .spyOn(clientKeysApi, 'addClientKey')
      .mockResolvedValue({ aliases: [{ apiKeyHash: hashOf(KEY_C), alias: 'Desk' }] });
    const fetchConfig = vi
      .fn<(force?: boolean) => Promise<Config>>()
      .mockResolvedValue(config([KEY_A, KEY_B, KEY_C]))
      .mockResolvedValueOnce(config());
    useConfigStore.setState({ fetchConfig });
    await mount();
    expect(hook.total).toBe(2);
    let result!: Awaited<ReturnType<KeyProfilesState['addKey']>>;
    await act(async () => {
      result = await hook.addKey(KEY_C, 'Desk');
    });
    expect(result).toEqual({ ok: true });
    expect(add).toHaveBeenCalledExactlyOnceWith(KEY_C, 'Desk', {
      serviceBase: 'http://manager.local',
      managementKey: 'management-key',
      aliases: [],
      aliasStateKnown: true,
    });
    expect(aliasState.replaced).toHaveLength(1);
    expect(fetchConfig).toHaveBeenLastCalledWith(true);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
    expect(hook.total).toBe(3);
    const row = hook.rows.find((entry) => entry.key === KEY_C);
    expect(row?.label).toBe('Desk');
    expect(row?.profile).toBeNull();
  });

  test('removing a key reloads, drops its alias and its profile row', async () => {
    aliasState.aliases = [{ apiKeyHash: hashOf(KEY_B), alias: 'Phone' }];
    const remove = vi
      .spyOn(clientKeysApi, 'removeClientKey')
      .mockResolvedValue({ removedAliasHash: hashOf(KEY_B) });
    const fetchConfig = vi
      .fn<(force?: boolean) => Promise<Config>>()
      .mockResolvedValue(config([KEY_A]))
      .mockResolvedValueOnce(config());
    useConfigStore.setState({ fetchConfig });
    vi.mocked(routingProfilesApi.get)
      .mockResolvedValue(profilesState([]))
      .mockResolvedValueOnce(profilesState([{ key: KEY_B, profile: ownProfile() }]));
    await mount();
    expect(hook.count).toBe(1);
    let result!: Awaited<ReturnType<KeyProfilesState['removeKey']>>;
    await act(async () => {
      result = await hook.removeKey(KEY_B);
    });
    expect(result).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledExactlyOnceWith(
      KEY_B,
      expect.objectContaining({ aliases: [{ apiKeyHash: hashOf(KEY_B), alias: 'Phone' }] })
    );
    expect(aliasState.removed).toEqual([hashOf(KEY_B)]);
    expect(fetchConfig).toHaveBeenLastCalledWith(true);
    expect(hook.rows.map((row) => row.key)).toEqual([KEY_A]);
    expect(hook.count).toBe(0);
  });

  test('add and remove work while per-key profiles are inert', async () => {
    vi.mocked(routingProfilesApi.get).mockResolvedValue({ ...profilesState(), supported: false });
    const add = vi.spyOn(clientKeysApi, 'addClientKey').mockResolvedValue({});
    const remove = vi.spyOn(clientKeysApi, 'removeClientKey').mockResolvedValue({});
    await mount();
    let added!: Awaited<ReturnType<KeyProfilesState['addKey']>>;
    let removed!: Awaited<ReturnType<KeyProfilesState['removeKey']>>;
    await act(async () => {
      added = await hook.addKey(KEY_C);
    });
    await act(async () => {
      removed = await hook.removeKey(KEY_A);
    });
    expect([added.ok, removed.ok]).toEqual([true, true]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('does not write keys while disabled', async () => {
    const add = vi.spyOn(clientKeysApi, 'addClientKey');
    await mount(true);
    let result!: Awaited<ReturnType<KeyProfilesState['addKey']>>;
    await act(async () => {
      result = await hook.addKey(KEY_C);
    });
    expect(result).toEqual({ ok: false });
    expect(add).not.toHaveBeenCalled();
  });

  test.each([
    [
      new InvalidClientKeyError(),
      'The key may contain only visible ASCII characters, without spaces.',
    ],
    [new DuplicateClientKeyError(), 'This key is already in the configuration.'],
    [new InvalidAliasError('empty'), 'The alias cannot be empty.'],
    [new InvalidAliasError('too_long'), 'The alias must be at most 120 characters.'],
    [new DuplicateAliasError(), 'Another key already uses this alias.'],
    [new AliasStateUnknownError(), 'The key alias state could not be confirmed. Try again later.'],
  ])('an add rejected with %s shows its message without a reload', async (error, message) => {
    vi.spyOn(clientKeysApi, 'addClientKey').mockRejectedValue(error);
    await mount();
    let result!: Awaited<ReturnType<KeyProfilesState['addKey']>>;
    await act(async () => {
      result = await hook.addKey(KEY_C, 'Desk');
    });
    expect(result).toEqual({ ok: false });
    expect(hook.error).toBe(message);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(1);
  });

  test('removing the last key shows its message', async () => {
    vi.spyOn(clientKeysApi, 'removeClientKey').mockRejectedValue(new LastClientKeyError());
    await mount();
    await act(async () => {
      await hook.removeKey(KEY_A);
    });
    expect(hook.error).toBe('The last client key cannot be deleted.');
  });

  test('removing a key that is already gone reloads the list', async () => {
    vi.spyOn(clientKeysApi, 'removeClientKey').mockRejectedValue(new UnknownApiKeyError());
    await mount();
    await act(async () => {
      await hook.removeKey(KEY_A);
    });
    expect(hook.error).toBe(unknownKeyMessage);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
  });

  test('a generic key write failure reloads and keeps its message', async () => {
    vi.spyOn(clientKeysApi, 'addClientKey').mockRejectedValue(new Error('network down'));
    await mount();
    await act(async () => {
      await hook.addKey(KEY_C);
    });
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
    expect(hook.error).toBe('network down');
  });

  test('an alias failure after the key was written returns ok with a warning', async () => {
    vi.spyOn(clientKeysApi, 'addClientKey').mockResolvedValue({
      aliasError: new AliasWriteError('alias service offline'),
    });
    vi.spyOn(clientKeysApi, 'removeClientKey').mockResolvedValue({
      aliasError: new AliasWriteError('alias service offline'),
    });
    await mount();
    let added!: Awaited<ReturnType<KeyProfilesState['addKey']>>;
    let removed!: Awaited<ReturnType<KeyProfilesState['removeKey']>>;
    await act(async () => {
      added = await hook.addKey(KEY_C, 'Desk');
    });
    await act(async () => {
      removed = await hook.removeKey(KEY_A);
    });
    expect(added).toEqual({
      ok: true,
      aliasWarning: 'The key was saved, but its alias was not: alias service offline',
    });
    expect(removed).toEqual({
      ok: true,
      aliasWarning: 'The key was deleted, but its alias was not: alias service offline',
    });
    expect(aliasState.replaced).toEqual([]);
    expect(hook.error).toBe('');
  });

  test('a connection change drops a stale key write result', async () => {
    const pending = deferred<{ aliases: ApiKeyAlias[] }>();
    vi.spyOn(clientKeysApi, 'addClientKey').mockReturnValue(pending.promise);
    await mount();
    let result!: Promise<Awaited<ReturnType<KeyProfilesState['addKey']>>>;
    await act(async () => {
      result = hook.addKey(KEY_C, 'Desk');
    });
    revision += 1;
    await act(async () => {
      pending.resolve({ aliases: [{ apiKeyHash: hashOf(KEY_C), alias: 'Desk' }] });
    });
    await expect(result).resolves.toEqual({ ok: false });
    expect(aliasState.replaced).toEqual([]);
    expect(hook.saving).toBe(false);
    expect(hook.error).toBe('');
  });

  test('a connection change drops a stale key write error', async () => {
    const pending = deferred<never>();
    vi.spyOn(clientKeysApi, 'removeClientKey').mockReturnValue(pending.promise);
    await mount();
    let result!: Promise<Awaited<ReturnType<KeyProfilesState['removeKey']>>>;
    await act(async () => {
      result = hook.removeKey(KEY_A);
    });
    revision += 1;
    await act(async () => {
      pending.reject(new Error('old connection failed'));
    });
    await expect(result).resolves.toEqual({ ok: false });
    expect(hook.error).toBe('');
  });
});
