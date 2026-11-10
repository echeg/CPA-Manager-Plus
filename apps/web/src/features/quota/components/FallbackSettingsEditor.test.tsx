import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { ClaudeFallbackSettings } from '@/features/personal-quota-support/services/api/claudeFallback';
import { FallbackModeMappings, FallbackSettingsEditor } from './FallbackSettingsEditor';
import { Select } from './Select';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | undefined;
const value: ClaudeFallbackSettings = {
  enabled: true,
  mode: 'auto',
  mappings: [
    { from: 'claude-opus-*', to: 'gpt-6-astra' },
    { from: 'claude-sonnet-*', to: 'gpt-6-sol' },
  ],
};
const models = { claude: ['claude-opus-5'], codex: ['gpt-6-astra', 'gpt-6-sol'] };

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

function editorElement(disabled: boolean, onChange = vi.fn()) {
  return createElement(FallbackSettingsEditor, { value, models, disabled, onChange });
}

async function mount(disabled = false, onChange = vi.fn()) {
  await act(async () => {
    renderer = create(editorElement(disabled, onChange));
  });
  return onChange;
}

const inputs = () =>
  renderer!.root.findAllByType('input').filter((input) => input.props.list !== undefined);
const buttonByLabel = (label: string) =>
  renderer!.root.findAllByType(Button).find((button) => button.props['aria-label'] === label)!;

describe('FallbackSettingsEditor', () => {
  test('the disabled prop disables every control', async () => {
    await mount(true);
    expect(renderer!.root.findByType(ToggleSwitch).props.disabled).toBe(true);
    expect(renderer!.root.findByType(Select).props.disabled).toBe(true);
    expect(inputs().every((input) => input.props.disabled === true)).toBe(true);
    expect(renderer!.root.findAllByType(Button).every((button) => button.props.disabled)).toBe(
      true
    );
  });

  test('every change reports the whole updated settings without mutating the value', async () => {
    const onChange = await mount();
    const snapshot = JSON.stringify(value);

    act(() => renderer!.root.findByType(ToggleSwitch).props.onChange(false));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, enabled: false });

    act(() => renderer!.root.findByType(Select).props.onChange('always'));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, mode: 'always' });

    act(() => inputs()[1].props.onChange({ target: { value: 'gpt-6-sol' } }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      mappings: [{ from: 'claude-opus-*', to: 'gpt-6-sol' }, value.mappings[1]],
    });

    act(() => inputs()[2].props.onChange({ target: { value: 'claude-fable-*' } }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      mappings: [value.mappings[0], { from: 'claude-fable-*', to: 'gpt-6-sol' }],
    });

    act(() => buttonByLabel('Remove mapping 1').props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({ ...value, mappings: [value.mappings[1]] });

    const add = renderer!.root
      .findAllByType(Button)
      .find((button) => button.props['aria-label'] === undefined)!;
    act(() => add.props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({
      ...value,
      mappings: [...value.mappings, { from: '', to: '' }],
    });

    expect(JSON.stringify(value)).toBe(snapshot);
  });

  test('shows the invalid hint for an enabled block without mappings', async () => {
    await act(async () => {
      renderer = create(
        createElement(FallbackSettingsEditor, {
          value: { ...value, mappings: [] },
          models,
          disabled: false,
          onChange: vi.fn(),
        })
      );
    });
    const alerts = renderer!.root.findAll((node) => node.props.role === 'alert');
    expect(alerts).toHaveLength(1);
  });

  test('two editors never share datalist ids', async () => {
    await act(async () => {
      renderer = create(createElement('div', {}, editorElement(false), editorElement(false)));
    });
    const ids = renderer!.root.findAllByType('datalist').map((node) => node.props.id as string);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    const lists = inputs().map((input) => input.props.list as string);
    expect(lists.every((list) => ids.includes(list))).toBe(true);
  });

  test('a disabled block without mappings is not an error', async () => {
    await act(async () => {
      renderer = create(
        createElement(FallbackSettingsEditor, {
          value: { ...value, enabled: false, mappings: [] },
          models,
          disabled: false,
          onChange: vi.fn(),
        })
      );
    });
    expect(renderer!.root.findAll((node) => node.props.role === 'alert')).toHaveLength(0);
    expect(renderer!.root.findByType(FallbackModeMappings).props.enabled).toBe(false);
  });
});

describe('FallbackModeMappings', () => {
  const part = { mode: 'auto' as const, mappings: value.mappings };

  async function mountPart(props: Partial<Parameters<typeof FallbackModeMappings>[0]> = {}) {
    const onChange = vi.fn();
    await act(async () => {
      renderer = create(
        createElement(FallbackModeMappings, {
          value: part,
          models,
          disabled: false,
          onChange,
          ...props,
        })
      );
    });
    return onChange;
  }

  test('renders the mode select and the mapping table without a toggle', async () => {
    await mountPart();
    expect(renderer!.root.findAllByType(ToggleSwitch)).toHaveLength(0);
    expect(renderer!.root.findByType(Select).props.value).toBe('auto');
    expect(inputs()).toHaveLength(4);
  });

  test('reports only the mode and the mappings', async () => {
    const onChange = await mountPart();
    act(() => renderer!.root.findByType(Select).props.onChange('always'));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'always', mappings: value.mappings });

    act(() => buttonByLabel('Remove mapping 2').props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'auto', mappings: [value.mappings[0]] });
  });

  test('requires a mapping unless it is told the fallback is off', async () => {
    await mountPart({ value: { mode: 'auto', mappings: [] } });
    expect(renderer!.root.findAll((node) => node.props.role === 'alert')).toHaveLength(1);
    await act(async () => renderer!.unmount());

    await mountPart({ value: { mode: 'auto', mappings: [] }, enabled: false });
    expect(renderer!.root.findAll((node) => node.props.role === 'alert')).toHaveLength(0);
  });

  test('the disabled prop disables every control', async () => {
    await mountPart({ disabled: true });
    expect(renderer!.root.findByType(Select).props.disabled).toBe(true);
    expect(inputs().every((input) => input.props.disabled === true)).toBe(true);
    expect(renderer!.root.findAllByType(Button).every((button) => button.props.disabled)).toBe(
      true
    );
  });
});
