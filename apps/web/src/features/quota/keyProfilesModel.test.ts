import { beforeAll, describe, expect, test } from 'vitest';
import i18n from '@/i18n';
import {
  providersFromClaudeFallback,
  type ProviderRouting,
  type RoutingProfile,
  type RoutingSelectionOptions,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { sha256Hex } from '@/utils/apiKeyHash';
import {
  buildKeyRows,
  chainSummary,
  copyOfShared,
  normalizeProfile,
  profileDirty,
} from './keyProfilesModel';
import { preferredAccountOptions } from './routingModel';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const t = i18n.t.bind(i18n);

const options: RoutingSelectionOptions = {
  narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
  pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
};

const profile = (patch: Partial<RoutingProfile> = {}): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: { claude: 'claude-a' },
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  providers: providersFromClaudeFallback({
    enabled: true,
    mode: 'auto',
    mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
  }),
  ...patch,
});

/** `profile()` with one provider block replaced. */
const withProvider = (
  provider: 'claude' | 'codex',
  routing: ProviderRouting,
  base: RoutingProfile = profile()
): RoutingProfile => ({ ...base, providers: { ...base.providers, [provider]: routing } });

const claudeRouting = (patch: Partial<ProviderRouting> = {}): ProviderRouting => ({
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
  ...patch,
});

const files: AuthFileItem[] = [
  {
    name: 'claude-bob@example.com.json',
    email: 'bob@example.com',
    provider: 'claude',
    authIndex: 'claude-a',
  },
  {
    name: 'codex-alice@example.com.json',
    email: 'alice@example.com',
    provider: 'codex',
    authIndex: 'codex-a',
    disabled: true,
  },
  { name: 'codex-no-index.json', provider: 'codex' },
];

describe('normalizeProfile and profileDirty', () => {
  test('a picker primary drops the tiebreak', () => {
    const value = profile({ selection: { primary: 'fill-first', tiebreak: 'round-robin' } });
    expect(normalizeProfile(value, options).selection).toEqual({ primary: 'fill-first' });
    expect(profileDirty(value, profile({ selection: { primary: 'fill-first' } }), options)).toBe(
      false
    );
  });

  test('a narrowing primary keeps the tiebreak', () => {
    expect(normalizeProfile(profile(), options).selection).toEqual({
      primary: 'reserves',
      tiebreak: 'round-robin',
    });
    expect(profileDirty(profile(), profile({ selection: { primary: 'reserves' } }), options)).toBe(
      true
    );
  });

  test('mappings are trimmed and empty preferences dropped', () => {
    const messy = profile({
      preferredAccounts: { claude: ' claude-a ', codex: '  ' },
      providers: providersFromClaudeFallback({
        enabled: true,
        mode: 'auto',
        mappings: [{ from: ' claude-opus-* ', to: ' gpt-6-astra ' }],
      }),
    });
    const normalized = normalizeProfile(messy, options);
    expect(normalized.preferredAccounts).toEqual({ claude: 'claude-a' });
    expect(normalized.providers.claude.fallback.mappings).toEqual([
      { from: 'claude-opus-*', to: 'gpt-6-astra' },
    ]);
    expect(profileDirty(messy, profile(), options)).toBe(false);
  });

  test('a real change is dirty', () => {
    expect(profileDirty(profile(), profile({ sessionAffinity: false }), options)).toBe(true);
    expect(
      profileDirty(profile(), profile({ preferredAccounts: { codex: 'codex-a' } }), options)
    ).toBe(true);
  });
});

describe('normalizeProfile with providers', () => {
  test('trims the API credential and builds keys in a fixed order', () => {
    const messy = withProvider('claude', {
      ignoreClientTier: false,
      disabled: false,
      speed: 'standard',
      fallback: { mappings: [], mode: 'always', target: 'api' },
      apiCredential: '  claude-key  ',
      mode: 'subscription',
    });
    const normalized = normalizeProfile(messy, options);
    expect(normalized.providers.claude.apiCredential).toBe('claude-key');
    expect(JSON.stringify(normalized.providers.claude)).toBe(
      '{"mode":"subscription","apiCredential":"claude-key","fallback":{"target":"api","mode":"always","mappings":[]},"speed":"standard","ignoreClientTier":false,"disabled":false}'
    );
    expect(
      profileDirty(
        messy,
        withProvider(
          'claude',
          claudeRouting({
            apiCredential: 'claude-key',
            fallback: { target: 'api', mode: 'always', mappings: [] },
          })
        ),
        options
      )
    ).toBe(false);
  });

  test('API key mode carries target off but keeps the mappings and the credential', () => {
    const api = withProvider('claude', claudeRouting({ mode: 'api', apiCredential: 'claude-key' }));
    expect(normalizeProfile(api, options).providers.claude).toEqual({
      mode: 'api',
      apiCredential: 'claude-key',
      fallback: {
        target: 'off',
        mode: 'auto',
        mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
      },
      speed: 'standard',
      ignoreClientTier: false,
      disabled: false,
    });
    // The backend stores target off for API key mode, so a read-back with off is equal.
    const stored = withProvider(
      'claude',
      claudeRouting({
        mode: 'api',
        apiCredential: 'claude-key',
        fallback: { ...claudeRouting().fallback, target: 'off' },
      })
    );
    expect(profileDirty(api, stored, options)).toBe(false);
  });

  test('hidden values stay part of the profile: mappings and a credential under target off', () => {
    const hidden = withProvider(
      'claude',
      claudeRouting({
        apiCredential: 'claude-key',
        fallback: { ...claudeRouting().fallback, target: 'off' },
      })
    );
    const cleared = withProvider(
      'claude',
      claudeRouting({ fallback: { target: 'off', mode: 'auto', mappings: [] } })
    );
    expect(normalizeProfile(hidden, options).providers.claude.apiCredential).toBe('claude-key');
    expect(profileDirty(hidden, cleared, options)).toBe(true);
  });

  test('ignores the Codex fallback mode and mappings, and a Codex target of codex', () => {
    const codex = (fallback: ProviderRouting['fallback']): RoutingProfile =>
      withProvider('codex', {
        mode: 'subscription',
        apiCredential: ' codex-key ',
        fallback,
        speed: 'standard',
        ignoreClientTier: false,
        disabled: false,
      });
    const a = codex({ target: 'api', mode: 'always', mappings: [{ from: 'x', to: 'y' }] });
    const b = codex({ target: 'api', mode: 'auto', mappings: [] });
    expect(normalizeProfile(a, options).providers.codex).toEqual({
      mode: 'subscription',
      apiCredential: 'codex-key',
      fallback: { target: 'api', mode: 'auto', mappings: [] },
      speed: 'standard',
      ignoreClientTier: false,
      disabled: false,
    });
    expect(profileDirty(a, b, options)).toBe(false);
  });

  test('a change of mode, target or credential is dirty', () => {
    const base = profile();
    expect(
      profileDirty(base, withProvider('claude', claudeRouting({ mode: 'api' })), options)
    ).toBe(true);
    expect(
      profileDirty(
        base,
        withProvider(
          'claude',
          claudeRouting({ fallback: { ...claudeRouting().fallback, target: 'api' } })
        ),
        options
      )
    ).toBe(true);
    expect(
      profileDirty(
        base,
        withProvider('codex', {
          mode: 'subscription',
          apiCredential: 'codex-key',
          fallback: { target: 'off', mode: 'auto', mappings: [] },
          speed: 'standard',
          ignoreClientTier: false,
          disabled: false,
        }),
        options
      )
    ).toBe(true);
  });
});

describe('normalizeProfile with the Codex speed', () => {
  const withCodexSpeed = (
    patch: Partial<ProviderRouting>,
    base: RoutingProfile = profile()
  ): RoutingProfile => withProvider('codex', { ...base.providers.codex, ...patch }, base);

  test('carries the speed and the flag of both providers', () => {
    const fast = withCodexSpeed({ speed: 'ultrafast', ignoreClientTier: true });
    const normalized = normalizeProfile(fast, options);
    expect(normalized.providers.codex.speed).toBe('ultrafast');
    expect(normalized.providers.codex.ignoreClientTier).toBe(true);
    expect(normalized.providers.claude.speed).toBe('standard');
    expect(normalized.providers.claude.ignoreClientTier).toBe(false);
    // API key mode keeps the stored values: they are hidden, not cleared.
    const api = normalizeProfile(withCodexSpeed({ mode: 'api', speed: 'fast' }), options);
    expect(api.providers.codex.speed).toBe('fast');
  });

  test('a changed speed is dirty', () => {
    expect(profileDirty(profile(), withCodexSpeed({ speed: 'fast' }), options)).toBe(true);
    expect(
      profileDirty(
        withCodexSpeed({ speed: 'fast' }),
        withCodexSpeed({ speed: 'ultrafast' }),
        options
      )
    ).toBe(true);
  });

  test('a changed flag is dirty', () => {
    expect(profileDirty(profile(), withCodexSpeed({ ignoreClientTier: true }), options)).toBe(true);
  });

  test('equal speeds and flags are not dirty', () => {
    expect(
      profileDirty(
        withCodexSpeed({ speed: 'fast', ignoreClientTier: true }),
        withCodexSpeed({ speed: 'fast', ignoreClientTier: true }),
        options
      )
    ).toBe(false);
    expect(profileDirty(profile(), profile(), options)).toBe(false);
  });
});

describe('normalizeProfile with a disabled provider', () => {
  const disabledProvider = (provider: 'claude' | 'codex', base: RoutingProfile = profile()) =>
    withProvider(provider, { ...base.providers[provider], disabled: true }, base);

  test('keeps disabled true for both providers, with the other fields as they are', () => {
    const both = disabledProvider('codex', disabledProvider('claude'));
    const normalized = normalizeProfile(both, options);
    expect(normalized.providers.claude.disabled).toBe(true);
    expect(normalized.providers.codex.disabled).toBe(true);
    const enabled = normalizeProfile(profile(), options);
    expect(normalized.providers.claude).toEqual({ ...enabled.providers.claude, disabled: true });
    expect(normalized.providers.codex).toEqual({ ...enabled.providers.codex, disabled: true });
  });

  test('a change of only the Claude or only the Codex disabled is dirty', () => {
    expect(profileDirty(profile(), disabledProvider('claude'), options)).toBe(true);
    expect(profileDirty(profile(), disabledProvider('codex'), options)).toBe(true);
    expect(profileDirty(disabledProvider('claude'), disabledProvider('codex'), options)).toBe(true);
    expect(profileDirty(disabledProvider('claude'), disabledProvider('claude'), options)).toBe(
      false
    );
  });

  test('keeps disabled under API key mode', () => {
    const api = withProvider('claude', claudeRouting({ mode: 'api', disabled: true }));
    expect(normalizeProfile(api, options).providers.claude.disabled).toBe(true);
  });
});

describe('copyOfShared', () => {
  test('copies disabled of both providers', () => {
    const shared = withProvider('codex', { ...profile().providers.codex, disabled: true });
    shared.providers.claude = { ...shared.providers.claude, disabled: true };
    const copy = copyOfShared(shared);
    expect(copy.providers.claude.disabled).toBe(true);
    expect(copy.providers.codex.disabled).toBe(true);
    expect(copy).toEqual(shared);
    copy.providers.claude.disabled = false;
    expect(shared.providers.claude.disabled).toBe(true);
  });

  test('copies the Codex speed and flag into an independent copy', () => {
    const shared = withProvider('codex', {
      ...profile().providers.codex,
      speed: 'fast',
      ignoreClientTier: true,
    });
    const copy = copyOfShared(shared);
    expect(copy.providers.codex.speed).toBe('fast');
    expect(copy.providers.codex.ignoreClientTier).toBe(true);
    expect(copy).toEqual(shared);
    copy.providers.codex.speed = 'ultrafast';
    copy.providers.codex.ignoreClientTier = false;
    expect(shared.providers.codex.speed).toBe('fast');
    expect(shared.providers.codex.ignoreClientTier).toBe(true);
  });

  test('returns an equal, independent copy', () => {
    const shared = profile();
    const copy = copyOfShared(shared);
    expect(copy).toEqual(shared);
    copy.preferredAccounts.claude = 'other';
    copy.selection.primary = 'priority';
    copy.providers.claude.fallback.mappings[0].to = 'changed';
    copy.providers.claude.fallback.mappings.push({ from: 'x', to: 'y' });
    copy.providers.claude.fallback.target = 'off';
    copy.providers.codex.apiCredential = 'changed';
    expect(shared).toEqual(profile());
  });

  test('keeps hidden values: API key mode with a stored mapping table and credential', () => {
    const shared = withProvider(
      'claude',
      claudeRouting({ mode: 'api', apiCredential: 'claude-key' }),
      withProvider('codex', {
        mode: 'subscription',
        apiCredential: 'codex-key',
        fallback: { target: 'off', mode: 'auto', mappings: [] },
        speed: 'standard',
        ignoreClientTier: false,
        disabled: false,
      })
    );
    const copy = copyOfShared(shared);
    expect(copy).toEqual(shared);
    expect(copy.providers.claude.fallback).not.toBe(shared.providers.claude.fallback);
    expect(copy.providers.codex).not.toBe(shared.providers.codex);
  });
});

describe('buildKeyRows', () => {
  const rawKey = 'sk-client-secret-key-0001';
  const otherKey = 'sk-client-secret-key-0002';

  test('uses the alias when one matches the key hash', () => {
    const [row] = buildKeyRows(
      [{ key: rawKey, profile: null }],
      [{ apiKeyHash: sha256Hex(rawKey).toUpperCase(), alias: 'Laptop' }]
    );
    expect(row.label).toBe('Laptop');
    expect(row.hasAlias).toBe(true);
    expect(row.masked).not.toContain(rawKey);
    expect(row.key).toBe(rawKey);
  });

  test('falls back to the masked key without an alias', () => {
    const rows = buildKeyRows(
      [
        { key: rawKey, profile: profile() },
        { key: otherKey, profile: null },
      ],
      [{ apiKeyHash: sha256Hex('unknown-key'), alias: 'Ghost' }]
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.label).toBe(row.masked);
      expect(row.hasAlias).toBe(false);
      expect(row.label).not.toContain(row.key);
      expect(JSON.stringify({ label: row.label, masked: row.masked })).not.toContain('Ghost');
    }
    expect(rows[0].profile).toEqual(profile());
    expect(rows[1].profile).toBeNull();
  });

  test('never shows an alias that repeats the raw key', () => {
    const [row] = buildKeyRows(
      [{ key: 'plain-client-key', profile: null }],
      [{ apiKeyHash: sha256Hex('plain-client-key'), alias: 'plain-client-key' }]
    );
    expect(row.label).not.toContain('plain-client-key');
    expect(row.hasAlias).toBe(false);
  });

  test('labels a CP key without an alias with its instance name', () => {
    const cpTail = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const cpKey = `sk-bx-team-a-1-${cpTail}`;
    const [row] = buildKeyRows([{ key: cpKey, profile: null }]);
    expect(row.label).toBe('team-a-1');
    expect(row.label).not.toContain(cpTail);
    expect(row.hasAlias).toBe(true);
    expect(row.masked).not.toContain(cpKey);
    expect(row.key).toBe(cpKey);
  });

  test('shows the mask once for two keys of one CP instance', () => {
    const first = 'sk-bx-ecwowk-AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const second = 'sk-bx-ecwowk-ZyXwVuTsRqPoNmLkJiHgFeDcBa98765Q';
    const rows = buildKeyRows([
      { key: first, profile: null },
      { key: second, profile: null },
    ]);
    expect(rows.map((row) => row.label)).toEqual(['ecwowk (sk******45)', 'ecwowk (sk******5Q)']);
    for (const row of rows) {
      expect(row.label).toContain(row.masked);
      expect(row.hasAlias).toBe(false);
    }
  });
});

describe('preferredAccountOptions', () => {
  const name = (file: AuthFileItem) => String(file.email);

  test('marks disabled accounts and skips files without an auth index', () => {
    expect(preferredAccountOptions('codex', files, '', name, t)).toEqual([
      { value: '', label: 'Automatic' },
      { value: 'codex-a', label: 'alice@example.com · disabled' },
    ]);
  });

  test('keeps a selected account that no longer exists', () => {
    expect(preferredAccountOptions('claude', files, 'gone', name, t)).toEqual([
      { value: '', label: 'Automatic' },
      { value: 'claude-a', label: 'bob@example.com' },
      { value: 'gone', label: 'Subscription unavailable or removed' },
    ]);
  });
});

describe('chainSummary', () => {
  const apiKeys = {
    apiCredentials: {
      claude: [{ authIndex: 'claude-key-1', label: 'claude-apikey', baseUrl: '', disabled: false }],
      codex: [{ authIndex: 'codex-key-1', label: 'codex-apikey', baseUrl: '', disabled: false }],
    },
    providerConfigs: {
      claude: [],
      codex: [{ authIndex: 'codex-key-1', name: 'codex-1', masked: 'sk******yz', baseUrl: '' }],
    },
  };
  const codexRouting = (patch: Partial<ProviderRouting> = {}): ProviderRouting => ({
    mode: 'subscription',
    apiCredential: '',
    fallback: { target: 'off', mode: 'auto', mappings: [] },
    speed: 'standard',
    ignoreClientTier: false,
    disabled: false,
    ...patch,
  });

  test('lists sticky session, both providers and pool selection with emails shown', () => {
    expect(chainSummary(profile(), files, true, t)).toBe(
      'Sticky session · Claude: claude-bob@example.com.json → Codex · Codex: Automatic · reserves → round-robin'
    );
  });

  test('matches the documented example', () => {
    const value = withProvider(
      'codex',
      codexRouting({ mode: 'api', apiCredential: 'codex-key-1' }),
      profile({
        preferredAccounts: {},
        selection: { primary: 'reserves', tiebreak: 'earliest-reset' },
      })
    );
    expect(chainSummary(value, files, true, t, apiKeys)).toBe(
      'Sticky session · Claude: Automatic → Codex · Codex: API key codex-1 · sk******yz · reserves → earliest-reset'
    );
  });

  test('masks account names when emails are hidden', () => {
    const summary = chainSummary(profile(), files, false, t);
    expect(summary).not.toContain('bob@example.com');
    expect(summary).toContain('Claude: ');
    expect(summary).not.toContain('Claude: Automatic');
    const toApiKey = chainSummary(
      withProvider(
        'claude',
        claudeRouting({
          fallback: { ...claudeRouting().fallback, target: 'api' },
          apiCredential: 'claude-key-1',
        })
      ),
      files,
      false,
      t,
      apiKeys
    );
    expect(toApiKey).not.toContain('bob@example.com');
    expect(toApiKey).toMatch(/Claude: .+ → API key ·/);
  });

  test('shows a missing and a disabled account', () => {
    const summary = chainSummary(
      profile({ preferredAccounts: { claude: 'gone', codex: 'codex-a' } }),
      files,
      true,
      t
    );
    expect(summary).toContain('Claude: Subscription unavailable or removed → Codex');
    expect(summary).toContain('Codex: codex-alice@example.com.json · disabled');
  });

  test('fallback off shows the preferred account only, and a primary without a tiebreak', () => {
    const off = profile({
      sessionAffinity: false,
      selection: { primary: 'fill-first' },
      providers: providersFromClaudeFallback({ enabled: false, mode: 'auto', mappings: [] }),
    });
    expect(chainSummary(off, files, true, t)).toBe(
      'No sticky session · Claude: claude-bob@example.com.json · Codex: Automatic · fill-first'
    );
  });

  test('a forced Codex fallback skips the preferred account', () => {
    const always = withProvider(
      'claude',
      claudeRouting({ fallback: { ...claudeRouting().fallback, mode: 'always' } })
    );
    expect(chainSummary(always, files, true, t)).toBe(
      'Sticky session · Claude: Codex (forced) · Codex: Automatic · reserves → round-robin'
    );
  });

  test('a disabled provider shows as off instead of its leg', () => {
    const claudeOff = withProvider('claude', claudeRouting({ disabled: true }));
    expect(chainSummary(claudeOff, files, true, t)).toBe(
      'Sticky session · Claude: off · Codex: Automatic · reserves → round-robin'
    );
    const codexOff = withProvider(
      'codex',
      codexRouting({ disabled: true, mode: 'api', apiCredential: 'codex-key-1', speed: 'fast' }),
      withProvider(
        'claude',
        claudeRouting({ fallback: { ...claudeRouting().fallback, target: 'off' } })
      )
    );
    expect(chainSummary(codexOff, files, true, t, apiKeys)).toBe(
      'Sticky session · Claude: claude-bob@example.com.json · Codex: off · reserves → round-robin'
    );
  });

  test('a Claude fallback into a disabled Codex reads as no fallback, the stored target kept', () => {
    for (const mode of ['auto', 'always'] as const) {
      const value = withProvider(
        'codex',
        codexRouting({ disabled: true }),
        withProvider('claude', claudeRouting({ fallback: { ...claudeRouting().fallback, mode } }))
      );
      expect(chainSummary(value, files, true, t)).toBe(
        'Sticky session · Claude: claude-bob@example.com.json · Codex: off · reserves → round-robin'
      );
      expect(value.providers.claude.fallback).toMatchObject({ target: 'codex', mode });
    }
  });

  test('an API-key fallback for each provider', () => {
    const value = withProvider(
      'codex',
      codexRouting({
        apiCredential: 'codex-key-1',
        fallback: { target: 'api', mode: 'auto', mappings: [] },
      }),
      withProvider(
        'claude',
        claudeRouting({
          apiCredential: 'claude-key-1',
          fallback: { ...claudeRouting().fallback, target: 'api' },
        })
      )
    );
    expect(chainSummary(value, files, true, t, apiKeys)).toBe(
      'Sticky session · Claude: claude-bob@example.com.json → API key · Codex: Automatic → API key · reserves → round-robin'
    );
  });

  test('API key mode names the key, ignores the fallback and the preferred account', () => {
    const value = withProvider(
      'claude',
      claudeRouting({ mode: 'api', apiCredential: 'claude-key-1' }),
      withProvider('codex', codexRouting({ mode: 'api', apiCredential: 'codex-key-1' }))
    );
    expect(chainSummary(value, files, true, t, apiKeys)).toBe(
      'Sticky session · Claude: API key claude-apikey · claude-k · Codex: API key codex-1 · sk******yz · reserves → round-robin'
    );
  });

  test('Codex in Subscription mode names a Fast or Ultrafast speed', () => {
    const fast = withProvider('codex', codexRouting({ speed: 'fast' }));
    expect(chainSummary(fast, files, true, t)).toBe(
      'Sticky session · Claude: claude-bob@example.com.json → Codex · Codex (Fast): Automatic · reserves → round-robin'
    );
    const ultrafast = withProvider('codex', codexRouting({ speed: 'ultrafast' }));
    expect(chainSummary(ultrafast, files, true, t)).toContain('· Codex (Ultrafast): Automatic ·');
  });

  test('Standard speed leaves the Codex name unchanged', () => {
    const standard = withProvider('codex', codexRouting({ speed: 'standard' }));
    expect(chainSummary(standard, files, true, t)).toContain('· Codex: Automatic ·');
    expect(chainSummary(standard, files, true, t)).not.toContain('Standard');
  });

  test('Codex API key mode does not name the speed', () => {
    const value = withProvider(
      'codex',
      codexRouting({ mode: 'api', apiCredential: 'codex-key-1', speed: 'fast' })
    );
    const summary = chainSummary(value, files, true, t, apiKeys);
    expect(summary).toContain('· Codex: API key codex-1 · sk******yz ·');
    expect(summary).not.toContain('Fast');
  });

  test('Subscription with an API-key fallback names the speed', () => {
    const value = withProvider(
      'codex',
      codexRouting({
        apiCredential: 'codex-key-1',
        fallback: { target: 'api', mode: 'auto', mappings: [] },
        speed: 'fast',
      })
    );
    expect(chainSummary(value, files, true, t, apiKeys)).toContain(
      '· Codex (Fast): Automatic → API key ·'
    );
  });

  test('the Claude leg never names a speed', () => {
    const value = withProvider('codex', codexRouting({ speed: 'ultrafast' }));
    const summary = chainSummary(value, files, true, t);
    expect(summary).toContain('Sticky session · Claude: claude-bob@example.com.json → Codex ·');
    expect(summary).not.toContain('Claude (');
  });

  test('API key mode without label sources, with an unknown key, and with no key', () => {
    const known = withProvider(
      'codex',
      codexRouting({ mode: 'api', apiCredential: 'codex-key-1' })
    );
    expect(chainSummary(known, files, true, t)).toContain('Codex: API key codex-ke ·');
    const unknown = withProvider(
      'codex',
      codexRouting({ mode: 'api', apiCredential: 'removed-index-42' })
    );
    expect(chainSummary(unknown, files, true, t, apiKeys)).toContain('Codex: API key removed- ·');
    const unset = withProvider('codex', codexRouting({ mode: 'api' }));
    expect(chainSummary(unset, files, true, t, apiKeys)).toContain(
      'Codex: API key not chosen · reserves'
    );
  });
});
