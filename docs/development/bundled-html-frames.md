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
   `sandbox="allow-scripts allow-same-origin"`. Scripts keep the page interactive;
   same-origin lets the panel reach `iframe.contentDocument`.
4. Sync the theme: read `resolvedTheme` (`'light' | 'dark'`) from `useThemeStore` and
   set `data-theme` on `iframe.contentDocument.documentElement` both in the iframe's
   `onLoad` and in an effect on `resolvedTheme`. Calling it in both places covers a
   theme change before the iframe has loaded and a change after it. Guard against a
   null `contentDocument`.
5. Mount only the visible frame (for tabs, only the active one) so a single embedded
   runtime runs at a time.

Reference implementation: `apps/web/src/features/guide/DiagramFrame.tsx` and its tests
(`DiagramFrame.test.tsx`, `DiagramFrame.themeStore.test.tsx`).

## Trade-offs

- Every bundled page adds its full size to `dist/index.html` (the two Guide diagrams
  add about 1.4 MB). Prefer an inline SVG when the page does not need its own
  interactivity.
- Use this pattern only for trusted pages committed to the repository. Plugin pages
  are third-party content and go through `PluginResourcePage` and its host style
  bridge instead.
