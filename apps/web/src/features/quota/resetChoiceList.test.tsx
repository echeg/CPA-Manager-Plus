import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import i18n from '@/i18n';
import { QuotaLedgerResetsDrawer, ResetActionFooter } from './components/QuotaLedgerResets';
import type { ResetAction, ResetActionChoice } from './resetActions';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const choice = (id: string, overrides: Partial<ResetActionChoice> = {}): ResetActionChoice => ({
  id,
  label: `Grant ${id}`,
  detail: `1 of 2 left · clears 5-hour`,
  usable: true,
  recommended: false,
  selected: false,
  ...overrides,
});

const resetAction = (overrides: Partial<ResetAction> = {}): ResetAction => ({
  label: 'Use a reset…',
  blocked: false,
  busy: false,
  consequence: 'Spends Grant B',
  note: '2 left',
  confirmLabel: 'Use reset',
  onConfirm: vi.fn(),
  choices: [
    choice('A'),
    choice('B', { recommended: true, selected: true }),
    choice('C', { usable: false, reason: 'Paused' }),
  ],
  onChoose: vi.fn(),
  onClearChoice: vi.fn(),
  ...overrides,
});

const markup = (action: ResetAction, variant: 'drawer' | 'card') =>
  renderToStaticMarkup(
    createElement(ResetActionFooter, {
      provider: 'claude',
      action,
      initialConfirming: true,
      variant,
    })
  );

const radioTag = (html: string, id: string) =>
  html.match(new RegExp(`<input[^>]*value="${id}"[^>]*>`))?.[0] ?? '';

describe.each(['drawer', 'card'] as const)('ResetActionFooter choices (%s)', (variant) => {
  test('renders a fieldset with a legend and one radio per choice', () => {
    const html = markup(resetAction(), variant);
    expect(html).toContain('<fieldset');
    expect(html).toContain(`<legend`);
    expect(html).toContain(i18n.t('quota_management.resets.choice.legend'));
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('Grant A');
    expect(html).toContain('1 of 2 left');
    expect(html).toContain(i18n.t('quota_management.resets.choice.recommended'));
  });

  test('checks exactly the selected choice', () => {
    const html = markup(resetAction(), variant);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(radioTag(html, 'B')).toContain('checked=""');
  });

  test('disables an unusable choice and shows its reason', () => {
    const html = markup(resetAction(), variant);
    expect(radioTag(html, 'C')).toContain('disabled=""');
    expect(radioTag(html, 'A')).not.toContain('disabled=""');
    expect(html).toContain('Paused');
  });

  test('keeps the plain confirm step without choices', () => {
    const html = markup(resetAction({ choices: undefined, onChoose: undefined }), variant);
    expect(html).not.toContain('<fieldset');
    expect(html).toContain('Spends Grant B');
  });

  test('locks the whole list while a claim is in flight', () => {
    expect(markup(resetAction(), variant)).not.toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup(resetAction({ busy: true }), variant)).toMatch(/<fieldset[^>]*disabled=""/);
  });
});

describe('QuotaLedgerResetsDrawer list', () => {
  test('numbers unnamed grants and shows the shared detail', () => {
    const html = renderToStaticMarkup(
      createElement(QuotaLedgerResetsDrawer, {
        id: 'resets',
        provider: 'claude',
        inventory: {
          items: [
            { id: 'A', expiresAtMs: null, left: 1, total: 2, clears: ['five_hour', 'seven_day'] },
            { id: 'B', expiresAtMs: null, label: 'Fable reset', left: 3 },
          ],
        },
        loading: false,
        showEmails: true,
        now: 0,
      })
    );
    expect(html).toContain(i18n.t('quota_management.resets.unnamed', { index: 1 }));
    expect(html).toContain('1 of 2 left · clears 5-hour + 7-day');
    expect(html).toContain('Fable reset');
    expect(html).toContain('3 of 3 left');
  });
});

describe('ResetActionFooter choice handlers', () => {
  let renderer: ReactTestRenderer | undefined;
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const mount = (action: ResetAction) => {
    act(() => {
      renderer = create(
        createElement(ResetActionFooter, { provider: 'claude', action, initialConfirming: true })
      );
    });
    return renderer!;
  };

  test('picking a radio calls onChoose with its id', () => {
    const action = resetAction();
    const root = mount(action).root;
    const radioA = root.find((node) => node.type === 'input' && node.props.value === 'A');
    act(() => radioA.props.onChange());
    expect(action.onChoose).toHaveBeenCalledWith('A');
  });

  test('Cancel clears the choice and closes the confirm step', () => {
    const onClose = vi.fn();
    const action = resetAction();
    act(() => {
      renderer = create(
        createElement(ResetActionFooter, {
          provider: 'claude',
          action,
          initialConfirming: true,
          onClose,
        })
      );
    });
    const cancel = renderer!.root.find(
      (node) => node.type === 'button' && node.props['data-resets-cancel'] === ''
    );
    act(() => cancel.props.onClick());
    expect(action.onClearChoice).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAll((node) => node.type === 'fieldset')).toHaveLength(0);
  });

  test('Esc clears the choice', () => {
    const action = resetAction();
    const root = mount(action).root;
    const confirm = root.find(
      (node) => node.type === 'div' && node.props['data-resets-confirm'] === ''
    );
    act(() => confirm.props.onKeyDown({ key: 'Escape', stopPropagation: () => {} }));
    expect(action.onClearChoice).toHaveBeenCalledTimes(1);
  });

  test('opening the confirm step clears a pick left from an unmounted footer', () => {
    const action = resetAction();
    act(() => {
      renderer = create(createElement(ResetActionFooter, { provider: 'claude', action }));
    });
    const use = renderer!.root.find(
      (node) => node.type === 'button' && node.props['data-resets-use'] === ''
    );
    act(() => use.props.onClick());
    expect(action.onClearChoice).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAll((node) => node.type === 'fieldset')).toHaveLength(1);
  });

  test('a finished claim clears the choice', async () => {
    const action = resetAction({ onConfirm: vi.fn(async () => {}) });
    const root = mount(action).root;
    const confirmButton = root.find(
      (node) => node.type === 'button' && String(node.props.className).includes('btn-primary')
    );
    await act(async () => {
      confirmButton.props.onClick();
    });
    expect(action.onConfirm).toHaveBeenCalledTimes(1);
    expect(action.onClearChoice).toHaveBeenCalledTimes(1);
  });
});
