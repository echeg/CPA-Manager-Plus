# Exact per-model timeline for the model trend chart

## Overview
- The Usage Analytics model trend chart ("Model Trend Comparison" on the trends tab, the model compare chart on the models tab) does not show real per-model data. `buildEntityTrendSeries` (`apps/web/src/features/usage-analytics/usageAnalyticsModel.ts:1946`) draws each model as `overall timeline × the model's share of the whole period`. A model that only started at 12:00 is smeared across the morning, and a model that stopped is shown as still running. Every line has the shape of the total.
- Goal: draw each of the top models from its own exact buckets, the same way API key trends already do (`include.api_key_timeline` → `buildApiKeyTrendSeries`).
- The server already fetches timeline points split by model (`store.TimelinePoint.Model`, from both the raw query `TimelineWithFilter` and the hourly rollup `usagehourly.Reader.AnalyticsTimeline`). Only `buildTimeline` (`apps/manager-server/internal/service/monitoring/service.go:2692`) merges the models. A new `include.model_timeline` regroups those same points by (model, bucket). No new SQL.
- The web sends a follow-up request for the top models, the same way it does for API keys. It keeps the current estimate as the fallback for backends without `model_timeline`, and shows the "estimated" hint only while the fallback is in use.

## Decisions
- **Context**: model lines must be exact. The API key trend already solved the same problem with a separate exact request.
- **Chosen approach**: a separate web request with `filters.models = <top model ids>` and `include.model_timeline = true`. On the server, `model_timeline` is built from the timeline points the service already fetches (raw or hourly rollup), grouped by (model, bucket). Cost is computed per point with the same `costForTimelinePoint` as the main timeline, so the per-model sums match it.
- **Rejected alternatives**:
  - Returning `model_timeline` for all models in the main tab response. It avoids the second request, but the response grows to hundreds of KB with hourly granularity over 7-30 days and about ten models. The top models are also unknown until `model_stats` arrives in that same response.
  - A new `ModelTimelineWithFilter` repository query, a full copy of the API key path. It is more code, duplicates the hourly rollup support, and the points it would return are already fetched.
- **Verified facts**:
  - `filters.models` (JSON `models`, `Filters.Models`, `service.go:128`) is applied by `analyticsWhere` to `SQLRequestAnalyticsModelExpression` after `normalizeModelFilterValues` (`apps/manager-server/internal/repository/usageevent/analytics.go:3002,3102`). That is the same value as `analytics_model_value`, which `ModelStat.Model` and `TimelinePoint.Model` carry.
  - Web model rows use `id: row.model || '-'` (`usageAnalyticsModel.ts:1353`), so a row id equals the server's model filter value. `'-'` (empty model) must not be sent.
  - Web model rows are sorted by cost, then by requests (`usageAnalyticsModel.ts:1387`), whatever the selected metric. `buildEntityTrendSeries` takes the first 4 rows whose selected metric is above 0. The set of top models can therefore differ between the requests, tokens and cost metrics.
  - The model chart renders on the `trends` tab (`UsageAnalyticsPage.tsx:3135`) and the `models` tab (`UsageAnalyticsPage.tsx:3203`, with `highlightId`). The overview tab does not render it.
  - `entity_trend_hint` is rendered only in the models tab header (`UsageAnalyticsPage.tsx:3181`). The trends tab panel (3110-3142) has no hint.
  - Hourly rollup timelines are used only when `needsHourlyTimeline := req.Include.Timeline || req.Include.AnomalyPoints` (`service.go:1026`) and the filter is rollup-eligible (`usagehourly.SupportsAnalyticsFilter`). The point fetch itself is gated at `service.go:1389`.
  - The response fields use `omitempty`. A new backend with zero points omits `model_timeline` just as it omits `api_key_timeline`, and the web falls back to an all-zero estimate. That is harmless.

## Context (from discovery)
- Server files:
  - `apps/manager-server/internal/service/monitoring/service.go`:
    - `Include` (`:163`) and `Response` (`:208`) structs
    - the `APIKeyTimelinePoint` service struct (`:677`) as the template
    - the timeline fetch block (`:1386-1410`)
    - the coverage limitations (`:1641`, `:1652`)
    - `buildTimeline` (`:2692`)
    - `buildAPIKeyTimeline` and its accumulator (`:3400-3462`) as the template
    - `costForTimelinePoint` (`:4615`)
  - `apps/manager-server/internal/service/monitoring/service_test.go`. Test templates:
    - `TestAnalyticsAPIKeyTimelineBuildsExactPerKeyBuckets` (`:354`)
    - `TestBuildTimelineIsIndependentOfPointOrder` (`:637`)
    - `TestAnalyticsHourlyRollupMatchesRawCoreComparisonAndTimeline` (`:3200`)
    - `TestAnalyticsReportsArchivedCoverageAndKeepsProjectionBackedCoreExact` (`:3504`)
- Web files:
  - `apps/web/src/services/api/usageService.ts`:
    - the `MonitoringAnalyticsInclude` type (`:1035`, with `api_key_timeline` at `:1051`)
    - the `MonitoringAnalyticsApiKeyTimelinePoint` type (`:1756`)
    - the `api_key_timeline` field on `MonitoringAnalyticsResponse` (`:2150`)
  - `apps/web/src/features/usage-analytics/usageAnalyticsModel.ts`:
    - `UsageApiKeyTimelinePoint` (`:250`)
    - `buildUsageApiKeyTimeline` (`:1082`)
    - `buildModelRows` (`:1353`)
    - `buildEntityTrendSeries` (`:1946`)
    - `buildApiKeyTrendSeries` (`:1982`)
  - `apps/web/src/features/usage-analytics/useUsageAnalytics.ts`:
    - `API_KEY_TREND_SERIES_LIMIT` (`:67`)
    - the exact API key request block (`:383-447`)
    - `modelTrendSeries` (`:494`)
  - `apps/web/src/features/usage-analytics/UsageAnalyticsPage.tsx`: the hint at `:3181` and the charts at `:3135` and `:3203`
  - `apps/web/src/features/demo/demoFixtures.ts`: the API key timeline fixture at `:3686-3757` and `:4828-4830`
- Web tests:
  - `useUsageAnalytics.test.tsx`: the mock at `:95-242`, with the `apiKeyTimelineAvailable` toggle and the `include.api_key_timeline` branch at `:177`, and the exact API key tests at `:342-500`
  - `usageAnalyticsModel.test.ts:914`
  - `features/demo/DemoPage.test.tsx:874`
  - `UsageAnalyticsPage.test.tsx`
  - `usageAnalyticsWiring.test.ts:142`
- Commands, run from the repo root:
  - `npm run manager-server:test` (`go test ./...`)
  - `cd apps/manager-server && go test -race ./internal/service/monitoring/...`
  - `npm run test`
  - `npm run type-check`
  - `npm run lint`
  - `npm run check:demo-isolation`
  - `npm run build`

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
- Maintain backward compatibility: a backend without `model_timeline` keeps today's estimated lines and the hint; a request without `include.model_timeline` gets exactly today's response.

## Testing Strategy
- **Unit tests**: required for every task (see Development Approach above)
- **Go**: service-level tests that seed usage events through the existing test helpers, and cover both the raw path and the hourly rollup path
- **Web**: vitest tests for the model builder and the hook (mocked monitoring API), page tests for the hint, and demo tests
- No Playwright or Cypress e2e suite exists for this page

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

### Task 1: Server `include.model_timeline` built from the fetched timeline points
- [x] add `ModelTimeline bool json:"model_timeline"` to `Include` and `ModelTimeline []ModelTimelinePoint json:"model_timeline,omitempty"` to `Response` in `apps/manager-server/internal/service/monitoring/service.go`. `ModelTimelinePoint` mirrors `APIKeyTimelinePoint` (`:677`) but has `Model string json:"model"` instead of `APIKeyHash`.
- [x] add `buildModelTimeline(points []store.TimelinePoint, granularity, location, prices) []ModelTimelinePoint`:
  - group by (`strings.TrimSpace(point.Model)`, `BucketMS`) and skip empty models
  - sum the counters the same way `buildAPIKeyTimeline` does (`:3406`)
  - add `costForTimelinePoint(point, prices)` per raw point
  - weight latency by `LatencySamples`, then set the success and failure rates
  - sort the output by bucket, then model, so it does not depend on input order
- [x] fetch the points when `req.Include.Timeline || req.Include.AnomalyPoints || req.Include.ModelTimeline`, in the block at `:1389`. Set `response.ModelTimeline = buildModelTimeline(points, …)` only when `ModelTimeline` is requested. Extend `needsHourlyTimeline` (`:1026`) with `ModelTimeline`, so the hourly rollup serves it when the filter allows.
- [x] add `req.Include.ModelTimeline` to the coverage condition at `:1641`, so `timeline_metrics_require_raw_events` is reported when the points do not come from the rollup and raw events were deleted
- [x] write a service test modelled on `TestAnalyticsAPIKeyTimelineBuildsExactPerKeyBuckets`:
  - seed two models in different hours and request with `filters.models` set to both
  - assert that each model has only its own buckets: no calls for a model in an hour where it had none
  - assert that the per-bucket sums of calls, tokens and cost match `response.Timeline` requested in the same call
  - assert that a third model excluded by `filters.models` is absent
- [x] write tests for the edge cases:
  - without `include.model_timeline` the response has no `model_timeline` field
  - `buildModelTimeline` gives the same result regardless of point order and skips empty-model points (a unit test like `TestBuildTimelineIsIndependentOfPointOrder`)
  - the hourly rollup path gives the same `model_timeline` as the raw path (extend or mirror `TestAnalyticsHourlyRollupMatchesRawCoreComparisonAndTimeline`)
  - `model_timeline` adds the coverage limitation when raw events are archived (mirror the assertion at `:3572`)
- [x] run `npm run manager-server:test` and `cd apps/manager-server && go test -race ./internal/service/monitoring/...`. Both must pass before task 2.

### Task 2: Web API types and exact model trend builder
- [x] in `apps/web/src/services/api/usageService.ts`, add `model_timeline?: boolean` to `MonitoringAnalyticsInclude`, a `MonitoringAnalyticsModelTimelinePoint` type that mirrors `MonitoringAnalyticsApiKeyTimelinePoint` with `model` in place of `api_key_hash`, and `model_timeline?: MonitoringAnalyticsModelTimelinePoint[]` to `MonitoringAnalyticsResponse`. If the response is normalized, the new field must pass through.
- [x] in `usageAnalyticsModel.ts`, add a `UsageModelTimelinePoint` type and `buildUsageModelTimeline(points, granularity)`, modelled on `buildUsageApiKeyTimeline` (`:1082`)
- [x] add `buildModelTrendSeries(rows, timeline, modelTimeline, metric, limit)`, modelled on `buildApiKeyTrendSeries`:
  - key rows by `row.id`, skipping `'-'` and empty ids
  - take the first `limit` rows whose metric is above 0
  - read each point from that model's buckets, with 0 for a missing bucket
  - keep the same colour order as `buildEntityTrendSeries`, so the colours do not change when the exact data arrives
- [x] add `selectModelTrendIds(rows, limit)`. It returns the union, in row order, of the first `limit` rows with a value above 0 for each of `requestCount`, `totalTokens` and `estimatedCost`, and skips `'-'` and empty ids. One exact request then covers every metric switch.
- [x] write tests in `usageAnalyticsModel.test.ts`, next to the API key test at `:914`:
  - a model that only has afternoon buckets gives 0 in the morning
  - missing buckets give 0
  - the colour and order match `buildEntityTrendSeries`
  - `selectModelTrendIds` returns the union across metrics and skips `'-'` and empty ids
- [x] write edge-case tests: an empty `modelTimeline` gives all-zero series, rows with the metric at 0 are skipped, and the limit is respected
- [x] run `npm run test` and `npm run type-check`. Both must pass before task 3.

### Task 3: Hook requests the exact model timeline and falls back to the estimate
- [ ] in `useUsageAnalytics.ts`, add `MODEL_TREND_SERIES_LIMIT = 4` and use it in place of the hard-coded `4` at `:495`
- [ ] add a model trend request, modelled on the API key block (`:383-447`):
  - get the ids from `selectModelTrendIds(adapted.modelRows, MODEL_TREND_SERIES_LIMIT)`
  - send it only when the active tab is `trends` or `models` and there is at least one id
  - use `filters: { ...analyticsFilters, models: ids }` and `include: { granularity: resolvedGranularity, model_timeline: true }`
  - build a `dataScopeKey` from tab, ids, `presentationRangeScopeKey`, filters, granularity and search, and use `throttleMs: 0`
- [ ] compute `modelTimeline` and `hasExactModelTimeline = Array.isArray(modelTrendData?.model_timeline)`, ignoring stale data the same way `apiKeyTrendData` does. `modelTrendSeries` uses `buildModelTrendSeries` when the timeline is exact, and otherwise falls back to `buildEntityTrendSeries`. Expose `modelTrendEstimated = !hasExactModelTimeline` from the hook.
- [ ] extend the mock in `useUsageAnalytics.test.tsx` (`:95-242`) with a `modelTimelineAvailable` toggle and an `include.model_timeline` branch. Write tests:
  - the trends and models tabs send one request with `filters.models` equal to the selected ids and `include.model_timeline`
  - the series come from the exact buckets
  - the overview tab and the other tabs do not send it
  - changing the metric does not send a new request when the ids are unchanged
- [ ] write fallback tests:
  - a backend that omits `model_timeline` keeps the estimate and `modelTrendEstimated === true`
  - a stale response is ignored
  - when there are no model rows, no request is sent
- [ ] run `npm run test` and `npm run type-check`. Both must pass before task 4.

### Task 4: Show the "estimated" hint only on the fallback
- [ ] in `UsageAnalyticsPage.tsx`, render `usage_analytics.entity_trend_hint` in the models tab header (`:3181`) only when `usage.modelTrendEstimated` is true. Also show it in the trends tab model comparison panel (`:3110-3142`) under the same condition, because that panel draws the same estimated model lines today. Keep the existing hint text and i18n keys, so the four locales and `usageAnalyticsWiring.test.ts:142` stay valid.
- [ ] write page tests in `UsageAnalyticsPage.test.tsx`: with `modelTrendEstimated: false` no hint is rendered on either tab, and with `true` the hint appears on both
- [ ] run `npm run test`, `npm run type-check` and `npm run lint`. All must pass before task 5.

### Task 5: Demo fixtures return the exact model timeline
- [ ] in `apps/web/src/features/demo/demoFixtures.ts`, emit `model_timeline` when `include.model_timeline` is set and `filters.models` is non-empty:
  - build one series per requested demo model from the demo timeline, so that each bucket's model values add up to the timeline bucket
  - give at least one model a visibly different time shape, for example active only in the second half of the range, so the demo shows the improvement
  - keep the output deterministic, like the existing `apiKeyTimeline` fixture (`:3725`)
  - do not change the response when `include.model_timeline` is absent
- [ ] write tests in `features/demo/DemoPage.test.tsx`, next to `:874`: the requested models get exact buckets, unrequested models are absent, and the per-bucket sums do not exceed the timeline
- [ ] run `npm run test` and `npm run check:demo-isolation`. Both must pass before task 6.

### Task 6: Verify acceptance criteria
- [ ] verify that a model active only in part of the range is drawn as 0 outside its active buckets on both the trends and models tabs (hook-level test with exact data)
- [ ] verify the fallback: a backend without `model_timeline` gives today's estimated lines and the hint, and a request without `include.model_timeline` gives an unchanged server response
- [ ] run `npm run manager-server:test` and `cd apps/manager-server && go test -race ./...`
- [ ] run `npm run test`, `npm run type-check`, `npm run lint`, `npm run check:demo-isolation` and `npm run build`
- [ ] check that the new Go and TS code is covered by the tests above, with no untested branch in `buildModelTimeline`, `buildModelTrendSeries` or `selectModelTrendIds`

### Task 7: [Final] Update documentation
- [ ] if a draft or unreleased release-notes file exists in `docs/release-notes/`, add a note there in English and Chinese, modelled on `v1.11.5-en.md:20`. The note says that model trends now use exact per-model buckets instead of overall share, that they fall back to the estimate on older backends, and that the "estimated" hint appears only in that case. If there is no draft, do not create a release file, and note this in the completion report.
- [ ] add a short note to `docs/usage-analytics-implementation-plan.zh-CN.md` next to `:61`: entity trends for models now use the exact `include.model_timeline`, and the estimate is only a fallback

## Technical Details
- **Request** (follow-up, trends and models tabs only):
  ```json
  {
    "filters": { "...current filters": "...", "models": ["gpt-6.2-sol", "claude-sonnet-5-5"] },
    "include": { "granularity": "hour", "model_timeline": true }
  }
  ```
- **Response point** (`model_timeline[]`). The fields match `api_key_timeline`, with `model` in place of `api_key_hash`:
  `model`, `bucket_ms`, `bucket_label`, `calls`, `tokens`, `total_tokens`, `success`, `failure`, `input_tokens`, `output_tokens`, `cached_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `reasoning_tokens`, `cost`, `average_latency_ms`, `success_rate`, `failure_rate`.
- **Server flow**: the `ModelTimeline` include feeds into `needsHourlyTimeline`. The points come from the hourly rollup when it can represent the filter and range, and otherwise from `TimelineWithFilter`. `buildTimeline` keeps its current output, and `buildModelTimeline` groups the same points by (model, bucket). `model_timeline` contains only the models that pass `filters.models`, because the query itself filters by them.
- **Web flow**:
  1. The main response gives `model_stats`.
  2. `selectModelTrendIds` picks up to 12 ids, usually 4.
  3. The follow-up request returns `model_timeline`.
  4. `buildModelTrendSeries` builds the exact series. Until it arrives, or when the field is missing, `buildEntityTrendSeries` and the hint are used.
- **Model identity**: the ids are `analytics_model_value` on both sides. The server normalizes filter values with `usageidentity.AnalyticsModel`, which is idempotent.

## Post-Completion
**Manual verification**:
- On a real instance, open Usage Analytics → Trends and Models for "today", with hourly granularity, on a day when a model switch happened, for example sol until 12:00 and Sonnet after. Check that Sonnet is 0 before the switch and that sol drops after it. Compare a few hours with direct database counts per model.
- Switch the metric between Requests, Tokens and Cost and check that the lines change without a visible reload.
- Against an older manager-server build without `model_timeline`, check that the chart still renders estimated lines with the hint.

**Deployment**:
- The manager-server and the web panel ship together. An older server with a newer web panel falls back automatically, and no config change is needed.
