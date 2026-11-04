import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import {
  claudeFallbackApi,
  suggestedFallbackMappings,
  type ClaudeFallbackState,
} from '@/features/personal-quota-support/services/api/claudeFallback';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ClaudeFallbackControl } from './components/ClaudeFallbackControl';
import { Select } from './components/Select';

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? createElement('section', {}, children, footer) : null,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
let revision = 0;
const state = (): ClaudeFallbackState => ({
  supported: true,
  settings: { enabled: false, mode: 'auto', mappings: suggestedFallbackMappings() },
  models: { claude: ['claude-opus-5'], codex: ['gpt-6-astra', 'gpt-6-sol'] },
});
beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  revision = 0;
  vi.spyOn(apiClient, 'getConnectionRevision').mockImplementation(() => revision);
  vi.spyOn(claudeFallbackApi, 'get').mockResolvedValue(state());
  vi.spyOn(claudeFallbackApi, 'save').mockImplementation(async (settings) => ({
    ...state(),
    settings,
  }));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () => {
    renderer = create(createElement(ClaudeFallbackControl, { disabled: false, showEmails: false }));
  });
}
const toggle = () => renderer!.root.findAllByType(ToggleSwitch)[0];
const configure = () =>
  renderer!.root
    .findAllByType('button')
    .find(
      (button) => button.props['aria-label'] === i18n.t('quota_management.fallback.configure')
    )!;

describe('Claude fallback controls', () => {
  test('toggles immediately without losing mappings or the selected mode', async () => {
    const forced = { ...state(), settings: { ...state().settings, mode: 'always' as const } };
    vi.mocked(claudeFallbackApi.get).mockResolvedValue(forced);
    await mount();
    await act(async () => {
      toggle().props.onChange(true);
    });
    expect(claudeFallbackApi.save).toHaveBeenLastCalledWith({ ...forced.settings, enabled: true });
    expect(toggle().props.checked).toBe(true);
    await act(async () => {
      toggle().props.onChange(false);
    });
    expect(claudeFallbackApi.save).toHaveBeenLastCalledWith(forced.settings);
    expect(toggle().props.checked).toBe(false);
  });
  test('edits model mappings and force mode only after Save', async () => {
    await mount();
    await act(async () => configure().props.onClick());
    await act(async () => renderer!.root.findByType(Select).props.onChange('always'));
    const input = renderer!.root
      .findAllByType('input')
      .find((item) => item.props.value === 'gpt-6-sol')!;
    await act(async () => input.props.onChange({ target: { value: 'gpt-6-sol(high)' } }));
    expect(claudeFallbackApi.save).not.toHaveBeenCalled();
    const save = renderer!.root
      .findAllByType(Button)
      .find((button) => button.props.children === i18n.t('common.save'))!;
    await act(async () => save.props.onClick());
    expect(claudeFallbackApi.save).toHaveBeenCalledWith({
      ...state().settings,
      mode: 'always',
      mappings: [
        state().settings.mappings[0],
        { from: 'claude-sonnet-*', to: 'gpt-6-sol(high)' },
        state().settings.mappings[2],
      ],
    });
    expect(renderer!.root.findByType(Modal).props.open).toBe(false);
  });
  test('blocks unsupported backends', async () => {
    vi.mocked(claudeFallbackApi.get).mockResolvedValue({ ...state(), supported: false });
    await mount();
    expect(toggle().props.disabled).toBe(true);
    expect(configure().props.disabled).toBe(true);
    expect(claudeFallbackApi.save).not.toHaveBeenCalled();
  });
  test('shows a failed save and disables another toggle until a reload', async () => {
    vi.mocked(claudeFallbackApi.save).mockRejectedValue(new Error('offline'));
    await mount();
    await act(async () => toggle().props.onChange(true));
    expect(toggle().props.disabled).toBe(true);
    expect(renderer!.root.findAll((node) => node.props.role === 'alert').length).toBeGreaterThan(0);
  });
  test('closes an old connection draft and ignores its pending save result', async () => {
    let resolve!: (value: ClaudeFallbackState) => void;
    vi.mocked(claudeFallbackApi.save).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    await mount();
    await act(async () => {
      toggle().props.onChange(true);
    });
    revision++;
    await act(async () => {
      renderer!.update(
        createElement(ClaudeFallbackControl, { disabled: false, showEmails: false })
      );
    });
    await act(async () =>
      resolve({ ...state(), settings: { ...state().settings, enabled: true } })
    );
    expect(toggle().props.checked).toBe(false);
    expect(renderer!.root.findByType(Modal).props.open).toBe(false);
  });
});
