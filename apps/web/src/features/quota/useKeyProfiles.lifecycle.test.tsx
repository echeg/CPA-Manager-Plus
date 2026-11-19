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
  ConfigChangedError,
  DefaultCopyUnconfirmedError,
  providersFromClaudeFallback,
  InvalidRoutingConfigError,
  UnknownApiKeyError,
  routingProfilesApi,
  unsupportedRoutingProfiles,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { useConfigStore } from '@/features/personal-quota-support/stores/useConfigStore';
import type { Config } from '@/features/personal-quota-support/types';
import { providersApi } from '@/services/api/providers';
import type { ApiKeyAlias } from '@/services/api/usageService';
import { sha256Hex } from '@/utils/apiKeyHash';
import { withCodexSpeed } from './codexSpeedModel';
import { useKeyProfiles, type KeyProfilesState } from './hooks/useKeyProfiles';
import { copyOfShared } from './keyProfilesModel';

const aliasState = vi.hoisted(() => ({
  aliases: [] as ApiKeyAlias[],
  available: true,
  serviceBase: 'http://manager.local',
  stateKnown: true,
  replaced: [] as unknown[],
  removed: [] as string[],
  reloads: 0,
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
        reload: () => {
          aliasState.reloads += 1;
        },
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
/** Keys with their own profile among the hook's rows. */
const ownProfiles = () => hook.rows.filter((row) => row.profile !== null).length;

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
  providers: providersFromClaudeFallback({ enabled: true, mode: 'auto', mappings: [] }),
});
const ownProfile = (): RoutingProfile => ({
  sessionAffinity: false,
  preferredAccounts: { claude: 'claude-1' },
  selection: { primary: 'priority', tiebreak: 'fill-first' },
  providers: providersFromClaudeFallback({ enabled: false, mode: 'auto', mappings: [] }),
});
const profilesState = (keys: RoutingProfilesState['keys'] = []): RoutingProfilesState => ({
  supported: true,
  unsupportedBackend: false,
  providersSupported: true,
  speedSupported: true,
  providerToggleSupported: false,
  apiCredentials: { claude: [], codex: [] },
  shared: sharedProfile(),
  keys,
  selectionOptions: {
    narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
    pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
  },
});
const config = (keys: string[] = [KEY_A, KEY_B], ttl?: string): Config => ({
  raw: { access: { 'api-keys': keys } },
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

const unknownKeyMessage = 'This key was removed on the Config page, so nothing was saved.';
/** The config ETag a speed table write of a key row is conditional on. */
const CONFIG_VERSION = '"config-v1"';
/**
 * The stored config as `configSnapshot` reads it: KEY_A and KEY_B are client keys, as
 * in `config`, and KEY_B owns a profile, as in `get`.
 */
const snapshot = (
  version = CONFIG_VERSION,
  profiledKeys: string[] = [KEY_B],
  clientKeys: string[] = [KEY_A, KEY_B]
) => ({
  version,
  clientKeys: new Set(clientKeys),
  profiledKeys: new Set(profiledKeys),
  legacyClaudeFallback: { shared: false, keys: new Set<string>() },
});

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
  aliasState.reloads = 0;
  vi.spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
  useConfigStore.setState(initialConfigState, true);
  useConfigStore.setState({ fetchConfig: vi.fn(async () => config()) });
  vi.spyOn(routingProfilesApi, 'get').mockResolvedValue(
    profilesState([{ key: KEY_B, profile: ownProfile() }])
  );
  vi.spyOn(routingProfilesApi, 'configSnapshot').mockResolvedValue(snapshot());
  vi.spyOn(providersApi, 'getClaudeConfigs').mockResolvedValue([]);
  vi.spyOn(providersApi, 'getCodexConfigs').mockResolvedValue([]);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  useConfigStore.setState(initialConfigState, true);
});

describe('useKeyProfiles', () => {
  test('loads every client key with its profile and the key count', async () => {
    aliasState.aliases = [{ apiKeyHash: sha256Hex(KEY_A).toLowerCase(), alias: 'Laptop' }];
    await mount();
    expect(hook.loading).toBe(false);
    expect(hook.error).toBe('');
    expect(hook.state?.supported).toBe(true);
    expect(ownProfiles()).toBe(1);
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

  test('loads the provider API-key entries for labels without their raw keys', async () => {
    const rawClaude = 'sk-ant-api03-RAWCLAUDE-0123456789';
    vi.mocked(providersApi.getClaudeConfigs).mockResolvedValue([
      { apiKey: rawClaude, prefix: 'team-a', authIndex: 'claude-idx-1' },
    ]);
    vi.mocked(providersApi.getCodexConfigs).mockResolvedValue([
      { apiKey: 'sk-proj-RAWCODEX-99', authIndex: 'codex-idx-1', baseUrl: 'https://r.example' },
    ]);
    await mount();
    expect(hook.apiKeyConfigs).toEqual({
      claude: [{ authIndex: 'claude-idx-1', name: 'team-a', masked: 'sk******89', baseUrl: '' }],
      codex: [
        { authIndex: 'codex-idx-1', name: '', masked: 'sk******99', baseUrl: 'https://r.example' },
      ],
    });
    expect(JSON.stringify(hook.apiKeyConfigs)).not.toContain('RAW');
  });

  test('a failed API-key list leaves that provider empty and never blocks the profiles', async () => {
    vi.mocked(providersApi.getClaudeConfigs).mockRejectedValue(new Error('forbidden'));
    vi.mocked(providersApi.getCodexConfigs).mockResolvedValue([
      { apiKey: 'sk-proj-key-0011', authIndex: 'codex-idx-1' },
    ]);
    await mount();
    expect(hook.error).toBe('');
    expect(hook.state?.supported).toBe(true);
    expect(hook.apiKeyConfigs.claude).toEqual([]);
    expect(hook.apiKeyConfigs.codex).toHaveLength(1);
  });

  test('a pending API-key list does not hold back the profiles', async () => {
    const pending = deferred<never[]>();
    vi.mocked(providersApi.getClaudeConfigs).mockReturnValue(pending.promise);
    await mount();
    expect(hook.loading).toBe(false);
    expect(hook.state).not.toBeNull();
    expect(hook.apiKeyConfigs).toEqual({ claude: [], codex: [] });
    await act(async () => pending.resolve([]));
  });

  test('a connection change drops the API-key entries and a stale list', async () => {
    vi.mocked(providersApi.getCodexConfigs).mockResolvedValue([
      { apiKey: 'sk-proj-key-0011', authIndex: 'codex-idx-1' },
    ]);
    await mount();
    expect(hook.apiKeyConfigs.codex).toHaveLength(1);
    const stale = deferred<{ apiKey: string; authIndex: string }[]>();
    vi.mocked(providersApi.getCodexConfigs).mockReturnValue(stale.promise);
    revision += 1;
    await act(async () => hook.reload());
    expect(hook.apiKeyConfigs).toEqual({ claude: [], codex: [] });
    revision += 1;
    await act(async () => stale.resolve([{ apiKey: 'sk-proj-old-0022', authIndex: 'old' }]));
    expect(hook.apiKeyConfigs.codex).toEqual([]);
  });

  test('does not load while disabled', async () => {
    await mount(true);
    expect(routingProfilesApi.get).not.toHaveBeenCalled();
    expect(providersApi.getClaudeConfigs).not.toHaveBeenCalled();
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
      profilesState().selectionOptions,
      true,
      true
    );
    expect(hook.state).toBe(saved);
    expect(ownProfiles()).toBe(2);
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
    expect(save).toHaveBeenCalledExactlyOnceWith(
      KEY_B,
      null,
      profilesState().selectionOptions,
      true,
      true
    );
    expect(ownProfiles()).toBe(0);
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

  test('refuses every write while the profiles reload', async () => {
    const saveKey = vi.spyOn(routingProfilesApi, 'saveKeyProfile');
    const saveShared = vi.spyOn(routingProfilesApi, 'saveSharedProfile');
    const add = vi.spyOn(clientKeysApi, 'addClientKey');
    const remove = vi.spyOn(clientKeysApi, 'removeClientKey');
    await mount();
    const pending = deferred<RoutingProfilesState>();
    vi.mocked(routingProfilesApi.get).mockReturnValueOnce(pending.promise);
    await act(async () => hook.reload());
    expect(hook.loading).toBe(true);

    const results: unknown[] = [];
    await act(async () => {
      results.push(await hook.saveKeyProfile(KEY_A, ownProfile()));
      results.push(await hook.saveShared(sharedProfile()));
      results.push(await hook.addKey(KEY_C));
      results.push(await hook.removeKey(KEY_A));
    });
    expect(results).toEqual([false, false, { ok: false }, { ok: false }]);
    for (const spy of [saveKey, saveShared, add, remove]) expect(spy).not.toHaveBeenCalled();
    expect(hook.saving).toBe(false);

    await act(async () => pending.resolve(profilesState()));
    expect(hook.loading).toBe(false);
  });

  test('a running shared save blocks key writes until it settles', async () => {
    const pending = deferred<RoutingProfilesState>();
    vi.spyOn(routingProfilesApi, 'saveSharedProfile').mockReturnValue(pending.promise);
    const add = vi.spyOn(clientKeysApi, 'addClientKey').mockResolvedValue({});
    const remove = vi.spyOn(clientKeysApi, 'removeClientKey');
    await mount();
    let first!: Promise<boolean>;
    const blocked: unknown[] = [];
    await act(async () => {
      first = hook.saveShared(sharedProfile());
      blocked.push(await hook.addKey(KEY_C));
      blocked.push(await hook.removeKey(KEY_A));
    });
    expect(blocked).toEqual([{ ok: false }, { ok: false }]);
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(hook.saving).toBe(true);

    await act(async () => {
      pending.resolve(profilesState());
      await first;
    });
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
    expect(ownProfiles()).toBe(0);
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
    expect([ownProfiles(), hook.total]).toEqual([1, 2]);
    await act(async () => pending.reject(new Error('offline')));
    expect(hook.loading).toBe(false);
    expect(hook.error).toBe('offline');
    expect(hook.state).toBe(loaded);
    expect([ownProfiles(), hook.total]).toEqual([1, 2]);
  });

  test('a connection change drops the previous connection state', async () => {
    await mount();
    expect(hook.state).not.toBeNull();
    vi.mocked(routingProfilesApi.get).mockRejectedValue(new Error('offline'));
    revision += 1;
    await act(async () => hook.reload());
    expect(hook.state).toBeNull();
    expect([ownProfiles(), hook.total]).toEqual([0, 0]);
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
    expect(ownProfiles()).toBe(0);
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
    expect(ownProfiles()).toBe(1);
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
      profilesState().selectionOptions,
      true,
      true
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
      profilesState().selectionOptions,
      true,
      true
    );
  });

  test('saves on an older backend pass providersSupported false for the legacy body', async () => {
    const legacy = { ...profilesState(), providersSupported: false, speedSupported: false };
    vi.mocked(routingProfilesApi.get).mockResolvedValue(legacy);
    const saveKey = vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockResolvedValue(legacy);
    const saveShared = vi.spyOn(routingProfilesApi, 'saveSharedProfile').mockResolvedValue(legacy);
    await mount();
    await act(async () => {
      await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    await act(async () => {
      await hook.saveShared(sharedProfile());
    });
    expect(saveKey).toHaveBeenCalledExactlyOnceWith(
      KEY_A,
      ownProfile(),
      legacy.selectionOptions,
      false,
      false
    );
    expect(saveShared).toHaveBeenCalledExactlyOnceWith(
      sharedProfile(),
      undefined,
      legacy.selectionOptions,
      false,
      false
    );
  });

  test('saves on a backend without speed pass speedSupported false', async () => {
    const noSpeed = { ...profilesState(), speedSupported: false };
    vi.mocked(routingProfilesApi.get).mockResolvedValue(noSpeed);
    const saveKey = vi.spyOn(routingProfilesApi, 'saveKeyProfile').mockResolvedValue(noSpeed);
    const saveShared = vi.spyOn(routingProfilesApi, 'saveSharedProfile').mockResolvedValue(noSpeed);
    await mount();
    await act(async () => {
      await hook.saveKeyProfile(KEY_A, ownProfile());
    });
    await act(async () => {
      await hook.saveShared(sharedProfile());
    });
    expect(saveKey).toHaveBeenCalledExactlyOnceWith(
      KEY_A,
      ownProfile(),
      noSpeed.selectionOptions,
      true,
      false
    );
    expect(saveShared).toHaveBeenCalledExactlyOnceWith(
      sharedProfile(),
      undefined,
      noSpeed.selectionOptions,
      true,
      false
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

describe('useKeyProfiles Codex speed', () => {
  /**
   * The stored profiles after another tab changed the routing since the hook loaded:
   * the shared profile prefers a Codex account, and KEY_B's profile has a new selection.
   */
  const changedElsewhere = (): RoutingProfilesState => {
    const state = profilesState([
      {
        key: KEY_B,
        profile: { ...ownProfile(), selection: { primary: 'reserves', tiebreak: 'round-robin' } },
      },
    ]);
    return { ...state, shared: { ...state.shared, preferredAccounts: { codex: 'codex-9' } } };
  };

  test('a key with its own profile gets the changed field alone, conditional on the version', async () => {
    await mount();
    const stored = changedElsewhere();
    vi.mocked(routingProfilesApi.get).mockResolvedValue(stored);
    const saved = changedElsewhere();
    const saveField = vi.spyOn(routingProfilesApi, 'saveKeyCodexSpeed').mockResolvedValue(saved);
    const saveCopy = vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy');
    const clearCache = vi.fn();
    useConfigStore.setState({ clearCache });
    let result = false;
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_B, { speed: 'ultrafast' });
    });
    expect(result).toBe(true);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(2);
    // No other field is sent, so none can carry a value older than the stored one,
    // also when the profiles CPA has loaded lag an edit of the file.
    expect(saveField).toHaveBeenCalledExactlyOnceWith(
      KEY_B,
      { speed: 'ultrafast' },
      CONFIG_VERSION
    );
    expect(saveCopy).not.toHaveBeenCalled();
    // The version is read before the profiles, so a change saved after the reread
    // fails the conditional write instead of being undone by it.
    const [versionRead] = vi.mocked(routingProfilesApi.configSnapshot).mock.invocationCallOrder;
    const reread = vi.mocked(routingProfilesApi.get).mock.invocationCallOrder[1];
    expect(versionRead).toBeLessThan(reread);
    expect(hook.state).toBe(saved);
    expect(clearCache).toHaveBeenCalled();
    expect(hook.saving).toBe(false);
  });

  test('refuses a key write without a config version', async () => {
    await mount();
    const saveCopy = vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy');
    const saveField = vi.spyOn(routingProfilesApi, 'saveKeyCodexSpeed');
    const missing =
      "CPA's answer carried no usable configuration version (ETag), so a key's speed cannot be changed here without the risk of undoing a change made elsewhere. Nothing was saved; change the speed in the key's profile editor.";
    // Unconditional, either write could undo a change saved elsewhere after the reread,
    // and bring back a profile deleted meanwhile, so neither a key with its own
    // profile nor a key on the Default profile is written.
    vi.mocked(routingProfilesApi.configSnapshot).mockResolvedValue(snapshot('', [KEY_B]));
    for (const key of [KEY_B, KEY_A]) {
      let result = true;
      await act(async () => {
        result = await hook.saveCodexSpeed(key, { speed: 'fast' });
      });
      expect(result).toBe(false);
      expect(hook.error).toBe(missing);
      expect(hook.saving).toBe(false);
    }
    expect(saveField).not.toHaveBeenCalled();
    expect(saveCopy).not.toHaveBeenCalled();
    // Refused before the reread: nothing was written, so nothing is reloaded either.
    expect(routingProfilesApi.get).toHaveBeenCalledOnce();
    // The Default row merges one field and needs no version.
    const saveShared = vi
      .spyOn(routingProfilesApi, 'saveSharedCodexSpeed')
      .mockResolvedValue(profilesState());
    let result = false;
    await act(async () => {
      result = await hook.saveCodexSpeed(null, { speed: 'fast' });
    });
    expect(result).toBe(true);
    expect(saveShared).toHaveBeenCalledExactlyOnceWith({ speed: 'fast' });
  });

  test('writes nothing while the loaded profiles lag the stored config on a key profile', async () => {
    await mount();
    const saveField = vi.spyOn(routingProfilesApi, 'saveKeyCodexSpeed');
    const saveCopy = vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy');
    const changed =
      'The configuration changed elsewhere after it was read, so nothing was saved. Check the current values and try again.';
    // The file no longer holds KEY_B's profile, but CPA has not reloaded it yet.
    vi.mocked(routingProfilesApi.configSnapshot).mockResolvedValue(snapshot(CONFIG_VERSION, []));
    let result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_B, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(hook.error).toBe(changed);
    // The file gives KEY_A a profile that CPA has not loaded yet.
    vi.mocked(routingProfilesApi.configSnapshot).mockResolvedValue(
      snapshot(CONFIG_VERSION, [KEY_A, KEY_B])
    );
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_A, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(hook.error).toBe(changed);
    expect(saveField).not.toHaveBeenCalled();
    expect(saveCopy).not.toHaveBeenCalled();
    expect(hook.saving).toBe(false);
  });

  test('a key on the Default profile gets a full copy of the stored Default profile', async () => {
    await mount();
    const stored = changedElsewhere();
    vi.mocked(routingProfilesApi.get).mockResolvedValue(stored);
    const save = vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy').mockResolvedValue(stored);
    const saveProfile = vi.spyOn(routingProfilesApi, 'saveKeyProfile');
    await act(async () => {
      await hook.saveCodexSpeed(KEY_A, { ignoreClientTier: true });
    });
    const sent = withCodexSpeed(copyOfShared(stored.shared), { ignoreClientTier: true });
    // Passed with the read it was copied from, so the write can check that the version
    // it wrote holds that Default.
    expect(save).toHaveBeenCalledExactlyOnceWith(KEY_A, sent, stored, CONFIG_VERSION);
    expect(saveProfile).not.toHaveBeenCalled();
    expect(sent.preferredAccounts).toEqual({ codex: 'codex-9' });
  });

  test('a Default change patches the changed Codex field alone', async () => {
    await mount();
    const stored = changedElsewhere();
    vi.mocked(routingProfilesApi.get).mockResolvedValue(stored);
    const saved = changedElsewhere();
    const saveField = vi.spyOn(routingProfilesApi, 'saveSharedCodexSpeed').mockResolvedValue(saved);
    const saveProfile = vi.spyOn(routingProfilesApi, 'saveSharedProfile');
    let result = false;
    await act(async () => {
      result = await hook.saveCodexSpeed(null, { speed: 'fast' });
    });
    expect(result).toBe(true);
    // No full profile is sent, so a change another tab writes meanwhile is kept.
    expect(saveField).toHaveBeenCalledExactlyOnceWith({ speed: 'fast' });
    expect(saveProfile).not.toHaveBeenCalled();
    // The config is read for the legacy Claude fallback check only: a merged field of
    // the shared profile needs no config version.
    expect(routingProfilesApi.configSnapshot).toHaveBeenCalledTimes(1);
    expect(hook.state).toBe(saved);
  });

  test('a key write refused because the config changed shows why and reloads', async () => {
    await mount();
    vi.spyOn(routingProfilesApi, 'saveKeyCodexSpeed').mockRejectedValue(new ConfigChangedError());
    let result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_B, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(hook.error).toBe(
      'The configuration changed elsewhere after it was read, so nothing was saved. Check the current values and try again.'
    );
    // Mount, reread, then the reload after the refused write.
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(3);
    expect(hook.saving).toBe(false);
  });

  test('a click on a key deleted elsewhere writes nothing and reloads the key list', async () => {
    const fetchConfig = vi
      .fn<(force?: boolean) => Promise<Config>>()
      .mockResolvedValue(config([KEY_B]))
      .mockResolvedValueOnce(config());
    useConfigStore.setState({ fetchConfig });
    await mount();
    // Another tab deleted KEY_A, which was on the Default profile. A click on the speed
    // the Default profile already has would write nothing and keep the key shown.
    vi.mocked(routingProfilesApi.configSnapshot).mockResolvedValue(
      snapshot(CONFIG_VERSION, [KEY_B], [KEY_B])
    );
    const saveCopy = vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy');
    let result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_A, { speed: 'standard' });
    });
    expect(result).toBe(false);
    expect(saveCopy).not.toHaveBeenCalled();
    expect(hook.error).toBe(unknownKeyMessage);
    expect(fetchConfig).toHaveBeenLastCalledWith(true);
    expect(hook.rows.map((row) => row.key)).toEqual([KEY_B]);
    expect(hook.saving).toBe(false);
  });

  test('a copy of the Default the key may keep says so and reloads', async () => {
    await mount();
    vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy').mockRejectedValue(
      new DefaultCopyUnconfirmedError()
    );
    let result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_A, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(hook.error).toBe(
      'The key may now have its own profile: a copy of the Default profile that could not be confirmed. Refresh to see whether it has one, and reset it to default if the key should follow the Default profile.'
    );
    // Mount, reread, then the reload that shows whether the key kept the copy.
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(3);
    expect(hook.saving).toBe(false);
  });

  test('a write warning whose reload fails says the values shown may be out of date', async () => {
    await mount();
    const copyWarning =
      'The key may now have its own profile: a copy of the Default profile that could not be confirmed. Refresh to see whether it has one, and reset it to default if the key should follow the Default profile.';
    vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy').mockRejectedValue(
      new DefaultCopyUnconfirmedError()
    );
    // The reread succeeds; the reload after the write finds the connection down.
    vi.mocked(routingProfilesApi.get)
      .mockResolvedValueOnce(profilesState([{ key: KEY_B, profile: ownProfile() }]))
      .mockRejectedValueOnce(new Error('Network down'));
    await act(async () => {
      await hook.saveCodexSpeed(KEY_A, { speed: 'fast' });
    });
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(3);
    expect(hook.loading).toBe(false);
    // The rows are still those of the mount, which showed KEY_A on the Default profile:
    // the reload error is not hidden behind the write warning.
    expect(hook.rows[0].profile).toBeNull();
    expect(hook.error).toBe(
      `${copyWarning} The current values could not be loaded, so the values shown may be out of date: Network down`
    );
    // A user reload that fails too keeps the warning: the "Default" row it explains was
    // not reloaded either.
    vi.mocked(routingProfilesApi.get).mockRejectedValueOnce(new Error('Still down'));
    await act(async () => {
      hook.reload();
    });
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(4);
    expect(hook.rows[0].profile).toBeNull();
    expect(hook.error).toBe(
      `${copyWarning} The current values could not be loaded, so the values shown may be out of date: Still down`
    );
    // A reload that succeeds clears both.
    await act(async () => {
      hook.reload();
    });
    expect(hook.error).toBe('');
  });

  test('a write warning stays until a user reload loads, and the next write clears it', async () => {
    await mount();
    vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy').mockRejectedValue(
      new DefaultCopyUnconfirmedError()
    );
    await act(async () => {
      await hook.saveCodexSpeed(KEY_A, { speed: 'fast' });
    });
    expect(hook.error).toContain('The key may now have its own profile');
    // A reload still running shows the warning.
    const pending = deferred<RoutingProfilesState>();
    vi.mocked(routingProfilesApi.get).mockReturnValueOnce(pending.promise);
    await act(async () => {
      hook.reload();
    });
    expect(hook.loading).toBe(true);
    expect(hook.error).toContain('The key may now have its own profile');
    await act(async () => {
      pending.resolve(profilesState([{ key: KEY_B, profile: ownProfile() }]));
    });
    expect(hook.error).toBe('');
    // A failed user reload followed by a write: the write's own error is not cleared by
    // the reload that write triggers.
    vi.mocked(routingProfilesApi.get).mockRejectedValueOnce(new Error('Network down'));
    await act(async () => {
      hook.reload();
    });
    vi.mocked(routingProfilesApi.configSnapshot).mockResolvedValueOnce(
      snapshot(CONFIG_VERSION, [KEY_B], [KEY_B])
    );
    await act(async () => {
      await hook.saveCodexSpeed(KEY_A, { speed: 'fast' });
    });
    expect(hook.error).toBe('This key was removed on the Config page, so nothing was saved.');
  });

  test('a write that would drop a legacy Claude fallback is refused before any write', async () => {
    await mount();
    const saveShared = vi.spyOn(routingProfilesApi, 'saveSharedCodexSpeed');
    const saveKeyField = vi.spyOn(routingProfilesApi, 'saveKeyCodexSpeed');
    const saveCopy = vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy');
    const refuse = async (key: string | null) => {
      let result = true;
      await act(async () => {
        result = await hook.saveCodexSpeed(key, { speed: 'ultrafast' });
      });
      expect(result).toBe(false);
    };
    // The Default profile keeps it: CPA runs its merge on the shared profile for every
    // routing write, also one that names only a key.
    vi.mocked(routingProfilesApi.configSnapshot).mockResolvedValue({
      ...snapshot(),
      legacyClaudeFallback: { shared: true, keys: new Set() },
    });
    for (const key of [null, KEY_A, KEY_B]) {
      await refuse(key);
      expect(hook.error).toBe(
        'The Default profile keeps its Claude fallback in the old claude-fallback block beside an empty providers.claude.fallback, and CPA would drop that block on this change, which turns the fallback off. Nothing was saved; save the Default profile once in Profiles, then change the speed.'
      );
    }
    // Only KEY_B's own profile keeps it: a write of its speed is refused.
    vi.mocked(routingProfilesApi.configSnapshot).mockResolvedValue({
      ...snapshot(),
      legacyClaudeFallback: { shared: false, keys: new Set([KEY_B]) },
    });
    await refuse(KEY_B);
    expect(hook.error).toBe(
      "This key's profile keeps its Claude fallback in the old claude-fallback block beside an empty providers.claude.fallback, and CPA would drop that block on this change, which turns the fallback off. Nothing was saved; save the key's profile once in Profiles, then change the speed."
    );
    expect(saveShared).not.toHaveBeenCalled();
    expect(saveKeyField).not.toHaveBeenCalled();
    expect(saveCopy).not.toHaveBeenCalled();
    // Refused before any write, so nothing is reloaded: the mount and four rereads.
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(5);
    // A click on the value the row already gets writes nothing, so it is not refused.
    await act(async () => {
      await hook.saveCodexSpeed(KEY_B, { speed: 'standard' });
    });
    expect(hook.error).toBe('');
  });

  test('a failed config version read writes nothing', async () => {
    await mount();
    vi.mocked(routingProfilesApi.configSnapshot).mockRejectedValueOnce(new Error('Network down'));
    const save = vi.spyOn(routingProfilesApi, 'saveKeyCodexSpeed');
    let result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_B, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(hook.error).toBe('Network down');
    expect(hook.saving).toBe(false);
  });

  /** Codex on an API key, and Claude not falling back to Codex: CPA uses no Codex speed. */
  const speedUnused = (profile: RoutingProfile): RoutingProfile => ({
    ...profile,
    providers: {
      claude: {
        ...profile.providers.claude,
        fallback: { ...profile.providers.claude.fallback, target: 'off' },
      },
      codex: { ...profile.providers.codex, mode: 'api' },
    },
  });

  test('writes nothing when the stored row no longer uses the speed', async () => {
    await mount();
    const saveKey = vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy');
    const saveKeyField = vi.spyOn(routingProfilesApi, 'saveKeyCodexSpeed');
    const saveField = vi.spyOn(routingProfilesApi, 'saveSharedCodexSpeed');
    // Another tab moved the Default profile to Codex API key mode without a fallback.
    const stored = { ...profilesState(), shared: speedUnused(sharedProfile()) };
    vi.mocked(routingProfilesApi.get).mockResolvedValue(stored);
    let result = true;
    await act(async () => {
      // KEY_A inherits the Default profile, so it must not get an own profile now.
      result = await hook.saveCodexSpeed(KEY_A, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(hook.state).toBe(stored);
    result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(null, { speed: 'fast' });
    });
    expect(result).toBe(false);
    // A key whose own profile moved to API key mode is not written either.
    vi.mocked(routingProfilesApi.get).mockResolvedValue(
      profilesState([{ key: KEY_B, profile: speedUnused(ownProfile()) }])
    );
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_B, { ignoreClientTier: true });
    });
    expect(result).toBe(false);
    expect(saveKey).not.toHaveBeenCalled();
    expect(saveKeyField).not.toHaveBeenCalled();
    expect(saveField).not.toHaveBeenCalled();
    expect(hook.saving).toBe(false);
  });

  test('a Default speed is written under supported: false even with a stored API key mode', async () => {
    const locked = { ...profilesState(), supported: false, shared: speedUnused(sharedProfile()) };
    vi.mocked(routingProfilesApi.get).mockResolvedValue(locked);
    await mount();
    const saveField = vi
      .spyOn(routingProfilesApi, 'saveSharedCodexSpeed')
      .mockResolvedValue(locked);
    let result = false;
    await act(async () => {
      result = await hook.saveCodexSpeed(null, { speed: 'ultrafast' });
    });
    // CPA ignores the stored mode there and applies the shared speed to every request.
    expect(result).toBe(true);
    expect(saveField).toHaveBeenCalledExactlyOnceWith({ speed: 'ultrafast' });
  });

  test('a click on the value a row already gets writes nothing', async () => {
    await mount();
    const saveKey = vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy');
    const saveKeyField = vi.spyOn(routingProfilesApi, 'saveKeyCodexSpeed');
    const saveField = vi.spyOn(routingProfilesApi, 'saveSharedCodexSpeed');
    // The table opened on Standard; another tab has set the Default profile to Fast since.
    const shared = withCodexSpeed(sharedProfile(), { speed: 'fast' });
    const stored = profilesState([
      { key: KEY_B, profile: withCodexSpeed(ownProfile(), { speed: 'fast' }) },
    ]);
    vi.mocked(routingProfilesApi.get).mockResolvedValue({ ...stored, shared });
    let result = true;
    await act(async () => {
      // KEY_A already gets Fast from the Default profile: it stays on the Default profile.
      result = await hook.saveCodexSpeed(KEY_A, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(hook.state?.shared).toBe(shared);
    expect(ownProfiles()).toBe(1);
    await act(async () => {
      await hook.saveCodexSpeed(KEY_B, { speed: 'fast' });
      await hook.saveCodexSpeed(null, { speed: 'fast', ignoreClientTier: false });
    });
    expect(saveKey).not.toHaveBeenCalled();
    expect(saveKeyField).not.toHaveBeenCalled();
    expect(saveField).not.toHaveBeenCalled();
    expect(hook.saving).toBe(false);
  });

  test('writes nothing when the reread shows that the change no longer applies', async () => {
    await mount();
    const saveKey = vi
      .spyOn(routingProfilesApi, 'saveKeyDefaultCopy')
      .mockResolvedValue(profilesState());
    const saveKeyField = vi
      .spyOn(routingProfilesApi, 'saveKeyCodexSpeed')
      .mockResolvedValue(profilesState());
    const saveShared = vi
      .spyOn(routingProfilesApi, 'saveSharedCodexSpeed')
      .mockResolvedValue(profilesState());
    // Key profiles are no longer used, for example after a scheduler plugin was enabled.
    vi.mocked(routingProfilesApi.get).mockResolvedValue({ ...profilesState(), supported: false });
    let result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_B, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(hook.state?.supported).toBe(false);
    // The backend no longer serves the speed.
    vi.mocked(routingProfilesApi.get).mockResolvedValue({
      ...profilesState(),
      speedSupported: false,
    });
    result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(null, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(hook.state?.speedSupported).toBe(false);
    expect(saveKey).not.toHaveBeenCalled();
    expect(saveKeyField).not.toHaveBeenCalled();
    expect(saveShared).not.toHaveBeenCalled();
    expect(hook.saving).toBe(false);
  });

  test('a key change is refused without a request while key profiles are not used', async () => {
    vi.mocked(routingProfilesApi.get).mockResolvedValue({ ...profilesState(), supported: false });
    await mount();
    const save = vi.spyOn(routingProfilesApi, 'saveKeyDefaultCopy');
    const saveField = vi.spyOn(routingProfilesApi, 'saveKeyCodexSpeed');
    let result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(KEY_B, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(1);
    expect(routingProfilesApi.configSnapshot).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(saveField).not.toHaveBeenCalled();
  });

  test('a failed reread shows its error and writes nothing', async () => {
    await mount();
    vi.mocked(routingProfilesApi.get).mockRejectedValueOnce(new Error('Network down'));
    const save = vi.spyOn(routingProfilesApi, 'saveSharedCodexSpeed');
    let result = true;
    await act(async () => {
      result = await hook.saveCodexSpeed(null, { speed: 'fast' });
    });
    expect(result).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(hook.error).toBe('Network down');
    expect(hook.saving).toBe(false);
  });

  test('a connection change during the reread writes nothing', async () => {
    await mount();
    const pending = deferred<RoutingProfilesState>();
    vi.mocked(routingProfilesApi.get).mockReturnValueOnce(pending.promise);
    const save = vi.spyOn(routingProfilesApi, 'saveSharedCodexSpeed');
    let result!: Promise<boolean>;
    await act(async () => {
      result = hook.saveCodexSpeed(null, { speed: 'fast' });
    });
    revision += 1;
    await act(async () => {
      pending.resolve(changedElsewhere());
    });
    await expect(result).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(hook.saving).toBe(false);
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
    expect(ownProfiles()).toBe(1);
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
    expect(ownProfiles()).toBe(0);
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

  test('a write callback kept past a connection change sends no request', async () => {
    const remove = vi.spyOn(clientKeysApi, 'removeClientKey').mockResolvedValue({});
    const save = vi.spyOn(routingProfilesApi, 'saveKeyProfile');
    await mount();
    // A confirmation dialog keeps the callbacks of the render that opened it.
    const { removeKey, saveKeyProfile } = hook;
    revision += 1;
    await act(async () => hook.reload());
    let removed!: Awaited<ReturnType<KeyProfilesState['removeKey']>>;
    let saved = true;
    await act(async () => {
      removed = await removeKey(KEY_A);
      saved = await saveKeyProfile(KEY_B, null);
    });
    expect(removed).toEqual({ ok: false });
    expect(saved).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  test('a write callback kept past an unmount sends no request', async () => {
    const add = vi.spyOn(clientKeysApi, 'addClientKey').mockResolvedValue({});
    const remove = vi.spyOn(clientKeysApi, 'removeClientKey').mockResolvedValue({});
    await mount();
    const { addKey, removeKey } = hook;
    await act(async () => renderer!.unmount());
    renderer = undefined;
    await expect(removeKey(KEY_A)).resolves.toEqual({ ok: false });
    await expect(addKey(KEY_C)).resolves.toEqual({ ok: false });
    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  test('a reload retries an alias list that did not load and keeps a known one', async () => {
    aliasState.stateKnown = false;
    await mount();
    await act(async () => hook.reload());
    expect(aliasState.reloads).toBe(1);
    await act(async () => renderer!.unmount());
    aliasState.stateKnown = true;
    await mount();
    await act(async () => hook.reload());
    expect(aliasState.reloads).toBe(1);
  });

  test('a delete refused for an unknown alias state loads the alias list again', async () => {
    vi.spyOn(clientKeysApi, 'removeClientKey').mockRejectedValue(new AliasStateUnknownError());
    await mount();
    let result!: Awaited<ReturnType<KeyProfilesState['removeKey']>>;
    await act(async () => {
      result = await hook.removeKey(KEY_A);
    });
    expect(result).toEqual({ ok: false });
    expect(hook.error).toBe('The key alias state could not be confirmed. Try again later.');
    expect(aliasState.reloads).toBe(1);
    expect(routingProfilesApi.get).toHaveBeenCalledTimes(1);
  });
});
