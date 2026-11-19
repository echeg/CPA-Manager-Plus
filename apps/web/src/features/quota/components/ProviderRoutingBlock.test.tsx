import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type {
  ApiProvider,
  ProviderRouting,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { ApiKeyOption } from '../providerRoutingModel';
import { FallbackModeMappings } from './FallbackSettingsEditor';
import { ProviderRoutingBlock, type ProviderRoutingBlockProps } from './ProviderRoutingBlock';
import { Select } from './Select';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

const mappings = [{ from: 'claude-opus-*', to: 'gpt-6-astra' }];
const routing = (patch: Partial<ProviderRouting> = {}): ProviderRouting => ({
  mode: 'subscription',
  apiCredential: 'key-idx-1',
  fallback: { target: 'off', mode: 'auto', mappings },
  speed: 'standard',
  ignoreClientTier: false,
  disabled: false,
  ...patch,
});
const keyOptions: ApiKeyOption[] = [
  { value: 'key-idx-1', label: 'team · sk-a...wxyz', status: 'ok' },
  { value: 'key-idx-2', label: 'backup · sk-b...abcd · disabled', status: 'disabled' },
];

async function mount(props: Partial<ProviderRoutingBlockProps> & { provider?: ApiProvider } = {}) {
  const onChange = vi.fn();
  const onPreferredChange = vi.fn();
  await act(async () => {
    renderer = create(
      createElement(ProviderRoutingBlock, {
        provider: 'claude',
        value: routing(),
        preferred: '',
        preferredOptions: [
          { value: '', label: 'Automatic' },
          { value: 'acc-1', label: 'a***@example.com' },
        ],
        apiKeyOptions: keyOptions,
        models: { claude: ['claude-opus-5'], codex: ['gpt-6-astra'] },
        disabled: false,
        modeLocked: false,
        providersSupported: true,
        onChange,
        onPreferredChange,
        ...props,
      })
    );
  });
  return { onChange, onPreferredChange };
}

const root = () => renderer!.root;
const tabs = (prefix: string) =>
  root()
    .findAllByType(SegmentedTabs)
    .find((node) => String(node.props.ariaLabel).endsWith(prefix));
const modeTabs = () => tabs('mode');
const targetTabs = () => tabs('fallback');
const select = (ariaLabel: string) =>
  root()
    .findAllByType(Select)
    .find((node) => node.props.ariaLabel === ariaLabel);
const apiKeySelect = (provider = 'Claude') => select(`${provider} API key`);
const preferredSelect = (provider = 'Claude') =>
  select(`${provider}: subscription for new threads`);
const tabItem = (node: ReactTestInstance | undefined, id: string) =>
  (node!.props.items as Array<{ id: string; disabled?: boolean; title?: string }>).find(
    (item) => item.id === id
  )!;
const text = () =>
  root()
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' ');
const byData = (attr: string) => root().findAll((node) => node.props[attr] !== undefined);

describe('ProviderRoutingBlock', () => {
  test('Claude in Subscription mode shows Preferred and the three fallback targets', async () => {
    await mount();
    expect(modeTabs()!.props.activeTab).toBe('subscription');
    expect(preferredSelect()).toBeDefined();
    expect(targetTabs()!.props.items.map((item: { id: string }) => item.id)).toEqual([
      'off',
      'codex',
      'api',
    ]);
    expect(targetTabs()!.props.activeTab).toBe('off');
    expect(apiKeySelect()).toBeUndefined();
    expect(root().findAllByType(FallbackModeMappings)).toHaveLength(0);
  });

  test('Claude with the Codex target shows the mode select and the mapping table', async () => {
    await mount({ value: routing({ fallback: { target: 'codex', mode: 'auto', mappings } }) });
    const editor = root().findByType(FallbackModeMappings);
    expect(editor.props.value.mappings).toEqual(mappings);
    expect(apiKeySelect()).toBeUndefined();
  });

  test('Claude with the API-key target shows the key select and the fallback hint', async () => {
    await mount({ value: routing({ fallback: { target: 'api', mode: 'auto', mappings } }) });
    expect(apiKeySelect()!.props.value).toBe('key-idx-1');
    expect(text()).toContain('Used only after subscriptions fail');
    expect(root().findAllByType(FallbackModeMappings)).toHaveLength(0);
  });

  test('API key mode shows only the key select and the billing hint', async () => {
    await mount({ value: routing({ mode: 'api' }) });
    expect(modeTabs()!.props.activeTab).toBe('api');
    expect(apiKeySelect()!.props.options).toBe(keyOptions);
    expect(text()).toContain('Subscriptions are skipped. Billed to this key.');
    expect(preferredSelect()).toBeUndefined();
    expect(targetTabs()).toBeUndefined();
  });

  test('Codex has no Codex fallback target', async () => {
    await mount({ provider: 'codex' });
    expect(targetTabs()!.props.items.map((item: { id: string }) => item.id)).toEqual([
      'off',
      'api',
    ]);
    expect(preferredSelect('Codex')).toBeDefined();
  });

  test('Codex in API key mode shows its own key select', async () => {
    await mount({ provider: 'codex', value: routing({ mode: 'api' }) });
    expect(apiKeySelect('Codex')).toBeDefined();
    expect(preferredSelect('Codex')).toBeUndefined();
  });

  test('switching mode and target keeps the hidden values', async () => {
    const value = routing({ fallback: { target: 'codex', mode: 'always', mappings } });
    const { onChange, onPreferredChange } = await mount({ value });
    const snapshot = JSON.stringify(value);

    act(() => modeTabs()!.props.onChange('api'));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, mode: 'api' });

    act(() => targetTabs()!.props.onChange('api'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      fallback: { target: 'api', mode: 'always', mappings },
    });

    act(() => targetTabs()!.props.onChange('off'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      fallback: { target: 'off', mode: 'always', mappings },
    });

    act(() =>
      root().findByType(FallbackModeMappings).props.onChange({ mode: 'auto', mappings: [] })
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      fallback: { target: 'codex', mode: 'auto', mappings: [] },
    });

    act(() => preferredSelect()!.props.onChange('acc-1'));
    expect(onPreferredChange).toHaveBeenLastCalledWith('acc-1');

    expect(JSON.stringify(value)).toBe(snapshot);
  });

  test('choosing an API key keeps the mode and the fallback', async () => {
    const value = routing({ mode: 'api', apiCredential: '' });
    const { onChange } = await mount({ value });
    act(() => apiKeySelect()!.props.onChange('key-idx-2'));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, apiCredential: 'key-idx-2' });
  });

  test('without API keys the API-key options are disabled with a hint and a link', async () => {
    await mount({ apiKeyOptions: [], value: routing({ apiCredential: '' }) });
    const hint = 'No Claude API key is configured.';
    expect(tabItem(modeTabs(), 'api')).toMatchObject({ disabled: true, title: hint });
    expect(tabItem(targetTabs(), 'api')).toMatchObject({ disabled: true, title: hint });
    expect(tabItem(targetTabs(), 'codex').disabled).toBeFalsy();
    expect(modeTabs()!.props.disabled).toBe(false);
    const [noKeys] = byData('data-provider-routing-no-keys');
    expect(noKeys.findByType('a').props.href).toBe('#/ai-providers');
    expect(text()).toContain(hint);
  });

  test('modeLocked locks mode and fallback but keeps Preferred editable', async () => {
    await mount({
      modeLocked: true,
      value: routing({ fallback: { target: 'codex', mode: 'auto', mappings } }),
    });
    expect(modeTabs()!.props.disabled).toBe(true);
    expect(targetTabs()!.props.disabled).toBe(true);
    expect(root().findByType(FallbackModeMappings).props.disabled).toBe(true);
    expect(preferredSelect()!.props.disabled).toBe(false);
    expect(byData('data-provider-routing-locked')).toHaveLength(1);
  });

  test('modeLocked keeps Preferred editable while the stored mode is API key', async () => {
    const { onPreferredChange } = await mount({
      modeLocked: true,
      value: routing({ mode: 'api' }),
    });
    expect(modeTabs()!.props.disabled).toBe(true);
    expect(apiKeySelect()!.props.disabled).toBe(true);
    expect(preferredSelect()!.props.disabled).toBe(false);
    act(() => preferredSelect()!.props.onChange('acc-1'));
    expect(onPreferredChange).toHaveBeenCalledWith('acc-1');
  });

  test('an older backend allows only Subscription mode and the Codex target', async () => {
    await mount({ providersSupported: false, apiKeyOptions: [] });
    const hint = 'Requires an updated CPA backend.';
    expect(modeTabs()!.props.disabled).toBe(true);
    expect(tabItem(modeTabs(), 'api')).toMatchObject({ disabled: true, title: hint });
    expect(targetTabs()!.props.disabled).toBe(false);
    expect(tabItem(targetTabs(), 'api')).toMatchObject({ disabled: true, title: hint });
    expect(tabItem(targetTabs(), 'codex').disabled).toBeFalsy();
    expect(byData('data-provider-routing-old-backend')).toHaveLength(1);
    expect(byData('data-provider-routing-no-keys')).toHaveLength(0);
  });

  test('the disabled prop locks every control', async () => {
    await mount({
      disabled: true,
      value: routing({ fallback: { target: 'api', mode: 'auto', mappings } }),
    });
    expect(modeTabs()!.props.disabled).toBe(true);
    expect(targetTabs()!.props.disabled).toBe(true);
    expect(preferredSelect()!.props.disabled).toBe(true);
    expect(apiKeySelect()!.props.disabled).toBe(true);
  });

  test('warns about a disabled chosen key', async () => {
    await mount({ value: routing({ mode: 'api', apiCredential: 'key-idx-2' }) });
    const [warning] = byData('data-provider-key-warning');
    expect(warning.children.join('')).toContain('This API key is disabled');
    expect(apiKeySelect()!.props.ariaDescribedBy).toContain(warning.props.id);
    expect(root().findAll((node) => node.props.role === 'alert')).toHaveLength(0);
  });

  test('warns about an unknown chosen key', async () => {
    const options: ApiKeyOption[] = [
      ...keyOptions,
      { value: 'gone-idx-9', label: 'gone-idx · unknown', status: 'unknown' },
    ];
    await mount({
      apiKeyOptions: options,
      value: routing({
        apiCredential: 'gone-idx-9',
        fallback: { target: 'api', mode: 'auto', mappings },
      }),
    });
    const [warning] = byData('data-provider-key-warning');
    expect(warning.children.join('')).toContain('no longer configured');
    expect(apiKeySelect()!.props.value).toBe('gone-idx-9');
  });

  test('no warning for a working key', async () => {
    await mount({ value: routing({ mode: 'api' }) });
    expect(byData('data-provider-key-warning')).toHaveLength(0);
  });

  test('a missing key shows an error at the field', async () => {
    await mount({ value: routing({ mode: 'api', apiCredential: '' }) });
    const alerts = root().findAll((node) => node.props.role === 'alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].children.join('')).toBe('Choose an API key.');
    expect(apiKeySelect()!.props.ariaInvalid).toBe(true);
    expect(apiKeySelect()!.props.ariaDescribedBy).toContain(alerts[0].props.id);
  });

  test('an invalid mapping table shows the mapping error', async () => {
    await mount({ value: routing({ fallback: { target: 'codex', mode: 'auto', mappings: [] } }) });
    const alerts = root().findAll((node) => node.props.role === 'alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].children.join('')).toContain('Fill in both model IDs');
    expect(byData('data-provider-hidden-mappings-error')).toHaveLength(0);
  });

  test.each([
    [
      'target Off',
      routing({ fallback: { target: 'off', mode: 'auto', mappings: [{ from: '', to: '' }] } }),
    ],
    [
      'API key mode',
      routing({
        mode: 'api',
        fallback: { target: 'codex', mode: 'auto', mappings: [{ from: '', to: '' }] },
      }),
    ],
  ])(
    'a hidden invalid mapping table explains why the save is blocked: %s',
    async (_name, value) => {
      await mount({ value });
      expect(root().findAllByType(FallbackModeMappings)).toHaveLength(0);
      const [error] = byData('data-provider-hidden-mappings-error');
      expect(error.props.role).toBe('alert');
      expect(error.children.join('')).toContain(
        'The hidden Codex mapping table has an invalid row'
      );
    }
  );

  test('a hidden mapping table under the API-key target is not checked', async () => {
    await mount({
      value: routing({
        fallback: { target: 'api', mode: 'auto', mappings: [{ from: '', to: '' }] },
      }),
    });
    expect(byData('data-provider-hidden-mappings-error')).toHaveLength(0);
  });

  test.each([
    ['API key mode', routing({ mode: 'api', apiCredential: '' })],
    [
      'the API-key target',
      routing({ apiCredential: '', fallback: { target: 'api', mode: 'auto', mappings } }),
    ],
  ])('the key select is enabled with keys listed and none chosen: %s', async (_name, value) => {
    await mount({ value });
    expect(apiKeySelect()!.props.disabled).toBe(false);
  });

  test('a stored key stays selectable after the last key is removed', async () => {
    await mount({ apiKeyOptions: [], value: routing({ mode: 'api', apiCredential: 'key-idx-1' }) });
    expect(apiKeySelect()!.props.disabled).toBe(false);
  });

  test('without keys and nothing chosen the key select is disabled', async () => {
    await mount({ apiKeyOptions: [], value: routing({ mode: 'api', apiCredential: '' }) });
    expect(apiKeySelect()!.props.disabled).toBe(true);
  });
});

describe('ProviderRoutingBlock Codex speed', () => {
  const speedTabs = () => tabs('speed');
  const flagSwitch = () =>
    root()
      .findAllByType(ToggleSwitch)
      .find((node) => node.props.label === 'Ignore the tier the client sends')!;
  const speedRow = () => byData('data-provider-codex-speed');

  test.each(['standard', 'fast', 'ultrafast'] as const)(
    'choosing %s calls onChange with the new speed',
    async (speed) => {
      const start = speed === 'fast' ? 'ultrafast' : 'fast';
      const { onChange } = await mount({
        provider: 'codex',
        speedSupported: true,
        value: routing({ speed: start }),
      });
      expect(speedTabs()!.props.activeTab).toBe(start);
      expect(speedTabs()!.props.idBase).toMatch(/-speed$/);
      act(() => speedTabs()!.props.onChange(speed));
      expect(onChange).toHaveBeenCalledExactlyOnceWith(routing({ speed }));
    }
  );

  test('the flag switch calls onChange with the new flag', async () => {
    const { onChange } = await mount({ provider: 'codex', speedSupported: true });
    expect(flagSwitch().props.checked).toBe(false);
    act(() => flagSwitch().props.onChange(true));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(routing({ ignoreClientTier: true }));
    expect(text()).toContain('Ultrafast applies to models that offer it.');
  });

  test('an unused speed keeps the row visible but disabled, with the explanation', async () => {
    await mount({
      provider: 'codex',
      speedSupported: true,
      speedUse: 'unused',
      value: routing({ mode: 'api', speed: 'fast', ignoreClientTier: true }),
    });
    expect(speedTabs()!.props.activeTab).toBe('fast');
    expect(speedTabs()!.props.disabled).toBe(true);
    expect(flagSwitch().props.checked).toBe(true);
    expect(flagSwitch().props.disabled).toBe(true);
    expect(byData('data-provider-speed-api-mode')).toHaveLength(1);
  });

  test("Claude's fallback to Codex keeps the row enabled in API key mode, with its own hint", async () => {
    const { onChange } = await mount({
      provider: 'codex',
      speedSupported: true,
      speedUse: 'claude_fallback',
      value: routing({ mode: 'api', speed: 'fast' }),
    });
    expect(speedTabs()!.props.disabled).toBe(false);
    expect(flagSwitch().props.disabled).toBe(false);
    expect(byData('data-provider-speed-api-mode')).toHaveLength(0);
    expect(byData('data-provider-speed-claude-fallback')).toHaveLength(1);
    act(() => speedTabs()!.props.onChange('ultrafast'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(routing({ mode: 'api', speed: 'ultrafast' }));
  });

  test('a speed that applies keeps the row enabled, with neither note', async () => {
    await mount({ provider: 'codex', speedSupported: true });
    expect(speedTabs()!.props.disabled).toBe(false);
    expect(flagSwitch().props.disabled).toBe(false);
    expect(byData('data-provider-speed-api-mode')).toHaveLength(0);
    expect(byData('data-provider-speed-claude-fallback')).toHaveLength(0);
  });

  test('the mode lock locks the mode but never the Speed row', async () => {
    await mount({
      provider: 'codex',
      speedSupported: true,
      modeLocked: true,
      value: routing({ mode: 'api' }),
    });
    expect(modeTabs()!.props.disabled).toBe(true);
    expect(speedTabs()!.props.disabled).toBe(false);
    expect(flagSwitch().props.disabled).toBe(false);
    expect(byData('data-provider-speed-api-mode')).toHaveLength(0);
  });

  test('disabled disables the row', async () => {
    await mount({ provider: 'codex', speedSupported: true, disabled: true });
    expect(speedTabs()!.props.disabled).toBe(true);
    expect(flagSwitch().props.disabled).toBe(true);
  });

  test('Claude has no speed row', async () => {
    await mount({ provider: 'claude', speedSupported: true });
    expect(speedRow()).toHaveLength(0);
    expect(speedTabs()).toBeUndefined();
    // Only the Enabled switch: no Codex flag switch.
    expect(root().findAllByType(ToggleSwitch)).toHaveLength(1);
  });

  test('an older backend gets no speed row', async () => {
    await mount({ provider: 'codex', speedSupported: false });
    expect(speedRow()).toHaveLength(0);
    expect(speedTabs()).toBeUndefined();
  });
});

describe('ProviderRoutingBlock Enabled switch', () => {
  const enabledSwitch = (provider = 'Claude') =>
    root()
      .findAllByType(ToggleSwitch)
      .find((node) => node.props.ariaLabel === `${provider} enabled`)!;
  const speedTabs = () => tabs('speed');
  const codexFallbackWarning = () => byData('data-provider-codex-fallback-off');
  const codexTarget = { target: 'codex' as const, mode: 'auto' as const, mappings };

  test.each([
    [false, true],
    [true, false],
  ])('a stored disabled=%s renders the switch checked=%s', async (stored, checked) => {
    await mount({ providerToggleSupported: true, value: routing({ disabled: stored }) });
    expect(enabledSwitch().props.checked).toBe(checked);
    expect(enabledSwitch().props.label).toBe('Enabled');
    expect(enabledSwitch().props.disabled).toBe(false);
  });

  test.each([
    ['off', true, false],
    ['on', false, true],
  ])('switching %s changes only disabled', async (_name, stored, checked) => {
    const value = routing({ disabled: stored, fallback: codexTarget });
    const { onChange } = await mount({ providerToggleSupported: true, value });
    act(() => enabledSwitch().props.onChange(checked));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...value, disabled: !checked });
  });

  test('switching back on keeps every other field of a stored-off provider', async () => {
    const value = routing({ disabled: true, mode: 'api', apiCredential: 'key-idx-2' });
    const { onChange } = await mount({ providerToggleSupported: true, value });
    act(() => enabledSwitch().props.onChange(true));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...value, disabled: false });
  });

  test('while off every other control is disabled, values are kept and a hint shows', async () => {
    await mount({
      providerToggleSupported: true,
      value: routing({ disabled: true, fallback: codexTarget }),
    });
    expect(modeTabs()!.props.disabled).toBe(true);
    expect(modeTabs()!.props.activeTab).toBe('subscription');
    expect(targetTabs()!.props.disabled).toBe(true);
    expect(targetTabs()!.props.activeTab).toBe('codex');
    expect(preferredSelect()!.props.disabled).toBe(true);
    const editor = root().findByType(FallbackModeMappings);
    expect(editor.props.disabled).toBe(true);
    expect(editor.props.value.mappings).toEqual(mappings);
    expect(enabledSwitch().props.disabled).toBe(false);
    const [hint] = byData('data-provider-off');
    expect(hint.children.join('')).toContain('Claude is off for this profile');
  });

  test('while off the API key select is disabled and keeps the key', async () => {
    await mount({
      providerToggleSupported: true,
      value: routing({ disabled: true, mode: 'api' }),
    });
    expect(apiKeySelect()!.props.disabled).toBe(true);
    expect(apiKeySelect()!.props.value).toBe('key-idx-1');
  });

  test('a Codex that is off disables the Speed row and renders none of its hints', async () => {
    await mount({
      provider: 'codex',
      speedSupported: true,
      providerToggleSupported: true,
      speedUse: 'unused',
      value: routing({ disabled: true, mode: 'api', speed: 'fast' }),
    });
    expect(speedTabs()!.props.disabled).toBe(true);
    expect(speedTabs()!.props.activeTab).toBe('fast');
    expect(byData('data-provider-speed-api-mode')).toHaveLength(0);
    expect(byData('data-provider-speed-claude-fallback')).toHaveLength(0);
    expect(byData('data-provider-off')).toHaveLength(1);
  });

  test('a Codex that is off in Subscription mode locks the speed and the flag, keeping them', async () => {
    // `applies` leaves the row enabled on its own, so only the off state locks it here.
    await mount({
      provider: 'codex',
      speedSupported: true,
      providerToggleSupported: true,
      speedUse: 'applies',
      value: routing({ disabled: true, speed: 'ultrafast', ignoreClientTier: true }),
    });
    const flag = root()
      .findAllByType(ToggleSwitch)
      .find((node) => node.props.label === 'Ignore the tier the client sends')!;
    expect(speedTabs()!.props.disabled).toBe(true);
    expect(speedTabs()!.props.activeTab).toBe('ultrafast');
    expect(flag.props.disabled).toBe(true);
    expect(flag.props.checked).toBe(true);
  });

  test('a Codex that is off hides the Claude fallback note too', async () => {
    await mount({
      provider: 'codex',
      speedSupported: true,
      providerToggleSupported: true,
      speedUse: 'claude_fallback',
      value: routing({ disabled: true, mode: 'api' }),
    });
    expect(speedTabs()!.props.disabled).toBe(true);
    expect(byData('data-provider-speed-claude-fallback')).toHaveLength(0);
  });

  test('validation errors never lock the switch', async () => {
    await mount({
      providerToggleSupported: true,
      value: routing({ disabled: true, mode: 'api', apiCredential: '' }),
    });
    expect(root().findAll((node) => node.props.role === 'alert')).toHaveLength(1);
    expect(enabledSwitch().props.disabled).toBe(false);
  });

  test('the disabled prop locks the switch', async () => {
    await mount({ providerToggleSupported: true, disabled: true });
    expect(enabledSwitch().props.disabled).toBe(true);
  });

  test('the mode lock locks the switch with the existing lock hint', async () => {
    await mount({ providerToggleSupported: true, modeLocked: true });
    expect(enabledSwitch().props.disabled).toBe(true);
    expect(byData('data-provider-routing-locked')).toHaveLength(1);
    expect(byData('data-provider-toggle-old-backend')).toHaveLength(0);
  });

  test('a backend without the flag locks the switch with the backend hint', async () => {
    await mount({ providerToggleSupported: false });
    expect(enabledSwitch().props.disabled).toBe(true);
    expect(enabledSwitch().props.checked).toBe(true);
    const [hint] = byData('data-provider-toggle-old-backend');
    expect(hint.children.join('')).toBe('Requires an updated CPA backend.');
    // Beside the switch, not under the mode tabs, which still work on this backend.
    expect(hint.parent!.props['data-provider-routing']).toBe('claude');
    expect(modeTabs()!.props.disabled).toBe(false);
  });

  test('without providers support the existing backend hint covers the switch', async () => {
    await mount({ providersSupported: false });
    expect(enabledSwitch().props.disabled).toBe(true);
    expect(byData('data-provider-routing-old-backend')).toHaveLength(1);
    expect(byData('data-provider-toggle-old-backend')).toHaveLength(0);
  });

  test('the switch is locked, and shows on, when providerToggleSupported is omitted', async () => {
    await mount();
    expect(enabledSwitch().props.disabled).toBe(true);
    expect(enabledSwitch().props.checked).toBe(true);
  });

  test('under the mode lock a stored off locks nothing and shows no off hint', async () => {
    const { onPreferredChange } = await mount({
      provider: 'codex',
      speedSupported: true,
      providerToggleSupported: true,
      modeLocked: true,
      value: routing({ disabled: true }),
    });
    expect(enabledSwitch('Codex').props.checked).toBe(false);
    expect(enabledSwitch('Codex').props.disabled).toBe(true);
    expect(preferredSelect('Codex')!.props.disabled).toBe(false);
    expect(speedTabs()!.props.disabled).toBe(false);
    expect(byData('data-provider-off')).toHaveLength(0);
    act(() => preferredSelect('Codex')!.props.onChange('acc-1'));
    expect(onPreferredChange).toHaveBeenCalledWith('acc-1');
  });

  test('Claude falling back to a disabled Codex shows a warning', async () => {
    await mount({
      providerToggleSupported: true,
      codexDisabled: true,
      value: routing({ fallback: codexTarget }),
    });
    const [warning] = codexFallbackWarning();
    expect(warning.children.join('')).toContain('fallback to Codex will not run');
  });

  test.each([
    ['Codex enabled', { codexDisabled: false, value: routing({ fallback: codexTarget }) }],
    ['target Off', { codexDisabled: true, value: routing() }],
    [
      'target API key',
      { codexDisabled: true, value: routing({ fallback: { ...codexTarget, target: 'api' } }) },
    ],
    [
      'Claude in API key mode',
      { codexDisabled: true, value: routing({ mode: 'api', fallback: codexTarget }) },
    ],
    [
      'both providers off',
      { codexDisabled: true, value: routing({ disabled: true, fallback: codexTarget }) },
    ],
    [
      'the mode lock',
      { codexDisabled: true, modeLocked: true, value: routing({ fallback: codexTarget }) },
    ],
  ] as Array<[string, Partial<ProviderRoutingBlockProps>]>)(
    'no Codex fallback warning: %s',
    async (_name, props) => {
      await mount({ providerToggleSupported: true, ...props });
      expect(codexFallbackWarning()).toHaveLength(0);
    }
  );

  test('the Codex block never shows the Claude fallback warning', async () => {
    await mount({
      provider: 'codex',
      providerToggleSupported: true,
      codexDisabled: true,
      value: routing({ fallback: { ...codexTarget, target: 'off' } }),
    });
    expect(codexFallbackWarning()).toHaveLength(0);
  });
});
