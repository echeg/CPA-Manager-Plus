# Report: 2026 11 05 cpa logs storage card
plan: /Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/cpa-logs-storage-card/docs/plans/20261105-cpa-logs-storage-card.md | branch: cpa-logs-storage-card | base: main | mode: full | executor: claude | task model: claude:opus:high | review model: claude:opus:xhigh | started: 2026-11-05T20:32:30Z | finished: 2026-11-05T21:48:57Z

## Summary
- task iterations: 7
- failed retries: 0
- external reviewers: 1
- post-review iterations: 1
| phase | duration_ms |
|---|---:|
| evaluation | 924080 |
| external review | 377179 |
| internal review | 1967706 |
| other | 0 |
| tasks | 1317616 |

## Change scope
- commits: 9
- files: 25
- additions: 1632
- deletions: 163
| status | path |
|---|---|
| M | README.md |
| M | apps/docs/deployment/reverse-proxy.md |
| M | apps/docs/en/deployment/reverse-proxy.md |
| M | apps/docs/en/operations/manager-server.md |
| M | apps/docs/operations/manager-server.md |
| A | apps/web/src/features/demo/demoApi.logStorage.test.ts |
| M | apps/web/src/features/demo/demoApi.ts |
| M | apps/web/src/features/usage-maintenance/UsageMaintenanceArchiveViews.module.scss |
| A | apps/web/src/features/usage-maintenance/UsageMaintenanceArchiveViews.test.tsx |
| M | apps/web/src/features/usage-maintenance/UsageMaintenanceArchiveViews.tsx |
| M | apps/web/src/features/usage-maintenance/UsageMaintenancePage.test.tsx |
| M | apps/web/src/features/usage-maintenance/UsageMaintenancePage.tsx |
| A | apps/web/src/features/usage-maintenance/cpaLogStorage.client.test.ts |
| A | apps/web/src/features/usage-maintenance/cpaLogStorage.test.ts |
| A | apps/web/src/features/usage-maintenance/cpaLogStorage.ts |
| M | apps/web/src/features/usage-maintenance/usageMaintenanceWiring.test.ts |
| M | apps/web/src/i18n/locales/en.json |
| M | apps/web/src/i18n/locales/ru.json |
| M | apps/web/src/i18n/locales/zh-CN.json |
| M | apps/web/src/i18n/locales/zh-TW.json |
| A | apps/web/src/utils/format.test.ts |
| M | apps/web/src/utils/format.ts |
| A | docs/backlog/web-lint-warnings.md |
| M | docs/personal-quota.md |
| M | docs/plans/20261105-cpa-logs-storage-card.md |

## Evidence
_assessment unavailable_

## Risk
_assessment unavailable_

## Merge danger
_assessment unavailable_

## Migrations and operational steps
_assessment unavailable_

## Plan deviation
_assessment unavailable_
### Added
- ➕ `logStorage` / `onOpenConfig` were optional on `UsageMaintenanceOverviewView` until Task 3 wired them; the code review made them required (the page is the only caller). No existing `iconWrap` color or `reclaimHighlight` variant fit a warning, so the card adds `.iconAmber` and a `.warningHighlight` amber modifier; its sub-lines use a `.cardSubWrap` modifier so the longer facts wrap instead of being cut off at five columns. ⚠️ The viewport breakpoints ignored the 280px sidebar (at 1120px each of five cards had ~104px inside, hiding titles), so the column count now follows the summary's own width via an `usage-summary` container query: 5 columns from 1240px (the longest title, ru "Размер файлов SQLite", needs ~192px beside the icon), then 3 / 2 / 1 below 1240 / 760 / 480px; `.cardHeader` wraps so a wide chip ("View offline compaction") drops below the title instead of hiding it. Locale keys used: `cpa_logs`, `cpa_logs_open_config`, `cpa_logs_files` ({{count}}), `cpa_logs_limit` ({{limit}}), `cpa_logs_no_limit`, `cpa_logs_request_log_on/off`, `cpa_logs_retention` ({{oldest}}, {{days}}), `cpa_logs_per_day` ({{size}}), `cpa_logs_loading`, `cpa_logs_unsupported`, `cpa_logs_error` ({{message}}), `cpa_logs_refresh_error` ({{message}}), `cpa_logs_warning_unbounded`, `cpa_logs_warning_near_limit` ({{used}}, {{limit}})
- ➕ while a refresh is in flight the card keeps its previous state (no flash back to loading). Per `docs/development/data-loading-and-refresh.md`, a failed refresh keeps the last `ready` snapshot with an inline `refreshError` (only a first load shows the `error` state), and a connection change resets the card to `loading` and invalidates its in-flight request so the previous connection's size never shows.
- ➕ the existing `usage_maintenance` parity test only compares key sets against `en`; added `usageMaintenanceWiring.test.ts` checks that every `cpa_logs*` key the card source uses exists in all four locales with the same `{{placeholders}}`, plus a label test. Page tests resolve real `en` strings, so two Task 3 assertions were updated to the translated text.
- ➕ the v8 quota client sends every call through `requestRaw`, so only `handleDemoRawRequest` serves the route (`handleDemoApiRequest` is never reached). ⚠️ 380 MB of 512 MB is 74%, under the 90% threshold, so the fixture uses ~470 MB capped (≈92%) to actually show the near-limit warning; `request_log`/`logging_to_file`/`limit_mb` pass straight through from the current demo config (the base fixture always supplies them). `check:demo-isolation` needs a built bundle, so run `npm run build` first.
- ➕ lint: 0 errors; 7 pre-existing warnings in files this branch does not touch (AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx, UsageMaintenanceCapabilityViews.tsx) filed as `docs/backlog/web-lint-warnings.md`. Type-check, 309 files / 5132 tests and build pass; every Overview requirement and edge case has code and a test.
- ➕ neither `apps/docs/operations/configuration.md` nor its `en` copy describes log settings (they cover Manager Server env vars only), so both were skipped as the item allows. The endpoint, the total-size meaning of `logs-max-total-size-mb`, the warning rules, the 404 fallback and the demo route are documented in a new "CPA logs storage" section of `docs/personal-quota.md`, which already lists this fork's v8 endpoints.
### Blocked
- none
### Skipped
- none

## Backlog
| status | path | title |
|---|---|---|
| A | docs/backlog/web-lint-warnings.md | Pre-existing web lint warnings |

## External review
### codex:gpt-6-astra:xhigh
- label: codex
- iterations: 2
- duration_ms: 1301222
- ended by: done
- had findings: true
#### Iteration 1
- truncated: false
Reviewer output:
```
- **[P2] Five columns collapse card headers at laptop widths** — [UsageMaintenanceArchiveViews.module.scss:14](/Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/cpa-logs-storage-card/apps/web/src/features/usage-maintenance/UsageMaintenanceArchiveViews.module.scss:14). With the default 280px sidebar and a 1120px viewport, each card has about 105px of inner width. The icon, gaps, and Settings button consume that space, hiding the title; longer translations overflow. Wrapping sub-lines does not fix the header. Reflow headers or switch columns based on available content width.

- **[P3] Demo ignores canonical v8 logging settings** — [demoApi.ts:698](/Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/cpa-logs-storage-card/apps/web/src/features/demo/demoApi.ts:698). Saving `observability.logs` with both logging flags disabled and the limit set to zero still returns `512`, `true`, and `true`. The fixture reads legacy root defaults instead of the canonical settings supported by the config editor, producing an incorrect near-limit warning.

- **[P3] Negative demo limits still break the card** — [demoApi.ts:698](/Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/cpa-logs-storage-card/apps/web/src/features/demo/demoApi.ts:698). This previously recorded issue remains reproducible: saving `logs-max-total-size-mb: -1` produces “Invalid CPA log storage response.” Real CPA normalizes negative limits to zero. Apply equivalent normalization before constructing the demo response.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the external findings rigorously.Checking layout math (sidebar width, page padding) to verify the five-column claim, then the demo config path for the other two findings.Making the demo fix first: read `observability.logs.<key>` before the legacy root key (as CPA does), and clamp the limit to a non-negative integer.Now the demo tests: canonical v8 settings, canonical over legacy precedence, and a negative limit.Before editing the styles, I'll start the demo dev server so I can measure the real header layout at 1120px, before and after the change.Only this file uses the module. Editing the SCSS:Now replacing the viewport rules for `.summary` with container queries.Now closing the wrapper after `</dl>`:The large TSX diff is only Prettier re-indenting the cards inside the new wrapper. Re-measuring in the browser at several widths:3 columns at 1120px, no titles clipped, and the Reclaimable chip wraps under its title. The "Online details" header still reports overflow, so I'm checking what causes it, plus the 2 console errors.5 columns at 1600px (200px inner each), nothing clipped. Checking the narrow end and the 1200px threshold, then Russian, which has the longest strings.At exactly 1200px of container width (5 columns, 185px inner), the en headers fit. Switching to Russian:The language setting didn't apply in demo mode, so I'll put the Russian strings into the DOM directly to measure layout:Re-measuring across widths with the Russian strings injected, which are the worst case:Fresh load with no console errors. Measuring English at several widths:That's real Russian now: the earlier localStorage change took effect on the full reload, and it matches the injected run. Switching back to English and sweeping the widths:English at 1240px: every title is beside its icon and unclipped; only the long "View offline compaction" chip wraps. Sweeping the remaining widths in one script:No clipped titles or overflowing cards at any width from 1920 down to 390. One screenshot at 1120px to check the result visually:`.playwright-mcp/` is gitignored, but I created it, so I'll remove it, close the browser, and stop the dev server before running the checks.The dev server's exit code 143 is the SIGTERM from my own `kill`, so that's expected. Using superpowers:verification-before-completion before I report the fixes as done.Proving the new demo tests are real regressions: run them against the old `demoApi.ts` (they should fail), then restore the fix.All 3 new tests fail on the old code and the fix is restored. Now the plan's full validation set: type-check, lint, the whole web suite, the build, and the demo isolation check.All three findings were valid and are fixed in the working tree, uncommitted as the loop requires. Nothing was dismissed or filed to the backlog.

- [P2] Five columns collapse card headers (UsageMaintenanceArchiveViews.module.scss:14): fixed. I reproduced it in the demo app at a 1120px viewport: each card had 104px of inner width, the "CPA logs" and "Reclaimable" titles rendered 0px wide, and the Reclaimable header needed 213px. The four-column layout already overflowed for the "View offline compaction" chip.
  - Columns now follow the summary's own width instead of the viewport. A new wrapper div (UsageMaintenanceArchiveViews.tsx) is a size container, and container queries set 5 columns from 1240px, 3 below 1240, 2 below 760 and 1 below 480. 1240 is where five cards fit the longest shipped title (Russian "Размер файлов SQLite", 148px) beside the icon. The old viewport rules for the summary are removed.
  - Card headers now wrap. A chip that doesn't fit drops below the title, the title stays beside the icon, a title too long for its row gets an ellipsis, and a chip too wide for the card is truncated.
  - The container is a dedicated wrapper rather than .view, because containment can make an element the containing block for positioned descendants, and .view holds more than the cards.
  - Checked in the browser at 1920, 1568, 1566, 1120, 900, 768, 600 and 390px in English, and at the 1240px threshold in Russian too: no title clipped or pushed off the icon row, no chip clipped, no card overflow. The plan's Task 2 note records the change from viewport breakpoints.
- [P3] Demo ignores canonical v8 logging settings (demoApi.ts:698): fixed. Real CPA lets observability.logs.<key> win when present and falls back to the legacy root key (CLIProxyAPI-migration internal/config/config_v8.go:190, flattenV8). A new readDemoLogsSetting helper does the same for the limit, request-log and logging-to-file. Both flags are now strict booleans.
- [P3] Negative demo limits break the card (demoApi.ts:698): fixed. CPA turns negative limits into 0 (parse.go:96, config_load.go:152). The demo limit is now a non-negative integer, and a missing or non-numeric value becomes 0 (no limit).

Tests and checks:
- demoApi.logStorage.test.ts has 3 new tests: canonical settings with both flags off and limit 0, canonical winning over legacy root keys, and a negative limit becoming 0. All 3 fail against the old demoApi.ts and pass with the fix.
- type-check and lint exit 0; lint has 0 errors. The full web suite passes (311 files, 5149 tests), as do the build and the demo isolation check.
- Lint still shows 7 warnings, all in files this branch doesn't touch. I left them because the plan's Task 6 filed them on purpose in docs/backlog/web-lint-warnings.md, and fixing them means editing four unrelated files, one of them a hook dependency that changes behavior.

Insight:
- Viewport breakpoints don't account for a fixed sidebar. At 1120px the content area is about 790px, so "5 columns above 1100px" really meant cards about 145px wide. A container query keyed to the grid's own width removes that coupling, and also adapts when the sidebar is hidden on mobile.
- Flex-wrap only kicks in when an item's starting width is its natural width. The old title used flex: 1, which starts at zero, so the title could always shrink to nothing and nothing ever wrapped. Switching to flex: 1 1 auto, with a max-width so the title stays beside the icon, makes the chip move down instead.
- The demo now resolves v8 config keys the way the backend does. Otherwise the demo shows near-limit warnings for settings the config editor has already changed.
```
#### Iteration 2
- truncated: false
Reviewer output:
```
NO ISSUES FOUND.

All three previous findings are correctly fixed: responsive card headers, canonical v8 configuration precedence, and negative-limit normalization. No regressions found in the current diff.

```
Evaluator response:
```
Codex found no issues, so I'll review what's uncommitted and commit this loop's fixes. First I'm loading the verification skill, since this step ends in a commit.All five dirty paths trace back to the three findings Codex confirmed as fixed. There are no untracked files. Before committing I'll run the tests, lint, type-check and build fresh.Codex found no issues this time and confirmed the three earlier fixes hold: card headers that adapt to width, the v8 config taking priority over the old root keys, and negative limits treated as "no limit". The accumulated fixes are now committed as 7941cbd0, "fix: address codex review findings".

What went into the commit (5 files, all from this review loop, no new files):
- UsageMaintenanceArchiveViews.tsx and .module.scss: the summary cards now pick their column count from their own width instead of the screen width, so the 280px sidebar no longer squeezes five cards until titles disappear. Card headers wrap so a wide action button drops below the title.
- demoApi.ts and demoApi.logStorage.test.ts: demo mode reads the logs settings from observability.logs first, and from the old root keys only when the new key is absent. A negative or missing size limit becomes 0 (no limit). Three new tests cover this.
- docs/plans/20261105-cpa-logs-storage-card.md: a note in Task 2 explaining the column-count change.

Checks run just before the commit:
- npm test: web 311 files / 5149 tests passed, repo 16 files / 266 tests passed
- npm run type-check: exit 0
- Prettier: the changed files are formatted correctly
- npm run lint: exit 0, 0 errors, 7 warnings. All 7 are in files this branch didn't touch (AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx, UsageMaintenanceCapabilityViews.tsx), and docs/backlog/web-lint-warnings.md, committed earlier on this branch, already lists them, so I left them alone.

The working tree is clean after the commit.

Insight: the column-count fix uses CSS container queries rather than media queries. A media query checks the browser window width, but these cards sit next to a fixed 280px sidebar, so the window width overstated their space. A container query checks the width of the wrapper the cards are in. The demo-config fix copies the backend's rule: the new observability.logs key wins whenever it is present, even if its value is false or 0.

<<<RALPHEX:EXTERNAL_REVIEW_DONE>>>
```

## Validation
- `npm run type-check`
- `npm run lint`
- `npm run test:web`
- duration_ms: 526966
- runs: 14