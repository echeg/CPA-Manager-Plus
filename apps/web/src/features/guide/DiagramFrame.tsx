import { useCallback, useLayoutEffect, useRef } from 'react';
import { useThemeStore } from '@/stores';
import styles from './DiagramFrame.module.scss';

interface DiagramFrameProps {
  html: string;
  title: string;
}

type ResolvedTheme = 'light' | 'dark';

/** The archify viewer's own theme API (`var Archify` in the page is a window global). */
type ArchifyWindow = Window & { Archify?: { theme?: { toggle?: () => void } } };

/**
 * The archify viewer reads this key before its first paint and ignores OS theme changes
 * while it holds a value. The srcdoc page shares the panel's origin and storage, so writing
 * the panel theme here keeps the diagram on the panel theme from the first frame.
 */
const ARCHIFY_THEME_STORAGE_KEY = 'archify-theme';

// Downloads and modals keep the viewer's file export and its error alerts working.
const SANDBOX = 'allow-scripts allow-same-origin allow-downloads allow-modals';

const storeArchifyTheme = (theme: ResolvedTheme) => {
  try {
    localStorage.setItem(ARCHIFY_THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable; the load handler still sets data-theme directly.
  }
};

/**
 * Renders a self-contained diagram page (archify HTML bundled via `?raw`) in an iframe and
 * keeps its theme in sync with the panel's resolved theme. The srcdoc document is
 * same-origin, so its root element and the viewer's theme API are reachable directly.
 */
export function DiagramFrame({ html, title }: DiagramFrameProps) {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const applyTheme = useCallback(() => {
    storeArchifyTheme(resolvedTheme);
    const frame = iframeRef.current;
    const root = frame?.contentDocument?.documentElement;
    if (!root || root.getAttribute('data-theme') === resolvedTheme) return;
    // The viewer's toggle also updates its toolbar label; it is absent before load.
    const archifyTheme = (frame?.contentWindow as ArchifyWindow | null | undefined)?.Archify?.theme;
    if (archifyTheme?.toggle) archifyTheme.toggle();
    if (root.getAttribute('data-theme') !== resolvedTheme) {
      root.setAttribute('data-theme', resolvedTheme);
    }
  }, [resolvedTheme]);

  // A layout effect runs during the commit, before the srcdoc page's scripts can read the
  // stored theme.
  useLayoutEffect(() => {
    applyTheme();
  }, [applyTheme]);

  return (
    <iframe
      ref={iframeRef}
      className={styles.frame}
      srcDoc={html}
      title={title}
      sandbox={SANDBOX}
      loading="lazy"
      onLoad={applyTheme}
    />
  );
}
