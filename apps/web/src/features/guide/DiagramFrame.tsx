import { useCallback, useEffect, useRef } from 'react';
import { useThemeStore } from '@/stores';
import styles from './DiagramFrame.module.scss';

interface DiagramFrameProps {
  html: string;
  title: string;
}

/**
 * Renders a self-contained diagram page (archify HTML bundled via `?raw`) in an iframe and
 * keeps its `data-theme` in sync with the panel's resolved theme. The srcdoc document is
 * same-origin, so the attribute can be set directly on its root element.
 */
export function DiagramFrame({ html, title }: DiagramFrameProps) {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const applyTheme = useCallback(() => {
    iframeRef.current?.contentDocument?.documentElement?.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    applyTheme();
  }, [applyTheme]);

  return (
    <iframe
      ref={iframeRef}
      className={styles.frame}
      srcDoc={html}
      title={title}
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
      onLoad={applyTheme}
    />
  );
}
