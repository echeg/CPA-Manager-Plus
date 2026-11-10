import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The persist middleware binds its storage when the store module is created, so an
// in-memory localStorage must exist before the store import below is evaluated.
vi.hoisted(() => {
  const data = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
});
import { useThemeStore } from '@/stores/useThemeStore';
import { DiagramFrame } from './DiagramFrame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Uses the real theme store (not a stub) so the header's Auto / Dark / White modes are
// checked end to end: theme -> resolvedTheme -> data-theme inside the diagram iframe.
// The barrel is narrowed to the theme store so unrelated stores are not loaded.
vi.mock('@/stores', async () => ({
  useThemeStore: (await import('@/stores/useThemeStore')).useThemeStore,
}));

let prefersDark = false;
const systemThemeListeners = new Set<() => void>();
let renderers: ReactTestRenderer[] = [];

const stubBrowserGlobals = () => {
  vi.stubGlobal('window', {
    matchMedia: () => ({
      matches: prefersDark,
      addEventListener: (_type: string, listener: () => void) =>
        void systemThemeListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        void systemThemeListeners.delete(listener),
    }),
  });
  vi.stubGlobal('document', {
    documentElement: { setAttribute: vi.fn(), removeAttribute: vi.fn() },
  });
};

const changeSystemTheme = (dark: boolean) =>
  act(() => {
    prefersDark = dark;
    systemThemeListeners.forEach((listener) => listener());
  });

const renderFrame = () => {
  const attributes = new Map<string, string>();
  const node = {
    contentDocument: {
      documentElement: {
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => void attributes.set(name, value),
      },
    },
    contentWindow: {},
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<DiagramFrame html="<html></html>" title="Diagram" />, {
      createNodeMock: () => node,
    });
  });
  renderers.push(renderer);
  act(() => {
    renderer.root.findByType('iframe').props.onLoad();
  });
  return () => attributes.get('data-theme');
};

describe('DiagramFrame with the real theme store', () => {
  beforeEach(() => {
    prefersDark = false;
    stubBrowserGlobals();
    act(() => {
      useThemeStore.getState().setTheme('auto');
    });
  });

  afterEach(() => {
    act(() => renderers.forEach((renderer) => renderer.unmount()));
    renderers = [];
    systemThemeListeners.clear();
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('follows auto -> dark -> white', () => {
    const diagramTheme = renderFrame();
    expect(diagramTheme()).toBe('light');

    act(() => {
      useThemeStore.getState().setTheme('dark');
    });
    expect(diagramTheme()).toBe('dark');

    act(() => {
      useThemeStore.getState().setTheme('white');
    });
    expect(diagramTheme()).toBe('light');
  });

  it('resolves auto to dark when the system prefers dark', () => {
    prefersDark = true;
    act(() => {
      useThemeStore.getState().setTheme('auto');
    });

    const diagramTheme = renderFrame();
    expect(diagramTheme()).toBe('dark');
  });

  it('follows a live system theme change in auto mode', () => {
    const stopWatching = useThemeStore.getState().initializeTheme();
    const diagramTheme = renderFrame();
    expect(diagramTheme()).toBe('light');

    changeSystemTheme(true);

    expect(diagramTheme()).toBe('dark');
    expect(localStorage.getItem('archify-theme')).toBe('dark');
    stopWatching();
  });

  it('keeps an explicit White theme, and its stored copy, when the system theme changes', () => {
    act(() => {
      useThemeStore.getState().setTheme('white');
    });
    const stopWatching = useThemeStore.getState().initializeTheme();
    const diagramTheme = renderFrame();

    changeSystemTheme(true);

    expect(diagramTheme()).toBe('light');
    // The diagram's own OS-theme listener stays idle while this key holds a value.
    expect(localStorage.getItem('archify-theme')).toBe('light');
    stopWatching();
  });
});
