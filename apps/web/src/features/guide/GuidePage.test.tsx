import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidePage } from './GuidePage';
import keyRoutingHtml from './diagrams/key-routing.html?raw';
import poolSelectionHtml from './diagrams/pool-selection.html?raw';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  node.children.map((child) => (typeof child === 'string' ? child : getText(child))).join('');

let renderers: ReactTestRenderer[] = [];

const renderPage = () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<GuidePage />, {
      createNodeMock: () => ({ contentDocument: null, contentWindow: null }),
    });
  });
  renderers.push(renderer);
  return renderer;
};

const findTab = (renderer: ReactTestRenderer, id: string) =>
  renderer.root.find((node) => node.props.role === 'tab' && node.props.id === `guide-tab-${id}`);

describe('GuidePage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { setItem: () => {} });
  });

  afterEach(() => {
    act(() => renderers.forEach((renderer) => renderer.unmount()));
    renderers = [];
    vi.unstubAllGlobals();
  });

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

  it('strips the Google Fonts links so the Guide makes no third-party requests', () => {
    const renderer = renderPage();
    const keyRoutingDoc = renderer.root.findByType('iframe').props.srcDoc as string;
    act(() => {
      findTab(renderer, 'pool-selection').props.onClick({ preventDefault: () => {} });
    });
    const poolSelectionDoc = renderer.root.findByType('iframe').props.srcDoc as string;

    for (const doc of [keyRoutingDoc, poolSelectionDoc]) {
      expect(doc).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
      expect(doc).toContain('<style>');
    }
  });
});

// DiagramFrame relies on these parts of the generated archify pages. A regenerated page
// that drops one of them would silently stop following the panel theme.
describe.each([
  ['key-routing.html', keyRoutingHtml],
  ['pool-selection.html', poolSelectionHtml],
])('%s theme contract', (_name, html) => {
  it('reads the stored archify-theme before first paint', () => {
    expect(html).toContain("localStorage.getItem('archify-theme')");
  });

  it('styles both light and dark data-theme values', () => {
    expect(html).toContain('[data-theme="light"]');
    expect(html).toContain('[data-theme="dark"]');
  });

  it('exposes the viewer theme toggle on the Archify global', () => {
    expect(html).toContain('var Archify = {};');
    expect(html).toContain('return { toggle: toggle };');
  });
});
