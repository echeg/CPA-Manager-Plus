import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type {
  RoutingProfile,
  RoutingSelectionOptions,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { suggestedFallbackMappings } from '@/features/personal-quota-support/services/api/claudeFallback';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { copyOfShared } from '../keyProfilesModel';
import { FallbackSettingsEditor } from './FallbackSettingsEditor';
import { KeyProfileEditor, type KeyProfileEditorProps } from './KeyProfileEditor';
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
  claudeFallback: {
    enabled: true,
    mode: 'auto',
    mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
  },
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
        profile: null,
        shared,
        files,
        showEmails: true,
        selectionOptions,
        models: { claude: ['claude-opus-5'], codex: ['gpt-6-astra'] },
        saving: false,
        readOnly: false,
        sessionAffinityTTL: '1h',
        onSave,
        onCancel,
        ...props,
      })
    );
  });
  return { onSave, onCancel };
}

const root = () => renderer!.root;
const modeButton = (mode: 'shared' | 'own') =>
  root().find((node) => node.type === 'button' && node.props['data-mode'] === mode);
const saveButton = () =>
  root()
    .findAllByType(Button)
    .find((button) => button.props['data-key-profile-save'])!;
const cancelButton = () =>
  root()
    .findAllByType(Button)
    .find((button) => button.props.children === 'Cancel')!;
const selects = () => root().findAllByType(Select);
const accountSelect = (provider: 'Claude' | 'Codex') =>
  selects().find(
    (select) => select.props.ariaLabel === `${provider}: subscription for new threads`
  )!;
const slotSelects = () => selects().filter((select) => select.props.ariaLabelledBy);
const summaryText = () =>
  textOf(root().find((node) => node.props['data-key-profile-summary'] === true));
const sticky = () => root().findAllByType(ToggleSwitch)[0];

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

const click = (node: ReactTestInstance) => act(() => node.props.onClick());

describe('KeyProfileEditor', () => {
  test('a key without a profile starts on the shared settings and seeds its own copy', async () => {
    const { onSave } = await mount();
    expect(modeButton('shared').props['aria-checked']).toBe(true);
    expect(root().findAllByType(ToggleSwitch)).toHaveLength(0);
    expect(saveButton().props.disabled).toBe(true);
    expect(summaryText()).toContain('Sticky session');

    click(modeButton('own'));
    expect(modeButton('own').props['aria-checked']).toBe(true);
    expect(sticky().props.checked).toBe(true);
    expect(accountSelect('Claude').props.value).toBe('claude-a');
    expect(accountSelect('Codex').props.value).toBe('');
    expect(slotSelects().map((select) => select.props.value)).toEqual(['reserves', 'round-robin']);
    expect(root().findByType(FallbackSettingsEditor).props.value).toEqual(shared.claudeFallback);
    expect(textOf(root())).toContain('TTL 1h is global');

    // A new profile is a change even when it still equals the shared settings.
    expect(saveButton().props.disabled).toBe(false);
    click(saveButton());
    expect(onSave).toHaveBeenCalledWith(copyOfShared(shared));
    expect(onSave.mock.calls[0][0]).not.toBe(shared);
  });

  test('a stored profile without mappings opens clean and saves the suggested ones', async () => {
    const stored = {
      ...copyOfShared(shared),
      claudeFallback: { enabled: false, mode: 'auto' as const, mappings: [] },
    };
    const { onSave } = await mount({ profile: stored });
    // The fallback editor shows suggestions for an empty list; that alone is no edit.
    expect(saveButton().props.disabled).toBe(true);
    act(() => sticky().props.onChange(false));
    click(saveButton());
    expect(onSave.mock.calls[0][0].sessionAffinity).toBe(false);
    expect(onSave.mock.calls[0][0].claudeFallback.mappings).toEqual(suggestedFallbackMappings());
  });

  test('edits never touch the shared profile', async () => {
    const snapshot = JSON.stringify(shared);
    await mount();
    click(modeButton('own'));
    act(() => sticky().props.onChange(false));
    act(() => accountSelect('Claude').props.onChange(''));
    expect(JSON.stringify(shared)).toBe(snapshot);
  });

  test('a picker primary disables the tiebreak and saves without it', async () => {
    const { onSave } = await mount({ profile: copyOfShared(shared) });
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
      profile: { ...copyOfShared(shared), preferredAccounts: { claude: 'gone' } },
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
    await mount({ profile: copyOfShared(shared), showEmails: false });
    const labels = accountSelect('Claude').props.options.map(
      (option: { label: string }) => option.label
    );
    expect(labels.join(' ')).not.toContain('bob@example.com');
    expect(summaryText()).not.toContain('bob@example.com');
  });

  test('Save is disabled while the profile is clean or invalid', async () => {
    await mount({ profile: copyOfShared(shared) });
    expect(saveButton().props.disabled).toBe(true);

    act(() => sticky().props.onChange(false));
    expect(saveButton().props.disabled).toBe(false);
    act(() => sticky().props.onChange(true));
    expect(saveButton().props.disabled).toBe(true);

    act(() =>
      root()
        .findByType(FallbackSettingsEditor)
        .props.onChange({ ...shared.claudeFallback, mappings: [] })
    );
    expect(saveButton().props.disabled).toBe(true);
    expect(root().findAll((node) => node.props.role === 'alert')).toHaveLength(1);
  });

  test('Save sends the full draft', async () => {
    const { onSave } = await mount({ profile: copyOfShared(shared) });
    act(() => sticky().props.onChange(false));
    act(() => accountSelect('Claude').props.onChange(''));
    act(() => accountSelect('Codex').props.onChange('codex-a'));
    act(() => slotSelects()[0].props.onChange('priority'));
    act(() => slotSelects()[1].props.onChange(''));
    act(() =>
      root()
        .findByType(FallbackSettingsEditor)
        .props.onChange({ ...shared.claudeFallback, mode: 'always' })
    );
    click(saveButton());
    expect(onSave).toHaveBeenCalledWith({
      sessionAffinity: false,
      preferredAccounts: { codex: 'codex-a' },
      selection: { primary: 'priority' },
      claudeFallback: { ...shared.claudeFallback, mode: 'always' },
    });
  });

  test('choosing the shared settings for a key with a profile saves null', async () => {
    const { onSave } = await mount({ profile: copyOfShared(shared) });
    click(modeButton('shared'));
    expect(textOf(root())).toContain('This key follows the shared settings');
    expect(root().findAllByType(ToggleSwitch)).toHaveLength(0);
    click(saveButton());
    expect(onSave).toHaveBeenCalledWith(null);
  });

  test('switching back to the own profile keeps the unsaved edits', async () => {
    await mount({ profile: copyOfShared(shared) });
    act(() => sticky().props.onChange(false));
    click(modeButton('shared'));
    click(modeButton('own'));
    expect(sticky().props.checked).toBe(false);
  });

  test('Cancel calls onCancel', async () => {
    const { onCancel, onSave } = await mount({ profile: copyOfShared(shared) });
    click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('read-only disables every control and explains why', async () => {
    const { onSave, onCancel } = await mount({ profile: copyOfShared(shared), readOnly: true });
    expect(textOf(root())).toContain('Per-key profiles need native CPA routing');
    expect(modeButton('shared').props.disabled).toBe(true);
    expect(modeButton('own').props.disabled).toBe(true);
    expect(sticky().props.disabled).toBe(true);
    expect(selects().every((select) => select.props.disabled === true)).toBe(true);
    expect(root().findByType(FallbackSettingsEditor).props.disabled).toBe(true);
    expect(saveButton().props.disabled).toBe(true);

    click(modeButton('shared'));
    expect(modeButton('own').props['aria-checked']).toBe(true);
    click(saveButton());
    expect(onSave).not.toHaveBeenCalled();

    expect(cancelButton().props.disabled).toBeFalsy();
    click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('while saving the controls are locked and Save shows progress', async () => {
    await mount({ profile: copyOfShared(shared), saving: true });
    expect(sticky().props.disabled).toBe(true);
    expect(modeButton('shared').props.disabled).toBe(true);
    expect(saveButton().props.loading).toBe(true);
  });
});
