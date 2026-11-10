import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  claudeFallbackOf,
  providersFromClaudeFallback,
  type RoutingProfile,
  type RoutingSelectionOptions,
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
  test('renders the profile stages without a shared/own mode switch', async () => {
    await mount();
    expect(root().findAll((node) => node.props.role === 'radiogroup')).toHaveLength(0);
    expect(root().findAll((node) => node.props['data-mode'] !== undefined)).toHaveLength(0);
    expect(sticky().props.checked).toBe(true);
    expect(accountSelect('Claude').props.value).toBe('claude-a');
    expect(accountSelect('Codex').props.value).toBe('');
    expect(slotSelects().map((select) => select.props.value)).toEqual(['reserves', 'round-robin']);
    expect(root().findByType(FallbackSettingsEditor).props.value).toEqual(claudeFallbackOf(shared));
    expect(summaryText()).toContain('Sticky session');
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
      root()
        .findByType(FallbackSettingsEditor)
        .props.onChange({ ...claudeFallbackOf(shared), mappings: [] })
    );
    expect(saveButton().props.disabled).toBe(true);
    expect(root().findAll((node) => node.props.role === 'alert')).toHaveLength(1);
  });

  test('Save sends the full draft', async () => {
    const { onSave } = await mount();
    act(() => sticky().props.onChange(false));
    act(() => accountSelect('Claude').props.onChange(''));
    act(() => accountSelect('Codex').props.onChange('codex-a'));
    act(() => slotSelects()[0].props.onChange('priority'));
    act(() => slotSelects()[1].props.onChange(''));
    act(() =>
      root()
        .findByType(FallbackSettingsEditor)
        .props.onChange({ ...claudeFallbackOf(shared), mode: 'always' })
    );
    click(saveButton());
    expect(onSave).toHaveBeenCalledWith(
      {
        sessionAffinity: false,
        preferredAccounts: { codex: 'codex-a' },
        selection: { primary: 'priority' },
        providers: providersFromClaudeFallback({ ...claudeFallbackOf(shared), mode: 'always' }),
      },
      undefined
    );
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
    expect(root().findByType(FallbackSettingsEditor).props.disabled).toBe(true);
    expect(saveButton().props.disabled).toBe(true);

    click(saveButton());
    expect(onSave).not.toHaveBeenCalled();

    expect(cancelButton().props.disabled).toBeFalsy();
    click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('fallbackReadOnly locks only the fallback and saves the stored block', async () => {
    // An empty mapping list is filled with suggestions on screen; a save must not store them.
    const stored: RoutingProfile = {
      ...shared,
      providers: providersFromClaudeFallback({ enabled: false, mode: 'auto', mappings: [] }),
    };
    const { onSave } = await mount({ initial: stored, variant: 'default', fallbackReadOnly: true });
    expect(textOf(root())).toContain('Requires an updated CPA backend with native routing');
    expect(textOf(root())).not.toContain('Per-key profiles need native CPA routing');
    expect(root().findByType(FallbackSettingsEditor).props.disabled).toBe(true);
    expect(sticky().props.disabled).toBe(false);
    expect(ttlInputs()[0].props.disabled).toBe(false);

    act(() => sticky().props.onChange(false));
    click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual({ ...stored, sessionAffinity: false });
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
