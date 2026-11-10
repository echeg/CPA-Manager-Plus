import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from '@/stores';
import { DiagramFrame } from './DiagramFrame';

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

type FakeIframe = {
  contentDocument: { documentElement: { setAttribute: ReturnType<typeof vi.fn> } } | null;
};

const fakeIframeWithDocument = (): FakeIframe => ({
  contentDocument: { documentElement: { setAttribute: vi.fn() } },
});

const renderFrame = (node: FakeIframe) => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<DiagramFrame html={HTML} title={TITLE} />, {
      createNodeMock: () => node,
    });
  });
  return renderer;
};

const lastThemeSet = (node: FakeIframe) => {
  const calls = node.contentDocument?.documentElement.setAttribute.mock.calls ?? [];
  const themeCalls = calls.filter(([name]) => name === 'data-theme');
  return themeCalls[themeCalls.length - 1]?.[1];
};

describe('DiagramFrame', () => {
  beforeEach(() => {
    useThemeStore.setState({ resolvedTheme: 'light' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a sandboxed iframe with the given html and title', () => {
    const renderer = renderFrame(fakeIframeWithDocument());
    const iframe = renderer.root.findByType('iframe');

    expect(iframe.props.srcDoc).toContain('Request routing by client key');
    expect(iframe.props.srcDoc).toBe(HTML);
    expect(iframe.props.title).toBe(TITLE);
    expect(iframe.props.sandbox).toBe('allow-scripts allow-same-origin');
    expect(iframe.props.loading).toBe('lazy');
  });

  it('sets data-theme from the resolved theme when the iframe loads', () => {
    useThemeStore.setState({ resolvedTheme: 'dark' });
    const node = fakeIframeWithDocument();
    const renderer = renderFrame(node);
    node.contentDocument!.documentElement.setAttribute.mockClear();

    act(() => {
      renderer.root.findByType('iframe').props.onLoad();
    });

    expect(node.contentDocument!.documentElement.setAttribute).toHaveBeenCalledWith(
      'data-theme',
      'dark'
    );
  });

  it('updates data-theme when the resolved theme changes', () => {
    const node = fakeIframeWithDocument();
    const renderer = renderFrame(node);
    act(() => {
      renderer.root.findByType('iframe').props.onLoad();
    });
    expect(lastThemeSet(node)).toBe('light');

    act(() => {
      useThemeStore.setState({ resolvedTheme: 'dark' });
    });
    expect(lastThemeSet(node)).toBe('dark');

    act(() => {
      useThemeStore.setState({ resolvedTheme: 'light' });
    });
    expect(lastThemeSet(node)).toBe('light');
  });

  it('does not throw when the iframe has no content document', () => {
    const node: FakeIframe = { contentDocument: null };
    const renderer = renderFrame(node);

    expect(() =>
      act(() => {
        renderer.root.findByType('iframe').props.onLoad();
      })
    ).not.toThrow();
    expect(() =>
      act(() => {
        useThemeStore.setState({ resolvedTheme: 'dark' });
      })
    ).not.toThrow();
  });
});
