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
  readRoutingProfiles,
  routingProfilesApi,
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
  claudeFallback: {
    enabled: true,
    mode: 'always',
    mappings: [{ from: 'claude-*', to: 'gpt-6-sol' }],
  },
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
        claudeFallback: {
          enabled: true,
          mode: 'auto',
          mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
        },
      },
      keys: [{ key: RAW_KEY, profile: keyProfile() }],
      selectionOptions: options,
    });
  });

  it('accepts an omitted preferred-accounts block and an empty tiebreak', () => {
    const profile = { ...rawKeyProfile(), selection: { primary: 'fill-first', tiebreak: '' } };
    delete (profile as Record<string, unknown>)['preferred-accounts'];
    const state = readRoutingProfiles(response([{ key: RAW_KEY, profile }]));
    expect(state.keys[0].profile.preferredAccounts).toEqual({});
    expect(state.keys[0].profile.selection).toEqual({ primary: 'fill-first' });
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
      { ...response(), shared: { ...rawShared(), selection: { primary: 'reserves', tiebreak: 1 } } },
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
  it('sends the complete profile with cleared values as null', () => {
    const profile: RoutingProfile = {
      ...keyProfile(),
      preferredAccounts: { claude: ' claude-2 ', codex: '' },
      selection: { primary: 'priority' },
      claudeFallback: {
        enabled: true,
        mode: 'auto',
        mappings: [
          { from: ' claude-opus-* ', to: 'gpt-6-astra ' },
          { from: 'claude-sonnet-*', to: 'gpt-6-sol' },
        ],
      },
    };
    expect(keyProfilePatch(RAW_KEY, profile, options)).toEqual({
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
        claudeFallback: { enabled: true, mode: 'auto', mappings: [] },
      })
    ).rejects.toThrow('Invalid Claude fallback mappings');
    expect(mocks.patch).not.toHaveBeenCalled();
  });
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
