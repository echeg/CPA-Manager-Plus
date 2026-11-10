import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), revision: 0 }));
vi.mock('./client', () => ({
  apiClient: {
    get: mocks.get,
    patch: mocks.patch,
    getConnectionRevision: () => mocks.revision,
  },
}));
import { sha256Hex } from '@/utils/apiKeyHash';
import {
  clientApiKeys,
  InvalidRoutingConfigError,
  keyProfilePatch,
  mergeKeyRows,
  profileBody,
  providersFromClaudeFallback,
  readRoutingProfiles,
  routingProfilesApi,
  sharedProfilePatch,
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
    },
    codex: {
      mode: 'api',
      apiCredential: 'codex-idx',
      fallback: { target: 'off', mode: 'auto', mappings: [] },
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
  for (const [url] of [...mocks.get.mock.calls, ...mocks.patch.mock.calls]) {
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
      },
      codex: {
        mode: 'subscription',
        apiCredential: '',
        fallback: { target: 'off', mode: 'auto', mappings: [] },
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
      },
      codex: {
        mode: 'subscription',
        apiCredential: '',
        fallback: { target: 'off', mode: 'auto', mappings: [] },
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
