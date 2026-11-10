# Report: Guide section with interactive routing diagrams
**Plan:** `docs/plans/20261110-guide-section-routing-diagrams.md` · **Branch:** `guide-section-routing-diagrams` · **Base:** `main` · **Mode:** full · **Executor:** claude · **Task model:** claude:opus:high · **Review model:** claude:opus:xhigh · **Started:** 2026-11-10T14:25:48Z · **Finished:** 2026-11-10T15:31:48Z

## Summary
The panel now has a top-level **Guide** section. It has a book icon and a `/guide` route, and it sits in the last sidebar block, directly after System Info. The page has two tabs, built with the existing `SegmentedTabs`. Each tab shows a short translated intro and one interactive archify diagram:
1. **Request routing by client key**: routing profile → sticky session → preferred account → pool selection → Claude → Codex fallback.
2. **Credential selection inside the pool**: availability filter → preferred account → primary slot → tiebreak slot → picker → selected credential.

How it works:
- **Bundling:** each diagram HTML file is imported with `?raw` and rendered in an `<iframe srcDoc>` by `DiagramFrame`. Only the active tab's iframe is mounted.
- **Theme sync:** `DiagramFrame` follows the panel's resolved theme in three ways:
  - it writes `localStorage['archify-theme']` from a layout effect, so the diagram's first paint already uses the panel theme;
  - after load, it switches theme through `Archify.theme.toggle()`, so the viewer's toolbar label stays in step;
  - it then sets `data-theme` directly if the theme still doesn't match.
- **No external requests:** `GuidePage` removes the Google Fonts `<link>`s from the diagram HTML before rendering it.
- **Translations:** page text uses i18n in `en`, `ru`, `zh-CN` and `zh-TW`.
- **Documentation:** new manual pages in English and Chinese, a sidebar entry in the docs site, a developer note on the bundled-HTML iframe pattern, and the archify MIT notices in `LICENSE`.

Run shape:
- 5 task iterations with 0 failed retries.
- Internal review ran 1 loop iteration and ended by `review_done`. Post-review ran 1 iteration.
- External review (codex) ran 3 iterations. It found two problems in the pool-selection diagram's empty-pool error text, both fixed (see External review).

Phase durations (total 3,960,239 ms, about 66 min, which matches start → finish):

| phase | duration_ms | ≈ |
|---|---:|---|
| tasks | 907057 | 15m 07s |
| internal review | 1953737 | 32m 34s |
| evaluation | 647209 | 10m 47s |
| external review | 452236 | 7m 32s |
| other | 0 | 0s |

Finalize did not run, so there was no base sync. `main`, `origin/main` and the merge-base are the same commit (`1def60a5`), so the diff against `main` shows exactly the delivered work.

## Change scope
- **Diff:** 29 files, +31,172 / −24.
  - The two generated diagram pages account for 29,674 of the added lines: `key-routing.html` (+14,839) and `pool-selection.html` (+14,835), about 713 KB each.
  - The remaining ~1,500 added lines are source, tests, JSON sources, i18n and docs.
  - All 24 deleted lines are in the plan file (checkboxes ticked, one manual-verification line rewritten). No existing code was removed.
- **New feature code** (`apps/web/src/features/guide/`):
  - `DiagramFrame.tsx` (+72) and `GuidePage.tsx` (+82), each with a `.module.scss` (+16 / +46)
  - `pages/GuidePage.tsx`, a one-line re-export
- **Tests** (+610 lines):
  - `DiagramFrame.test.tsx` (10 cases)
  - `DiagramFrame.themeStore.test.tsx` (4 cases, against the real `useThemeStore`)
  - `GuidePage.test.tsx` (7 cases, including checks of the archify theme contract)
  - `guideWiring.test.ts` (4 cases)
- **Diagram assets:** two `*.html` pages, two `*.workflow.json` sources (+219 each) and `diagrams/README.md` (+39).
- **Wiring:**
  - `MainLayout.tsx` (+8): icon entry and nav item
  - `icons.tsx` (+15): new `IconSidebarGuide`
  - `MainRoutes.tsx` (+2): import and route
  - four locale files (+10 each): `nav.guide` and the `guide.*` keys
- **Docs:**
  - `apps/docs/en/manual/guide.md` and `apps/docs/manual/guide.md` (+18 each)
  - `.vitepress/config.ts` (+2): sidebar links
  - `docs/development/bundled-html-frames.md` (+51)
  - `CONTRIBUTING.md` (+2): link to the new note
  - `docs/personal-quota.md` (+9): Guide paragraph
  - `LICENSE` (+2): archify and Cocoon AI copyright lines
  - plan file (+27 / −24)
- **Commits (7):**
  - `68e87ea0` feat: add guide diagram assets and DiagramFrame component
  - `5fb35bee` feat: add GuidePage with routing diagram tabs and i18n
  - `f1929c3b` feat: wire Guide nav item and /guide route
  - `12de084e` feat: verify guide acceptance criteria and add theme sync edge-case tests
  - `b60a6d7a` feat: document the Guide page and the bundled HTML iframe pattern
  - `2b8e0e2a` fix: address code review findings (17 files, +387 / −102)
  - `21674b5c` fix: address codex review findings (8 files, +15 / −11)

## Evidence
none

The run recorded no validation commands, so there is no deterministic before/after proof. The diff adds 25 new test cases for a feature that did not exist before. Their results are reported only by the agents, not by the run facts:
- the plan's Task 4 notes say 316 files and 5,201 tests passed, `npm run lint` gave 0 errors and the same 7 known warnings, and `dist/index.html` is 8,296,075 bytes and contains both diagram titles;
- the codex evaluator transcripts say 316 files and 5,214 tests passed after the review fixes.

## Risk
**low**

- **Public APIs:** nothing changes on the backend or the management API. The panel gains one new route, `#/guide`. Existing routes and nav items are untouched; the new item is appended after `/system`, and the wiring test asserts that position.
- **Data schemas:** none. The locale files only gain keys.
- **Configuration:** none on the server or in config files. In the browser, the panel origin gets one new `localStorage` key, `archify-theme`. Only the diagram viewer reads it.
- **Concurrency:** none on the server. On the client, the ordering between the iframe's `load` event and the theme effect is a real race, and dedicated tests cover it (stale load handler, theme change before load, live change of the system theme).
- **Migrations:** none.
- **Main things to watch:**
  - **Sandbox is effectively off.** The sandbox is `allow-scripts allow-same-origin allow-downloads allow-modals`, and with both scripts and same-origin allowed it doesn't isolate anything. The bundled archify viewer script (about 713 KB per page) runs with the panel origin's privileges, including access to the panel's `localStorage`. This is acceptable because the content is static, committed and generated from repo JSON by a pinned archify version (2.16.0), and the remote font links are removed. Any future regeneration of a diagram should be reviewed like code.
  - **Bundle size.** The bundle grows by about 1.4 MB (`dist/index.html` is about 8.3 MB, about 2.1 MB gzipped, per the plan). The `?raw` imports are static, so every panel load carries the diagrams, whether or not the Guide is opened.
  - **Content drift.** The diagrams describe the custom backend's current routing. They will go stale if the selector or fallback logic changes.

## Merge danger
**Door:** two-way
A plain revert removes the route, the nav item and all new files. The only thing left behind is a stray `archify-theme` key in browsers' `localStorage`, which nothing else reads.

**Blast radius:** panel
The change adds one isolated page. The only effect on the rest of the panel is the extra sidebar item and about 1.4 MB more inline HTML on every panel load.

## Migrations and operational steps
- **Database:** none
- **Configuration:** none
- **Data:** none
- **Deployment:** rebuild `apps/web` and do a panel-only deploy with the local launchd procedure: copy `dist/index.html` to a new `releases/panel-<name>-<date>/management.html`, back up the plist, switch `PANEL_PATH`, then bootout and bootstrap. The backend does not need to change.
- **Manual checks after deploy** (the plan's Post-Completion list):
  - The diagram follows Light, Dark and Auto, including the label on the diagram toolbar.
  - Focus and zoom work, and a PNG export starts a download.
  - The page works at about 1280px wide. At tablet and mobile widths there is no horizontal overflow, the tab strip scrolls, and the frame height drops to 680/560px.
  - No requests go to `fonts.googleapis.com` or `fonts.gstatic.com`.
  - The sidebar label is localized: "Guide", "Гайд", "指南".
- **Housekeeping (outside the repo):** the repo's `pool-selection.html` and `pool-selection.workflow.json` were regenerated during external review. They no longer match the originals in `/Users/echeg/Projects/CPA/diagrams/` (checked with `cmp`), while the `key-routing.*` files are still byte-identical. Copy the newer pool-selection files back there if that folder stays the place where diagrams are authored.

## Plan deviation
The run facts list no added, blocked or skipped items. All five tasks are checked off in the plan. The implementation differs from the plan's wording as follows; the plan file records each of these:
- **Byte-for-byte copy no longer holds for one diagram.** Task 1 copied all four diagram files unchanged. After the codex findings, `pool-selection.workflow.json` was corrected and `pool-selection.html` was regenerated with archify 2.16.0 (`deliver --quality showcase`: 9/9 checks passed). `key-routing.*` remain exact copies.
- **Sandbox.** The plan specified `allow-scripts allow-same-origin`. Code review added `allow-downloads allow-modals` so that archify's export and its error alerts work.
- **Theme sync.** The plan's design was `useEffect` plus `setAttribute('data-theme')`. The final design uses a `useLayoutEffect` that writes `localStorage['archify-theme']` before the first paint, then calls `Archify.theme.toggle()` on a mismatch after load, with `setAttribute` as the fallback.
- **Remote fonts.** Not in the plan: `GuidePage` removes the Google Fonts `<link>`s, so the Guide makes no third-party requests.
- **Icon.** The plan asked for an inline SVG in `sidebarIcons`. It was added as a reusable `IconSidebarGuide` in `components/ui/icons.tsx`, which is where the neighbouring sidebar icons live, and `sidebarIcons.guide` uses it.
- **Docs, beyond the plan's Context list (fulfilling Task 5):**
  - English and Chinese manual pages, linked in the VitePress sidebar
  - `docs/development/bundled-html-frames.md`, linked from `CONTRIBUTING.md` (the repo has no `CLAUDE.md`)
  - a Guide paragraph in `docs/personal-quota.md` (added during code review)
  - the archify and Cocoon AI copyright lines in `LICENSE` (added during code review)
- **Narrow-viewport check.** Task 4 verified the narrow layout from the styles only. The in-browser check was moved to Post-Completion.
- **Test count.** The plan records 5,201 tests. The evaluator later reported 5,214 after the code-review tests were added.

## Backlog
There were no backlog entries. The codex evaluator noted that the 7 existing lint warnings are already tracked in `docs/backlog/web-lint-warnings.md` and filed nothing new.

## External review
### codex:gpt-6-astra:xhigh
- label: codex
- iterations: 3
- duration_ms: 1099401
- ended by: done
- had findings: true

Findings:
- **[P2] Distinguish unavailable credentials from cooldowns** (`pool-selection.workflow.json:132`): the diagram labelled every empty pool as a cooldown with `Retry-After` → **fixed**.
  - The "No credential" node now covers both cooldown and unavailable errors.
  - The "Availability first" card says 429 with `Retry-After` applies only when every credential is cooling down or hard-reserved, and `auth_unavailable` otherwise.
  - The HTML was regenerated, and the intros in the four locales and both manual pages were updated.
- **[P3] Include the zero-candidate error** (`pool-selection.workflow.json:198`): `auth_not_found` with no `Retry-After` was missing → **fixed**.
  - The node now reads "not found · cooldown · unavailable", and the card lists `auth_not_found` separately.
  - The wrong "all credentials disabled → auth_unavailable" example was replaced with "expired or rejected tokens". Credentials turned off in the panel are dropped before selection, so they produce `auth_not_found`.
  - The HTML was regenerated, and the intros and manuals were updated again.
- Iteration 3: `NO ISSUES FOUND`. Both fixes were committed together as `21674b5c`.

## Validation
- Commands: none
- Timings: duration_ms 0, runs 0

The run itself recorded no validation commands. The test, lint and build results quoted under Evidence come only from the plan notes and the evaluator transcripts.