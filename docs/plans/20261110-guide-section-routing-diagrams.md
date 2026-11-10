# Guide section with interactive routing diagrams

## Overview
- Add a top-level **Guide** section to the panel's left navigation (route `/guide`, book icon, last nav block next to System Info).
- The page explains how CPA routes a request today, with two interactive diagrams shown as tabs, each with a short intro paragraph:
  1. **Request routing by client key** — routing profile → sticky session → preferred account → pool selection → Claude → Codex fallback.
  2. **Credential selection inside the pool** — availability filter → preferred account → primary slot → tiebreak slot → picker → selected credential.
- The diagrams are self-contained archify HTML pages (already authored and verified outside the repo). They are bundled into the single-file panel build and rendered in an `<iframe srcDoc>`, following the panel's current theme.
- Benefit: operators get an in-panel explanation of the routing stages that the Routing profiles modal configures, without leaving the panel or reading backend docs.

## Decisions
- **Context**: the panel is a single-file build (`vite-plugin-singlefile`, `assetsInlineLimit` effectively unlimited, `apps/web/dist/index.html` ≈ 6.9 MB served by CPA as `static/management.html`). Separate static assets cannot be served, so the diagrams must live inside the bundle.
- **Chosen approach**: import each diagram HTML with Vite `?raw` and render it with `<iframe srcDoc>`. The diagrams keep their interactivity (focus, zoom, pan, theme toggle, export). Bundle grows by ≈ 1.4 MB; accepted.
- **Theme sync**: the archify page honours `data-theme="light" | "dark"` on its root element (and `prefers-color-scheme`). After the iframe loads, set `data-theme` on the iframe's document element from the panel's `useThemeStore` `resolvedTheme` (`'light' | 'dark'`), and update it whenever the resolved theme changes. The srcdoc document is same-origin, so `iframe.contentDocument` is accessible.
- **Diagram language**: English only — matches the panel's default UI language and the archify viewer's `en` locale. Page chrome (nav label, title, tab titles, intro paragraphs) goes through i18n for `en`, `ru`, `zh-CN`, `zh-TW`.
- **Content**: diagrams describe CURRENT backend behaviour only.
- **Rejected alternatives**:
  - Inline SVG export: far lighter, but loses focus/zoom/theme/export interactivity.
  - Serving the HTML as separate static files: impossible with the single-file panel build.
  - Adding the planned "API mode / target: api fallback" diagram now: that backend feature does not exist yet; its own panel plan will add a third tab later.
- **Verified facts**:
  - `apps/web/src/components/layout/MainLayout.tsx`: `sidebarIcons` record (~line 62) holds nav icons; `navSections` (~lines 577-630) builds the sidebar; the last block holds `/system`. Items use `t('nav.*')` with `shortLabel: navShortLabel(...)`.
  - `apps/web/src/router/MainRoutes.tsx`: routes are `{ path: '/quota', element: <QuotaPage /> }` entries; pages are imported from `@/pages/*`, which re-export feature pages (e.g. `src/pages/SystemPage.tsx` → `@/features/system/SystemPage`).
  - `apps/web/src/stores/useThemeStore.ts`: exposes `theme` (`auto | white | dark`) and `resolvedTheme` (`light | dark`); it sets `data-theme` on `document.documentElement` itself.
  - Wiring tests read sources via `?raw` and assert nav/route strings and i18n keys in all four locales: `src/features/usage-analytics/usageAnalyticsWiring.test.ts`, `src/features/accounts/accountsWorkspaceWiring.test.ts`.
  - Existing iframe usage: `src/features/plugins/PluginResourcePage.tsx` (iframe ref + plugin host style bridge). The guide needs only the theme attribute, not the style bridge.
  - Scripts in `apps/web/package.json`: `npm run build` (`tsc && vite build`), `npm test` (`vitest run`), `npm run lint` (eslint). Known lint warnings are tracked in `docs/backlog/web-lint-warnings.md`; add none.
  - Diagram sources (outside the repo, verified with archify `deliver` 9/9 checks and browser `visual-check` on 1440×900 … 2048×1320):
    - `/Users/echeg/Projects/CPA/diagrams/key-routing.html` (713 KB) + `key-routing.workflow.json`
    - `/Users/echeg/Projects/CPA/diagrams/pool-selection.html` (713 KB) + `pool-selection.workflow.json`

## Context (from discovery)
- Files/components involved:
  - `apps/web/src/components/layout/MainLayout.tsx` (icon + nav item)
  - `apps/web/src/router/MainRoutes.tsx` (route)
  - `apps/web/src/pages/GuidePage.tsx` (new re-export)
  - `apps/web/src/features/guide/` (new: page, diagram frame component, diagram assets, tests, styles)
  - `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json` (`nav.guide`, `guide.*`)
- Related patterns: feature folder + `pages/*` re-export; `*.module.scss` styles; `?raw` imports in tests; `useThemeStore` for theme.
- Dependencies: none new. Vite `?raw` import of `.html` works out of the box; add a `declare module '*.html?raw'` typing only if `tsc` complains (Vite's `client` types already cover `?raw`).

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
  - tests are not optional - they are a required part of the checklist
  - write unit tests for new functions/methods and components
  - update existing test cases if behaviour changes
  - tests cover both success and error scenarios
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- Run tests after each change
- Maintain backward compatibility (no existing route or nav item changes)

## Testing Strategy
- **Unit tests**: Vitest + Testing Library, required for every task (see Development Approach above)
- **Wiring test**: same style as `usageAnalyticsWiring.test.ts` — nav item string in `MainLayout.tsx`, route string in `MainRoutes.tsx`, i18n keys present in all four locales
- **E2E tests**: the project has no browser e2e suite; the build check (`npm run build`, then grep `dist/index.html` for both diagram titles) stands in for an integration check

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): tasks achievable within this codebase - code changes, tests, documentation updates
- **Post-Completion** (no checkboxes): items requiring external action - manual testing, deployment
- **Checkbox placement**: Checkboxes belong only in Task sections. Do not put checkboxes in Success criteria, Overview, Context, or Decisions.

## Implementation Steps

### Task 1: Add diagram assets and the `DiagramFrame` component
- [x] create `apps/web/src/features/guide/diagrams/` and copy into it, byte-for-byte: `/Users/echeg/Projects/CPA/diagrams/key-routing.html`, `key-routing.workflow.json`, `pool-selection.html`, `pool-selection.workflow.json` (the JSON sources are kept for future re-authoring with archify; add a short `README.md` in that folder saying the HTML is generated by archify from the JSON next to it and must not be edited by hand)
- [x] create `apps/web/src/features/guide/DiagramFrame.tsx`: props `{ html: string; title: string }`; renders `<iframe srcDoc={html} title={title}>` with `sandbox="allow-scripts allow-same-origin"` (the archify viewer needs scripts; same-origin is required for the theme attribute), `loading="lazy"`, and a module-scss class giving it full width and a fixed height suited to the diagram (≈ 760px desktop, scaling down on narrow viewports)
- [x] implement theme sync in `DiagramFrame`: read `resolvedTheme` from `useThemeStore`; on iframe `load` and whenever `resolvedTheme` changes, set `iframe.contentDocument?.documentElement.setAttribute('data-theme', resolvedTheme)`; guard against a null document
- [x] write `DiagramFrame.test.tsx`: renders an iframe whose `srcdoc` contains the given html and the given title; after a simulated `load` event with a stubbed `contentDocument`, `data-theme` equals the store's resolved theme; changing the store theme updates the attribute; a missing `contentDocument` does not throw
- [x] run `npm test` in `apps/web` - must pass before task 2

### Task 2: Build `GuidePage` with two tabs
- [x] create `apps/web/src/features/guide/GuidePage.tsx`: page title + subtitle from i18n, a tab strip with two tabs (`key-routing`, `pool-selection`), the active tab's intro paragraph (i18n), and a `DiagramFrame` with the matching `?raw` import (`import keyRoutingHtml from './diagrams/key-routing.html?raw'`); follow the markup/style conventions of an existing tabbed feature page (see `src/features/usage-analytics/UsageAnalyticsPage.tsx` tab strip) and reuse existing tab components/classes when available instead of new ones
- [x] keep only the active tab's iframe mounted (so one archify runtime runs at a time); remember the selected tab in component state only (no persistence)
- [x] create `apps/web/src/pages/GuidePage.tsx` re-exporting `GuidePage` from the feature, matching `src/pages/SystemPage.tsx`
- [x] add i18n keys to all four locale files: `nav.guide` (en "Guide", ru "Гайд", zh-CN "指南", zh-TW "指南") and `guide.title`, `guide.subtitle`, `guide.tabs_label`, `guide.tab_key_routing`, `guide.tab_pool_selection`, `guide.intro_key_routing`, `guide.intro_pool_selection`; intro texts summarise the stages shown in each diagram in two or three sentences (ru written in natural Russian, zh-CN/zh-TW in natural Chinese)
- [x] write `GuidePage.test.tsx`: renders title and both tab labels; the first tab shows an iframe whose `srcdoc` contains "Request routing by client key"; clicking the second tab swaps it for an iframe whose `srcdoc` contains "Credential selection inside the pool"; only one iframe is in the document at a time
- [x] run `npm test` in `apps/web` - must pass before task 3

### Task 3: Wire the nav item and route
- [x] add a `guide` book icon to `sidebarIcons` in `apps/web/src/components/layout/MainLayout.tsx` (inline SVG in the same style and size as the neighbours)
- [x] add the nav item `{ path: '/guide', label: t('nav.guide'), shortLabel: navShortLabel('nav.guide', t('nav.guide')), icon: sidebarIcons.guide }` to the last `navSections` block, directly after the `/system` item
- [x] add `{ path: '/guide', element: <GuidePage /> }` to `apps/web/src/router/MainRoutes.tsx`, importing `GuidePage` from `@/pages/GuidePage`
- [x] write `apps/web/src/features/guide/guideWiring.test.ts` in the style of `usageAnalyticsWiring.test.ts`: asserts the nav item source string and the route source string, and that every `nav.guide` / `guide.*` key exists in `en`, `ru`, `zh-CN`, `zh-TW`
- [x] run `npm test` in `apps/web` - must pass before task 4

### Task 4: Verify acceptance criteria
- [x] verify all requirements from Overview are implemented (nav item in last block, `/guide` route, two tabs, intro texts, iframes with theme sync)
- [x] verify edge cases: the iframe `load` fires before the theme effect, theme switches `auto → dark → white`, narrow viewport layout does not overflow horizontally (load-order and theme-before-load cases added to `DiagramFrame.test.tsx`; `DiagramFrame.themeStore.test.tsx` drives the real `useThemeStore` through auto → dark → white and auto-with-dark-system; narrow layout checked from the styles: iframe `width: 100%`, page/panel `min-width: 0`, the `SegmentedTabs` strip scrolls with `overflow-x: auto`, iframe height steps down 760 → 680 → 560px; the in-browser check is in Post-Completion)
- [x] run the full `apps/web` test suite (`npm test`) — 316 files, 5201 tests passed
- [x] run `npm run lint` in `apps/web` - no new warnings compared with `docs/backlog/web-lint-warnings.md` (0 errors, the same 7 known warnings)
- [x] run `npm run build` in `apps/web` and verify `dist/index.html` contains both strings "Request routing by client key" and "Credential selection inside the pool"; note the resulting `dist/index.html` size in the plan (expected ≈ 8.3 MB) — both strings found (4 matches each); `dist/index.html` is 8,296,075 bytes (≈ 8.3 MB, gzip ≈ 2.1 MB)

### Task 5: Update documentation
- [x] add a short "Guide" entry to the panel's user-facing docs if a features list exists (README or `docs/`), stating that the diagrams are generated with archify from the JSON sources in `src/features/guide/diagrams/` (new manual pages `apps/docs/en/manual/guide.md` and `apps/docs/manual/guide.md`, linked in the VitePress sidebar after System)
- [x] update project knowledge docs (CLAUDE.md or equivalent) with the pattern "bundled self-contained HTML via `?raw` + `iframe srcDoc` with theme sync" if no such note exists (no CLAUDE.md in this repo; added `docs/development/bundled-html-frames.md` and linked it from `CONTRIBUTING.md`)

## Technical Details
- **Assets**: `apps/web/src/features/guide/diagrams/{key-routing,pool-selection}.html` (~713 KB each) imported as strings via `?raw`; Vite inlines them into the single-file bundle.
- **`DiagramFrame` theme sync**:
  ```ts
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme); // 'light' | 'dark'
  const apply = () => iframeRef.current?.contentDocument?.documentElement.setAttribute('data-theme', resolvedTheme);
  useEffect(apply, [resolvedTheme]);           // theme changes after load
  <iframe ref={iframeRef} onLoad={apply} srcDoc={html} title={title} sandbox="allow-scripts allow-same-origin" />
  ```
- **Tabs**: ids `key-routing` and `pool-selection`; only the active diagram's iframe is mounted.
- **i18n keys**: `nav.guide`, `guide.title`, `guide.subtitle`, `guide.tabs_label`, `guide.tab_key_routing`, `guide.tab_pool_selection`, `guide.intro_key_routing`, `guide.intro_pool_selection`.
- **Nav placement**: last `navSections` block, after `/system`.

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- Open `/guide` in the running panel, switch Light/Dark/Auto in the header and confirm the diagram follows; use the diagram's own focus/zoom/export controls; check the page on a ~1280px wide window.
- Confirm the sidebar shows "Guide"/"Гайд"/"指南" when switching the panel language.

**Deployment**:
- Panel-only deploy per the local launchd procedure (build web, copy `dist/index.html` to a new `releases/panel-<name>-<date>/management.html`, back up the plist, switch `PANEL_PATH`, bootout/bootstrap).

**Follow-up (separate plan)**:
- When the backend ships the API-mode / `target: api` fallback feature, add its diagram (`/Users/echeg/Projects/CPA/diagrams/key-routing-fallback.workflow.json`, currently in Russian; re-author in English) as a third tab.
