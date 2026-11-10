import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from '@/stores';
import { DiagramFrame } from './DiagramFrame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real theme store persists to localStorage, which the node test environment lacks,
// so the test swaps in a plain zustand store with the same `resolvedTheme` field.
vi.mock('@/stores', async () => {
  const { create: createStore } = await import('zustand');
  return {
    useThemeStore: createStore<{ resolvedTheme: 'light' | 'dark' }>()(() => ({
      resolvedTheme: 'light',
    })),
  };
});

const HTML = '<!doctype html><html><body><h1>Request routing by client key</h1></body></html>';
const TITLE = 'Request routing by client key';

/** A document whose root element keeps real attribute state. */
const fakeDocument = (theme?: string) => {
  const attributes = new Map<string, string>(theme ? [['data-theme', theme]] : []);
  return {
    documentElement: {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
    },
  };
};

type FakeDocument = ReturnType<typeof fakeDocument>;
type FakeIframe = {
  contentDocument: FakeDocument | null;
  contentWindow: { Archify?: { theme: { toggle: () => void } } } | null;
};

/** The iframe right after mount: its initial about:blank document, no archify runtime. */
const fakeIframe = (): FakeIframe => ({ contentDocument: fakeDocument(), contentWindow: {} });

/** Mimics the srcdoc page loading: a new document replaces the initial one. */
const loadPage = (node: FakeIframe, pageTheme: string, withArchify = false) => {
  const page = fakeDocument(pageTheme);
  node.contentDocument = page;
  node.contentWindow = withArchify
    ? {
        Archify: {
          theme: {
            toggle: vi.fn(() => {
              const current = page.documentElement.getAttribute('data-theme');
              page.documentElement.setAttribute(
                'data-theme',
                current === 'dark' ? 'light' : 'dark'
              );
            }),
          },
        },
      }
    : {};
};

const themeOf = (node: FakeIframe) =>
  node.contentDocument?.documentElement.getAttribute('data-theme');

const storage = new Map<string, string>();
let renderers: ReactTestRenderer[] = [];

const renderFrame = (node: FakeIframe) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<DiagramFrame html={HTML} title={TITLE} />, {
      createNodeMock: () => node,
    });
  });
  renderers.push(renderer);
  return renderer;
};

const fireLoad = (renderer: ReactTestRenderer) =>
  act(() => {
    renderer.root.findByType('iframe').props.onLoad();
  });

describe('DiagramFrame', () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    });
    useThemeStore.setState({ resolvedTheme: 'light' });
  });

  afterEach(() => {
    act(() => renderers.forEach((renderer) => renderer.unmount()));
    renderers = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders a sandboxed iframe with the given html and title', () => {
    const renderer = renderFrame(fakeIframe());
    const iframe = renderer.root.findByType('iframe');

    expect(iframe.props.srcDoc).toBe(HTML);
    expect(iframe.props.title).toBe(TITLE);
    expect(iframe.props.loading).toBe('lazy');
  });

  it('allows the downloads and alerts the diagram export uses', () => {
    const renderer = renderFrame(fakeIframe());
    const tokens = renderer.root.findByType('iframe').props.sandbox.split(' ');

    expect(tokens).toEqual(
      expect.arrayContaining([
        'allow-scripts',
        'allow-same-origin',
        'allow-downloads',
        'allow-modals',
      ])
    );
  });

  it('stores the panel theme for the diagram before the page loads and on every change', () => {
    renderFrame(fakeIframe());
    expect(storage.get('archify-theme')).toBe('light');

    act(() => {
      useThemeStore.setState({ resolvedTheme: 'dark' });
    });
    expect(storage.get('archify-theme')).toBe('dark');
  });

  it('sets data-theme on the loaded page, replacing the theme the page picked itself', () => {
    useThemeStore.setState({ resolvedTheme: 'dark' });
    const node = fakeIframe();
    const renderer = renderFrame(node);

    loadPage(node, 'light');
    fireLoad(renderer);

    expect(themeOf(node)).toBe('dark');
  });

  it('updates data-theme on the current page when the resolved theme changes', () => {
    const node = fakeIframe();
    const renderer = renderFrame(node);
    loadPage(node, 'light');
    fireLoad(renderer);

    act(() => {
      useThemeStore.setState({ resolvedTheme: 'dark' });
    });
    expect(themeOf(node)).toBe('dark');

    act(() => {
      useThemeStore.setState({ resolvedTheme: 'light' });
    });
    expect(themeOf(node)).toBe('light');
  });

  it('applies the latest theme when the theme changes before the iframe loads', () => {
    const node = fakeIframe();
    const renderer = renderFrame(node);

    act(() => {
      useThemeStore.setState({ resolvedTheme: 'dark' });
    });
    loadPage(node, 'light');
    fireLoad(renderer);

    expect(themeOf(node)).toBe('dark');
  });

  it('ends on the new theme when a stale load handler fires before the theme effect re-runs', () => {
    const node = fakeIframe();
    const renderer = renderFrame(node);
    const staleOnLoad = renderer.root.findByType('iframe').props.onLoad;

    // The page loads with the old stored theme and the load handler captured with the old
    // theme runs; the effect for the new theme runs when act flushes and must reach the
    // page that just loaded, not the initial document.
    act(() => {
      useThemeStore.setState({ resolvedTheme: 'dark' });
      loadPage(node, 'light');
      staleOnLoad();
    });

    expect(themeOf(node)).toBe('dark');
    expect(storage.get('archify-theme')).toBe('dark');
  });

  it("uses the viewer's own theme toggle when the archify runtime is present", () => {
    const node = fakeIframe();
    const renderer = renderFrame(node);
    loadPage(node, 'dark', true);
    const toggle = node.contentWindow!.Archify!.theme.toggle;

    fireLoad(renderer);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(themeOf(node)).toBe('light');

    // Already in sync: the toggle must not flip it back.
    fireLoad(renderer);
    expect(toggle).toHaveBeenCalledTimes(1);

    act(() => {
      useThemeStore.setState({ resolvedTheme: 'dark' });
    });
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(themeOf(node)).toBe('dark');
  });

  it('does not throw when the iframe has no content document', () => {
    const renderer = renderFrame({ contentDocument: null, contentWindow: null });

    expect(() => fireLoad(renderer)).not.toThrow();
    expect(() =>
      act(() => {
        useThemeStore.setState({ resolvedTheme: 'dark' });
      })
    ).not.toThrow();
  });

  it('still sets data-theme when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('storage disabled');
      },
    });
    useThemeStore.setState({ resolvedTheme: 'dark' });
    const node = fakeIframe();
    const renderer = renderFrame(node);
    loadPage(node, 'light');

    expect(() => fireLoad(renderer)).not.toThrow();
    expect(themeOf(node)).toBe('dark');
  });
});
