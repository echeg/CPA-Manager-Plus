# CPA logs storage card on Usage maintenance

## Overview
- Add a fifth summary card, "CPA logs", to the overview of `#/usage-maintenance` (tab `organize`). It shows how much disk the CPA logs directory takes, using the new CPA endpoint `GET /v8/management/observability/logs/storage` (deployed on 2026-11-05 in CLIProxyAPI-migration `v8.0.10-personal.logs-storage.20261105`).
- Problem: today the panel shows no log size anywhere, and the System configuration label "Log File Size Limit (MB)" for `logs-max-total-size-mb` is misleading, because the cap is the TOTAL size of the logs directory, not a per-file limit.
- The card is read-only: value = total size; sub-line = file count, limit (or "no limit"), request-log on/off, the retention span (oldest → newest) and an approximate growth per day; an action chip opens `/config`. A warning appears when request logging is on without a limit, or when capped files use ≥ 90% of the limit.
- Old CPA builds without the endpoint answer 404: the card then shows "—" and a hint that CPA needs an update. The card never blocks or breaks the rest of the page.

## Decisions
- **Context**: the backend endpoint exists; the panel needs a place to show it. The user picked the Usage maintenance page and a read-only card ("Только показ") over an editable limit control.
- **Chosen approach**: a separate fetch through the existing v8 quota client (`createQuotaRequestConfig` pins `${base}/v8/management` and the captured admin key), run independently of the page's `Promise.all` of `getUsageMaintenance` + `listUsageArchives`, with its own `AbortController`. The card renders inside `UsageMaintenanceOverviewView`'s summary `<dl>` with the same `summaryCard` markup as the four existing cards.
- **Rejected alternatives**:
  - Editing `logs-max-total-size-mb` from the card: rejected by the user; editing stays on `/config`.
  - Adding the request to the page's `Promise.all`: a missing or failing CPA endpoint would mark the whole page unsupported or errored.
  - Routing the call through the manager server (`usageServiceApi`): the data lives in CPA, and the v8 client already reaches it (CPAMP proxies `/v8/management/*` to CPA; verified 200 on :18318 on 2026-11-05).
  - A `directory_present` flag: the endpoint does not send one; a missing directory is reported as zeros with `null` timestamps.
- **Verified facts**:
  - Response shape (live, 2026-11-05): `{"total_bytes":185068097,"total_files":15,"capped_bytes":183686396,"capped_files":12,"oldest_modified_at":"2026-10-07T07:21:57Z","newest_modified_at":"2026-11-05T19:17:08Z","limit_mb":0,"request_log":false,"logging_to_file":false}`. Timestamps are UTC RFC 3339 or `null`; all keys are always present.
  - `capped_*` are the top-level `*.log`/`*.log.gz` files the size cleaner counts toward `limit_mb`; `total_*` is every regular file in the tree. `limit_mb: 0` means no limit.
  - Errors: 404 on CPA builds without the route; 500 `{"error": ...}` on a scan failure; 503 when CPA has no config.
  - `features/personal-quota-support/services/api/routingProfiles.ts:246-253` is the established 404 → unsupported pattern (`isRecord(error) && error.status === 404`).

## Context (from discovery)
- Files/components involved:
  - `apps/web/src/features/usage-maintenance/UsageMaintenanceArchiveViews.tsx` — `UsageMaintenanceOverviewView` (line ~111), summary `<dl>` of four `summaryCard`s (lines ~140-250): `cardHeader`, `iconWrap` + color class, `cardTitle`, `actionChip`, `cardBody`, `cardValue`, `cardSub`, `reclaimHighlight`; `stale ? '—' : …`; `formatFileSize` / `formatDateTime` from `@/utils/format`.
  - `apps/web/src/features/usage-maintenance/UsageMaintenanceArchiveViews.module.scss` — `.summary` is `repeat(4, minmax(0, 1fr))` (line 12), 2 columns under 1100px (line 1421), 1 column under 768px (line 1433).
  - `apps/web/src/features/usage-maintenance/UsageMaintenancePage.tsx` — `load()` (lines ~814-880) with `loadControllerRef`/`loadGenerationRef`, `Promise.all` at line ~847; `useNavigate` at line 373; overview rendered at line ~2011.
  - `apps/web/src/features/personal-quota-support/services/api/client.ts` — `apiClient.get(url, config)` for v8 requests (`createQuotaRequestConfig`, line 38).
  - `apps/web/src/features/demo/demoApi.ts` — `handleDemoRawRequest` (line ~681) serves raw (v8 quota client) requests in demo mode; `handleDemoApiRequest` (line 502).
  - `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json` — `config_management.visual.sections.system.logs_max_size` (en line 4310, ru 4309, zh-CN 4305, zh-TW 4305) and the `usage_maintenance.*` namespace.
  - Icons: `IconScrollText`, `IconFileText`, `IconHardDrive` in `apps/web/src/components/ui/icons.tsx`.
- Related patterns found:
  - Tests: `UsageMaintenancePage.test.tsx` mocks `react-i18next`, `react-router-dom` (`useNavigate`) and `usageServiceApi` via `vi.hoisted`; `routingProfiles.test.ts` covers the 404 pattern; demo fixtures have `demoFixtures.*.test.ts` and `demoApi.*.test.ts`.
  - Locale parity is checked by existing tests (e.g. `features/config/ConfigPage.test.ts` reads the locale files).
- Dependencies identified: CPA must run the build with the logs storage route; nothing in `apps/manager-server` changes.

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
  - tests are not optional - they are a required part of the checklist
  - write unit tests for new functions/methods
  - write unit tests for modified functions/methods
  - add new test cases for new code paths
  - update existing test cases if behavior changes
  - tests cover both success and error scenarios
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- Run tests after each change
- Maintain backward compatibility

## Testing Strategy
- **Unit tests**: required for every task (see Development Approach above). Vitest + Testing Library, following `UsageMaintenancePage.test.tsx` and `routingProfiles.test.ts`.
- **E2E tests**: the web app has no Playwright/Cypress suite; none to add.

## Validation Commands
Run from the repository root:
- `npm run type-check`
- `npm run lint`
- `npm run test:web`

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): tasks achievable within this codebase - code changes, tests, documentation updates
- **Post-Completion** (no checkboxes): items requiring external action - manual testing, changes in consuming projects, deployment configs, third-party verifications
- **Checkbox placement**: Checkboxes belong only in Task sections (`### Task N:` or `### Iteration N:`). Do not put checkboxes in Success criteria, Overview, Context, Decisions, or Decision Log — they cause extra loop iterations.

## Implementation Steps

### Task 1: CPA log storage service and pure helpers
- [x] create `apps/web/src/features/usage-maintenance/cpaLogStorage.ts` with a `CpaLogStorage` type (camelCase fields: `totalBytes`, `totalFiles`, `cappedBytes`, `cappedFiles`, `oldestModifiedAt: Date | null`, `newestModifiedAt: Date | null`, `limitMb`, `requestLog`, `loggingToFile`) and `readCpaLogStorage(raw: unknown): CpaLogStorage`, which validates every key (non-negative finite numbers, booleans, RFC 3339 string or `null` that parses to a valid date) and throws `Error('Invalid CPA log storage response')` otherwise
- [x] add `cpaLogStorageApi.get(signal?: AbortSignal): Promise<{ supported: true; storage: CpaLogStorage } | { supported: false }>` using `apiClient.get('/observability/logs/storage', { signal })` from `features/personal-quota-support/services/api/client`; a 404 returns `{ supported: false }` (same check as `routingProfiles.ts:251`); every other error is rethrown
- [x] add `logStorageWarning(storage): 'unbounded' | 'near_limit' | null` — `'unbounded'` when `requestLog && limitMb === 0`; `'near_limit'` when `limitMb > 0 && cappedBytes >= 0.9 * limitMb * 1024 * 1024`; otherwise `null`
- [x] add `logRetention(storage): { spanDays: number; bytesPerDay: number | null } | null` — `null` when either timestamp is `null`; `spanDays = (newest - oldest) / 86_400_000`; `bytesPerDay = totalBytes / spanDays` only when `spanDays >= 1`, else `null` (too short to extrapolate)
- [x] write tests in `cpaLogStorage.test.ts`: reader accepts the live sample from Decisions and a missing-directory payload (zeros, `null` timestamps); rejects missing keys, negative/NaN numbers, wrong types, unparsable timestamps
- [x] write tests for `cpaLogStorageApi.get` (mock the quota `apiClient`): success, 404 → `{ supported: false }`, 500 and network errors rethrown, signal passed through
- [x] write tests for `logStorageWarning` (boundaries: exactly 90%, just under, `limitMb` 0 with request-log off → `null`) and `logRetention` (null timestamps, span < 1 day, multi-day span)
- [x] run `npm run test:web` - must pass before task 2

### Task 2: CPA logs summary card in the overview
- [x] in `UsageMaintenanceArchiveViews.tsx`, add a `CpaLogsSummaryCard` component (same file, next to the overview) taking `state: { status: 'loading' } | { status: 'unsupported' } | { status: 'error'; message: string } | { status: 'ready'; storage: CpaLogStorage }` and `onOpenConfig: () => void`; render it as the fifth `summaryCard` inside the existing `<dl>` of `UsageMaintenanceOverviewView`, which gains the props `logStorage` and `onOpenConfig`
- [x] card content: icon (`IconScrollText`, an existing `iconWrap` color class), title `usage_maintenance.cpa_logs`, `actionChip` button `usage_maintenance.cpa_logs_open_config` calling `onOpenConfig`; value = `formatFileSize(totalBytes)` when ready, `'—'` otherwise; sub-line when ready: file count, limit (`formatFileSize(limitMb * 1024 * 1024)` or "no limit"), request-log on/off; a second sub-line with the retention span (oldest date via `formatDateTime`, span in days) and `≈ <size>/day` when `bytesPerDay` is non-null; unsupported → hint `usage_maintenance.cpa_logs_unsupported`; error → `usage_maintenance.cpa_logs_error`; loading → `usage_maintenance.cpa_logs_loading`
- [x] warning block in the `reclaimHighlight` style: `'unbounded'` → `usage_maintenance.cpa_logs_warning_unbounded`; `'near_limit'` → `usage_maintenance.cpa_logs_warning_near_limit` with `{ used, limit }` (capped bytes vs limit)
- [x] in `UsageMaintenanceArchiveViews.module.scss`, make `.summary` fit five cards: `repeat(5, minmax(0, 1fr))` above 1100px; keep the existing 2-column (≤1100px) and 1-column (≤768px) breakpoints
- [x] write component tests (`UsageMaintenanceArchiveViews.test.tsx`, new): ready state renders size, counts, limit and request-log text; `limitMb` 0 renders "no limit"; retention line with and without `bytesPerDay`; both warnings; unsupported, error and loading render `'—'` and their hint; the chip calls `onOpenConfig`
- [x] run `npm run test:web` - must pass before task 3
- ➕ `logStorage` / `onOpenConfig` are optional on `UsageMaintenanceOverviewView` (card omitted when absent) so the page type-checks before Task 3 wires them; Task 3 may make them required. Locale keys used: `cpa_logs`, `cpa_logs_open_config`, `cpa_logs_files` ({{count}}), `cpa_logs_limit` ({{limit}}), `cpa_logs_no_limit`, `cpa_logs_request_log_on/off`, `cpa_logs_retention` ({{oldest}}, {{days}}), `cpa_logs_per_day` ({{size}}), `cpa_logs_loading`, `cpa_logs_unsupported`, `cpa_logs_error` ({{message}}), `cpa_logs_warning_unbounded`, `cpa_logs_warning_near_limit` ({{used}}, {{limit}})

### Task 3: Fetch the card data on the Usage maintenance page
- [x] in `UsageMaintenancePage.tsx`, add `logStorage` state (initial `{ status: 'loading' }`) and a `loadLogStorage` callback with its own `AbortController` ref and generation counter, independent of `load()`; it calls `cpaLogStorageApi.get(signal)` and maps the result to `ready` / `unsupported`, any thrown error (including a missing connection from `createQuotaRequestConfig`) to `error` with the message; aborted or superseded calls set nothing
- [x] run it on mount and whenever the page's foreground `load()` runs (the user-visible refresh), not on background polling; abort it on unmount
- [x] pass `logStorage` and `onOpenConfig={() => navigate('/config')}` to `UsageMaintenanceOverviewView`
- [x] keep `load()`, its `Promise.all`, unsupported and error handling unchanged: a failing or 404 log storage call must not set the page's `unsupported` or `error`
- [x] extend `UsageMaintenancePage.test.tsx` (mock `cpaLogStorageApi` the same way as `usageServiceApi`): card shows the size when the call resolves; a 404-style `{ supported: false }` and a rejected call leave the rest of the page rendered with no page error; unmount aborts the request; the chip navigates to `/config`
- [x] run `npm run test:web` - must pass before task 4
- ➕ while a refresh is in flight the card keeps its previous state (no flash back to loading); `logStorage`/`onOpenConfig` stay optional on the overview view so other callers and the view tests need no change

### Task 4: Locale keys and the total-size limit label
- [x] add the new `usage_maintenance.cpa_logs*` keys to `en.json`, `ru.json`, `zh-CN.json`, `zh-TW.json` (title, open-config chip, files/limit/no-limit/request-log on/off sub-line, retention span, per-day growth, loading, unsupported hint "update CPA to show log size", error, both warnings)
- [x] fix `config_management.visual.sections.system.logs_max_size` to total wording in all four: en "Total Log Size Limit (MB)", ru "Общий лимит размера логов (МБ)", zh-CN "日志总大小限制 (MB)", zh-TW "記錄檔總大小限制（MB）"; update any test or snapshot asserting the old text
- [x] run the existing locale parity tests; add a test that the four locales define every `usage_maintenance.cpa_logs*` key if the existing parity tests do not already cover new keys
- [x] run `npm run test:web` - must pass before task 5
- ➕ the existing `usage_maintenance` parity test only compares key sets against `en`; added `usageMaintenanceWiring.test.ts` checks that every `cpa_logs*` key the card source uses exists in all four locales with the same `{{placeholders}}`, plus a label test. Page tests resolve real `en` strings, so two Task 3 assertions were updated to the translated text.

### Task 5: Demo mode fixture
- [x] in `features/demo/demoApi.ts`, serve `/observability/logs/storage` from the request path the v8 quota client uses in demo mode (`handleDemoRawRequest`, and `handleDemoApiRequest` too if `apiClient.get` goes there), returning a plausible payload consistent with the demo config (`request-log: true`, `logging-to-file: true`, `logs-max-total-size-mb: 512`), e.g. ~380 MB capped of a 512 MB limit so the near-limit warning is visible in the demo
- [x] write a demo test (`demoApi.logStorage.test.ts` or the closest existing `demoApi.*.test.ts`) asserting the payload passes `readCpaLogStorage`
- [x] run `npm run check:demo-isolation` and `npm run test:web` - must pass before task 6
- ➕ the v8 quota client sends every call through `requestRaw`, so only `handleDemoRawRequest` serves the route (`handleDemoApiRequest` is never reached). ⚠️ 380 MB of 512 MB is 74%, under the 90% threshold, so the fixture uses ~470 MB capped (≈92%) to actually show the near-limit warning; `request_log`/`logging_to_file`/`limit_mb` follow the current demo config. `check:demo-isolation` needs a built bundle, so run `npm run build` first.

### Task 6: Verify acceptance criteria
- [ ] verify all requirements from Overview are implemented (card, warning rules, 404 → "—", independent fetch, `/config` chip, label fix, demo)
- [ ] verify edge cases: missing logs directory (zeros, `null` timestamps), `limit_mb` 0, span under one day, connection unavailable
- [ ] run `npm run type-check`
- [ ] run `npm run lint` - all issues must be fixed
- [ ] run `npm run test:web`
- [ ] run `npm run build` (tsc + vite) to confirm the bundle builds

### Task 7: [Final] Update documentation
- [ ] in `apps/docs/operations/configuration.md` and `apps/docs/en/operations/configuration.md`, where `logs-max-total-size-mb` or log settings are described, state that the limit is the total size of the CPA logs directory and that the current usage is shown on the Usage maintenance page; skip a file that does not describe log settings
- [ ] update project knowledge docs if new patterns were discovered

## Technical Details
- Endpoint: `GET {base}/v8/management/observability/logs/storage`, admin Bearer key (handled by `createQuotaRequestConfig`).
- Bytes are logical file sizes (`stat` size), not allocated blocks; the scan is not atomic while CPA keeps writing, so numbers can differ by a few KB from a manual `find`.
- Near-limit threshold compares `capped_bytes` (what the cleaner counts) to `limit_mb * 1024 * 1024`; `total_bytes` includes nested and non-`.log` files the cleaner never removes.
- Growth per day is `total_bytes / span`, a rough average that assumes the oldest file is still on disk; label it with `≈`.

## Post-Completion
**Manual verification**:
- Panel-only deploy per the local deploy notes (`PANEL_PATH` swap, `apps/manager-server` unchanged), then open `https://echegas-macbook-pro-2.tail9ac4fa.ts.net:9443/management.html#/usage-maintenance` and compare the card with `find "$HOME/Library/Application Support/CLIProxyAPI/logs" -type f -exec stat -f%z {} + | awk '{s+=$1} END {print s, NR}'` (expect ~185 MB, 15 files, "no limit", request-log off on 2026-11-05).
- Check the 2-column and 1-column layouts at ≤1100px and ≤768px.

**External system updates**:
- None; the CPA endpoint is already deployed. `launchd-stdout-log-in-capped-logs-dir` in the CLIProxyAPI-migration backlog explains why most of today's usage is `stdout.log`.
