import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { GuidePage } from './GuidePage';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

// The real theme store persists to localStorage, which the node test environment lacks.
vi.mock('@/stores', async () => {
  const { create: createStore } = await import('zustand');
  return {
    useThemeStore: createStore<{ resolvedTheme: 'light' | 'dark' }>()(() => ({
      resolvedTheme: 'light',
    })),
  };
});

const getText = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : getText(child)))
    .join('');

const renderPage = () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<GuidePage />, {
      createNodeMock: () => ({ contentDocument: null }),
    });
  });
  return renderer;
};

const findTab = (renderer: ReactTestRenderer, id: string) =>
  renderer.root.find((node) => node.props.role === 'tab' && node.props.id === `guide-tab-${id}`);

describe('GuidePage', () => {
  it('renders the title, subtitle and both tab labels', () => {
    const renderer = renderPage();

    expect(getText(renderer.root.findByType('h1'))).toBe('guide.title');
    expect(renderer.root.findAll((node) => node.type === 'p').map(getText)).toContain(
      'guide.subtitle'
    );
    expect(renderer.root.findByProps({ role: 'tablist' }).props['aria-label']).toBe(
      'guide.tabs_label'
    );
    expect(getText(findTab(renderer, 'key-routing'))).toBe('guide.tab_key_routing');
    expect(getText(findTab(renderer, 'pool-selection'))).toBe('guide.tab_pool_selection');
  });

  it('shows the key routing diagram and intro on the first tab', () => {
    const renderer = renderPage();
    const iframes = renderer.root.findAllByType('iframe');

    expect(iframes).toHaveLength(1);
    expect(iframes[0].props.srcDoc).toContain('Request routing by client key');
    expect(iframes[0].props.title).toBe('guide.tab_key_routing');
    expect(findTab(renderer, 'key-routing').props['aria-selected']).toBe(true);

    const panel = renderer.root.findByProps({ role: 'tabpanel' });
    expect(panel.props['aria-labelledby']).toBe('guide-tab-key-routing');
    expect(getText(panel)).toContain('guide.intro_key_routing');
  });

  it('swaps to the pool selection diagram when the second tab is clicked', () => {
    const renderer = renderPage();

    act(() => {
      findTab(renderer, 'pool-selection').props.onClick({ preventDefault: () => {} });
    });

    const iframes = renderer.root.findAllByType('iframe');
    expect(iframes).toHaveLength(1);
    expect(iframes[0].props.srcDoc).toContain('Credential selection inside the pool');
    expect(iframes[0].props.srcDoc).not.toContain('Request routing by client key');
    expect(findTab(renderer, 'pool-selection').props['aria-selected']).toBe(true);
    expect(findTab(renderer, 'key-routing').props['aria-selected']).toBe(false);

    const panel = renderer.root.findByProps({ role: 'tabpanel' });
    expect(panel.props['aria-labelledby']).toBe('guide-tab-pool-selection');
    expect(getText(panel)).toContain('guide.intro_pool_selection');
    expect(getText(panel)).not.toContain('guide.intro_key_routing');

    act(() => {
      findTab(renderer, 'key-routing').props.onClick({ preventDefault: () => {} });
    });
    const backIframes = renderer.root.findAllByType('iframe');
    expect(backIframes).toHaveLength(1);
    expect(backIframes[0].props.srcDoc).toContain('Request routing by client key');
  });
});
