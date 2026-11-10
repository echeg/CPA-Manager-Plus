# Bundled Self-Contained HTML Pages

The panel ships as a single file (`vite-plugin-singlefile`), and CPA serves it as
`static/management.html`. Extra static files cannot be served next to it, so a
self-contained HTML page (for example an archify diagram) must be bundled into the
JavaScript build.

## Pattern

1. Keep the generated page in the feature folder, next to its source, with a short
   `README.md` saying it is generated and must not be edited by hand
   (see `apps/web/src/features/guide/diagrams/`).
2. Import it as a string with Vite's `?raw` suffix:
   `import keyRoutingHtml from './diagrams/key-routing.html?raw'`.
   Vite's `client` types already cover `?raw`; no extra module declaration is needed.
3. Render it with `<iframe srcDoc={html}>` and
   `sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"`. Scripts keep
   the page interactive; same-origin lets the panel reach `iframe.contentDocument`;
   downloads and modals keep the page's file export and its error alerts working.
4. Sync the theme: read `resolvedTheme` (`'light' | 'dark'`) from `useThemeStore` and
   apply it both in the iframe's `onLoad` and in a layout effect on `resolvedTheme`.
   Calling it in both places covers a theme change before the iframe has loaded and a
   change after it. For an archify page, applying means:
   - write the theme to `localStorage['archify-theme']`. The page reads this key before
     its first paint and ignores OS theme changes while it holds a value; a layout
     effect writes it before the srcdoc page's scripts run;
   - if the page's `data-theme` differs, call the viewer's `Archify.theme.toggle()` (it
     also updates the viewer's toolbar label), then set `data-theme` on
     `iframe.contentDocument.documentElement` if it still differs. Guard against a null
     `contentDocument` and a missing `Archify` global.
5. Drop remote font links before rendering (`GuidePage.tsx` removes the Google Fonts
   `<link>`s). The panel makes no third-party requests elsewhere, and the page falls back
   to the system monospace font.
6. Mount only the visible frame (for tabs, only the active one) so a single embedded
   runtime runs at a time.

Reference implementation: `apps/web/src/features/guide/DiagramFrame.tsx` and its tests
(`DiagramFrame.test.tsx`, `DiagramFrame.themeStore.test.tsx`).

## Trade-offs

- Every bundled page adds its full size to `dist/index.html` (the two Guide diagrams
  add about 1.4 MB). Prefer an inline SVG when the page does not need its own
  interactivity.
- Use this pattern only for trusted pages committed to the repository. With `srcDoc`,
  `allow-scripts allow-same-origin` gives no isolation: the page runs with the panel's
  origin, shares its `localStorage` (including the stored login data) and can reach
  `window.parent`. Plugin pages are third-party content and go through
  `PluginResourcePage` and its host style bridge instead.
- The page's URL is `about:srcdoc`, so links the page builds from `location.href` (the
  archify viewer's "Copy link" buttons) are not usable outside the panel.
