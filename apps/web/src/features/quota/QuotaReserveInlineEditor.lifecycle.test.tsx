import { createElement, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import { observeQuotaReserveCapabilities } from '@/features/personal-quota-support/services/api/quotaReserveCapabilities';
import { buildQuotaReservePatch, readQuotaReserveDraft } from './authFiles/quotaReserve';
import { QuotaReserveInlineEditor } from './components/QuotaReserveInlineEditor';
import { Select } from './components/Select';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
const initial = { percent: 30, mode: 'soft' as const, steps: [15, 5] };
const saved = vi.fn();
const cancel = vi.fn();
const remove = vi.fn();
const focus = vi.fn();

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  vi.clearAllMocks();
  observeQuotaReserveCapabilities(3, apiClient.getConnectionRevision());
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  observeQuotaReserveCapabilities(undefined, apiClient.getConnectionRevision());
});

async function mount(saving = false) {
  function Harness() {
    const [draft, setDraft] = useState(readQuotaReserveDraft('codex', {}, initial)!);
    return createElement(QuotaReserveInlineEditor, {
      draft,
      saving,
      canRemove: true,
      onChange: (patch) => setDraft((value) => ({ ...value, ...patch, touched: true })),
      onSave: () => saved(buildQuotaReservePatch({}, { ...draft, touched: true })),
      onCancel: cancel,
      onRemove: remove,
    });
  }
  await act(async () => {
    renderer = create(createElement(Harness), {
      createNodeMock: () => ({ querySelector: () => ({ focus }) }),
    });
  });
}
const saveButton = () =>
  renderer!.root.findAllByType('button').find((button) => 'data-reserve-save' in button.props)!;
async function changeInput(index: number, value: string) {
  await act(async () => {
    renderer!.root.findAllByType('input')[index].props.onChange({ target: { value } });
  });
}

describe('staged reserve editor interaction', () => {
  test('keeps three thresholds, focuses the first input and saves edited steps', async () => {
    await mount();
    expect(renderer!.root.findAllByType('input').map((input) => input.props.value)).toEqual([
      '30',
      '15',
      '5',
    ]);
    expect(focus).toHaveBeenCalledTimes(1);
    await changeInput(1, '12');
    await changeInput(2, '4');
    await act(async () => {
      saveButton().props.onClick();
    });
    expect(saved).toHaveBeenCalledWith({
      quota_reserve: { percent: 30, mode: 'soft', steps: [12, 4] },
    });
  });

  test('invalid order and missing soft2 disable save; clearing both extras explicitly collapses', async () => {
    await mount();
    await changeInput(1, '5');
    expect(saveButton().props.disabled).toBe(true);
    await changeInput(1, '');
    expect(saveButton().props.disabled).toBe(true);
    await changeInput(2, '');
    expect(saveButton().props.disabled).toBe(false);
    await act(async () => {
      saveButton().props.onClick();
    });
    expect(saved).toHaveBeenCalledWith({ quota_reserve: { percent: 30, mode: 'soft', steps: [] } });
  });

  test('hard mode has one threshold and switching back preserves the unsaved soft draft', async () => {
    await mount();
    await act(async () => {
      renderer!.root.findByType(Select).props.onChange('hard');
    });
    expect(renderer!.root.findAllByType('input')).toHaveLength(1);
    await act(async () => {
      saveButton().props.onClick();
    });
    expect(saved).toHaveBeenCalledWith({ quota_reserve: { percent: 30, mode: 'hard', steps: [] } });
    await act(async () => {
      renderer!.root.findByType(Select).props.onChange('soft');
    });
    expect(renderer!.root.findAllByType('input').map((input) => input.props.value)).toEqual([
      '30',
      '15',
      '5',
    ]);
  });

  test('an older backend cannot silently submit the displayed staged policy', async () => {
    observeQuotaReserveCapabilities(undefined, apiClient.getConnectionRevision());
    await mount();
    const inputs = renderer!.root.findAllByType('input');
    expect(inputs[0].props.disabled).toBe(false);
    expect(inputs.slice(1).every((input) => input.props.disabled)).toBe(true);
    expect(saveButton().props.disabled).toBe(true);
    expect(renderer!.root.findByType(QuotaReserveInlineEditor).props.draft.steps).toEqual([
      '15',
      '5',
    ]);
  });

  test('Escape cancels without saving and is ignored while a write is pending', async () => {
    await mount();
    const stopPropagation = vi.fn();
    await act(async () => {
      renderer!.root
        .findByProps({ 'data-reserve-editor': '' })
        .props.onKeyDown({ key: 'Escape', stopPropagation });
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
    await act(async () => {
      renderer!.unmount();
    });
    renderer = undefined;
    await mount(true);
    await act(async () => {
      renderer!.root
        .findByProps({ 'data-reserve-editor': '' })
        .props.onKeyDown({ key: 'Escape', stopPropagation });
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAllByType('input').every((input) => input.props.disabled)).toBe(true);
  });
});
