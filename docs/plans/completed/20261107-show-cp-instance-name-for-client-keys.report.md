# Report: Show the bridex instance name for CP-issued client keys

Plan: `docs/plans/20261107-show-cp-instance-name-for-client-keys.md` · Branch: `show-cp-instance-name-for-client-keys` · Base: `main` · Mode: full · Executor: claude · Task model: claude:opus:high · Review model: claude:opus:xhigh · Started: 2026-11-07T21:46:01Z · Finished: 2026-11-07T22:20:14Z

## Summary
Client keys issued by the bridex CP (`sk-bx-<instance name>-<32 base62>`) used to show only as an anonymous mask. A CP key with no stored alias is now labelled with its instance name. This only changes how the web panel displays keys. Nothing is persisted, and the CLIProxyAPI, the Manager Server and `bridex-cp` are unchanged.

- **Parser:** the new pure helper `cpInstanceNameFromKey` (`apps/web/src/utils/apiKeyName.ts`) uses the CP's own instance-name rule, plus `_placeholder`.
- **Label order:** `buildApiKeyDisplayMap` now picks the label in this order: stored alias, then the sanitized instance name, then the mask.
- **Where it shows:** the name appears in the Client keys and Routing profiles modals, in monitoring and in usage analytics. A stored alias still wins, and keys that are not in the CP format look the same as before.
- **Added during internal review:**
  - When a derived name is also used by another label (a second key of the same instance, or another key's alias), the key's mask is appended to it, as in `ecwowk (sk******45)`.
  - The new `labelShowsMask` stops the modals and the monitoring key summary from showing the mask twice.
- **Docs:** the "How keys are shown" paragraph in `docs/personal-quota.md` was rewritten.
- **Backlog:** two follow-up items were filed.

Run shape: 4 task iterations with 0 failed retries. Internal review ran 2 loop iterations and ended by `review_done`. External review ran 1 iteration with no findings. Post-review did not run.

Phase durations, which cover the work through finalize:

| phase | duration_ms | ≈ |
|---|---:|---|
| tasks | 453239 | 7m 33s |
| internal review | 1443984 | 24m 04s |
| external review | 143474 | 2m 23s |
| evaluation | 12135 | 12s |
| other | 0 | 0s |

Finalize did not run, so there was no base sync. The diff below is against local `main`.

## Change scope
16 files changed, 373 additions and 31 deletions, in 6 commits.

- **Production code (6 files):**
  - `apps/web/src/utils/apiKeyName.ts` (new, the parser).
  - `apps/web/src/features/monitoring/model/apiKeys.ts`: derived label, mask suffix for shared names, new `labelShowsMask`.
  - `apps/web/src/features/quota/keyProfilesModel.ts`: `hasAlias` is now `!labelShowsMask(label, masked)`.
  - `apps/web/src/features/monitoring/components/ApiKeySummaryPanel.tsx`: the secondary text uses `labelShowsMask`.
  - `ClientKeysModal.tsx` and `RoutingProfilesModal.tsx`: doc comments only.
- **Tests (6 files):**
  - `apiKeyName.test.ts` (new).
  - Updated: `useMonitoringData.test.ts`, `keyProfilesModel.test.ts`, `eventRows.test.ts`, `usageAnalyticsModel.test.ts`, `ApiKeySummaryPanel.test.tsx`.
- **Docs (4 files):**
  - `docs/personal-quota.md`.
  - The plan file (checkboxes and ➕ items).
  - Two new backlog files in `docs/backlog/`.

Commits, oldest first:
- `8ebb0aee` feat: add CP instance name parser for client keys
- `3bc2614a` feat: label CP client keys with their instance name
- `75245f79` feat: verify CP instance name labels against acceptance criteria
- `dd80e3d4` feat: document CP instance name labels for client keys
- `4e44871b` fix: address code review findings
- `85ee4c24` fix: address code review findings

## Evidence
none

loopai recorded no validation run (0 commands, 0 runs), so there is no recorded before/after output.

- **Tests in the diff:** they pin the new behaviour, for example:
  - `labels a CP key without an alias with its instance name`
  - `lets a stored alias override the derived instance name`
  - `keeps the masked label for keys outside the CP format`
  - `masks a CP instance name that looks like a key`
  - `adds the mask to two keys of one CP instance so their labels differ`
  - `cpInstanceNameFromKey` match and non-match cases
- **Not recorded as proof:** no run shows these tests failing before the change and passing after it.
- **Plan's own claim:** Task 3 says that `npm test`, `npm run type-check` and `npm run lint` passed. That is the executor's statement, not output loopai recorded.

## Risk
**low**

- **Public APIs:** none changed. No HTTP endpoint, Management API call or Manager Server contract is touched. `cpInstanceNameFromKey` and `labelShowsMask` are new exports used only inside the web app.
- **Data schemas:** none. Derived names are computed at render time and never written as aliases. Alias deletion still checks only stored aliases.
- **Configuration:** none. The monitoring UI state persists `selectedApiKeyHash`, not labels, so saved selections are unaffected.
- **Concurrency:** none. The new logic is pure, synchronous and runs over in-memory maps.
- **Migrations:** none.
- **Remaining exposure:**
  - **Display changes:** CP keys get new labels on four surfaces. When names are shared, the label-only lists (selects, filters, ranks) show `name (mask)`.
  - **Cross-repo format:** the `sk-bx-…` format belongs to `bridex-cp`. If it changes, the labels quietly fall back to the mask.
  - **Over-masking:** a known issue now reaches more labels. A name such as `task-runner` is shown as `task******er` (filed to backlog).

## Merge danger
**Door:** two-way
The change only affects display and stores nothing, so a plain revert brings back the old mask-only labels.

**Blast radius:** UI
Only key labels in the web panel change: the Client keys and Routing profiles modals, monitoring and usage analytics.

## Migrations and operational steps
none

## Plan deviation
All four planned tasks (parser, display-map label, acceptance check, docs) are checked off and match the plan.

**Added (3 items):**
- ➕ (code review) When a derived name is also used by another label, the key's mask is appended (`ecwowk (sk******45)`). Tests are in `useMonitoringData.test.ts` and `usageAnalyticsModel.test.ts`. This was implemented in `apiKeys.ts`.
- ➕ (code review) The new `labelShowsMask` stops the mask from showing twice in the modal rows and the monitoring key summary. Tests are in `keyProfilesModel.test.ts`, `ApiKeySummaryPanel.test.tsx` and `useMonitoringData.test.ts`. This was implemented in `apiKeys.ts`, `keyProfilesModel.ts` and `ApiKeySummaryPanel.tsx`.
- ➕ (Technical Details) A shared derived name gets the mask appended. This only notes the first item in the label rule; it is not separate work.

**Blocked:** none.
**Skipped:** none.

**Other differences from the plan text:**
- **Decisions said "nothing else changes":** that is no longer true.
  - `buildKeyRows` `hasAlias` changed from `label !== masked` to `!labelShowsMask(label, masked)`.
  - The alias loop now also clears the "named" flag (`named.delete(hash)`).
  - `ApiKeySummaryPanel.tsx`, which the plan did not list, was changed.
  - The plan's Technical Details line "`hasAlias` … stays `label !== masked`" is now stale.
- **Docs paragraph:** it goes beyond the planned bullets. It also says that usage analytics shows the name without the mask, describes the shared-name suffix, and notes that names such as `task-runner` get masked.
- **Unplanned files:** the two backlog files.

## Backlog
- **Config page key list ignores CP instance names** (`docs/backlog/config-api-keys-list-cp-names.md`; minor; found in internal review)
  - Problem: `ApiKeysCardEditor.tsx` titles keys with `alias || <generic label>` and does not use `buildApiKeyDisplayMap`, so CP keys still get the generic title there.
  - Disposition: filed to backlog, open. It needs a product decision: either show derived names there or document the screen as an exception.
- **Key masking also hits `sk-` inside ordinary words** (`docs/backlog/sensitive-text-mask-matches-inside-words.md`; minor; found in internal review)
  - Problem: `API_KEY_MASK_REGEX` has no left boundary, so a valid instance name such as `task-runner` is shown as `task******er`.
  - Disposition: filed to backlog, open. The current behaviour is documented in `docs/personal-quota.md`.

## External review
### codex:gpt-6-astra:xhigh
- label: codex
- iterations: 1
- duration_ms: 155556
- ended by: done
- had findings: false
- iteration 1 truncated: false

Findings: none. The reviewer output was `NO ISSUES FOUND`. The evaluator checked that the working tree, the index and HEAD had no differences, made no changes or commits, and filed nothing to backlog.

## Validation
- Commands: none
- Timings: duration_ms 0, runs 0

The plan's Task 3 reports these results, but loopai did not record the runs:
- `npm test`: 312 web files / 5177 tests and 16 repo files / 266 tests passed.
- `npm run type-check`: passed.
- `npm run lint`: 0 errors and 7 warnings. The warnings are older, in files this branch does not touch, and tracked in `docs/backlog/web-lint-warnings.md`.