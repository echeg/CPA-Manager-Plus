import { beforeAll, describe, expect, test } from 'vitest';
import i18n from '@/i18n';
import {
  defaultProviderRouting,
  providersFromClaudeFallback,
  type ApiCredentials,
  type ProviderRouting,
  type RoutingProfile,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import {
  apiCredentialLabel,
  apiCredentialOptions,
  chosenApiKeyLabel,
  fallbackTargets,
  hasProviderRoutingErrors,
  providerRoutingErrors,
  summarizeKeyConfigs,
  type ApiKeyConfigSummaries,
} from './providerRoutingModel';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const t = i18n.t.bind(i18n);

const RAW_CLAUDE_KEY = 'sk-ant-api03-RAWCLAUDEKEY-0123456789';
const RAW_CODEX_KEY = 'sk-proj-RAWCODEXKEY-9876543210';
const RAW_CUSTOM_KEY = 'sk-ant-custom-RAWKEY-abcdef';

const providerConfigs: ApiKeyConfigSummaries = {
  claude: summarizeKeyConfigs([
    { apiKey: RAW_CLAUDE_KEY, prefix: 'team-a', authIndex: 'claude-idx-1' },
    {
      apiKey: RAW_CUSTOM_KEY,
      authIndex: 'claude-idx-2',
      baseUrl: 'https://relay.example.com/v1',
    },
    // No auth-index: cannot be matched, so it is dropped.
    { apiKey: 'sk-ant-orphan-RAWKEY-000000', prefix: 'orphan' },
  ]),
  codex: summarizeKeyConfigs([{ apiKey: RAW_CODEX_KEY, authIndex: 'codex-idx-1' }]),
};

const apiCredentials: ApiCredentials = {
  claude: [
    { authIndex: 'claude-idx-1', label: 'claude-apikey', baseUrl: '', disabled: false },
    {
      authIndex: 'claude-idx-2',
      label: 'claude-apikey',
      baseUrl: 'https://relay.example.com/v1',
      disabled: false,
    },
    { authIndex: 'claude-idx-3abcdef', label: 'claude-apikey', baseUrl: '', disabled: true },
  ],
  codex: [{ authIndex: 'codex-idx-1', label: 'codex-apikey', baseUrl: '', disabled: false }],
};

const routing = (patch: Partial<ProviderRouting> = {}): ProviderRouting => ({
  ...defaultProviderRouting(),
  ...patch,
});

const profileWith = (
  claude: ProviderRouting = routing(),
  codex: ProviderRouting = routing()
): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: {},
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  providers: { claude, codex },
});

const validMappings = [{ from: 'claude-opus-*', to: 'gpt-6-astra' }];

describe('summarizeKeyConfigs', () => {
  test('keeps the index, prefix, mask and base URL, never the raw key', () => {
    expect(providerConfigs.claude).toEqual([
      { authIndex: 'claude-idx-1', name: 'team-a', masked: 'sk******89', baseUrl: '' },
      {
        authIndex: 'claude-idx-2',
        name: '',
        masked: 'sk******ef',
        baseUrl: 'https://relay.example.com/v1',
      },
    ]);
    expect(JSON.stringify(providerConfigs)).not.toMatch(/RAW/);
  });

  test('drops a prefix that repeats the raw key', () => {
    const [summary] = summarizeKeyConfigs([
      { apiKey: RAW_CODEX_KEY, prefix: `x-${RAW_CODEX_KEY}`, authIndex: 'i' },
    ]);
    expect(summary.name).toBe('');
    expect(JSON.stringify(summary)).not.toContain(RAW_CODEX_KEY);
  });
});

describe('fallbackTargets', () => {
  test('Claude can fall back to Codex; Codex cannot fall back to itself', () => {
    expect(fallbackTargets('claude')).toEqual(['off', 'codex', 'api']);
    expect(fallbackTargets('codex')).toEqual(['off', 'api']);
  });
});

describe('apiCredentialLabel', () => {
  test('a matched key shows its prefix and mask', () => {
    expect(apiCredentialLabel(apiCredentials.claude[0], providerConfigs.claude)).toBe(
      'team-a · sk******89'
    );
  });

  test('a matched key without a prefix uses the backend label and adds a custom host', () => {
    expect(apiCredentialLabel(apiCredentials.claude[1], providerConfigs.claude)).toBe(
      'claude-apikey · sk******ef · relay.example.com'
    );
  });

  test('an unmatched key shows the backend label and the first 8 index characters', () => {
    expect(apiCredentialLabel(apiCredentials.claude[2], providerConfigs.claude)).toBe(
      'claude-apikey · claude-i'
    );
    expect(apiCredentialLabel(apiCredentials.claude[1], [])).toBe(
      'claude-apikey · claude-i · relay.example.com'
    );
  });

  test('a base URL that is not a URL is shown as is', () => {
    expect(
      apiCredentialLabel(
        { authIndex: 'abcdefghij', label: '', baseUrl: 'relay', disabled: false },
        []
      )
    ).toBe('abcdefgh · relay');
  });
});

describe('apiCredentialOptions', () => {
  test('lists every key and marks a disabled one', () => {
    expect(apiCredentialOptions('claude', apiCredentials, providerConfigs, '', t)).toEqual([
      { value: 'claude-idx-1', label: 'team-a · sk******89', status: 'ok' },
      {
        value: 'claude-idx-2',
        label: 'claude-apikey · sk******ef · relay.example.com',
        status: 'ok',
      },
      {
        value: 'claude-idx-3abcdef',
        label: 'claude-apikey · claude-i · disabled',
        status: 'disabled',
      },
    ]);
  });

  test('keeps a selected key that is no longer listed, marked unknown', () => {
    const options = apiCredentialOptions(
      'codex',
      apiCredentials,
      providerConfigs,
      'gone-index-1',
      t
    );
    expect(options.map((option) => option.status)).toEqual(['ok', 'unknown']);
    expect(options[1]).toEqual({
      value: 'gone-index-1',
      label: 'gone-ind · unknown',
      status: 'unknown',
    });
  });

  test('a listed selection adds nothing', () => {
    expect(
      apiCredentialOptions('codex', apiCredentials, providerConfigs, 'codex-idx-1', t)
    ).toHaveLength(1);
  });

  test('a provider without keys has no options', () => {
    const none: ApiCredentials = { claude: [], codex: [] };
    expect(apiCredentialOptions('codex', none, providerConfigs, '', t)).toEqual([]);
  });

  test('labels fall back to the unmatched form when the configs did not load', () => {
    const options = apiCredentialOptions('codex', apiCredentials, { claude: [], codex: [] }, '', t);
    expect(options[0].label).toBe('codex-apikey · codex-id');
  });

  test('no label contains a raw key', () => {
    const labels = (['claude', 'codex'] as const).flatMap((provider) =>
      apiCredentialOptions(provider, apiCredentials, providerConfigs, 'gone', t).map(
        (option) => option.label
      )
    );
    for (const raw of [RAW_CLAUDE_KEY, RAW_CODEX_KEY, RAW_CUSTOM_KEY])
      expect(labels.join('\n')).not.toContain(raw);
  });
});

describe('chosenApiKeyLabel', () => {
  test('names a listed key, shortens an unknown one, and is empty with no key', () => {
    expect(chosenApiKeyLabel('codex', 'codex-idx-1', apiCredentials, providerConfigs)).toBe(
      'codex-apikey · sk******10'
    );
    expect(chosenApiKeyLabel('codex', 'gone-index-1', apiCredentials, providerConfigs)).toBe(
      'gone-ind'
    );
    expect(chosenApiKeyLabel('codex', '  ', apiCredentials, providerConfigs)).toBe('');
  });
});

describe('providerRoutingErrors', () => {
  const keyRequired = 'quota_management.provider_routing.errors.key_required';
  const mappingsInvalid = 'quota_management.fallback.invalid';

  test('defaults have no errors', () => {
    const errors = providerRoutingErrors(profileWith(), true);
    expect(errors).toEqual({ claude: {}, codex: {} });
    expect(hasProviderRoutingErrors(errors)).toBe(false);
  });

  test('API key mode without a key is an error for either provider', () => {
    const errors = providerRoutingErrors(
      profileWith(routing({ mode: 'api' }), routing({ mode: 'api', apiCredential: '  ' })),
      true
    );
    expect(errors).toEqual({
      claude: { apiCredential: keyRequired },
      codex: { apiCredential: keyRequired },
    });
    expect(hasProviderRoutingErrors(errors)).toBe(true);
  });

  test('the API-key fallback without a key is an error', () => {
    const fallback = { target: 'api' as const, mode: 'auto' as const, mappings: [] };
    expect(providerRoutingErrors(profileWith(routing(), routing({ fallback })), true)).toEqual({
      claude: {},
      codex: { apiCredential: keyRequired },
    });
  });

  test('a chosen key satisfies API key mode and the API-key fallback', () => {
    const errors = providerRoutingErrors(
      profileWith(
        routing({ mode: 'api', apiCredential: 'claude-idx-1' }),
        routing({
          apiCredential: 'codex-idx-1',
          fallback: { target: 'api', mode: 'auto', mappings: [] },
        })
      ),
      true
    );
    expect(hasProviderRoutingErrors(errors)).toBe(false);
  });

  test('Codex target needs at least one valid mapping', () => {
    const empty = routing({ fallback: { target: 'codex', mode: 'auto', mappings: [] } });
    expect(providerRoutingErrors(profileWith(empty), true).claude).toEqual({
      mappings: mappingsInvalid,
    });
    const broken = routing({
      fallback: { target: 'codex', mode: 'always', mappings: [{ from: 'claude-*', to: '' }] },
    });
    expect(providerRoutingErrors(profileWith(broken), true).claude).toEqual({
      mappings: mappingsInvalid,
    });
    const valid = routing({ fallback: { target: 'codex', mode: 'auto', mappings: validMappings } });
    expect(providerRoutingErrors(profileWith(valid), true).claude).toEqual({});
  });

  test('a hidden invalid mapping table does not block a save', () => {
    const hidden = [{ from: '', to: '' }];
    const underApiTarget = routing({
      apiCredential: 'claude-idx-1',
      fallback: { target: 'api', mode: 'auto', mappings: hidden },
    });
    const underApiMode = routing({
      mode: 'api',
      apiCredential: 'claude-idx-1',
      fallback: { target: 'codex', mode: 'auto', mappings: hidden },
    });
    expect(providerRoutingErrors(profileWith(underApiTarget), true).claude).toEqual({});
    expect(providerRoutingErrors(profileWith(underApiMode), true).claude).toEqual({});
  });

  test('API key mode does not need a key for its hidden fallback target', () => {
    const errors = providerRoutingErrors(
      profileWith(
        routing({
          mode: 'api',
          apiCredential: 'claude-idx-1',
          fallback: { target: 'api', mode: 'auto', mappings: [] },
        })
      ),
      true
    );
    expect(errors.claude).toEqual({});
  });

  test('an older backend checks only the Codex mappings', () => {
    const legacy: RoutingProfile = {
      ...profileWith(),
      providers: providersFromClaudeFallback({ enabled: true, mode: 'auto', mappings: [] }),
    };
    expect(providerRoutingErrors(legacy, false)).toEqual({
      claude: { mappings: mappingsInvalid },
      codex: {},
    });
    const apiDraft = profileWith(routing({ mode: 'api' }), routing({ mode: 'api' }));
    expect(providerRoutingErrors(apiDraft, false)).toEqual({ claude: {}, codex: {} });
  });
});
