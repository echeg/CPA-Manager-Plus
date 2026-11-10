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

// Uses the real theme store (not a stub) so the header's Auto / Dark / White modes are
// checked end to end: theme -> resolvedTheme -> data-theme inside the diagram iframe.
// The barrel is narrowed to the theme store so unrelated stores are not loaded.
vi.mock('@/stores', async () => ({
  useThemeStore: (await import('@/stores/useThemeStore')).useThemeStore,
}));

let prefersDark = false;

const stubBrowserGlobals = () => {
  vi.stubGlobal('window', {
    matchMedia: () => ({
      matches: prefersDark,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  vi.stubGlobal('document', {
    documentElement: { setAttribute: vi.fn(), removeAttribute: vi.fn() },
  });
};

const renderFrame = () => {
  const setAttribute = vi.fn();
  const node = { contentDocument: { documentElement: { setAttribute } } };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<DiagramFrame html="<html></html>" title="Diagram" />, {
      createNodeMock: () => node,
    });
  });
  act(() => {
    renderer.root.findByType('iframe').props.onLoad();
  });
  const lastTheme = () => {
    const calls = setAttribute.mock.calls.filter(([name]) => name === 'data-theme');
    return calls[calls.length - 1]?.[1];
  };
  return { renderer, lastTheme };
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
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('follows auto -> dark -> white', () => {
    const { renderer, lastTheme } = renderFrame();
    expect(lastTheme()).toBe('light');

    act(() => {
      useThemeStore.getState().setTheme('dark');
    });
    expect(lastTheme()).toBe('dark');

    act(() => {
      useThemeStore.getState().setTheme('white');
    });
    expect(lastTheme()).toBe('light');

    act(() => renderer.unmount());
  });

  it('resolves auto to dark when the system prefers dark', () => {
    prefersDark = true;
    act(() => {
      useThemeStore.getState().setTheme('auto');
    });

    const { renderer, lastTheme } = renderFrame();
    expect(lastTheme()).toBe('dark');

    act(() => renderer.unmount());
  });
});
