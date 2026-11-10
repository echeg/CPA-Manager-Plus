import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
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
