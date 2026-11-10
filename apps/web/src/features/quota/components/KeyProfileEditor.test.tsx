import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import {
  providersFromClaudeFallback,
  type ApiCredentials,
  type ApiProvider,
  type ProviderRouting,
  type RoutingProfile,
  type RoutingSelectionOptions,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { suggestedFallbackMappings } from '@/features/personal-quota-support/services/api/claudeFallback';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { copyOfShared, type ApiKeyLabelSource } from '../keyProfilesModel';
import { summarizeKeyConfigs, type ApiKeyConfigSummaries } from '../providerRoutingModel';
import { FallbackModeMappings, FallbackSettingsEditor } from './FallbackSettingsEditor';
import { KeyProfileEditor, type KeyProfileEditorProps } from './KeyProfileEditor';
import { ProviderRoutingBlock } from './ProviderRoutingBlock';
import { Select } from './Select';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const selectionOptions: RoutingSelectionOptions = {
  narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
  pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
};

const shared: RoutingProfile = {
  sessionAffinity: true,
  preferredAccounts: { claude: 'claude-a' },
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  providers: providersFromClaudeFallback({
    enabled: true,
    mode: 'auto',
    mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
  }),
};

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
  },
];

// A raw upstream key: it must never reach the rendered output.
const RAW_UPSTREAM = 'sk-ant-RAWUPSTREAM-0123456789abcdef';

const apiCredentials: ApiCredentials = {
  claude: [
    { authIndex: 'claude-key-1', label: 'claude-apikey', baseUrl: '', disabled: false },
    { authIndex: 'claude-key-2', label: 'claude-apikey', baseUrl: '', disabled: true },
  ],
  codex: [{ authIndex: 'codex-key-1', label: 'codex-apikey', baseUrl: '', disabled: false }],
};

const apiKeyConfigs: ApiKeyConfigSummaries = {
  claude: [{ authIndex: 'claude-key-1', name: 'team', masked: 'sk-a...cdef', baseUrl: '' }],
  codex: [],
};

let renderer: ReactTestRenderer | undefined;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

async function mount(props: Partial<KeyProfileEditorProps> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  await act(async () => {
    renderer = create(
      createElement(KeyProfileEditor, {
        initial: copyOfShared(shared),
        isNew: false,
        variant: 'key',
        ttl: '1h',
        files,
        showEmails: true,
        selectionOptions,
        models: { claude: ['claude-opus-5'], codex: ['gpt-6-astra'] },
        saving: false,
        readOnly: false,
        apiKeys: { apiCredentials, providerConfigs: apiKeyConfigs },
        onSave,
        onCancel,
        ...props,
      })
    );
  });
  return { onSave, onCancel };
}

const root = () => renderer!.root;
const saveButton = () =>
  root()
    .findAllByType(Button)
    .find((button) => button.props['data-key-profile-save'])!;
const cancelButton = () =>
  root()
    .findAllByType(Button)
    .find((button) => button.props.children === 'Cancel')!;
const selects = () => root().findAllByType(Select);
const blocks = () => root().findAllByType(ProviderRoutingBlock);
const block = (provider: ApiProvider) => blocks().find((item) => item.props.provider === provider)!;
/** Apply an edit to one provider block the way its controls do. */
const editProvider = (provider: ApiProvider, patch: (value: ProviderRouting) => ProviderRouting) =>
  act(() => block(provider).props.onChange(patch(block(provider).props.value)));
const setMode = (provider: ApiProvider, mode: ProviderRouting['mode']) =>
  editProvider(provider, (value) => ({ ...value, mode }));
const setTarget = (provider: ApiProvider, target: ProviderRouting['fallback']['target']) =>
  editProvider(provider, (value) => ({ ...value, fallback: { ...value.fallback, target } }));
const setKey = (provider: ApiProvider, apiCredential: string) =>
  editProvider(provider, (value) => ({ ...value, apiCredential }));
const segmentedItems = (provider: ApiProvider, index: number) =>
  block(provider).findAllByType(SegmentedTabs)[index].props.items as Array<{
    id: string;
    disabled?: boolean;
  }>;
const accountSelect = (provider: 'Claude' | 'Codex') =>
  selects().find(
    (select) => select.props.ariaLabel === `${provider}: subscription for new threads`
  )!;
const slotSelects = () => selects().filter((select) => select.props.ariaLabelledBy);
const summaryText = () =>
  textOf(root().find((node) => node.props['data-key-profile-summary'] === true));
const sticky = () => root().findAllByType(ToggleSwitch)[0];
const ttlInputs = () =>
  root().findAll((node) => node.type === 'input' && node.props['data-key-profile-ttl']);
const typeTTL = (value: string) => act(() => ttlInputs()[0].props.onChange({ target: { value } }));

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

const click = (node: ReactTestInstance) => act(() => node.props.onClick());

describe('KeyProfileEditor', () => {
  test('renders the shared stages on top and one block per provider', async () => {
    await mount();
    expect(root().findAll((node) => node.props.role === 'radiogroup')).toHaveLength(0);
    expect(root().findAll((node) => node.props['data-mode'] !== undefined)).toHaveLength(0);
    // Sticky session and pool selection stay as sections; Preferred and the fallback moved.
    const headings = root()
      .findAll((node) => node.type === 'h4')
      .map((node) => textOf(node));
    expect(headings).toEqual(['Sticky session', 'Pool selection', 'Claude', 'Codex']);
    expect(blocks().map((item) => item.props.provider)).toEqual(['claude', 'codex']);
    expect(root().findAllByType(FallbackSettingsEditor)).toHaveLength(0);
    expect(sticky().props.checked).toBe(true);
    expect(accountSelect('Claude').props.value).toBe('claude-a');
    expect(accountSelect('Codex').props.value).toBe('');
    expect(slotSelects().map((select) => select.props.value)).toEqual(['reserves', 'round-robin']);
    expect(block('claude').props.value).toEqual(shared.providers.claude);
    expect(block('claude').props.modeLocked).toBe(false);
    expect(block('claude').props.providersSupported).toBe(true);
    // The Codex target shows the mode and mapping table inside the Claude block.
    expect(block('claude').findByType(FallbackModeMappings).props.value.mappings).toEqual(
      shared.providers.claude.fallback.mappings
    );
    expect(summaryText()).toContain('Sticky session');
    expect(summaryText()).toContain('Claude: claude-bob@example.com.json → Codex');
  });

  test('API key options carry the joined labels and the Codex block has no Codex target', async () => {
    await mount();
    expect(
      block('claude').props.apiKeyOptions.map((option: { label: string }) => option.label)
    ).toEqual(['team · sk-a...cdef', 'claude-apikey · claude-k · disabled']);
    expect(block('codex').props.apiKeyOptions).toHaveLength(1);
    expect(segmentedItems('claude', 1).map((item) => item.id)).toEqual(['off', 'codex', 'api']);
    expect(segmentedItems('codex', 1).map((item) => item.id)).toEqual(['off', 'api']);
  });

  test('a new profile counts as a change and saves a copy of the initial profile', async () => {
    const initial = copyOfShared(shared);
    const { onSave } = await mount({ initial, isNew: true });
    expect(saveButton().props.disabled).toBe(false);
    click(saveButton());
    expect(onSave).toHaveBeenCalledWith(copyOfShared(shared), undefined);
    expect(onSave.mock.calls[0][0]).not.toBe(initial);
  });

  test('the key variant shows the global TTL as text', async () => {
    await mount({ variant: 'key', ttl: '2h' });
    expect(ttlInputs()).toHaveLength(0);
    expect(textOf(root())).toContain('TTL 2h is global');
  });

  test('the key variant hides the TTL text when it is empty', async () => {
    await mount({ variant: 'key', ttl: '' });
    expect(textOf(root())).not.toContain('is global');
  });

  test('the default variant edits the TTL and passes it only when it changed', async () => {
    const { onSave } = await mount({ variant: 'default', ttl: '1h' });
    expect(ttlInputs()).toHaveLength(1);
    expect(ttlInputs()[0].props.value).toBe('1h');
    expect(textOf(root())).not.toContain('is global');
    expect(saveButton().props.disabled).toBe(true);

    // The TTL alone is a change.
    typeTTL(' 30m ');
    expect(saveButton().props.disabled).toBe(false);
    click(saveButton());
    expect(onSave).toHaveBeenLastCalledWith(copyOfShared(shared), '30m');

    // Back to the stored TTL: only the profile edit is saved.
    typeTTL('1h');
    expect(saveButton().props.disabled).toBe(true);
    act(() => sticky().props.onChange(false));
    click(saveButton());
    expect(onSave.mock.calls[1]).toEqual([
      { ...copyOfShared(shared), sessionAffinity: false },
      undefined,
    ]);
  });

  test('an invalid TTL disables Save and explains the format', async () => {
    const { onSave } = await mount({ variant: 'default', ttl: '1h' });
    for (const value of ['', '0s', 'soon']) {
      typeTTL(value);
      expect(ttlInputs()[0].props['aria-invalid']).toBe(true);
      expect(textOf(root())).toContain('Enter a positive duration');
      expect(saveButton().props.disabled).toBe(true);
      click(saveButton());
    }
    expect(onSave).not.toHaveBeenCalled();

    typeTTL('24h');
    expect(ttlInputs()[0].props['aria-invalid']).toBe(false);
    expect(saveButton().props.disabled).toBe(false);
  });

  test('a stored profile without mappings opens clean and saves the suggested ones', async () => {
    const stored = {
      ...copyOfShared(shared),
      providers: providersFromClaudeFallback({ enabled: false, mode: 'auto', mappings: [] }),
    };
    const { onSave } = await mount({ initial: stored });
    // The fallback editor shows suggestions for an empty list; that alone is no edit.
    expect(saveButton().props.disabled).toBe(true);
    act(() => sticky().props.onChange(false));
    click(saveButton());
    expect(onSave.mock.calls[0][0].sessionAffinity).toBe(false);
    expect(onSave.mock.calls[0][0].providers.claude.fallback.mappings).toEqual(
      suggestedFallbackMappings()
    );
  });

  test('edits never touch the initial profile', async () => {
    const initial = copyOfShared(shared);
    const snapshot = JSON.stringify(initial);
    await mount({ initial, isNew: true });
    act(() => sticky().props.onChange(false));
    act(() => accountSelect('Claude').props.onChange(''));
    expect(JSON.stringify(initial)).toBe(snapshot);
  });

  test('a picker primary disables the tiebreak and saves without it', async () => {
    const { onSave } = await mount();
    expect(slotSelects()[1].props.disabled).toBe(false);

    act(() => slotSelects()[0].props.onChange('fill-first'));
    const [primary, tiebreak] = slotSelects();
    expect(primary.props.value).toBe('fill-first');
    expect(tiebreak.props.disabled).toBe(true);
    expect(tiebreak.props.value).toBe('');
    expect(textOf(root())).toContain('Not used: the primary slot picks one account.');

    click(saveButton());
    expect(onSave.mock.calls[0][0].selection).toEqual({ primary: 'fill-first' });
  });

  test('a preferred account that no longer exists is labeled as missing', async () => {
    await mount({
      initial: { ...copyOfShared(shared), preferredAccounts: { claude: 'gone' } },
    });
    const claude = accountSelect('Claude');
    expect(claude.props.value).toBe('gone');
    expect(claude.props.options).toContainEqual({
      value: 'gone',
      label: 'Subscription unavailable or removed',
    });
    expect(summaryText()).toContain('Claude: Subscription unavailable or removed');
  });

  test('account names are masked when emails are hidden', async () => {
    await mount({ showEmails: false });
    const labels = accountSelect('Claude').props.options.map(
      (option: { label: string }) => option.label
    );
    expect(labels.join(' ')).not.toContain('bob@example.com');
    expect(summaryText()).not.toContain('bob@example.com');
  });

  test('Save is disabled while the profile is clean or invalid', async () => {
    await mount();
    expect(saveButton().props.disabled).toBe(true);

    act(() => sticky().props.onChange(false));
    expect(saveButton().props.disabled).toBe(false);
    act(() => sticky().props.onChange(true));
    expect(saveButton().props.disabled).toBe(true);

    act(() =>
      block('claude')
        .findByType(FallbackModeMappings)
        .props.onChange({ mode: 'auto', mappings: [] })
    );
    expect(saveButton().props.disabled).toBe(true);
    expect(root().findAll((node) => node.props.role === 'alert')).toHaveLength(1);
  });

  test.each([
    ['Claude in API key mode', (provider: ApiProvider) => setMode(provider, 'api'), 'claude'],
    [
      'Claude falling back to an API key',
      (provider: ApiProvider) => setTarget(provider, 'api'),
      'claude',
    ],
    ['Codex in API key mode', (provider: ApiProvider) => setMode(provider, 'api'), 'codex'],
    [
      'Codex falling back to an API key',
      (provider: ApiProvider) => setTarget(provider, 'api'),
      'codex',
    ],
  ] as const)('Save is disabled for %s without a key', async (_name, edit, provider) => {
    const { onSave } = await mount();
    act(() => sticky().props.onChange(false));
    expect(saveButton().props.disabled).toBe(false);

    edit(provider);
    expect(saveButton().props.disabled).toBe(true);
    expect(textOf(block(provider))).toContain('Choose an API key.');
    click(saveButton());
    expect(onSave).not.toHaveBeenCalled();

    setKey(provider, `${provider}-key-1`);
    expect(saveButton().props.disabled).toBe(false);
  });

  test('an empty mapping table stops blocking the save once the target is no longer Codex', async () => {
    await mount();
    act(() =>
      block('claude')
        .findByType(FallbackModeMappings)
        .props.onChange({ mode: 'auto', mappings: [] })
    );
    expect(saveButton().props.disabled).toBe(true);
    setTarget('claude', 'off');
    expect(saveButton().props.disabled).toBe(false);
  });

  test.each([
    ['target Off', true, () => setTarget('claude', 'off'), true],
    ['API key mode', true, () => setMode('claude', 'api'), true],
    ['the API-key target', true, () => setTarget('claude', 'api'), false],
    ['target Off on an older backend', false, () => setTarget('claude', 'off'), true],
  ] as const)(
    'a blank mapping row hidden by %s blocks the save where CPA checks it',
    async (_name, providersSupported, hide, blocked) => {
      const { onSave } = await mount({ providersSupported });
      const table = block('claude').findByType(FallbackModeMappings);
      // "Add mapping" appends an empty row.
      act(() =>
        table.props.onChange({
          mode: 'auto',
          mappings: [...table.props.value.mappings, { from: '', to: '' }],
        })
      );
      setKey('claude', 'claude-key-1');
      hide();
      expect(saveButton().props.disabled).toBe(blocked);
      expect(
        root().findAll((node) => node.props['data-provider-hidden-mappings-error'] !== undefined)
      ).toHaveLength(blocked ? 1 : 0);
      click(saveButton());
      expect(onSave).toHaveBeenCalledTimes(blocked ? 0 : 1);
    }
  );

  test('a disabled or unknown chosen key warns but can be saved', async () => {
    const { onSave } = await mount();
    setMode('claude', 'api');
    setKey('claude', 'claude-key-2');
    expect(root().findAll((node) => node.props['data-provider-key-warning'])).toHaveLength(1);
    expect(saveButton().props.disabled).toBe(false);

    setKey('claude', 'gone-key-index');
    expect(textOf(block('claude'))).toContain('no longer configured');
    expect(saveButton().props.disabled).toBe(false);
    click(saveButton());
    expect(onSave.mock.calls[0][0].providers.claude.apiCredential).toBe('gone-key-index');
  });

  test('Save sends the full draft', async () => {
    const { onSave } = await mount();
    act(() => sticky().props.onChange(false));
    act(() => accountSelect('Claude').props.onChange(''));
    act(() => accountSelect('Codex').props.onChange('codex-a'));
    act(() => slotSelects()[0].props.onChange('priority'));
    act(() => slotSelects()[1].props.onChange(''));
    act(() =>
      block('claude')
        .findByType(FallbackModeMappings)
        .props.onChange({ mode: 'always', mappings: shared.providers.claude.fallback.mappings })
    );
    click(saveButton());
    expect(onSave).toHaveBeenCalledWith(
      {
        sessionAffinity: false,
        preferredAccounts: { codex: 'codex-a' },
        selection: { primary: 'priority' },
        providers: providersFromClaudeFallback({
          enabled: true,
          mode: 'always',
          mappings: shared.providers.claude.fallback.mappings,
        }),
      },
      undefined
    );
  });

  test('API key mode saves target off and keeps the hidden mapping table', async () => {
    const { onSave } = await mount();
    setMode('codex', 'api');
    setKey('codex', 'codex-key-1');
    setMode('claude', 'api');
    setKey('claude', 'claude-key-1');
    // The block still shows the stored target while it is hidden.
    expect(block('claude').props.value.fallback.target).toBe('codex');
    expect(summaryText()).toContain('Claude: API key team · sk-a...cdef');
    click(saveButton());
    const saved: RoutingProfile = onSave.mock.calls[0][0];
    expect(saved.providers.claude).toEqual({
      mode: 'api',
      apiCredential: 'claude-key-1',
      fallback: {
        target: 'off',
        mode: 'auto',
        mappings: shared.providers.claude.fallback.mappings,
      },
    });
    expect(saved.providers.codex).toEqual({
      mode: 'api',
      apiCredential: 'codex-key-1',
      fallback: { target: 'off', mode: 'auto', mappings: [] },
    });
  });

  test('the API-key fallback saves the target and the chosen key', async () => {
    const { onSave } = await mount();
    setTarget('claude', 'api');
    setKey('claude', 'claude-key-1');
    expect(summaryText()).toContain('Claude: claude-bob@example.com.json → API key');
    click(saveButton());
    const saved: RoutingProfile = onSave.mock.calls[0][0];
    expect(saved.providers.claude).toEqual({
      mode: 'subscription',
      apiCredential: 'claude-key-1',
      fallback: {
        target: 'api',
        mode: 'auto',
        mappings: shared.providers.claude.fallback.mappings,
      },
    });
    expect(saved.preferredAccounts).toEqual({ claude: 'claude-a' });
  });

  test('switching Subscription -> API key -> Subscription keeps Preferred, mappings and key', async () => {
    const { onSave } = await mount();
    setTarget('claude', 'api');
    setKey('claude', 'claude-key-1');
    setTarget('claude', 'codex');
    setMode('claude', 'api');
    // API key mode hides Preferred; the draft keeps it.
    expect(selects().some((select) => select.props.ariaLabel?.startsWith('Claude:'))).toBe(false);
    setMode('claude', 'subscription');
    expect(accountSelect('Claude').props.value).toBe('claude-a');
    expect(block('claude').props.value).toEqual({
      ...shared.providers.claude,
      apiCredential: 'claude-key-1',
    });
    expect(block('claude').findByType(FallbackModeMappings).props.value.mappings).toEqual(
      shared.providers.claude.fallback.mappings
    );
    // Back to the stored state except the remembered key, which is a stored value too.
    click(saveButton());
    expect(onSave.mock.calls[0][0].providers.claude.apiCredential).toBe('claude-key-1');
  });

  test('both providers in API key mode', async () => {
    await mount();
    setMode('claude', 'api');
    setKey('claude', 'claude-key-1');
    setMode('codex', 'api');
    setKey('codex', 'codex-key-1');
    expect(selects().filter((select) => select.props.ariaLabel?.endsWith('API key'))).toHaveLength(
      2
    );
    expect(summaryText()).toContain('Claude: API key team · sk-a...cdef');
    expect(summaryText()).toContain('Codex: API key codex-apikey · codex-ke');
    expect(saveButton().props.disabled).toBe(false);
  });

  test('a stored API credential that is no longer listed stays selected as unknown', async () => {
    const initial: RoutingProfile = {
      ...copyOfShared(shared),
      providers: {
        ...copyOfShared(shared).providers,
        codex: {
          mode: 'api',
          apiCredential: 'removed-index-123',
          fallback: { target: 'off', mode: 'auto', mappings: [] },
        },
      },
    };
    await mount({ initial });
    expect(block('codex').props.apiKeyOptions).toContainEqual({
      value: 'removed-index-123',
      label: 'removed- · unknown',
      status: 'unknown',
    });
    expect(textOf(block('codex'))).toContain('no longer configured');
    // Clean until edited: the unknown key alone does not block anything.
    expect(saveButton().props.disabled).toBe(true);
    act(() => sticky().props.onChange(false));
    expect(saveButton().props.disabled).toBe(false);
  });

  test('without API keys the API options are disabled and link to AI Providers', async () => {
    await mount({
      apiKeys: { apiCredentials: { claude: [], codex: [] }, providerConfigs: apiKeyConfigs },
    });
    for (const provider of ['claude', 'codex'] as const) {
      expect(segmentedItems(provider, 0).find((item) => item.id === 'api')?.disabled).toBe(true);
      expect(segmentedItems(provider, 1).find((item) => item.id === 'api')?.disabled).toBe(true);
      expect(
        block(provider).findAll((node) => node.type === 'a' && node.props.href === '#/ai-providers')
      ).toHaveLength(1);
    }
  });

  test('an old backend disables API key mode and every API-key option', async () => {
    const { onSave } = await mount({ providersSupported: false });
    for (const provider of ['claude', 'codex'] as const) {
      expect(block(provider).props.providersSupported).toBe(false);
      expect(block(provider).findAllByType(SegmentedTabs)[0].props.disabled).toBe(true);
      expect(segmentedItems(provider, 1).find((item) => item.id === 'api')?.disabled).toBe(true);
      expect(textOf(block(provider))).toContain('Requires an updated CPA backend.');
    }
    // The Codex target still works there.
    setTarget('claude', 'off');
    click(saveButton());
    expect(onSave.mock.calls[0][0].providers.claude.fallback.target).toBe('off');
  });

  test('no raw upstream key reaches the rendered output', async () => {
    // The configs as the hook builds them from the provider key lists.
    const apiKeys: ApiKeyLabelSource = {
      apiCredentials,
      providerConfigs: {
        claude: summarizeKeyConfigs([
          { apiKey: RAW_UPSTREAM, prefix: RAW_UPSTREAM, authIndex: 'claude-key-1' },
        ]),
        codex: [],
      },
    };
    await mount({ apiKeys });
    setMode('claude', 'api');
    setKey('claude', 'claude-key-1');
    const json = JSON.stringify(renderer!.toJSON());
    expect(json).toContain('sk******ef');
    expect(json).not.toContain(RAW_UPSTREAM);
  });

  test('Cancel calls onCancel', async () => {
    const { onCancel, onSave } = await mount();
    click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('read-only disables every control and explains why', async () => {
    const { onSave, onCancel } = await mount({ readOnly: true, isNew: true, variant: 'default' });
    expect(textOf(root())).toContain('Per-key profiles need native CPA routing');
    expect(sticky().props.disabled).toBe(true);
    expect(ttlInputs()[0].props.disabled).toBe(true);
    expect(selects().every((select) => select.props.disabled === true)).toBe(true);
    expect(blocks().every((item) => item.props.disabled === true)).toBe(true);
    expect(root().findByType(FallbackModeMappings).props.disabled).toBe(true);
    expect(saveButton().props.disabled).toBe(true);

    click(saveButton());
    expect(onSave).not.toHaveBeenCalled();

    expect(cancelButton().props.disabled).toBeFalsy();
    click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('fallbackReadOnly locks mode and fallback, keeps Preferred editable, saves the stored providers', async () => {
    // An empty mapping list is filled with suggestions on screen; a save must not store them.
    // A stored API key mode without a key would be invalid, but the locked block cannot block the save.
    const stored: RoutingProfile = {
      ...shared,
      providers: {
        claude: providersFromClaudeFallback({ enabled: false, mode: 'auto', mappings: [] }).claude,
        codex: {
          mode: 'subscription',
          apiCredential: '',
          fallback: { target: 'api', mode: 'auto', mappings: [] },
        },
      },
    };
    const { onSave } = await mount({ initial: stored, variant: 'default', fallbackReadOnly: true });
    expect(textOf(root())).toContain('mode and fallback cannot be changed here');
    expect(textOf(root())).not.toContain('Per-key profiles need native CPA routing');
    for (const provider of ['claude', 'codex'] as const) {
      expect(block(provider).props.modeLocked).toBe(true);
      expect(block(provider).findAllByType(SegmentedTabs)[0].props.disabled).toBe(true);
      expect(block(provider).findAllByType(SegmentedTabs)[1].props.disabled).toBe(true);
    }
    expect(accountSelect('Claude').props.disabled).toBe(false);
    expect(sticky().props.disabled).toBe(false);
    expect(ttlInputs()[0].props.disabled).toBe(false);

    act(() => accountSelect('Codex').props.onChange('codex-a'));
    act(() => sticky().props.onChange(false));
    expect(saveButton().props.disabled).toBe(false);
    click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual({
      ...stored,
      sessionAffinity: false,
      preferredAccounts: { claude: 'claude-a', codex: 'codex-a' },
    });
    expect(onSave.mock.calls[0][0].providers).toBe(stored.providers);
  });

  test('while saving the controls are locked and Save shows progress', async () => {
    const { onSave } = await mount({ saving: true, isNew: true, variant: 'default' });
    expect(sticky().props.disabled).toBe(true);
    expect(ttlInputs()[0].props.disabled).toBe(true);
    expect(saveButton().props.loading).toBe(true);
    click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
  });
});
