import { describe, expect, test } from 'vitest';
import {
  providersFromClaudeFallback,
  type ProviderRouting,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { sha256Hex } from '@/utils/apiKeyHash';
import { buildSpeedRows, codexSpeedUse, withCodexSpeed } from './codexSpeedModel';
import { buildKeyRows } from './keyProfilesModel';

const RAW_ALPHA = 'sk-live-RAWKEY-alpha-000111';
const RAW_BETA = 'sk-live-RAWKEY-beta-000222';
const RAW_GAMMA = 'sk-live-RAWKEY-gamma-000333';

const codex = (overrides: Partial<ProviderRouting> = {}): ProviderRouting => ({
  mode: 'subscription',
  apiCredential: '',
  fallback: { target: 'off', mode: 'auto', mappings: [] },
  speed: 'standard',
  ignoreClientTier: false,
  ...overrides,
});

const profile = (codexRouting: ProviderRouting, primary = 'reserves'): RoutingProfile => {
  const providers = providersFromClaudeFallback({ enabled: false, mode: 'auto', mappings: [] });
  return {
    sessionAffinity: true,
    preferredAccounts: { claude: 'claude-a' },
    selection: { primary, tiebreak: 'round-robin' },
    providers: { claude: providers.claude, codex: codexRouting },
  };
};

/** A profile whose Claude falls back to Codex (the Claude block of `profile` has no fallback). */
const viaClaude = (codexRouting: ProviderRouting): RoutingProfile => {
  const base = profile(codexRouting);
  const claude = base.providers.claude;
  return {
    ...base,
    providers: {
      ...base.providers,
      claude: { ...claude, fallback: { ...claude.fallback, target: 'codex' } },
    },
  };
};

const state = (overrides: Partial<RoutingProfilesState> = {}): RoutingProfilesState => ({
  supported: true,
  unsupportedBackend: false,
  providersSupported: true,
  speedSupported: true,
  apiCredentials: { claude: [], codex: [] },
  shared: profile(codex({ speed: 'fast', ignoreClientTier: true })),
  keys: [],
  selectionOptions: { narrowing: ['reserves'], pickers: ['round-robin'] },
  ...overrides,
});

const keyRows = (own: Partial<Record<string, RoutingProfile>> = {}) =>
  buildKeyRows(
    [RAW_ALPHA, RAW_BETA, RAW_GAMMA].map((key) => ({ key, profile: own[key] ?? null })),
    [{ apiKeyHash: sha256Hex(RAW_ALPHA).toLowerCase(), alias: 'Laptop' }]
  );

describe('codexSpeedUse', () => {
  test('Subscription mode applies the speed, with any fallback target', () => {
    expect(codexSpeedUse(profile(codex()).providers, false)).toBe('applies');
    const apiTarget = codex({ fallback: { target: 'api', mode: 'auto', mappings: [] } });
    expect(codexSpeedUse(profile(apiTarget).providers, false)).toBe('applies');
    expect(codexSpeedUse(viaClaude(codex()).providers, false)).toBe('applies');
  });

  test('API key mode leaves the speed unused unless Claude falls back to Codex', () => {
    expect(codexSpeedUse(profile(codex({ mode: 'api' })).providers, false)).toBe('unused');
    const fallback = viaClaude(codex({ mode: 'api' }));
    expect(codexSpeedUse(fallback.providers, false)).toBe('claude_fallback');
    // Claude in API key mode skips its fallback, so the speed reaches no request.
    const claudeApi = { ...fallback.providers.claude, mode: 'api' as const };
    expect(codexSpeedUse({ ...fallback.providers, claude: claudeApi }, false)).toBe('unused');
  });

  test('a locked mode applies the speed, also with a stored API key mode', () => {
    // CPA ignores the stored mode and fallback target while it is locked.
    expect(codexSpeedUse(profile(codex({ mode: 'api' })).providers, true)).toBe('applies');
    expect(codexSpeedUse(viaClaude(codex({ mode: 'api' })).providers, true)).toBe('applies');
  });
});

describe('buildSpeedRows', () => {
  test('the Default row comes first, then the keys in list order', () => {
    const display = keyRows();
    const rows = buildSpeedRows(state(), display);
    expect(rows[0]).toMatchObject({ id: 'default', keyRow: null, disabledReason: '' });
    // Each key row carries its display row as is, so labels match the Keys modal.
    expect(rows.slice(1).map((row) => row.keyRow)).toEqual(display);
    expect(rows.slice(1).map((row) => row.keyRow?.key)).toEqual([RAW_ALPHA, RAW_BETA, RAW_GAMMA]);
    expect(rows[1].keyRow).toMatchObject({ label: 'Laptop', hasAlias: true });
    expect(rows[2].keyRow?.hasAlias).toBe(false);
  });

  test('a key without its own profile shows the Default values; one with a profile shows its own', () => {
    const own = profile(codex({ speed: 'ultrafast', ignoreClientTier: false }), 'priority');
    const rows = buildSpeedRows(state(), keyRows({ [RAW_BETA]: own }));
    expect(rows[0]).toMatchObject({ speed: 'fast', ignoreClientTier: true });
    expect(rows[1]).toMatchObject({ speed: 'fast', ignoreClientTier: true });
    expect(rows[1].keyRow?.profile).toBeNull();
    expect(rows[2]).toMatchObject({ speed: 'ultrafast', ignoreClientTier: false });
    expect(rows[2].keyRow?.profile).toBe(own);
    expect(rows[3]).toMatchObject({ speed: 'fast', ignoreClientTier: true });
    expect(rows[3].keyRow?.profile).toBeNull();
  });

  test('a key row is api_mode when its effective Codex mode is API key', () => {
    const apiOwn = profile(codex({ mode: 'api', speed: 'fast' }));
    const rows = buildSpeedRows(state(), keyRows({ [RAW_GAMMA]: apiOwn }));
    expect(rows.map((row) => row.disabledReason)).toEqual(['', '', '', 'api_mode']);
    // A Default profile in API key mode is inherited by keys without their own profile.
    const apiShared = buildSpeedRows(
      state({ shared: profile(codex({ mode: 'api' })) }),
      keyRows({ [RAW_BETA]: profile(codex()) })
    );
    expect(apiShared.map((row) => row.disabledReason)).toEqual([
      'api_mode',
      'api_mode',
      '',
      'api_mode',
    ]);
  });

  test('Codex in API key mode stays enabled while Claude falls back to Codex', () => {
    // CPA runs the Claude -> Codex leg on Codex subscriptions with the profile's Codex speed.
    const rows = buildSpeedRows(
      state({ shared: viaClaude(codex({ mode: 'api', speed: 'ultrafast' })) }),
      keyRows({ [RAW_BETA]: profile(codex({ mode: 'api' })), [RAW_GAMMA]: profile(codex()) })
    );
    expect(rows.map((row) => row.disabledReason)).toEqual(['', '', 'api_mode', '']);
    expect(rows.map((row) => row.claudeFallbackOnly)).toEqual([true, true, false, false]);
    expect(rows[1].speed).toBe('ultrafast');
    // Claude in API key mode skips its fallback, so the speed reaches no request.
    const claudeApi = viaClaude(codex({ mode: 'api' }));
    claudeApi.providers.claude = { ...claudeApi.providers.claude, mode: 'api' };
    expect(buildSpeedRows(state({ shared: claudeApi }), [])[0]).toMatchObject({
      disabledReason: 'api_mode',
      claudeFallbackOnly: false,
    });
    // Under supported: false CPA ignores the stored mode and fallback target.
    const locked = buildSpeedRows(
      state({ supported: false, shared: viaClaude(codex({ mode: 'api' })) }),
      keyRows()
    );
    expect(locked.every((row) => !row.claudeFallbackOnly)).toBe(true);
    expect(locked[0].disabledReason).toBe('');
  });

  test('under supported: false every key row is read_only and the Default row stays enabled', () => {
    const rows = buildSpeedRows(state({ supported: false }), keyRows());
    expect(rows.map((row) => row.disabledReason)).toEqual([
      '',
      'read_only',
      'read_only',
      'read_only',
    ]);
    // CPA ignores the stored mode there, while the shared speed applies.
    const apiShared = buildSpeedRows(
      state({ supported: false, shared: profile(codex({ mode: 'api' })) }),
      keyRows()
    );
    expect(apiShared[0].disabledReason).toBe('');
    expect(apiShared.slice(1).every((row) => row.disabledReason === 'read_only')).toBe(true);
  });

  test('under supported: false a key row shows the Default values, which its requests get', () => {
    const own = profile(codex({ speed: 'ultrafast', ignoreClientTier: false }), 'priority');
    const rows = buildSpeedRows(state({ supported: false }), keyRows({ [RAW_BETA]: own }));
    // CPA ignores key profiles there, so the stored Ultrafast of beta does not apply.
    for (const row of rows) expect(row).toMatchObject({ speed: 'fast', ignoreClientTier: true });
    // The stored profile is kept on the display row, so the badge still says "Own profile".
    expect(rows[2].keyRow?.profile).toBe(own);
    expect(rows[2].disabledReason).toBe('read_only');
  });

  test('no id or label holds a raw key', () => {
    const rows = buildSpeedRows(state(), keyRows({ [RAW_BETA]: profile(codex()) }));
    for (const row of rows) {
      for (const raw of [RAW_ALPHA, RAW_BETA, RAW_GAMMA]) {
        expect(row.id).not.toContain(raw);
        expect(row.keyRow?.label ?? '').not.toContain(raw);
        expect(row.keyRow?.masked ?? '').not.toContain(raw);
      }
    }
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  test('without keys only the Default row is built', () => {
    expect(buildSpeedRows(state(), [])).toHaveLength(1);
  });
});

describe('withCodexSpeed', () => {
  test('changes only the Codex speed and flag', () => {
    const input = profile(codex({ speed: 'fast', apiCredential: 'idx' }));
    const before = JSON.parse(JSON.stringify(input));
    const speedOnly = withCodexSpeed(input, { speed: 'ultrafast' });
    expect(speedOnly).toEqual({
      ...before,
      providers: { ...before.providers, codex: { ...before.providers.codex, speed: 'ultrafast' } },
    });
    const flagOnly = withCodexSpeed(input, { ignoreClientTier: true });
    expect(flagOnly.providers.codex).toEqual({ ...before.providers.codex, ignoreClientTier: true });
    expect(flagOnly.providers.claude).toEqual(before.providers.claude);
    // The input is not mutated.
    expect(input).toEqual(before);
    expect(speedOnly.providers).not.toBe(input.providers);
    expect(speedOnly.providers.codex).not.toBe(input.providers.codex);
  });
});
