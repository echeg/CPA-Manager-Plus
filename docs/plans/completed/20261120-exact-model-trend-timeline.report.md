# Report: 2026 11 20 exact model trend timeline
plan: /Users/echeg/CPA-Manager-Plus/.loopai/worktrees/exact-model-trend-timeline/docs/plans/20261120-exact-model-trend-timeline.md | branch: exact-model-trend-timeline | base: main | mode: full | executor: claude | task model: claude:opus:high | review model: claude:opus:xhigh | started: 2026-11-20T13:00:01Z | finished: 2026-11-20T15:14:57Z

## Summary
- task iterations: 7
- failed retries: 0
- external reviewers: 1
- post-review iterations: 1
| phase | duration_ms |
|---|---:|
| evaluation | 3119690 |
| external review | 1290396 |
| internal review | 1917615 |
| other | 0 |
| tasks | 1768229 |

## Change scope
- commits: 9
- files: 28
- additions: 2263
- deletions: 215
| status | path |
|---|---|
| M | apps/docs/en/manual/usage-analytics.md |
| M | apps/docs/manual/usage-analytics.md |
| M | apps/manager-server/internal/repository/usageaggregate/repository.go |
| M | apps/manager-server/internal/repository/usageevent/analytics.go |
| M | apps/manager-server/internal/repository/usagemonitoring/event_filter.go |
| M | apps/manager-server/internal/repository/usagemonitoring/filter.go |
| M | apps/manager-server/internal/repository/usagepricing/repository.go |
| M | apps/manager-server/internal/service/monitoring/service.go |
| M | apps/manager-server/internal/service/monitoring/service_test.go |
| M | apps/manager-server/internal/service/usagehourly/reader.go |
| M | apps/manager-server/internal/usageidentity/model.go |
| M | apps/manager-server/internal/usageidentity/model_test.go |
| M | apps/web/src/features/demo/DemoPage.test.tsx |
| M | apps/web/src/features/demo/demoFixtures.ts |
| M | apps/web/src/features/monitoring/hooks/useMonitoringAnalytics.test.tsx |
| M | apps/web/src/features/monitoring/hooks/useMonitoringAnalytics.ts |
| M | apps/web/src/features/usage-analytics/UsageAnalyticsPage.module.scss |
| M | apps/web/src/features/usage-analytics/UsageAnalyticsPage.test.tsx |
| M | apps/web/src/features/usage-analytics/UsageAnalyticsPage.tsx |
| M | apps/web/src/features/usage-analytics/usageAnalyticsModel.test.ts |
| M | apps/web/src/features/usage-analytics/usageAnalyticsModel.ts |
| M | apps/web/src/features/usage-analytics/useUsageAnalytics.test.tsx |
| M | apps/web/src/features/usage-analytics/useUsageAnalytics.ts |
| M | apps/web/src/services/api/usageService.ts |
| A | docs/backlog/usage-api-key-trend-exact-zeros-after-refresh.md |
| A | docs/backlog/usage-page-model-filter-trims-model-identities.md |
| M | docs/plans/20261120-exact-model-trend-timeline.md |
| M | docs/usage-analytics-implementation-plan.zh-CN.md |

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
- none
### Blocked
- none
### Skipped
- none

## Backlog
| status | path | title |
|---|---|---|
| A | docs/backlog/usage-api-key-trend-exact-zeros-after-refresh.md | The API key trend draws refreshed hours as exact zeros until its follow-up answers |
| A | docs/backlog/usage-page-model-filter-trims-model-identities.md | The Usage Analytics model filter trims and re-normalizes model identities |

## External review
### codex:gpt-6.2-astra:xhigh
- label: codex
- iterations: 5
- duration_ms: 4410063
- ended by: done
- had findings: true
#### Iteration 1
- truncated: false
Reviewer output:
```
- **[P2] Refresh can miss new usage.** `apps/web/src/features/usage-analytics/useUsageAnalytics.ts:847` starts the model request with the previous `toMs`, before `setNowMs` takes effect. On a rolling range with unchanged top models, the hook deduplicates the request for the new bounds against the one already in flight. Requests made since the previous cutoff can therefore still be missing after refresh. Start the fetch after the new bounds are available.
- **[P2] A failed refresh can leave stale lines displayed as exact.** `apps/web/src/features/usage-analytics/useUsageAnalytics.ts:510` checks only whether the retained response contains an array. If the main request succeeds but the model request fails, the hook keeps the previous model buckets and hides the estimated hint. After a price change or usage import, the chart can contradict the freshly loaded model totals. On follow-up failure, use the estimate or explicitly mark the retained data as stale.
- **[P2] Some model IDs do not survive the follow-up filter.** `apps/web/src/features/usage-analytics/useUsageAnalytics.ts:466` sends IDs from `model_stats` through a filter that normalizes them a second time. For example, `custom(high)(low)` is reported as `custom(high)`, but the filter then queries `custom`. If another selected model returns points, the chart treats the response as exact and draws `custom(high)` as zero. The follow-up needs to match the returned analytics IDs verbatim.
- **[P3] Demo chart totals disagree with the model table.** `apps/web/src/features/demo/demoFixtures.ts:3809` allocates each bucket independently without preserving each model’s total. Across all 14 demo buckets, `claude-sonnet-4-5` sums to **2,330 calls**, while its model row reports **4,380**. Derive the chart and table from the same per-model buckets so both totals agree.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Checking how the range scope key reacts to a refresh, which decides whether finding 1 is real.Finding 1 looks real and affects every request in refresh(), not only the model one. Now checking the existing refresh tests and the remaining findings.Findings 1 and 2 check out so far. Now looking at the server model normalization for finding 3.Finding 3 decision: I'll fix it on the server with one shared filter-value helper that matches each value verbatim and also by its normalized form. Now checking finding 4 in the demo fixtures.I've worked through all four findings and they all hold up. Next I'm reading the demo API key test, then I'll start the fixes.Starting the fixes now. First I'm reading the hook test harness so I can write the refresh-ordering test.Now writing the server fix for finding 3: a shared helper in usageidentity, used by all four repository model-filter sites.The usageaggregate normalizeValues helper is now dead code, so I'm removing it.Build passes. Now adding Go tests: a unit test for the helper and a service test that seeds a non-idempotent model ID.Now adding the service test right after the existing model timeline test.Passes. Confirming it fails without the fix by temporarily disabling the verbatim match.Red check confirmed and the file is restored. Adding a unit test for the helper.Go side of finding 3 is done. Running the full Go suite in the background while I fix the web hook.Now the hook: refresh() will bump a counter, and an effect will run the forced fetches after the new range end is rendered. The model trend will also fall back to the estimate when its request fails.Adding the hook tests: an error toggle for the model request in the mock, a test for the refresh order, and a test for the fallback after a failure.All 29 pass. Red-checking the two new tests against the committed hook.Both tests fail on the old hook and pass on the fix. Now finding 4: the demo fixture will allocate each model's table totals across its active buckets.Updating the demo test to check what now holds: each model's buckets add up to its model_stats row.The Go suite passes with no failing packages, and the race run on monitoring passes too. Red-checking the demo test against the old fixture.The demo test fails on the old fixture (6741 vs 6200) and passes now. Updating the plan doc so its stated facts match the code.Now running the full verification: Go formatting and tests, plus web tests, type-check, lint, the demo isolation check and the build.Several things to check: type-check and build fail, gofmt lists files (two of which I touched), and prettier flags the hook test file. Looking at the type errors first.Prettier was already failing on this test file at HEAD, and eslint does not enforce it. Checking whether the repo has a format check before reformatting.A format script exists, but nothing enforces it: lint passes, and several branch files were already unformatted. I won't reformat whole files. I'll only make sure the lines I added are clean.My new lines are prettier-clean; the remaining diffs are in older code. Now checking whether the gofmt hits on the two Go files I touched predate my change.Both files were already unformatted at HEAD, only in import order. I touched them, so I'm applying gofmt to just those two.Re-running type-check, build and web tests, and checking which test files the root test script actually covers.Everything passes. A last look at the hook diff.All four Codex findings were real, and I fixed them all. Nothing is committed and I'm not sending the done signal, so Codex can re-check the fixes.

- Finding 1 (P2, refresh misses new usage): valid. refresh() set the new nowMs but started every forced fetch in the same handler, so the requests still used the old range end. On a rolling range like 24h or 7d the request key doesn't change, so when the hook re-rendered with the new range end, the in-flight dedupe dropped that request and the old-range one won. This hit the main request, the filter selectors and the API key trend too, not only the model request. Fix in useUsageAnalytics.ts: refresh() now only sets nowMs and bumps a counter. A separate effect runs the forced fetches after the render that applies the new nowMs. New hook test "refreshes with the new range end rather than the previous one" checks that the main and model refreshes see the new range end. It fails on the old hook.

- Finding 2 (P2, a failed refresh keeps stale lines shown as exact): valid. useMonitoringAnalytics keeps the last good data when a request fails, and the hook only checked that model_timeline was an array. So after a successful main refresh and a failed model refresh, the old buckets were drawn as exact with no hint, and the newest buckets dropped to 0. Fix: the hook now treats the model timeline as exact only when the follow-up request has no error. On error it falls back to the estimate and shows the hint. New test "falls back to the estimate when the model timeline request fails" covers failure and then recovery. It fails on the old hook.

- Finding 3 (P2, some model IDs don't survive the filter): valid. AnalyticsModel is not idempotent: "custom(high)(low)" becomes "custom(high)", and normalizing again gives "custom". The plan wrongly said it was idempotent. Fix on the server: a new helper, usageidentity.ModelFilterValues, matches each filter value as-is and also by its normalized form. All four repository model filters now use it (usageevent, usagemonitoring, usagepricing, usageaggregate), so the raw-event path and the hourly rollup path stay consistent. Raw names like "deepseek-v4-flash(max)" still select "deepseek-v4-flash". The old normalizeValues helper in usageaggregate had no callers left, so I removed it.
  - Tests: a unit test for the helper, and a service test that seeds "custom(high)(low)" and "custom(high)(max)", then requests filters.models = ["custom(high)"] on both the raw path and the rollup path. The service test fails on the old behaviour.
  - Remaining limitation, recorded in the plan: filtering on "custom(high)" also selects "custom" when both have events. The exact chart is unaffected because points are grouped per model, but the page's model filter can include too much in that rare case. Before the fix it selected the wrong model entirely.

- Finding 4 (P3, demo chart totals disagree with the model table): valid. The demo split each timeline bucket across models, so a model's line didn't add up to its row (claude-sonnet-4-5 totalled about 2,330 calls in the chart against 4,380 in its row). Fix in demoFixtures.ts: each model's calls, failures, tokens and cost from the model table are now spread over the buckets where it is active, following the timeline's shape.
  - The demo timeline (20,927 calls) and the model table (22,280) already disagree in total, so per-bucket model sums can't also equal the timeline. Making both match would mean changing the timeline in every demo response, which the plan rules out.
  - The DemoPage test now checks that each model's buckets add up to its row and that no model point exceeds its timeline bucket. It fails on the old fixture (6741 vs 6200).

Plan doc: I corrected the "idempotent" claim, the Task 5 demo description and test wording, and the web-flow notes about the error fallback and the refresh order.

Verification: npm run test (326 + 16 files, all pass), type-check, lint, check:demo-isolation and build all pass. In apps/manager-server, go test ./... and go test -race on the monitoring service pass. I applied gofmt to the two Go files I touched; their import order was already wrong at HEAD. Nine other files outside this change also fail gofmt, but nothing enforces it, so I left them. Prettier also reports older formatting differences in four branch files (UsageAnalyticsPage.tsx, its test, usageAnalyticsModel.test.ts and the hook test). Nothing enforces prettier either, and the lines I added are formatted correctly.

Nothing was filed to the backlog, because every finding concerned code this branch changed.

Insight: the in-flight dedupe in useMonitoringAnalytics deliberately ignores nowMs changes within the same data scope, so automatic re-renders don't keep cancelling requests. That makes the order of steps in refresh() matter: the forced fetch has to start after the render that carries the new bounds, or the dedupe keeps the stale request.
```
#### Iteration 2
- truncated: false
Reviewer output:
```
- **[P2] Refresh can still lose the newer model request.** `apps/web/src/features/usage-analytics/useUsageAnalytics.ts:856` now uses the new bounds when the previous request has finished. But Refresh becomes available as soon as the **main** request finishes. If the model request is still pending and the top IDs are unchanged, `apps/web/src/features/monitoring/hooks/useMonitoringAnalytics.ts:198` drops the newer request even with `force: true`. The older response can then be displayed as exact. The fallback on request failure is correct, but this path produces no error. A manual refresh needs to supersede or queue the pending request.
- **[P2] Selecting one model can display another model’s usage.** `apps/manager-server/internal/usageidentity/model.go:100` matches both `custom(high)` and `custom`. If both identities exist, selecting `custom(high)` returns both in `model_stats`; the chart then selects its lines from those rows. Grouping points by model prevents their values from being merged, but does **not** prevent the unselected model from appearing or contributing to the summary. Use exact matching for IDs returned by analytics and keep legacy raw-name normalization separate.
- **[P3] Whitespace before a reasoning suffix still breaks the ID round trip.** `apps/manager-server/internal/usageidentity/model.go:95` trims the filter value, as does `apps/web/src/features/usage-analytics/usageAnalyticsModel.ts:1110`. For `custom (high)`, the server returns the identity `"custom "` in `model_stats`, but the follow-up queries `"custom"`. If another model returns points, the missing model is drawn as an exact zero. Stats, filters, and timeline points need the same identity rule.
- **[P3] The default demo chart still disagrees with its table.** `apps/web/src/features/demo/demoFixtures.ts:3805` allocates each row across all 14 fixture days, not the requested range. I verified that `gpt-4.1` sums to **2,940** across the fixture but **0** in the default 24-hour chart, while its table row still reports **2,940**. The full-fixture total is fixed; the displayed total is not. Test the chart after applying the page’s bounds, and derive its rows and points from the same range.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate Codex's findings rigorously before acting on them.Still evaluating finding 1 (Refresh vs. an in-flight model request) — tracing why the in-flight dedupe keys on dataScopeKey before deciding on a fix.Checking who sends raw model names in filters (to decide whether exact matching would break callers) — zsh globbing tripped my grep, rerunning.Finding 2 hinges on whether the server can tell an identity from a legacy raw name. Checking for an existing known-identity source.Findings 1 and 3 look valid; finding 2 looks like the documented limitation. Verifying whether any caller still sends raw (non-identity) model names, which decides finding 2.Now reading the existing hook tests (including the refresh tests added last iteration) so the new tests follow the same harness.Now finding 4 — reading the demo fixture's timeline and how it treats the requested range.Now the Usage Analytics refresh effect passes the option to every forced fetch:Now a unit test for the hook-level behaviour. Reading the deferred-mock helpers first:Both suites pass. Confirming the new test actually fails without the fix (so it's guarding the right thing):Finding 1 done and guarded. Now finding 3 on the server: filter values keep the verbatim identity, and model_timeline groups by the verbatim model like model_stats does.Now `buildModelTimeline`: group by the verbatim model so its keys equal the `model_stats` identities.Adding an end-to-end service check (raw and hourly-rollup paths) for the `"spaced (high)"` → `"spaced "` round trip:The raw path returns nothing for `"spaced "` — something downstream trims again. Investigating rather than guessing:The generic `addInCondition` trims every value a second time. Checking the other three repositories for the same pattern:Only `usageevent` and `usagemonitoring` re-trim (aggregate/pricing bind the values directly). Splitting the "already normalized" path out of `addInCondition` in both:Still empty, so something earlier in the pipeline trims too. Tracing the request path:Server side of finding 3 passes on both the raw and rollup paths. Now the web side — model trend ids must stay verbatim:Finding 3 done on both sides. Now finding 4 — the demo model lines. Reading the current fixture block:Now the fixture change:Type narrowing won't survive into the callback; restructuring into a precomputed range object:Passing. Sanity check that the new demo test catches the original bug (temporarily ignoring the range, i.e. the pre-fix behaviour):Test catches the original bug and passes with the fix. Now updating the plan to record these decisions:No Go formatter/linter is configured in the project scripts. Checking CI and that my own Go edits are gofmt-clean:Changed Go files are gofmt-clean, and CI runs no Go formatter/linter. Running the full verification suite (Go tests + race, web tests, type-check, lint, build, demo isolation):Type-check and lint clean. Running the full web test suite, then build + demo isolation:Background Go run finished; checking its logs (verification-before-completion applies here — reading actual output before claiming anything):Everything is green. Final look at the working tree to confirm only intended files changed (e.g. the build didn't dirty tracked output):Three of the four findings were real and are fixed. I'm rejecting finding 2 as a documented limitation. All checks pass. Nothing is committed and no backlog entry was filed.

Finding 1 (P2, Refresh loses the newer model request) — valid, fixed.
- Cause: `useMonitoringAnalytics` drops a new request when one with the same scope key is already running, even with `force: true`. For a rolling range like 24h, a new range end doesn't change that key. So a model request still running from before the Refresh absorbed the newer one. Its older response was then drawn as exact, with no error. Example: open the trends tab on a page left idle for an hour, then click Refresh. The last hour of model lines comes out as zero.
- Fix: a new refresh option, `supersedeInFlight`. It aborts the running request and starts a new one, but only when the running one was sent with different parameters. A refresh for the same request is still ignored, so nothing is fetched twice. The Usage Analytics refresh now passes `{ force: true, supersedeInFlight: true }` to all seven requests.
- Normal re-renders keep the old behaviour, so the existing test "does not supersede an in-flight refresh for the same data scope" still holds.
- New test in `useMonitoringAnalytics.test.tsx`: a plain forced refresh is absorbed, a superseding one aborts the old request and sends the new range end, a repeat doesn't restart it, and the old late response is ignored. I confirmed it fails without the fix. The hook test now checks the new options.

Finding 2 (P2, selecting custom(high) also shows custom) — not fixed. It is a known limitation, written down in the plan.
- A plain string can't say whether it is a model ID from analytics or an old raw model name. "custom(high)" is both: the ID for "custom(high)(low)" requests, and a raw name meaning "custom" at reasoning level high. Raw names are still real inputs. The monitoring page builds model filter options from event rows (`useMonitoringData.ts:902`), and filters saved before IDs were introduced also hold raw names. Exact-only matching would make those select nothing.
- The only exact fix is a separate filter field. Every filter path (four repositories, the hourly rollup reader, the web, the demo) would have to support it. That is an API redesign outside this plan.
- The exact model trend this plan adds is not affected. Its points are grouped by model and the chart only reads the IDs it asked for.
- In the page-filter case Codex describes, the chart draws exactly the rows the table shows, so chart and table agree. The extra rows come from the page filter.
- Before this branch, the same filter selected only "custom", so the selected model's data never showed at all. Triggering the extra rows needs an upstream model literally named like "X(high)", called with a second reasoning suffix, plus traffic on "X".
- The plan now records why exact matching needs a separate field.

Finding 3 (P3, whitespace breaks the ID round trip) — valid, fixed. Model IDs now stay exactly as stored at every step:
- Server filter: matches the value as sent, then its trimmed form and its reasoning-suffix-stripped form. The extra forms keep older filters working.
- Hidden second trim: three places (`usageevent/analytics.go`, `usagemonitoring/filter.go`, `usagemonitoring/event_filter.go`) ran model values through a generic helper that trimmed them again. The new end-to-end test caught this. Model values now skip that helper.
- Server `buildModelTimeline`: groups by the model string as stored, the same as `model_stats`.
- Web: `normalizeModelTrendId` no longer trims. Only blank and "-" mean "no model".
- Tests:
  - an end-to-end service test checks that "spaced (high)" gives the ID "spaced " in both `model_stats` and `model_timeline`, on the raw and hourly-rollup paths;
  - the unit tests for `buildModelTimeline` and `ModelFilterValues` were extended;
  - a web test checks that "custom " and "custom" stay separate series;
  - an older web test that sent a padded name for an unpadded row was corrected.

Finding 4 (P3, demo chart disagrees with its table) — valid, fixed.
- Cause: the demo always returns 14 daily buckets. With the default 24h range the page draws only the last two, and gpt-4.1 stopped at bucket 9, so it was a flat zero next to a 2,940 table row.
- Fix in `demoFixtures.ts`: each model's table totals are now spread only over the buckets the page actually draws, using the same rule as `fillUsageTimelineBuckets`. Sonnet's start and gpt-4.1's stop are now relative to those buckets, so the lines still differ in shape on any range. With the whole fixture in range, the output is unchanged.
- New test: for 24h, today, 7d and 30d it applies the page's own bounds and chart-building code. It checks that every drawn line adds up to its table row for requests, tokens and cost, and that gpt-4.1 is drawn. I confirmed it fails without the fix.
- The existing demo test used `Date.now()` as the range end, which would fail if that landed exactly on an hour. It now uses a fixed time.
- Trade-off: the demo table does not depend on the range, so on short ranges a model line can be higher than its overall timeline bucket. I chose agreement between the model chart and its table, which is what this finding asks for. The plan says so.

Verification:
- Go: `npm run manager-server:test` passes. `go test -race` passes for monitoring, usageevent, usagemonitoring and usageidentity.
- Web: `npm run test` passes (5,789 web tests and 266 repo tests). `type-check`, `lint`, `build` and `check:demo-isolation` all pass.
- `gofmt -l` lists 9 files this branch never touched; my changed Go files are clean. CI runs no Go formatter or linter, so I left those 9 alone.

The plan file records each decision above.

★ Insight ─────────────────────────────────────
- A refresh that "forces" a request and one that should replace a running request are different. The hook's own re-render path also calls `force: true`, so force alone couldn't mean "replace". Making replacement an explicit option, and comparing the full request against the running one, keeps the protection against overlapping fetches while letting a manual Refresh win.
- Finding 3 had a second trim hidden in a generic helper. The unit-level fix looked complete until the end-to-end raw-path test returned nothing. A test that sends the ID the server itself returned back to the server catches this kind of mismatch.
- A fixture is only "consistent" for a stated window. The demo's rows are 14-day totals, so the honest fix was to choose which pair must agree (chart and table) and allocate over what the page actually draws.
─────────────────────────────────────────────────
```
#### Iteration 3
- truncated: false
Reviewer output:
```
- **[P2] The model-filter dismissal leaves a backward-compatibility regression.** `apps/manager-server/internal/usageidentity/model.go:103` makes an existing `filters.models: ["custom(high)"]` request match both `custom` and `custom(high)`. Previously it matched only `custom`. When both identities have traffic, even a **summary-only** request now counts extra calls and cost. The string is ambiguous, as Claude notes, but that is a reason to make exact-ID matching opt-in—not to broaden legacy requests.
- **[P2] A pending refresh can still display stale buckets as exact.** `apps/web/src/features/usage-analytics/useUsageAnalytics.ts:515` checks for an error and an array, but not whether the array belongs to the current refresh. Superseding the old request is fixed. However, if the main response arrives before the replacement model response, the chart combines the new timeline with the retained model buckets and draws new hours as zero without the estimate hint. Use the fallback until the model response matches the displayed refresh.
- **[P3] The page filter still drops whitespace from model IDs.** The automatic trend follow-up now preserves `"spaced "`, but `apps/web/src/features/usage-analytics/usageAnalyticsModel.ts:2937` trims it when building dropdown options, and `apps/web/src/features/usage-analytics/usageAnalyticsModel.ts:777` trims it when sending the page filter. Even if `"spaced "` is the *only* identity, selecting it sends `"spaced"` and returns no usage. Preserve the option value and request ID verbatim.
- **[P3] A valid custom demo range still produces zero lines beside nonzero table rows.** The default 24-hour case is fixed. I verified that a historical **11:00–12:00** hourly range has zero visible fixture buckets: `apps/web/src/features/demo/demoFixtures.ts:3807` excludes the point at 12:00, and the preceding fixture point is a day earlier. The chart therefore shows zero for `gpt-4.1` while its row reports 2,940 calls. Generate an in-range bucket or derive the table totals from the same visible points.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings rigorously.Now the useMonitoringAnalytics hook in full to understand dataStale semantics.Starting the server-side fix for finding 1: legacy `filters.models` matching goes back to how it was, and exact identity matching becomes opt-in.Now the filter structs and the four repositories.I ran `gofmt -w` on all of internal/repository, which also touched files with older formatting issues. Checking what changed so I can revert anything outside this fix.Lint is web-only, and the extra gofmt changes are reverted. Next I'm updating the identity unit test and the comments for the two modes.Now the service test: legacy requests must match what they matched before this branch, and `exact_models` must select identities verbatim on both the raw and rollup paths.Now the demo fixture: it should mirror the `exact_models` matching, and add an in-range bucket when no fixture point falls inside the range (finding 4).Now extending the demo test with historical custom ranges that fall between fixture points.Confirming the new test catches the bug by turning off the fallback bucket for one run:Now implementing finding 2. The monitoring hook will expose the request that produced its current data:Now using it in the usage hook to show the estimate until the follow-up covers the same range as the displayed main response:Type-check is clean and the hook tests pass. Checking that the new race test fails without the range check:The race test fails without the fix and passes with it, and the code is restored. Now filing finding 3 to the backlog. First I'm checking the exact line references:Updating the plan so its decisions match the new behavior:Now running the full verification: Go tests (including race) and the web test, type-check, lint, demo-isolation and build.I fixed findings 1, 2 and 4, and filed finding 3 to the backlog. Nothing is committed, so the next Codex pass can check the fixes. All checks pass: the Go tests and race tests for the changed packages, go vet, 5,791 web tests, the repo tests, type-check, lint, demo-isolation and the build.

Finding 1 (P2, the model filter now matched more models for old requests): valid, fixed.
- Codex is right. An earlier fix in this branch matched every value both as given and in its shortened form. So an existing request for "custom(high)" also counted calls and cost for the separate model "custom(high)".
- filters.models now matches exactly as it did before this branch: values are trimmed and shortened to the base model name.
- Exact matching is now opt-in with a new flag, filters.exact_models. With it, values are matched exactly as given, with no trimming or shortening.
- The flag is passed through to every place that filters by model, including the hourly rollup path.
- Only the model trend follow-up request sends the flag. Older servers ignore it and fall back to the old matching, which is the same behavior as before.
- The service test now seeds events for both "custom" and "custom(high)", and for both "spaced" and "spaced ", on the raw and rollup paths. Without the flag, "custom(high)" selects only "custom" and the summary total matches. With the flag, it selects only "custom(high)".

Finding 2 (P2, a refresh could draw old model buckets as exact): valid, fixed.
- The analytics hook (useMonitoringAnalytics) now exposes dataRequest: the request that its current data answers.
- The usage hook treats the model trend as exact only when the follow-up and the displayed main response have the same from_ms, to_ms and now_ms. Until then it shows the estimate and the hint.
- This works in both arrival orders: main response first or follow-up first.
- New tests: one checks that dataRequest keeps the previous range until the new response arrives. Another simulates the main response arriving before the follow-up and checks that the estimate shows, then the exact lines return. That second test fails without the fix.

Finding 3 (P3, the page filter trims model ids): real, but filed to the backlog as docs/backlog/usage-page-model-filter-trims-model-identities.md (staged only).
- This branch never changed the page filter code, and it behaved the same way before: the old server matching also trimmed "spaced " to "spaced".
- The value is trimmed in five places: the option builder, the dropdown options, the saved page state, the URL, and the request builder.
- Fixing it means sending the page filter with exact_models and keeping the value unchanged in all five places. That is outside this plan, which covers the trend chart.
- With finding 1 fixed, the page filter behaves exactly as before this branch, so it is not a regression. The backlog entry gives this fix direction.

Finding 4 (P3, a short custom range in the demo draws zero lines): valid, fixed.
- For a past 11:00–12:00 range, no demo fixture point falls inside the range. In that case each model now gets one bucket at the last hour of the range, shaped like the latest fixture point. Each line then adds up to its table row.
- The demo also follows exact_models: values are used as given when it is set, and trimmed otherwise.
- The demo test now also covers past custom ranges of 11:00–12:00 and 09:30–12:00, and the follow-up in the test sends exact_models. The test fails without the fix ("expected 0 to be close to 4380").

I updated the plan's decision notes and technical details to match all of this.

One gofmt run also reformatted four unrelated files that were already unformatted before this branch. I reverted those, so they are not part of this change.

Insight:
- The bucket ranges in the refresh fix compare request parameters rather than response contents. The server's response has no range fields, so the request that produced the data is the only reliable record of what range it covers.
```
#### Iteration 4
- truncated: false
Reviewer output:
```
**[P2] A rolling refresh can still draw an unqueried hour as an exact zero.** `apps/web/src/features/usage-analytics/useUsageAnalytics.ts:535` compares the two retained requests, but `apps/web/src/features/usage-analytics/useUsageAnalytics.ts:384` fills the chart using the **new** bounds. I reproduced a refresh from 10:55 to 11:05: before either response arrives, both requests still match at 10:55, yet the chart draws an 11:00 point with value `0` and no estimate hint. Use the displayed main response’s `dataRequest` bounds to fill its timeline, or keep the estimate hint until both responses match the active range.

The fix handles either response arriving first; the remaining gap is **before either arrives**. The legacy model-filter and short custom-range demo fixes address their reported cases. Deferring the pre-existing dropdown trimming issue is reasonable.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex finding rigorously.The fix will go into the hook. First I'm changing the test mock so a main response can answer an older request. Then I'll add a test that fails on the current code.Next, the new test. It covers a refresh where neither response has arrived, so both still answer the old range.The new test reproduces the finding: the timeline starts one hour after the range the response answered. Now the fix. The timeline gets filled over the range the displayed response was requested for.All 31 hook tests pass, and the new test failed before the fix at the first-bucket check. Next I'm running the full web test suite, the type check and lint.Tests, type check and lint pass. Prettier flags the test file, so I'll format it and review what changed.The Codex finding was correct, and I fixed it without committing anything. A test reproduced it before the fix, and the full web suite passes after it.

[P2] Before either refresh response arrives, an unqueried hour is drawn as an exact zero: valid, fixed.
- Cause: the hook kept the old main response on screen after a refresh, because a rolling range keeps its scope key. It still filled that response's timeline over the new page bounds (useUsageAnalytics.ts, the old line "timelineBounds = include.timeline ? bounds : null"). Both responses still answered the old request, so the range check passed and the exact series kept the hint off. The series follows the main timeline's buckets, so the hour after the old range end was drawn as an exact 0. The main timeline chart drew the same zero.
- In scope: the plan's own code-review note says the hint should show "instead of the new hours drawn as exact zeros", and this case breaks that.
- Fix (apps/web/src/features/usage-analytics/useUsageAnalytics.ts): the main timeline is now filled over the from_ms/to_ms of the request the displayed main response answers, instead of the current bounds. Until the new responses arrive, the timeline, the exact model series and the API key series all keep the range that was actually queried. The range check between the two responses stays, so either one arriving first is still handled.
- Test (useUsageAnalytics.test.tsx): the mock can now hold a main response for an older request (mainDataRequest). The new test "draws only the range the displayed responses answer while a refresh is pending" refreshes one hour later while both responses still answer the old range. It checks that the timeline starts and ends where the old request did, that each model series has the same buckets, and that the exact values are unchanged. Once both responses answer the new range, it checks that the timeline moves to it. The test failed on the old code at the first-bucket check and passes now.
- Plan: added a note to the code-review section of docs/plans/20261120-exact-model-trend-timeline.md.

Filed to the backlog, not fixed here:
- docs/backlog/usage-api-key-trend-exact-zeros-after-refresh.md (minor, staged). The API key trend treats any returned api_key_timeline as exact, with no check for an error or a matching range. When the main response for the new range arrives first, the new hour is drawn as an exact zero for every key. That code is older than this branch, and this plan only covers the model trend. The fix is the same check the model trend uses.

Other changes:
- Prettier reformatted useUsageAnalytics.test.tsx. Most of that diff was formatting that was already wrong on HEAD (a nested ternary and some one-line act calls).

Checks:
- Full web suite: 326 files, 5792 tests, all pass.
- Type check and lint: clean.
- Prettier: clean on both changed files.

The other points in Codex's note need nothing new. Its own review already confirms the earlier fixes: either response arriving first, the legacy model filter, the short custom-range demo, and deferring the dropdown trimming issue.

Insight:
- Whatever is drawn needs to use the range of the response being shown, not the range the page will ask for next. Refreshing a rolling range keeps the old response on screen while the bounds move, so anything filled from the live bounds mixes two ranges.
- Fixing where the timeline is filled covers every chart that maps over its buckets at once. Adding a separate guard for each trend would not.
```
#### Iteration 5
- truncated: false
Reviewer output:
```
NO ISSUES FOUND

The refresh fix addresses the reported race. Before either response arrives, the chart uses the displayed main response’s bounds. If either response arrives first, the model chart shows the estimate until both responses cover the same range. The deferred API-key and dropdown issues are pre-existing and outside this plan.

```
Evaluator response:
```
Codex reported no issues. Before committing the accumulated fixes, I'll verify that the Go and web test suites and linters pass.Go tests pass. Web type-check, lint, and 5792 tests pass. gofmt flagged some files, so I'm checking whether the project enforces it and whether this branch touched any of those files.Codex found no issues in this round, so I committed the fixes from the earlier review rounds as 0f561675 ("fix: address codex review findings"). The working tree is now clean.

Checks I ran before committing:
- Go: build, vet and the full test suite pass. The changed Go files are correctly formatted. gofmt flags some other files, but this branch didn't touch them and CI doesn't check formatting.
- Web: type-check and lint are clean, all 5792 tests pass, and the demo-isolation check passes.

The commit has 22 files:
- 19 code and test files from the earlier review fixes, in the server and the web app.
- The updated plan document.
- Two backlog entries for problems that existed before this branch: the API key trend can draw refreshed hours as zeros, and the page's model filter trims and re-normalizes model names.

<<<RALPHEX:EXTERNAL_REVIEW_DONE>>>
```

## Validation
- none
- duration_ms: 0
- runs: 0