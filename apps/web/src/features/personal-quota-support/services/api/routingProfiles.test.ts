import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getRaw: vi.fn(),
  patch: vi.fn(),
  patchRaw: vi.fn(),
  revision: 0,
}));
vi.mock('./client', () => ({
  apiClient: {
    get: mocks.get,
    getRaw: mocks.getRaw,
    patch: mocks.patch,
    patchRaw: mocks.patchRaw,
    getConnectionRevision: () => mocks.revision,
  },
}));
import { sha256Hex } from '@/utils/apiKeyHash';
import {
  clientApiKeys,
  ConfigChangedError,
  ConfigVersionUnavailableError,
  DefaultCopyUnconfirmedError,
  defaultProviderRouting,
  dropsLegacyClaudeFallback,
  holdsCodexSpeed,
  InvalidRoutingConfigError,
  keyCodexSpeedPatch,
  keyProfilePatch,
  legacyClaudeFallbackOf,
  mergeKeyRows,
  profileBody,
  profiledKeysOf,
  providersFromClaudeFallback,
  readRoutingProfiles,
  routingProfilesApi,
  sharedCodexSpeedPatch,
  sharedProfilePatch,
  strongETag,
  UnknownApiKeyError,
  type RoutingProfile,
} from './routingProfiles';

const RAW_KEY = 'sk-client-secret-a';
const OTHER_KEY = 'sk-client-secret-b';
const options = {
  narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
  pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
};
const rawShared = () => ({
  'session-affinity': true,
  'preferred-accounts': { claude: 'claude-1' },
  selection: { primary: 'reserves', tiebreak: 'earliest-reset' },
  'claude-fallback': {
    enabled: true,
    mode: 'auto',
    mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
  },
});
const rawKeyProfile = () => ({
  'session-affinity': false,
  'preferred-accounts': { claude: 'claude-2', codex: 'codex-1' },
  selection: { primary: 'priority', tiebreak: 'round-robin' },
  'claude-fallback': {
    enabled: true,
    mode: 'always',
    mappings: [{ from: 'claude-*', to: 'gpt-6-sol' }],
  },
});
const response = (keys: unknown[] = [{ key: RAW_KEY, profile: rawKeyProfile() }]) => ({
  supported: true,
  shared: rawShared(),
  keys,
  selection_options: options,
});
const keyProfile = (): RoutingProfile => ({
  sessionAffinity: false,
  preferredAccounts: { claude: 'claude-2', codex: 'codex-1' },
  selection: { primary: 'priority', tiebreak: 'round-robin' },
  providers: providersFromClaudeFallback({
    enabled: true,
    mode: 'always',
    mappings: [{ from: 'claude-*', to: 'gpt-6-sol' }],
  }),
});

// A backend with `providers`: the fixtures above are an older backend's response.
const rawProviders = () => ({
  claude: {
    mode: 'subscription',
    'api-credential': 'claude-idx',
    fallback: {
      target: 'api',
      mode: 'auto',
      mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
    },
  },
  codex: {
    mode: 'api',
    'api-credential': 'codex-idx',
    fallback: { target: 'off', mode: '', mappings: [] },
  },
});
const providersProfile = (): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: { claude: 'claude-1' },
  selection: { primary: 'reserves', tiebreak: 'earliest-reset' },
  providers: {
    claude: {
      mode: 'subscription',
      apiCredential: 'claude-idx',
      fallback: {
        target: 'api',
        mode: 'auto',
        mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
      },
      speed: 'standard',
      ignoreClientTier: false,
      disabled: false,
    },
    codex: {
      mode: 'api',
      apiCredential: 'codex-idx',
      fallback: { target: 'off', mode: 'auto', mappings: [] },
      speed: 'standard',
      ignoreClientTier: false,
      disabled: false,
    },
  },
});
const providersResponse = (
  sharedPatch: Record<string, unknown> = {},
  keys: unknown[] = [{ key: RAW_KEY, profile: { ...rawShared(), providers: rawProviders() } }]
) => ({
  supported: true,
  shared: {
    ...rawShared(),
    // The legacy view the backend still sends; `providers` wins.
    'claude-fallback': { enabled: false, mode: 'auto', mappings: [] },
    providers: rawProviders(),
    ...sharedPatch,
  },
  keys,
  api_credentials: {
    claude: [{ auth_index: 'claude-idx', label: 'claude-apikey', base_url: '', disabled: false }],
    codex: [
      { auth_index: 'codex-idx', label: 'codex-apikey', base_url: 'https://proxy.example' },
      { auth_index: 'codex-off', label: 'codex-old', base_url: '', disabled: true },
    ],
  },
  selection_options: options,
});

const assertNoKeyInRequests = () => {
  const forbidden = [RAW_KEY, sha256Hex(RAW_KEY)];
  for (const [url] of [
    ...mocks.get.mock.calls,
    ...mocks.patch.mock.calls,
    ...mocks.patchRaw.mock.calls,
  ]) {
    for (const value of forbidden) expect(String(url)).not.toContain(value);
  }
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.revision = 0;
});

describe('reading routing profiles', () => {
  it('maps a full response to panel types', () => {
    expect(readRoutingProfiles(response())).toEqual({
      supported: true,
      unsupportedBackend: false,
      shared: {
        sessionAffinity: true,
        preferredAccounts: { claude: 'claude-1' },
        selection: { primary: 'reserves', tiebreak: 'earliest-reset' },
        providers: providersFromClaudeFallback({
          enabled: true,
          mode: 'auto',
          mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
        }),
      },
      keys: [{ key: RAW_KEY, profile: keyProfile() }],
      selectionOptions: options,
      providersSupported: false,
      speedSupported: false,
      providerToggleSupported: false,
      apiCredentials: { claude: [], codex: [] },
    });
  });

  it('derives providers from claude-fallback on an older backend', () => {
    const state = readRoutingProfiles(response());
    expect(state.providersSupported).toBe(false);
    expect(state.shared.providers).toEqual({
      claude: {
        mode: 'subscription',
        apiCredential: '',
        fallback: {
          target: 'codex',
          mode: 'auto',
          mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
        },
        speed: 'standard',
        ignoreClientTier: false,
        disabled: false,
      },
      codex: {
        mode: 'subscription',
        apiCredential: '',
        fallback: { target: 'off', mode: 'auto', mappings: [] },
        speed: 'standard',
        ignoreClientTier: false,
        disabled: false,
      },
    });
    const disabled = readRoutingProfiles({
      ...response([]),
      shared: {
        ...rawShared(),
        'claude-fallback': { enabled: false, mode: 'always', mappings: [] },
      },
    });
    expect(disabled.shared.providers.claude.fallback).toEqual({
      target: 'off',
      mode: 'always',
      mappings: [],
    });
  });

  it('reads providers and api_credentials from a backend that serves them', () => {
    const state = readRoutingProfiles(providersResponse());
    expect(state.providersSupported).toBe(true);
    expect(state.shared).toEqual(providersProfile());
    expect(state.keys[0].profile).toEqual(providersProfile());
    expect(state.apiCredentials).toEqual({
      claude: [{ authIndex: 'claude-idx', label: 'claude-apikey', baseUrl: '', disabled: false }],
      codex: [
        {
          authIndex: 'codex-idx',
          label: 'codex-apikey',
          baseUrl: 'https://proxy.example',
          disabled: false,
        },
        { authIndex: 'codex-off', label: 'codex-old', baseUrl: '', disabled: true },
      ],
    });
  });

  it('defaults missing provider values and an absent provider block', () => {
    const state = readRoutingProfiles(
      providersResponse({
        providers: {
          claude: { mode: 'api', 'api-credential': null, fallback: { target: '' } },
        },
      })
    );
    expect(state.shared.providers).toEqual({
      claude: {
        mode: 'api',
        apiCredential: '',
        fallback: { target: 'off', mode: 'auto', mappings: [] },
        speed: 'standard',
        ignoreClientTier: false,
        disabled: false,
      },
      codex: {
        mode: 'subscription',
        apiCredential: '',
        fallback: { target: 'off', mode: 'auto', mappings: [] },
        speed: 'standard',
        ignoreClientTier: false,
        disabled: false,
      },
    });
  });

  it('reads an unknown fallback mode under target API key as auto, since CPA ignores it', () => {
    const state = readRoutingProfiles(
      providersResponse({
        providers: {
          claude: { 'api-credential': 'claude-idx', fallback: { target: 'api', mode: 'alwyas' } },
          codex: { 'api-credential': 'codex-idx', fallback: { target: 'api', mode: 'bogus' } },
        },
      })
    );
    expect(state.shared.providers.claude.fallback).toEqual({
      target: 'api',
      mode: 'auto',
      mappings: [],
    });
    expect(state.shared.providers.codex.fallback).toEqual({
      target: 'api',
      mode: 'auto',
      mappings: [],
    });
    const always = readRoutingProfiles(
      providersResponse({
        providers: {
          claude: { 'api-credential': 'claude-idx', fallback: { target: 'api', mode: 'always' } },
        },
      })
    );
    expect(always.shared.providers.claude.fallback.mode).toBe('always');
  });

  it('reads absent api_credentials as empty lists and skips malformed entries', () => {
    const withoutList = { ...providersResponse() } as Record<string, unknown>;
    delete withoutList.api_credentials;
    expect(readRoutingProfiles(withoutList).apiCredentials).toEqual({ claude: [], codex: [] });
    const messy = {
      ...providersResponse(),
      api_credentials: {
        claude: [null, { label: 'no index' }, { auth_index: '  ' }, { auth_index: 'ok', label: 1 }],
        codex: 'not a list',
      },
    };
    expect(readRoutingProfiles(messy).apiCredentials).toEqual({
      claude: [{ authIndex: 'ok', label: '', baseUrl: '', disabled: false }],
      codex: [],
    });
  });

  it.each([
    ['an unknown mode', { claude: { mode: 'hybrid' } }],
    ['an unknown target', { claude: { fallback: { target: 'gemini' } } }],
    ['a Codex target of codex', { codex: { fallback: { target: 'codex' } } }],
    ['an unknown fallback mode', { claude: { fallback: { target: 'codex', mode: 'sometimes' } } }],
    ['a non-string credential', { claude: { 'api-credential': 5 } }],
    ['non-list mappings', { claude: { fallback: { target: 'codex', mappings: 'x' } } }],
    ['a malformed mapping', { claude: { fallback: { target: 'codex', mappings: [{ from: 1 }] } } }],
    ['a non-object provider', { claude: 'subscription' }],
    ['a non-object fallback', { claude: { fallback: 'off' } }],
  ])('rejects invalid provider settings: %s', (_name, providers) => {
    expect(() => readRoutingProfiles(providersResponse({ providers }))).toThrow(
      'Invalid routing provider settings'
    );
  });

  it('rejects a providers value that is not an object', () => {
    expect(() =>
      readRoutingProfiles(
        providersResponse({}, [{ key: RAW_KEY, profile: { ...rawShared(), providers: [] } }])
      )
    ).toThrow('Invalid routing provider settings');
  });

  it.each(['standard', 'fast', 'ultrafast'] as const)('reads the Codex speed %s', (speed) => {
    const state = readRoutingProfiles(
      providersResponse(
        {
          providers: {
            ...rawProviders(),
            codex: { ...rawProviders().codex, speed, 'ignore-client-tier': true },
          },
        },
        [
          {
            key: RAW_KEY,
            profile: {
              ...rawShared(),
              providers: { ...rawProviders(), codex: { ...rawProviders().codex, speed } },
            },
          },
        ]
      )
    );
    expect(state.shared.providers.codex.speed).toBe(speed);
    expect(state.shared.providers.codex.ignoreClientTier).toBe(true);
    expect(state.keys[0].profile.providers.codex.speed).toBe(speed);
    expect(state.keys[0].profile.providers.codex.ignoreClientTier).toBe(false);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
  ])('reads an %s Codex speed as standard', (_name, speed) => {
    const codex: Record<string, unknown> = { ...rawProviders().codex };
    if (speed !== undefined) codex.speed = speed;
    const state = readRoutingProfiles(
      providersResponse({ providers: { ...rawProviders(), codex } })
    );
    expect(state.shared.providers.codex.speed).toBe('standard');
    expect(state.shared.providers.codex.ignoreClientTier).toBe(false);
  });

  it('reads only the boolean true as ignoring the client tier', () => {
    for (const value of ['true', 1, null, false]) {
      const state = readRoutingProfiles(
        providersResponse({
          providers: {
            ...rawProviders(),
            codex: { ...rawProviders().codex, 'ignore-client-tier': value },
          },
        })
      );
      expect(state.shared.providers.codex.ignoreClientTier).toBe(false);
    }
  });

  it('fails the load on an unknown Codex speed', () => {
    expect(() =>
      readRoutingProfiles(
        providersResponse({
          providers: { ...rawProviders(), codex: { ...rawProviders().codex, speed: 'turbo' } },
        })
      )
    ).toThrow('Invalid routing provider settings');
  });

  it('always reads Claude as standard without the flag, whatever the response holds', () => {
    for (const speed of ['fast', 'ultrafast', 'turbo', 7]) {
      const state = readRoutingProfiles(
        providersResponse({
          providers: {
            ...rawProviders(),
            claude: { ...rawProviders().claude, speed, 'ignore-client-tier': true },
          },
        })
      );
      expect(state.shared.providers.claude.speed).toBe('standard');
      expect(state.shared.providers.claude.ignoreClientTier).toBe(false);
    }
  });

  it('gives both providers the default speed on an older backend', () => {
    const state = readRoutingProfiles(response());
    for (const provider of ['claude', 'codex'] as const) {
      expect(state.shared.providers[provider].speed).toBe('standard');
      expect(state.shared.providers[provider].ignoreClientTier).toBe(false);
    }
    const legacy = providersFromClaudeFallback({ enabled: true, mode: 'auto', mappings: [] });
    expect(legacy.claude.speed).toBe('standard');
    expect(legacy.claude.ignoreClientTier).toBe(false);
    expect(legacy.codex.speed).toBe('standard');
    expect(legacy.codex.ignoreClientTier).toBe(false);
  });

  it('accepts an omitted preferred-accounts block and an empty tiebreak', () => {
    const profile = { ...rawKeyProfile(), selection: { primary: 'fill-first', tiebreak: '' } };
    delete (profile as Record<string, unknown>)['preferred-accounts'];
    const state = readRoutingProfiles(response([{ key: RAW_KEY, profile }]));
    expect(state.keys[0].profile.preferredAccounts).toEqual({});
    expect(state.keys[0].profile.selection).toEqual({ primary: 'fill-first' });
  });

  it('accepts a null tiebreak', () => {
    const profile = { ...rawKeyProfile(), selection: { primary: 'reserves', tiebreak: null } };
    const state = readRoutingProfiles(response([{ key: RAW_KEY, profile }]));
    expect(state.keys[0].profile.selection).toEqual({ primary: 'reserves' });
  });

  it('reads an empty fallback mode as auto, as CPA sends it for a config without one', () => {
    // GET /routing/profiles serializes the stored block as is: a config without
    // routing.claude-fallback, or a key profile without one, has mode "".
    const emptyFallback = { enabled: false, mode: '', mappings: [] };
    const state = readRoutingProfiles({
      ...response([
        { key: RAW_KEY, profile: { ...rawKeyProfile(), 'claude-fallback': emptyFallback } },
      ]),
      shared: { ...rawShared(), 'claude-fallback': emptyFallback },
    });
    const expected = { target: 'off', mode: 'auto', mappings: [] };
    expect(state.shared.providers.claude.fallback).toEqual(expected);
    expect(state.keys[0].profile.providers.claude.fallback).toEqual(expected);
  });

  it.each([
    ['not an object', null],
    ['no supported flag', { ...response(), supported: 'yes' }],
    ['keys not a list', { ...response(), keys: {} }],
    ['no selection options', { ...response(), selection_options: undefined }],
    ['an empty key', response([{ key: '', profile: rawKeyProfile() }])],
    [
      'a shared profile without selection',
      { ...response(), shared: { ...rawShared(), selection: null } },
    ],
    [
      'an invalid fallback block',
      { ...response(), shared: { ...rawShared(), 'claude-fallback': { enabled: 'on' } } },
    ],
    [
      'a non-string tiebreak',
      {
        ...response(),
        shared: { ...rawShared(), selection: { primary: 'reserves', tiebreak: 1 } },
      },
    ],
    [
      'non-list selection options',
      { ...response(), selection_options: { narrowing: 'priority', pickers: [] } },
    ],
    [
      'non-list preferences',
      response([{ key: RAW_KEY, profile: { ...rawKeyProfile(), 'preferred-accounts': 'x' } }]),
    ],
  ])('rejects a malformed response: %s', (_name, raw) => {
    expect(() => readRoutingProfiles(raw)).toThrow();
  });

  it('maps a 404 to an unsupported backend and surfaces other errors', async () => {
    mocks.get.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    await expect(routingProfilesApi.get()).resolves.toMatchObject({
      supported: false,
      unsupportedBackend: true,
      providersSupported: false,
      speedSupported: false,
      apiCredentials: { claude: [], codex: [] },
      keys: [],
    });
    expect(mocks.get).toHaveBeenCalledWith('/routing/profiles');
    mocks.get.mockRejectedValueOnce(new Error('offline'));
    await expect(routingProfilesApi.get()).rejects.toThrow('offline');
    mocks.get.mockResolvedValueOnce({ supported: true });
    await expect(routingProfilesApi.get()).rejects.toThrow('Invalid routing profiles response');
  });
});

describe('client key list', () => {
  it('reads access.api-keys before the legacy top-level list', () => {
    expect(
      clientApiKeys({ access: { 'api-keys': [RAW_KEY, OTHER_KEY] }, 'api-keys': ['legacy'] })
    ).toEqual([RAW_KEY, OTHER_KEY]);
    expect(clientApiKeys({ access: { 'api-keys': [] }, 'api-keys': ['legacy'] })).toEqual([]);
  });

  it('falls back to the legacy top-level api-keys when access.api-keys is absent', () => {
    expect(clientApiKeys({ 'api-keys': ['sk-old'] })).toEqual(['sk-old']);
    expect(clientApiKeys({ access: {}, 'api-keys': ['sk-old'] })).toEqual(['sk-old']);
  });

  it('returns nothing for a missing list and drops non-string, empty, and duplicate entries', () => {
    expect(clientApiKeys(undefined)).toEqual([]);
    expect(clientApiKeys({})).toEqual([]);
    expect(clientApiKeys({ 'api-keys': { group: ['x'] } })).toEqual([]);
    expect(
      clientApiKeys({ access: { 'api-keys': [RAW_KEY, 7, null, '', '  ', { key: 'x' }, RAW_KEY] } })
    ).toEqual([RAW_KEY]);
  });

  it('merges one row per key in list order and drops profiles of unlisted keys', () => {
    const profile = keyProfile();
    expect(
      mergeKeyRows(
        [OTHER_KEY, RAW_KEY],
        [
          { key: RAW_KEY, profile },
          { key: 'sk-gone', profile },
        ]
      )
    ).toEqual([
      { key: OTHER_KEY, profile: null },
      { key: RAW_KEY, profile },
    ]);
  });
});

describe('writing a key profile', () => {
  it('sends the complete legacy profile with cleared values as null to an older backend', () => {
    const profile: RoutingProfile = {
      ...keyProfile(),
      preferredAccounts: { claude: ' claude-2 ', codex: '' },
      selection: { primary: 'priority' },
      providers: providersFromClaudeFallback({
        enabled: true,
        mode: 'auto',
        mappings: [
          { from: ' claude-opus-* ', to: 'gpt-6-astra ' },
          { from: 'claude-sonnet-*', to: 'gpt-6-sol' },
        ],
      }),
    };
    expect(keyProfilePatch(RAW_KEY, profile, options, false)).toEqual({
      routing: {
        'key-profiles': {
          [RAW_KEY]: {
            'session-affinity': false,
            'preferred-accounts': { claude: 'claude-2', codex: null },
            selection: { primary: 'priority', tiebreak: null },
            'claude-fallback': {
              enabled: true,
              mode: 'auto',
              mappings: [
                { from: 'claude-opus-*', to: 'gpt-6-astra' },
                { from: 'claude-sonnet-*', to: 'gpt-6-sol' },
              ],
            },
          },
        },
      },
    });
  });

  it('sends the complete providers block and no claude-fallback to a backend with providers', () => {
    const profile = providersProfile();
    profile.providers.claude.apiCredential = '  ';
    profile.providers.claude.fallback.mappings = [{ from: ' claude-opus-* ', to: ' gpt-6-astra ' }];
    profile.providers.codex.fallback = {
      target: 'api',
      mode: 'always',
      mappings: [{ from: 'x', to: 'y' }],
    };
    expect(keyProfilePatch(RAW_KEY, profile, options)).toEqual({
      routing: {
        'key-profiles': {
          [RAW_KEY]: {
            'session-affinity': true,
            'preferred-accounts': { claude: 'claude-1', codex: null },
            selection: { primary: 'reserves', tiebreak: 'earliest-reset' },
            providers: {
              claude: {
                mode: 'subscription',
                'api-credential': null,
                fallback: {
                  target: 'api',
                  mode: 'auto',
                  mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
                },
              },
              // API key mode carries target off; the Codex fallback clears mode and mappings.
              codex: {
                mode: 'api',
                'api-credential': 'codex-idx',
                fallback: { target: 'off', mode: null, mappings: null },
              },
            },
          },
        },
      },
    });
  });

  it('API key mode sends target off but keeps the Claude mapping table', () => {
    const profile = providersProfile();
    profile.providers.claude.mode = 'api';
    profile.providers.claude.fallback.target = 'codex';
    const body = profileBody(profile, options) as { providers: { claude: unknown } };
    expect(body.providers.claude).toEqual({
      mode: 'api',
      'api-credential': 'claude-idx',
      fallback: {
        target: 'off',
        mode: 'auto',
        mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
      },
    });
    expect(body).not.toHaveProperty('claude-fallback');
  });

  it('clears a stored Codex fallback mode and mappings, which CPA checks under target off', () => {
    // CPA accepts any Codex mode and mapping rows under target api; the merge-PATCH
    // would keep them and fail the switch to off unless the body clears them.
    const state = readRoutingProfiles(
      providersResponse({
        providers: {
          codex: {
            'api-credential': 'codex-idx',
            fallback: { target: 'api', mode: 'bogus', mappings: [{ from: '', to: '' }] },
          },
        },
      })
    );
    const profile = state.shared;
    profile.providers.codex.fallback.target = 'off';
    const body = profileBody(profile, options) as { providers: { codex: unknown } };
    expect(body.providers.codex).toEqual({
      mode: 'subscription',
      'api-credential': 'codex-idx',
      fallback: { target: 'off', mode: null, mappings: null },
    });
  });

  it('an older backend gets claude-fallback enabled only for the Codex target', () => {
    const toApi = providersProfile();
    const legacy = profileBody(toApi, options, false);
    expect(legacy).not.toHaveProperty('providers');
    expect(legacy['claude-fallback']).toEqual({
      enabled: false,
      mode: 'auto',
      mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
    });
    toApi.providers.claude.fallback.target = 'codex';
    expect(profileBody(toApi, options, false)['claude-fallback']).toMatchObject({ enabled: true });
  });

  it('threads providersSupported into the PATCH body', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockResolvedValue(response());
    await routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile(), options, false);
    expect(mocks.patch).toHaveBeenCalledWith(
      '/config',
      keyProfilePatch(RAW_KEY, keyProfile(), options, false)
    );
    const body = mocks.patch.mock.calls[0][1].routing['key-profiles'][RAW_KEY];
    expect(body).toHaveProperty('claude-fallback');
    expect(body).not.toHaveProperty('providers');
  });

  it('reads the config version from the ETag of the config, or none without one', async () => {
    mocks.getRaw.mockResolvedValueOnce({ headers: { etag: '"abc123"' }, data: {} });
    await expect(routingProfilesApi.configSnapshot()).resolves.toEqual({
      version: '"abc123"',
      clientKeys: new Set(),
      profiledKeys: new Set(),
      legacyClaudeFallback: { shared: false, keys: new Set() },
    });
    expect(mocks.getRaw).toHaveBeenCalledExactlyOnceWith('/config');
    mocks.getRaw.mockResolvedValueOnce({ headers: {}, data: {} });
    await expect(routingProfilesApi.configSnapshot()).resolves.toMatchObject({ version: '' });
  });

  it('reads a weak ETag as no version, since CPA never matches one in If-Match', async () => {
    // A proxy that compresses the response weakens the ETag.
    mocks.getRaw.mockResolvedValueOnce({ headers: { etag: 'W/"abc123"' }, data: {} });
    await expect(routingProfilesApi.configSnapshot()).resolves.toMatchObject({ version: '' });
  });

  it('reads a wildcard or a list as no version, since CPA would match it to a newer config', async () => {
    // CPA's If-Match takes `*` as any version and a list as any of its tags.
    for (const etag of ['*', '"abc123", "def456"', '"abc123",*', 'abc123', '""', ' "abc123"']) {
      mocks.getRaw.mockResolvedValueOnce({ headers: { etag }, data: {} });
      await expect(routingProfilesApi.configSnapshot()).resolves.toMatchObject({ version: '' });
    }
    expect(strongETag('"abc123"')).toBe('"abc123"');
    expect(strongETag(undefined)).toBe('');
    expect(strongETag(['"abc123"'])).toBe('');
  });

  it('reads the client keys and the keys that own a profile from the same config document as the version', async () => {
    mocks.getRaw.mockResolvedValueOnce({
      headers: { etag: '"abc123"' },
      data: {
        access: { 'api-keys': [RAW_KEY, OTHER_KEY] },
        routing: { 'key-profiles': { [RAW_KEY]: { 'session-affinity': true }, [OTHER_KEY]: null } },
      },
    });
    const snapshot = await routingProfilesApi.configSnapshot();
    expect(snapshot.version).toBe('"abc123"');
    // The key list of that version, so a key deleted elsewhere is known before a write.
    expect([...snapshot.clientKeys]).toEqual([RAW_KEY, OTHER_KEY]);
    // A null entry owns no profile: CPA ignores it.
    expect([...snapshot.profiledKeys]).toEqual([RAW_KEY]);
    expect(profiledKeysOf({ routing: {} })).toEqual(new Set());
    expect(profiledKeysOf({ routing: { 'key-profiles': [] } })).toEqual(new Set());
    expect(profiledKeysOf(null)).toEqual(new Set());
  });

  it('finds the profiles whose legacy Claude fallback a routing write would drop', async () => {
    // CPA reads the fallback from `claude-fallback` while `providers.claude.fallback` sets
    // nothing, and deletes that block on any write naming the profile because the
    // providers node exists.
    const legacy = { enabled: true, mode: 'auto', mappings: [{ from: 'claude-*', to: 'gpt-6' }] };
    const shape = (fallback: unknown, claudeFallback: unknown = legacy) => ({
      providers: { claude: { fallback } },
      'claude-fallback': claudeFallback,
    });
    for (const empty of [{}, null, { target: '', mode: null, mappings: [] }])
      expect(dropsLegacyClaudeFallback(shape(empty)), JSON.stringify(empty)).toBe(true);
    expect(dropsLegacyClaudeFallback(shape({}, { enabled: false, mappings: [{}] }))).toBe(true);
    // Unaffected: the providers fallback sets something, so CPA already ignores the
    // legacy block; no providers fallback node, so CPA keeps the block; or no legacy
    // block that sets anything.
    expect(dropsLegacyClaudeFallback(shape({ target: 'off' }))).toBe(false);
    expect(dropsLegacyClaudeFallback(shape({ mappings: [{}] }))).toBe(false);
    expect(
      dropsLegacyClaudeFallback({ providers: { claude: {} }, 'claude-fallback': legacy })
    ).toBe(false);
    expect(dropsLegacyClaudeFallback({ 'claude-fallback': legacy })).toBe(false);
    for (const none of [null, {}, { enabled: false, mode: '', mappings: [] }])
      expect(dropsLegacyClaudeFallback(shape({}, none)), JSON.stringify(none)).toBe(false);
    expect(dropsLegacyClaudeFallback({ providers: { claude: { fallback: {} } } })).toBe(false);
    expect(dropsLegacyClaudeFallback(null)).toBe(false);

    mocks.getRaw.mockResolvedValueOnce({
      headers: { etag: '"abc123"' },
      data: {
        routing: {
          ...shape({}),
          'key-profiles': {
            [RAW_KEY]: shape(null),
            [OTHER_KEY]: shape({ target: 'codex', mode: 'auto' }),
          },
        },
      },
    });
    const snapshot = await routingProfilesApi.configSnapshot();
    expect(snapshot.legacyClaudeFallback.shared).toBe(true);
    expect([...snapshot.legacyClaudeFallback.keys]).toEqual([RAW_KEY]);
    expect(legacyClaudeFallbackOf({ routing: { 'key-profiles': [] } })).toEqual({
      shared: false,
      keys: new Set(),
    });
  });

  it('verifies a providers profile by reading it back', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockResolvedValue(providersResponse());
    // Hidden values in the draft: a Codex target under API key mode is stored as off,
    // and a Codex fallback mode or mapping list is not stored at all.
    const sent = providersProfile();
    sent.providers.codex.fallback = {
      target: 'api',
      mode: 'always',
      mappings: [{ from: 'a', to: 'b' }],
    };
    const state = await routingProfilesApi.saveKeyProfile(RAW_KEY, sent, options, true);
    expect(state.keys[0].profile).toEqual(providersProfile());
    assertNoKeyInRequests();
  });

  it('rejects a providers read-back with a different credential, mode or target', async () => {
    mocks.patch.mockResolvedValue({});
    const stored = (claude: Record<string, unknown>) =>
      providersResponse({}, [
        {
          key: RAW_KEY,
          profile: { ...rawShared(), providers: { ...rawProviders(), claude } },
        },
      ]);
    for (const claude of [
      { ...rawProviders().claude, 'api-credential': 'other-idx' },
      { ...rawProviders().claude, mode: 'api' },
      { ...rawProviders().claude, fallback: { ...rawProviders().claude.fallback, target: 'off' } },
    ]) {
      mocks.get.mockResolvedValue(stored(claude));
      await expect(
        routingProfilesApi.saveKeyProfile(RAW_KEY, providersProfile(), options, true)
      ).rejects.toThrow('CPA did not retain the routing profile');
    }
  });

  it('sends a picker primary without a tiebreak and a reset as null', () => {
    const profile = { ...keyProfile(), selection: { primary: 'fill-first', tiebreak: 'priority' } };
    const patch = keyProfilePatch(RAW_KEY, profile, options) as {
      routing: { 'key-profiles': Record<string, { selection: unknown }> };
    };
    expect(patch.routing['key-profiles'][RAW_KEY].selection).toEqual({
      primary: 'fill-first',
      tiebreak: null,
    });
    expect(keyProfilePatch(RAW_KEY, null)).toEqual({
      routing: { 'key-profiles': { [RAW_KEY]: null } },
    });
  });

  it('patches the config and verifies the stored profile by reading it back', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockResolvedValue(response());
    const state = await routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile(), options);
    expect(state.keys).toEqual([{ key: RAW_KEY, profile: keyProfile() }]);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith(
      '/config',
      keyProfilePatch(RAW_KEY, keyProfile(), options)
    );
    expect(mocks.get).toHaveBeenCalledWith('/routing/profiles');
    assertNoKeyInRequests();
  });

  it('verifies that a reset removed the profile', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockResolvedValue(response([]));
    await expect(routingProfilesApi.saveKeyProfile(RAW_KEY, null)).resolves.toMatchObject({
      keys: [],
    });
    expect(mocks.patch).toHaveBeenCalledWith('/config', {
      routing: { 'key-profiles': { [RAW_KEY]: null } },
    });
    assertNoKeyInRequests();
  });

  it('accepts a read-back that differs only by normalization', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockResolvedValue(
      response([
        {
          key: RAW_KEY,
          profile: {
            ...rawKeyProfile(),
            selection: { primary: 'fill-first', tiebreak: 'priority' },
          },
        },
      ])
    );
    await expect(
      routingProfilesApi.saveKeyProfile(
        RAW_KEY,
        { ...keyProfile(), selection: { primary: 'fill-first' } },
        options
      )
    ).resolves.toBeTruthy();
  });

  it('rejects a profile the backend did not retain', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockResolvedValue(
      response([{ key: RAW_KEY, profile: { ...rawKeyProfile(), 'session-affinity': true } }])
    );
    await expect(routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile())).rejects.toThrow(
      'CPA did not retain the routing profile'
    );
    mocks.get.mockResolvedValue(response());
    await expect(routingProfilesApi.saveKeyProfile(RAW_KEY, null)).rejects.toThrow(
      'did not retain'
    );
    mocks.get.mockResolvedValue(response([]));
    await expect(routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile())).rejects.toThrow(
      'did not retain'
    );
    assertNoKeyInRequests();
  });

  it('refuses invalid fallback mappings before writing', async () => {
    await expect(
      routingProfilesApi.saveKeyProfile(RAW_KEY, {
        ...keyProfile(),
        providers: providersFromClaudeFallback({ enabled: true, mode: 'auto', mappings: [] }),
      })
    ).rejects.toThrow('Invalid Claude fallback mappings');
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('skips the mapping rows only under target API key, which CPA ignores', async () => {
    mocks.patch.mockResolvedValue({});
    const hidden = providersProfile();
    hidden.providers.claude.fallback.mappings = [{ from: 'claude-*-x*', to: '' }];
    mocks.get.mockResolvedValue(
      providersResponse({}, [
        {
          key: RAW_KEY,
          profile: {
            ...rawShared(),
            providers: {
              ...rawProviders(),
              claude: {
                ...rawProviders().claude,
                fallback: {
                  target: 'api',
                  mode: 'auto',
                  mappings: [{ from: 'claude-*-x*', to: '' }],
                },
              },
            },
          },
        },
      ])
    );
    await expect(
      routingProfilesApi.saveKeyProfile(RAW_KEY, hidden, options, true)
    ).resolves.toBeTruthy();
    const apiMode = providersProfile();
    apiMode.providers.claude.mode = 'api';
    apiMode.providers.claude.fallback = { target: 'codex', mode: 'auto', mappings: [] };
    mocks.patch.mockClear();
    await expect(
      routingProfilesApi.saveKeyProfile(RAW_KEY, apiMode, options, true)
    ).rejects.toThrow('did not retain');
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['target off', 'subscription', 'off', true],
    ['API key mode (saved as off)', 'api', 'api', true],
    ['an older backend under target off', 'subscription', 'off', false],
  ] as const)(
    'refuses a hidden invalid mapping row before writing: %s',
    async (_name, mode, target, providersSupported) => {
      const hidden = providersProfile();
      hidden.providers.claude.mode = mode;
      hidden.providers.claude.fallback = {
        target,
        mode: 'auto',
        mappings: [{ from: '', to: '' }],
      };
      await expect(
        routingProfilesApi.saveKeyProfile(RAW_KEY, hidden, options, providersSupported)
      ).rejects.toThrow('Invalid Claude fallback mappings');
      await expect(
        routingProfilesApi.saveSharedProfile(hidden, undefined, options, providersSupported)
      ).rejects.toThrow('Invalid Claude fallback mappings');
      expect(mocks.patch).not.toHaveBeenCalled();
    }
  );
});

describe('write errors', () => {
  it('maps 400 unknown_api_key to UnknownApiKeyError without the raw key', async () => {
    mocks.patch.mockRejectedValue(
      Object.assign(new Error('x'), { status: 400, apiCode: 'unknown_api_key' })
    );
    const error = await routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile()).catch((e) => e);
    expect(error).toBeInstanceOf(UnknownApiKeyError);
    expect(error.message).not.toContain(RAW_KEY);
    expect(mocks.get).not.toHaveBeenCalled();
    assertNoKeyInRequests();
  });

  it('maps 422 invalid_config to InvalidRoutingConfigError with the backend message', async () => {
    const message = 'routing.key-profiles.ab12cd34ef56.selection.primary: unsupported value';
    mocks.patch.mockRejectedValue(
      Object.assign(new Error(message), { status: 422, apiCode: 'invalid_config', message })
    );
    const error = await routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile()).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidRoutingConfigError);
    expect(error.message).toBe(message);
    expect(error.message).not.toContain(RAW_KEY);
  });

  it('scrubs a raw key that leaks into a 422 message', async () => {
    mocks.patch.mockRejectedValue({
      status: 422,
      apiCode: 'invalid_config',
      message: `routing.key-profiles.${RAW_KEY}: bad`,
    });
    const error = await routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile()).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidRoutingConfigError);
    expect(error.message).not.toContain(RAW_KEY);
  });

  it('keeps a readable message for a 422 without one', async () => {
    mocks.patch.mockRejectedValue({ status: 422, apiCode: 'invalid_config' });
    const error = await routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile()).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidRoutingConfigError);
    expect(error.message).toBe('Invalid routing configuration');
  });

  it('maps 412 precondition_failed to ConfigChangedError and reads nothing back', async () => {
    mocks.patch.mockRejectedValue(
      Object.assign(new Error('precondition_failed'), {
        status: 412,
        apiCode: 'precondition_failed',
      })
    );
    const error = await routingProfilesApi
      .saveKeyProfile(RAW_KEY, keyProfile(), options, false)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConfigChangedError);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('passes through a write error that is not an object', async () => {
    mocks.patch.mockRejectedValue('network down');
    await expect(routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile())).rejects.toBe(
      'network down'
    );
  });

  it('does not map a 404 on PATCH to an unsupported backend', async () => {
    const notFound = Object.assign(new Error('not found'), { status: 404 });
    mocks.patch.mockRejectedValue(notFound);
    await expect(routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile())).rejects.toBe(notFound);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('fails the save when the read-back finds an older backend', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockRejectedValue({ status: 404 });
    await expect(routingProfilesApi.saveKeyProfile(RAW_KEY, null)).rejects.toThrow(
      'did not retain'
    );
  });

  it('aborts when the connection changes during the write', async () => {
    mocks.patch.mockImplementation(async () => {
      mocks.revision++;
      return {};
    });
    await expect(routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile())).rejects.toThrow(
      'connection changed'
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('reports the connection change instead of a write error from the old connection', async () => {
    mocks.patch.mockImplementation(async () => {
      mocks.revision++;
      throw Object.assign(new Error('x'), { status: 400, apiCode: 'unknown_api_key' });
    });
    const error = await routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile()).catch((e) => e);
    expect(error.name).toBe('AbortError');
  });

  it('aborts when the connection changes during the read-back', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockImplementation(async () => {
      mocks.revision++;
      return response();
    });
    await expect(routingProfilesApi.saveKeyProfile(RAW_KEY, keyProfile())).rejects.toThrow(
      'connection changed'
    );
    assertNoKeyInRequests();
  });
});

describe('writing the shared profile', () => {
  const sharedProfile = (): RoutingProfile => ({
    sessionAffinity: true,
    preferredAccounts: { claude: 'claude-1' },
    selection: { primary: 'reserves', tiebreak: 'earliest-reset' },
    providers: providersFromClaudeFallback({
      enabled: true,
      mode: 'auto',
      mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
    }),
  });
  const routeGets = (profiles: unknown, config: unknown = { routing: {} }) =>
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/routing/profiles') return profiles;
      if (url === '/config') return config;
      throw new Error(`unexpected GET ${url}`);
    });

  it('threads providersSupported into the shared PATCH body', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockResolvedValue(response());
    await routingProfilesApi.saveSharedProfile(sharedProfile(), undefined, options, false);
    expect(mocks.patch).toHaveBeenCalledWith(
      '/config',
      sharedProfilePatch(sharedProfile(), undefined, options, false)
    );
    const body = mocks.patch.mock.calls[0][1].routing;
    expect(body).toHaveProperty('claude-fallback');
    expect(body).not.toHaveProperty('providers');
  });

  it('sends the providers block as top-level routing fields', () => {
    expect(sharedProfilePatch(providersProfile(), undefined, options)).toEqual({
      routing: {
        'session-affinity': true,
        'preferred-accounts': { claude: 'claude-1', codex: null },
        selection: { primary: 'reserves', tiebreak: 'earliest-reset' },
        providers: {
          claude: {
            mode: 'subscription',
            'api-credential': 'claude-idx',
            fallback: {
              target: 'api',
              mode: 'auto',
              mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
            },
          },
          codex: {
            mode: 'api',
            'api-credential': 'codex-idx',
            fallback: { target: 'off', mode: null, mappings: null },
          },
        },
      },
    });
  });

  it('verifies a shared providers profile on a backend with providers', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(providersResponse());
    const state = await routingProfilesApi.saveSharedProfile(
      providersProfile(),
      undefined,
      options,
      true
    );
    expect(state.shared).toEqual(providersProfile());
    expect(mocks.patch.mock.calls[0][1].routing).not.toHaveProperty('claude-fallback');
  });

  it('sends the complete legacy profile as top-level routing fields to an older backend', () => {
    expect(sharedProfilePatch(sharedProfile(), undefined, options, false)).toEqual({
      routing: {
        'session-affinity': true,
        'preferred-accounts': { claude: 'claude-1', codex: null },
        selection: { primary: 'reserves', tiebreak: 'earliest-reset' },
        'claude-fallback': {
          enabled: true,
          mode: 'auto',
          mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
        },
      },
    });
  });

  it('sends a cleared preferred account as null and a picker primary with a null tiebreak', () => {
    const patch = sharedProfilePatch(
      {
        ...sharedProfile(),
        preferredAccounts: { claude: '  ', codex: 'codex-1' },
        selection: { primary: 'round-robin', tiebreak: 'priority' },
      },
      undefined,
      options
    ) as { routing: Record<string, unknown> };
    expect(patch.routing['preferred-accounts']).toEqual({ claude: null, codex: 'codex-1' });
    expect(patch.routing.selection).toEqual({ primary: 'round-robin', tiebreak: null });
  });

  it('includes the TTL only when it is passed', () => {
    const without = sharedProfilePatch(sharedProfile(), undefined, options) as {
      routing: Record<string, unknown>;
    };
    expect(without.routing).not.toHaveProperty('session-affinity-ttl');
    const withTTL = sharedProfilePatch(sharedProfile(), ' 24h ', options) as {
      routing: Record<string, unknown>;
    };
    expect(withTTL.routing['session-affinity-ttl']).toBe('24h');
  });

  it('patches the config once and verifies the stored shared profile', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(response());
    const state = await routingProfilesApi.saveSharedProfile(sharedProfile(), undefined, options);
    expect(state.shared).toEqual(sharedProfile());
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith(
      '/config',
      sharedProfilePatch(sharedProfile(), undefined, options)
    );
    expect(mocks.get).toHaveBeenCalledWith('/routing/profiles');
    expect(mocks.get).not.toHaveBeenCalledWith('/config');
  });

  it('verifies a sent TTL by reading the config back', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(response(), { routing: { 'session-affinity-ttl': '24h0m0s' } });
    await expect(
      routingProfilesApi.saveSharedProfile(sharedProfile(), '24h', options)
    ).resolves.toBeTruthy();
    expect(mocks.patch).toHaveBeenCalledWith('/config', {
      routing: expect.objectContaining({ 'session-affinity-ttl': '24h' }),
    });
    expect(mocks.get).toHaveBeenCalledWith('/config');
  });

  it.each([
    ['empty', ''],
    ['zero', '0s'],
    ['negative', '-1h'],
    ['garbage', 'soon'],
  ])('rejects an invalid TTL before any request: %s', async (_name, ttl) => {
    await expect(
      routingProfilesApi.saveSharedProfile(sharedProfile(), ttl, options)
    ).rejects.toThrow('Invalid session affinity TTL');
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('rejects invalid fallback mappings before any request', async () => {
    await expect(
      routingProfilesApi.saveSharedProfile(
        {
          ...sharedProfile(),
          providers: providersFromClaudeFallback({ enabled: true, mode: 'auto', mappings: [] }),
        },
        undefined,
        options
      )
    ).rejects.toThrow('Invalid Claude fallback mappings');
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('rejects a shared profile the backend did not retain', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets({ ...response(), shared: { ...rawShared(), 'session-affinity': false } });
    await expect(
      routingProfilesApi.saveSharedProfile(sharedProfile(), undefined, options)
    ).rejects.toThrow('CPA did not retain the routing profile');
  });

  it('rejects a TTL the backend did not retain', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(response(), { routing: { 'session-affinity-ttl': '1h' } });
    await expect(
      routingProfilesApi.saveSharedProfile(sharedProfile(), '24h', options)
    ).rejects.toThrow('CPA did not retain the routing profile');
    routeGets(response(), { routing: {} });
    await expect(
      routingProfilesApi.saveSharedProfile(sharedProfile(), '24h', options)
    ).rejects.toThrow('did not retain');
  });

  it('fails the save when the read-back finds an older backend', async () => {
    mocks.patch.mockResolvedValue({});
    mocks.get.mockRejectedValue({ status: 404 });
    await expect(
      routingProfilesApi.saveSharedProfile(sharedProfile(), undefined, options)
    ).rejects.toThrow('did not retain');
  });

  it('maps 422 invalid_config to InvalidRoutingConfigError with the backend message', async () => {
    const message = 'routing.selection.primary: unsupported value';
    mocks.patch.mockRejectedValue({ status: 422, apiCode: 'invalid_config', message });
    const error = await routingProfilesApi
      .saveSharedProfile(sharedProfile(), undefined, options)
      .catch((e) => e);
    expect(error).toBeInstanceOf(InvalidRoutingConfigError);
    expect(error.message).toBe(message);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('aborts when the connection changes during the write', async () => {
    mocks.patch.mockImplementation(async () => {
      mocks.revision++;
      return {};
    });
    await expect(
      routingProfilesApi.saveSharedProfile(sharedProfile(), '24h', options)
    ).rejects.toThrow('connection changed');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('Codex speed', () => {
  const speedProviders = (speed: string, ignore = false) => ({
    ...rawProviders(),
    codex: { ...rawProviders().codex, mode: 'subscription', speed, 'ignore-client-tier': ignore },
  });
  // A backend that serves `speed`: the shared profile and the key profile store `speed`.
  const speedResponse = (sharedSpeed: string, keySpeed: string | null = sharedSpeed) =>
    providersResponse(
      { providers: speedProviders(sharedSpeed) },
      keySpeed === null
        ? []
        : [{ key: RAW_KEY, profile: { ...rawShared(), providers: speedProviders(keySpeed) } }]
    );
  const fastProfile = (): RoutingProfile => {
    const profile = providersProfile();
    profile.providers.codex.mode = 'subscription';
    profile.providers.codex.speed = 'fast';
    return profile;
  };
  const codexBody = (body: Record<string, unknown>) =>
    (body.providers as Record<string, Record<string, unknown>>).codex;
  const claudeBody = (body: Record<string, unknown>) =>
    (body.providers as Record<string, Record<string, unknown>>).claude;
  const routeGets = (profiles: unknown) =>
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/routing/profiles') return profiles;
      throw new Error(`unexpected GET ${url}`);
    });

  it('marks the backend as speed-capable when the shared Codex block holds speed', () => {
    expect(readRoutingProfiles(speedResponse('standard')).speedSupported).toBe(true);
    expect(readRoutingProfiles(speedResponse('', null)).speedSupported).toBe(true);
  });

  it('marks a backend without speed in the shared Codex block as not speed-capable', () => {
    expect(readRoutingProfiles(providersResponse()).speedSupported).toBe(false);
    expect(readRoutingProfiles(response()).speedSupported).toBe(false);
    // A key profile with `speed` does not make up for a shared block without it.
    const keyOnly = providersResponse({}, [
      { key: RAW_KEY, profile: { ...rawShared(), providers: speedProviders('fast') } },
    ]);
    expect(readRoutingProfiles(keyOnly).speedSupported).toBe(false);
  });

  it('marks the unsupported backend as not speed-capable', async () => {
    mocks.get.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    await expect(routingProfilesApi.get()).resolves.toMatchObject({ speedSupported: false });
  });

  it('sends speed and ignore-client-tier in the Codex block of a key profile', () => {
    const profile = fastProfile();
    profile.providers.codex.ignoreClientTier = true;
    const body = keyProfilePatch(RAW_KEY, profile, options, true, true).routing as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const entry = body['key-profiles'][RAW_KEY];
    expect(codexBody(entry)).toEqual({
      mode: 'subscription',
      'api-credential': 'codex-idx',
      fallback: { target: 'off', mode: null, mappings: null },
      speed: 'fast',
      'ignore-client-tier': true,
    });
    expect(claudeBody(entry)).not.toHaveProperty('speed');
    expect(claudeBody(entry)).not.toHaveProperty('ignore-client-tier');
  });

  it('sends the default speed and flag explicitly, so a merge leaves no old value', () => {
    const body = profileBody(providersProfile(), options, true, true);
    expect(codexBody(body)).toMatchObject({ speed: 'standard', 'ignore-client-tier': false });
  });

  it('sends speed and ignore-client-tier in the Codex block of the shared profile', () => {
    const routing = sharedProfilePatch(fastProfile(), '5m', options, true, true).routing as Record<
      string,
      unknown
    >;
    expect(codexBody(routing)).toMatchObject({ speed: 'fast', 'ignore-client-tier': false });
    expect(claudeBody(routing)).not.toHaveProperty('speed');
    expect(claudeBody(routing)).not.toHaveProperty('ignore-client-tier');
    expect(routing['session-affinity-ttl']).toBe('5m');
  });

  it('never sends the fields in the Claude block, even if the draft holds them', () => {
    const profile = fastProfile();
    profile.providers.claude.speed = 'ultrafast';
    profile.providers.claude.ignoreClientTier = true;
    const body = profileBody(profile, options, true, true);
    expect(claudeBody(body)).not.toHaveProperty('speed');
    expect(claudeBody(body)).not.toHaveProperty('ignore-client-tier');
  });

  it.each([
    ['without the speed flag', true, false],
    ['by default', true, undefined],
  ])('sends neither field %s', (_name, providersSupported, speedSupported) => {
    const key = keyProfilePatch(RAW_KEY, fastProfile(), options, providersSupported, speedSupported)
      .routing as Record<string, Record<string, Record<string, unknown>>>;
    const shared = sharedProfilePatch(
      fastProfile(),
      undefined,
      options,
      providersSupported,
      speedSupported
    ).routing as Record<string, unknown>;
    for (const body of [key['key-profiles'][RAW_KEY], shared]) {
      expect(codexBody(body)).not.toHaveProperty('speed');
      expect(codexBody(body)).not.toHaveProperty('ignore-client-tier');
    }
  });

  it('sends neither field to a backend without providers, whatever the speed flag says', () => {
    const body = profileBody(fastProfile(), options, false, true);
    expect(body).not.toHaveProperty('providers');
    expect(JSON.stringify(body)).not.toContain('speed');
    expect(JSON.stringify(body)).not.toContain('ignore-client-tier');
  });

  it('saves a key profile with speed fast and verifies it by reading it back', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(speedResponse('standard', 'fast'));
    const state = await routingProfilesApi.saveKeyProfile(
      RAW_KEY,
      fastProfile(),
      options,
      true,
      true
    );
    expect(state.keys[0].profile.providers.codex.speed).toBe('fast');
    expect(codexBody(mocks.patch.mock.calls[0][1].routing['key-profiles'][RAW_KEY])).toMatchObject({
      speed: 'fast',
    });
    assertNoKeyInRequests();
  });

  it('rejects a key profile whose speed the backend did not retain', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(speedResponse('fast', 'standard'));
    await expect(
      routingProfilesApi.saveKeyProfile(RAW_KEY, fastProfile(), options, true, true)
    ).rejects.toThrow('CPA did not retain the routing profile');
  });

  it('rejects a key profile whose flag the backend did not retain', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(speedResponse('fast'));
    const profile = fastProfile();
    profile.providers.codex.ignoreClientTier = true;
    await expect(
      routingProfilesApi.saveKeyProfile(RAW_KEY, profile, options, true, true)
    ).rejects.toThrow('CPA did not retain the routing profile');
  });

  it('saves the shared profile with speed fast and verifies it by reading it back', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(speedResponse('fast', null));
    const state = await routingProfilesApi.saveSharedProfile(
      fastProfile(),
      undefined,
      options,
      true,
      true
    );
    expect(state.shared.providers.codex.speed).toBe('fast');
    expect(codexBody(mocks.patch.mock.calls[0][1].routing)).toMatchObject({ speed: 'fast' });
  });

  it('rejects a shared profile whose speed the backend did not retain', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(speedResponse('standard', null));
    await expect(
      routingProfilesApi.saveSharedProfile(fastProfile(), undefined, options, true, true)
    ).rejects.toThrow('CPA did not retain the routing profile');
  });

  it('fails a new fast key profile saved without the speed flag, since the body drops speed', async () => {
    // A caller that forgets the flag sends no `speed`; the backend creates the
    // profile with only the written fields, so it stores standard and the
    // read-back catches the lost value.
    mocks.patch.mockResolvedValue({});
    routeGets(speedResponse('fast', 'standard'));
    await expect(
      routingProfilesApi.saveKeyProfile(RAW_KEY, fastProfile(), options, true)
    ).rejects.toThrow('CPA did not retain the routing profile');
    const sent = mocks.patch.mock.calls[0][1].routing['key-profiles'][RAW_KEY];
    expect(codexBody(sent)).not.toHaveProperty('speed');
  });

  it('tells whether a Codex block already holds every value of a patch', () => {
    const codex = { ...defaultProviderRouting(), speed: 'fast' as const };
    expect(holdsCodexSpeed(codex, { speed: 'fast' })).toBe(true);
    expect(holdsCodexSpeed(codex, { ignoreClientTier: false })).toBe(true);
    expect(holdsCodexSpeed(codex, { speed: 'fast', ignoreClientTier: true })).toBe(false);
    expect(holdsCodexSpeed(codex, { speed: 'ultrafast' })).toBe(false);
  });

  it('a shared speed patch carries only the changed Codex fields', () => {
    expect(sharedCodexSpeedPatch({ speed: 'ultrafast' })).toEqual({
      routing: { providers: { codex: { speed: 'ultrafast' } } },
    });
    expect(sharedCodexSpeedPatch({ ignoreClientTier: true })).toEqual({
      routing: { providers: { codex: { 'ignore-client-tier': true } } },
    });
  });

  it('a key speed patch carries only the changed Codex fields of that key profile', () => {
    expect(keyCodexSpeedPatch(RAW_KEY, { speed: 'fast', ignoreClientTier: true })).toEqual({
      routing: {
        'key-profiles': {
          [RAW_KEY]: { providers: { codex: { speed: 'fast', 'ignore-client-tier': true } } },
        },
      },
    });
  });

  it('saves only a key speed, conditional on the version, and verifies that field alone', async () => {
    mocks.patch.mockResolvedValue({});
    // The key profile's session affinity differs from the one the panel loaded; the
    // write neither sends nor checks it.
    const stored = speedResponse('standard', 'ultrafast');
    const key = stored.keys[0] as { key: string; profile: Record<string, unknown> };
    key.profile['session-affinity'] = true;
    routeGets(stored);
    const state = await routingProfilesApi.saveKeyCodexSpeed(
      RAW_KEY,
      { speed: 'ultrafast' },
      '"v1"'
    );
    expect(state.keys[0].profile.providers.codex.speed).toBe('ultrafast');
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(
      '/config',
      keyCodexSpeedPatch(RAW_KEY, { speed: 'ultrafast' }),
      { headers: { 'If-Match': '"v1"' } }
    );
    assertNoKeyInRequests();
  });

  it('rejects a key speed the backend did not retain, or a key without a profile after it', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(speedResponse('fast', 'standard'));
    await expect(
      routingProfilesApi.saveKeyCodexSpeed(RAW_KEY, { speed: 'fast' }, '"v1"')
    ).rejects.toThrow('CPA did not retain the routing profile');
    // The shared profile holds the speed, but the key no longer has its own profile.
    routeGets(speedResponse('fast', null));
    await expect(
      routingProfilesApi.saveKeyCodexSpeed(RAW_KEY, { speed: 'fast' }, '"v1"')
    ).rejects.toThrow('CPA did not retain the routing profile');
  });

  it('never sends a key speed without a config version', async () => {
    await expect(
      routingProfilesApi.saveKeyCodexSpeed(RAW_KEY, { speed: 'fast' }, '')
    ).rejects.toThrow('A key speed write needs a config version');
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('maps a 412 on a key speed write to ConfigChangedError and reads nothing back', async () => {
    mocks.patch.mockRejectedValue({ status: 412, apiCode: 'precondition_failed' });
    await expect(
      routingProfilesApi.saveKeyCodexSpeed(RAW_KEY, { speed: 'fast' }, '"v1"')
    ).rejects.toBeInstanceOf(ConfigChangedError);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('scrubs the key from a 422 on a key speed write', async () => {
    mocks.patch.mockRejectedValue({
      status: 422,
      apiCode: 'invalid_config',
      message: `routing.key-profiles.${RAW_KEY}: bad`,
    });
    const error = await routingProfilesApi
      .saveKeyCodexSpeed(RAW_KEY, { speed: 'fast' }, '"v1"')
      .catch((e) => e);
    expect(error).toBeInstanceOf(InvalidRoutingConfigError);
    expect(error.message).not.toContain(RAW_KEY);
  });

  describe('a copy of the Default profile for a key', () => {
    /** The profiles the copy is built from: the Default is Fast, the key owns no profile. */
    const loadedRaw = () => speedResponse('fast', null);
    const from = () => readRoutingProfiles(loadedRaw());
    /** The Default with Ultrafast, as the speed table builds it for the key. */
    const copy = (): RoutingProfile => {
      const profile = from().shared;
      profile.providers.codex.speed = 'ultrafast';
      return profile;
    };
    /** The version written: the key holds the copy, and the Default is the one copied. */
    const written = () => speedResponse('fast', 'ultrafast');
    /** The version the empty write loaded holds another Default than the one copied. */
    const newerDefault = () => {
      const profiles = loadedRaw();
      return { ...profiles, shared: { ...profiles.shared, 'session-affinity': false } };
    };
    const writeResponse = (etag?: string) => ({ headers: etag ? { etag } : {}, data: {} });
    /** The empty write answers with `"v2"`; the copy is accepted. */
    const writes = () => {
      mocks.patchRaw.mockResolvedValueOnce(writeResponse('"v2"'));
      mocks.patch.mockResolvedValue({});
    };
    const copyWrite = () => [
      '/config',
      keyProfilePatch(RAW_KEY, copy(), options, true, true),
      { headers: { 'If-Match': '"v2"' } },
    ];
    /**
     * `/routing/profiles` answers each read with the next value, the last one repeating;
     * an `Error` or a `{status}` object is thrown instead.
     */
    const readsInTurn = (...answers: unknown[]) => {
      let index = 0;
      mocks.get.mockImplementation(async (url: string) => {
        if (url !== '/routing/profiles') throw new Error(`unexpected GET ${url}`);
        const answer = answers[Math.min(index++, answers.length - 1)];
        if (answer instanceof Error || (typeof answer === 'object' && answer && 'status' in answer))
          throw answer;
        return answer;
      });
    };
    it('checks the Default of the version named, then writes the complete copy into it and verifies it', async () => {
      writes();
      readsInTurn(loadedRaw(), written());
      const state = await routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"');
      expect(state.keys[0].profile.providers.codex.speed).toBe('ultrafast');
      // First a write that changes nothing makes CPA load the version the copy was
      // decided on; the copy then names the version that write produced.
      expect(mocks.patchRaw).toHaveBeenCalledExactlyOnceWith(
        '/config',
        {},
        { headers: { 'If-Match': '"v1"' } }
      );
      expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(...copyWrite());
      expect(mocks.get).toHaveBeenCalledTimes(2);
      assertNoKeyInRequests();
    });

    it('writes no copy of a Default CPA had not loaded yet', async () => {
      // One edit of the file added the key and changed the Default; CPA had not reloaded
      // it, so the copy was built from the old Default. The empty write loads the version
      // named, whose Default is not the one copied: the key never gets the copy.
      writes();
      readsInTurn(newerDefault());
      await expect(
        routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
      ).rejects.toBeInstanceOf(ConfigChangedError);
      expect(mocks.patchRaw).toHaveBeenCalledExactlyOnceWith(
        '/config',
        {},
        {
          headers: { 'If-Match': '"v1"' },
        }
      );
      expect(mocks.patch).not.toHaveBeenCalled();
      // Nor when the version loaded already gives the key a profile.
      mocks.patchRaw.mockReset();
      writes();
      readsInTurn(written());
      await expect(
        routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
      ).rejects.toBeInstanceOf(ConfigChangedError);
      expect(mocks.patchRaw).toHaveBeenCalledTimes(1);
      assertNoKeyInRequests();
    });

    it('writes no copy once the version loaded no longer uses key profiles or the speed', async () => {
      // A scheduler plugin took over routing, or the backend lost the speed, between the
      // reread and the empty write: a copy would wait unseen and apply once it is gone.
      // A Standard Default reads the same without `speed`, so only the capability differs.
      const standardRaw = () => speedResponse('standard', null);
      const standardCopy = readRoutingProfiles(standardRaw()).shared;
      standardCopy.providers.codex.speed = 'ultrafast';
      const withoutSpeed = structuredClone(standardRaw()) as {
        shared: { providers: { codex: Record<string, unknown> } };
      };
      delete withoutSpeed.shared.providers.codex.speed;
      expect(readRoutingProfiles(withoutSpeed).shared).toEqual(
        readRoutingProfiles(standardRaw()).shared
      );
      for (const [version, before, sent] of [
        [{ ...loadedRaw(), supported: false }, from(), copy()],
        [withoutSpeed, readRoutingProfiles(standardRaw()), standardCopy],
      ] as const) {
        mocks.patchRaw.mockReset();
        writes();
        readsInTurn(version);
        await expect(
          routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, sent, before, '"v1"')
        ).rejects.toBeInstanceOf(ConfigChangedError);
        expect(mocks.patchRaw).toHaveBeenCalledExactlyOnceWith(
          '/config',
          {},
          { headers: { 'If-Match': '"v1"' } }
        );
      }
      expect(mocks.patch).not.toHaveBeenCalled();
      assertNoKeyInRequests();
    });

    it('never writes without a version, and maps a 412 to ConfigChangedError', async () => {
      await expect(
        routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '')
      ).rejects.toThrow('A key speed write needs a config version');
      expect(mocks.patchRaw).not.toHaveBeenCalled();
      mocks.patchRaw.mockRejectedValue({ status: 412, apiCode: 'precondition_failed' });
      await expect(
        routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
      ).rejects.toBeInstanceOf(ConfigChangedError);
      expect(mocks.patchRaw).toHaveBeenCalledTimes(1);
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('writes no copy when the empty write names no version', async () => {
      for (const etag of [undefined, 'W/"v2"', '*']) {
        mocks.patchRaw.mockReset();
        mocks.patchRaw.mockResolvedValueOnce(writeResponse(etag));
        await expect(
          routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
        ).rejects.toBeInstanceOf(ConfigVersionUnavailableError);
        expect(mocks.patchRaw).toHaveBeenCalledTimes(1);
      }
      expect(mocks.get).not.toHaveBeenCalled();
    });

    it('says the key may keep a copy whose write got no answer', async () => {
      // CPA may have saved it, and without its answer nothing confirms it.
      // CPA's `write_failed` also follows a write whose bytes reached the file when only
      // the sync or close failed, so the hot reload can still load the copy.
      const refusedCopy = (failure: unknown) => {
        mocks.patchRaw.mockReset().mockResolvedValueOnce(writeResponse('"v2"'));
        mocks.patch.mockReset().mockRejectedValueOnce(failure);
        readsInTurn(loadedRaw());
      };
      for (const failure of [
        new Error('timeout of 30000ms exceeded'),
        { status: 504 },
        { status: 500, apiCode: 'write_failed', message: 'sync: input/output error' },
      ]) {
        refusedCopy(failure);
        await expect(
          routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
        ).rejects.toBeInstanceOf(DefaultCopyUnconfirmedError);
        expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(...copyWrite());
      }
      // CPA's own refusals keep their meaning: nothing was written.
      refusedCopy({ status: 412, apiCode: 'precondition_failed' });
      await expect(
        routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
      ).rejects.toBeInstanceOf(ConfigChangedError);
      refusedCopy({
        status: 422,
        apiCode: 'invalid_config',
        message: `routing.key-profiles.${RAW_KEY}: bad`,
      });
      const error = await routingProfilesApi
        .saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidRoutingConfigError);
      expect((error as Error).message).not.toContain(RAW_KEY);
      // A 500 CPA sends before it writes, such as a failed read of the file, is a refusal.
      const readFailed = { status: 500, apiCode: 'read_failed' };
      refusedCopy(readFailed);
      await expect(
        routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
      ).rejects.toBe(readFailed);
      expect(mocks.patch).toHaveBeenCalledTimes(1);
    });

    it('reports a copy CPA did not retain as unconfirmed and deletes nothing', async () => {
      // CPA names the version of its answer by a new read of the file, so a delete
      // conditional on it could remove a profile another writer gave the key meanwhile.
      for (const readBack of [speedResponse('fast', 'fast'), { status: 404 }]) {
        mocks.patch.mockReset();
        writes();
        readsInTurn(loadedRaw(), readBack);
        await expect(
          routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
        ).rejects.toBeInstanceOf(DefaultCopyUnconfirmedError);
        // The copy is the only write after the empty one.
        expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(...copyWrite());
      }
      assertNoKeyInRequests();
    });

    it('reports a copy whose read-back fails as unconfirmed and deletes nothing', async () => {
      writes();
      readsInTurn(loadedRaw(), new Error('Network down'));
      await expect(
        routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
      ).rejects.toBeInstanceOf(DefaultCopyUnconfirmedError);
      expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(...copyWrite());
      assertNoKeyInRequests();
    });

    it('reports a copy that landed beside another Default as unconfirmed', async () => {
      // An edit of the file right after CPA wrote the empty write gave its answer the
      // edited file's version, so the copy passed `If-Match` and landed beside a Default
      // it did not copy, which the read-back shows.
      writes();
      const beside = written();
      readsInTurn(loadedRaw(), {
        ...beside,
        shared: { ...beside.shared, 'session-affinity': false },
      });
      await expect(
        routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
      ).rejects.toBeInstanceOf(DefaultCopyUnconfirmedError);
      expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(...copyWrite());
    });

    it('raises no unconfirmed copy on another connection when the read-back fails after a switch', async () => {
      writes();
      let reads = 0;
      mocks.get.mockImplementation(async () => {
        reads += 1;
        if (reads === 1) return loadedRaw();
        mocks.revision += 1;
        throw new Error('Network down');
      });
      await expect(
        routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, copy(), from(), '"v1"')
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(...copyWrite());
    });
  });

  it('saves only the shared speed and verifies that field alone on read-back', async () => {
    mocks.patch.mockResolvedValue({});
    // Another field of the shared profile changed elsewhere; the check does not mind it.
    routeGets({
      ...speedResponse('ultrafast', null),
      shared: { ...speedResponse('ultrafast', null).shared, 'session-affinity': false },
    });
    const state = await routingProfilesApi.saveSharedCodexSpeed({ speed: 'ultrafast' });
    expect(state.shared.providers.codex.speed).toBe('ultrafast');
    expect(state.shared.sessionAffinity).toBe(false);
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith('/config', {
      routing: { providers: { codex: { speed: 'ultrafast' } } },
    });
  });

  it('rejects a shared speed the backend did not retain or no longer serves', async () => {
    mocks.patch.mockResolvedValue({});
    routeGets(speedResponse('standard', null));
    await expect(routingProfilesApi.saveSharedCodexSpeed({ speed: 'fast' })).rejects.toThrow(
      'CPA did not retain the routing profile'
    );
    routeGets(providersResponse({}, []));
    await expect(routingProfilesApi.saveSharedCodexSpeed({ speed: 'standard' })).rejects.toThrow(
      'CPA did not retain the routing profile'
    );
  });

  it('turns a 422 on a shared speed write into an invalid config error', async () => {
    mocks.patch.mockRejectedValue({ status: 422, apiCode: 'invalid_config', message: 'bad' });
    await expect(routingProfilesApi.saveSharedCodexSpeed({ speed: 'fast' })).rejects.toBeInstanceOf(
      InvalidRoutingConfigError
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('provider toggle', () => {
  /** A backend that serves `disabled`: both shared provider blocks hold it. */
  const toggleProviders = (claude?: unknown, codex?: unknown) => {
    const providers = rawProviders();
    return {
      claude: { ...providers.claude, ...(claude === undefined ? {} : { disabled: claude }) },
      codex: { ...providers.codex, ...(codex === undefined ? {} : { disabled: codex }) },
    };
  };
  const toggleResponse = (claude?: unknown, codex?: unknown) =>
    providersResponse({ providers: toggleProviders(claude, codex) }, [
      { key: RAW_KEY, profile: { ...rawShared(), providers: toggleProviders(codex, claude) } },
    ]);
  const blocks = (body: Record<string, unknown>) =>
    body.providers as Record<'claude' | 'codex', Record<string, unknown>>;

  it.each([
    ['true', true, true],
    ['false', false, false],
    ['absent', undefined, false],
    ['a non-boolean value', 'yes', false],
  ])('reads disabled %s for each provider', (_name, raw, expected) => {
    const claudeOff = readRoutingProfiles(toggleResponse(raw, false));
    expect(claudeOff.shared.providers.claude.disabled).toBe(expected);
    expect(claudeOff.shared.providers.codex.disabled).toBe(false);
    // The key profile swaps the two values.
    expect(claudeOff.keys[0].profile.providers.codex.disabled).toBe(expected);
    expect(claudeOff.keys[0].profile.providers.claude.disabled).toBe(false);
    const codexOff = readRoutingProfiles(toggleResponse(false, raw));
    expect(codexOff.shared.providers.codex.disabled).toBe(expected);
    expect(codexOff.shared.providers.claude.disabled).toBe(false);
  });

  it('reads both providers as enabled on an older backend', () => {
    const state = readRoutingProfiles(response());
    expect(state.shared.providers.claude.disabled).toBe(false);
    expect(state.shared.providers.codex.disabled).toBe(false);
  });

  it('marks the backend as toggle-capable when both shared provider blocks hold disabled', () => {
    expect(readRoutingProfiles(toggleResponse(false, false)).providerToggleSupported).toBe(true);
    expect(readRoutingProfiles(toggleResponse(true, true)).providerToggleSupported).toBe(true);
  });

  it('marks a backend without disabled in the shared provider blocks as not toggle-capable', () => {
    expect(readRoutingProfiles(providersResponse()).providerToggleSupported).toBe(false);
    expect(readRoutingProfiles(response()).providerToggleSupported).toBe(false);
    // One block alone is not enough.
    expect(readRoutingProfiles(toggleResponse(false)).providerToggleSupported).toBe(false);
    expect(readRoutingProfiles(toggleResponse(undefined, false)).providerToggleSupported).toBe(
      false
    );
    // A key profile with `disabled` does not make up for a shared profile without it.
    const keyOnly = providersResponse({}, [
      { key: RAW_KEY, profile: { ...rawShared(), providers: toggleProviders(true, true) } },
    ]);
    expect(readRoutingProfiles(keyOnly).providerToggleSupported).toBe(false);
  });

  it('marks the unsupported backend as not toggle-capable', async () => {
    mocks.get.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    await expect(routingProfilesApi.get()).resolves.toMatchObject({
      providerToggleSupported: false,
    });
  });

  it('sends disabled in both provider blocks, explicit false when on, only when supported', () => {
    const profile = providersProfile();
    profile.providers.claude.disabled = true;
    const body = blocks(profileBody(profile, options, true, false, true));
    expect(body.claude.disabled).toBe(true);
    expect(body.codex.disabled).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body.codex, 'disabled')).toBe(true);
    profile.providers.claude.disabled = false;
    profile.providers.codex.disabled = true;
    const swapped = blocks(profileBody(profile, options, true, true, true));
    expect(swapped.claude.disabled).toBe(false);
    expect(swapped.codex).toMatchObject({ disabled: true, speed: 'standard' });
  });

  it('keeps the other fields of a disabled provider in the body', () => {
    const profile = providersProfile();
    profile.providers.claude.disabled = true;
    const on = blocks(profileBody(providersProfile(), options, true, false, true));
    const off = blocks(profileBody(profile, options, true, false, true));
    expect(off.claude).toEqual({ ...on.claude, disabled: true });
  });

  it('threads the toggle flag through the key and shared patches', () => {
    const profile = providersProfile();
    profile.providers.codex.disabled = true;
    const key = keyProfilePatch(RAW_KEY, profile, options, true, false, true).routing as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(blocks(key['key-profiles'][RAW_KEY]).codex.disabled).toBe(true);
    expect(blocks(key['key-profiles'][RAW_KEY]).claude.disabled).toBe(false);
    const shared = sharedProfilePatch(profile, undefined, options, true, false, true)
      .routing as Record<string, unknown>;
    expect(blocks(shared).codex.disabled).toBe(true);
    expect(blocks(shared).claude.disabled).toBe(false);
  });

  it.each([
    ['without the toggle flag', false],
    ['by default', undefined],
  ])('never sends disabled %s', (_name, toggleSupported) => {
    const profile = providersProfile();
    profile.providers.claude.disabled = true;
    profile.providers.codex.disabled = true;
    const bodies = [
      profileBody(profile, options, true, true, toggleSupported),
      (
        keyProfilePatch(RAW_KEY, profile, options, true, true, toggleSupported).routing as Record<
          string,
          Record<string, Record<string, unknown>>
        >
      )['key-profiles'][RAW_KEY],
      sharedProfilePatch(profile, undefined, options, true, true, toggleSupported)
        .routing as Record<string, unknown>,
    ];
    for (const body of bodies) {
      expect(blocks(body).claude).not.toHaveProperty('disabled');
      expect(blocks(body).codex).not.toHaveProperty('disabled');
    }
  });

  it('never sends disabled to a backend without providers, whatever the toggle flag says', () => {
    const profile = providersProfile();
    profile.providers.claude.disabled = true;
    const body = profileBody(profile, options, false, true, true);
    expect(body).not.toHaveProperty('providers');
    expect(JSON.stringify(body)).not.toContain('disabled');
  });

  describe('save methods', () => {
    /** The exact provider blocks of `providersProfile()` with Claude off, as sent. */
    const sentProviders = (toggle: boolean) => ({
      claude: {
        mode: 'subscription',
        'api-credential': 'claude-idx',
        fallback: {
          target: 'api',
          mode: 'auto',
          mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
        },
        ...(toggle ? { disabled: true } : {}),
      },
      codex: {
        mode: 'api',
        'api-credential': 'codex-idx',
        fallback: { target: 'off', mode: null, mappings: null },
        ...(toggle ? { disabled: false } : {}),
      },
    });
    const sentProfile = (toggle: boolean) => ({
      'session-affinity': true,
      'preferred-accounts': { claude: 'claude-1', codex: null },
      selection: { primary: 'reserves', tiebreak: 'earliest-reset' },
      providers: sentProviders(toggle),
    });
    /** A read-back that stores Claude off in the shared profile and the key profile. */
    const claudeOffResponse = (toggle: boolean) => {
      const providers = toggle ? toggleProviders(true, false) : rawProviders();
      return providersResponse({ providers }, [
        { key: RAW_KEY, profile: { ...rawShared(), providers } },
      ]);
    };
    const claudeOff = () => {
      const profile = providersProfile();
      profile.providers.claude.disabled = true;
      return profile;
    };
    const routeGets = (profiles: unknown) =>
      mocks.get.mockImplementation(async (url: string) => {
        if (url === '/routing/profiles') return profiles;
        throw new Error(`unexpected GET ${url}`);
      });

    it('saveKeyProfile sends disabled in the exact body on a toggle-capable backend', async () => {
      mocks.patch.mockResolvedValue({});
      routeGets(claudeOffResponse(true));
      await routingProfilesApi.saveKeyProfile(RAW_KEY, claudeOff(), options, true, false, true);
      expect(mocks.patch).toHaveBeenCalledTimes(1);
      expect(mocks.patch).toHaveBeenCalledWith('/config', {
        routing: { 'key-profiles': { [RAW_KEY]: sentProfile(true) } },
      });
      assertNoKeyInRequests();
    });

    it('saveSharedProfile sends disabled in the exact body on a toggle-capable backend', async () => {
      mocks.patch.mockResolvedValue({});
      routeGets(claudeOffResponse(true));
      await routingProfilesApi.saveSharedProfile(
        claudeOff(),
        undefined,
        options,
        true,
        false,
        true
      );
      expect(mocks.patch).toHaveBeenCalledTimes(1);
      expect(mocks.patch).toHaveBeenCalledWith('/config', { routing: sentProfile(true) });
    });

    it('re-enabling sends an explicit disabled: false for both providers', async () => {
      mocks.patch.mockResolvedValue({});
      routeGets(
        providersResponse({ providers: toggleProviders(false, false) }, [
          { key: RAW_KEY, profile: { ...rawShared(), providers: toggleProviders(false, false) } },
        ])
      );
      const on = providersProfile();
      await routingProfilesApi.saveKeyProfile(RAW_KEY, on, options, true, false, true);
      await routingProfilesApi.saveSharedProfile(on, undefined, options, true, false, true);
      const keyBody = mocks.patch.mock.calls[0][1].routing['key-profiles'][RAW_KEY];
      const sharedBody = mocks.patch.mock.calls[1][1].routing;
      for (const body of [keyBody, sharedBody]) {
        expect(blocks(body).claude).toHaveProperty('disabled', false);
        expect(blocks(body).codex).toHaveProperty('disabled', false);
      }
    });

    it.each([
      ['without the toggle flag', false],
      ['by default', undefined],
    ])('both save methods omit disabled %s', async (_name, toggleSupported) => {
      mocks.patch.mockResolvedValue({});
      // An older backend stores no `disabled`, so the read-back has Claude on.
      routeGets(claudeOffResponse(false));
      const profile = providersProfile();
      await routingProfilesApi.saveKeyProfile(
        RAW_KEY,
        profile,
        options,
        true,
        false,
        toggleSupported
      );
      await routingProfilesApi.saveSharedProfile(
        profile,
        undefined,
        options,
        true,
        false,
        toggleSupported
      );
      expect(mocks.patch.mock.calls[0][1]).toEqual({
        routing: { 'key-profiles': { [RAW_KEY]: sentProfile(false) } },
      });
      expect(mocks.patch.mock.calls[1][1]).toEqual({ routing: sentProfile(false) });
    });

    it('rejects a disabled provider the backend did not retain', async () => {
      mocks.patch.mockResolvedValue({});
      routeGets(
        providersResponse({ providers: toggleProviders(false, false) }, [
          { key: RAW_KEY, profile: { ...rawShared(), providers: toggleProviders(false, false) } },
        ])
      );
      await expect(
        routingProfilesApi.saveKeyProfile(RAW_KEY, claudeOff(), options, true, false, true)
      ).rejects.toThrow('CPA did not retain the routing profile');
      await expect(
        routingProfilesApi.saveSharedProfile(claudeOff(), undefined, options, true, false, true)
      ).rejects.toThrow('CPA did not retain the routing profile');
    });
  });

  it('a key copy of the Default carries its disabled on a toggle-capable backend', async () => {
    // The Default stores Claude off and serves `speed`, which the copy write requires.
    const providers = () => {
      const raw = toggleProviders(true, false);
      return { ...raw, codex: { ...raw.codex, speed: 'standard' } };
    };
    const shared = { ...rawShared(), providers: providers() };
    const before = { ...providersResponse({ providers: providers() }, []) };
    const after = providersResponse({ providers: providers() }, [
      { key: RAW_KEY, profile: shared },
    ]);
    const from = readRoutingProfiles(before);
    expect(from.providerToggleSupported).toBe(true);
    mocks.patchRaw.mockResolvedValueOnce({ headers: { etag: '"v2"' }, data: {} });
    mocks.patch.mockResolvedValue({});
    let reads = 0;
    mocks.get.mockImplementation(async () => (reads++ === 0 ? before : after));
    await routingProfilesApi.saveKeyDefaultCopy(RAW_KEY, from.shared, from, '"v1"');
    const [, body] = mocks.patch.mock.calls[0] as [string, Record<string, unknown>];
    const entry = (body.routing as Record<string, Record<string, Record<string, unknown>>>)[
      'key-profiles'
    ][RAW_KEY];
    expect(blocks(entry).claude.disabled).toBe(true);
    expect(blocks(entry).codex.disabled).toBe(false);
  });
});
