# Report: 2026 11 10 provider mode profile editor
plan: /Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/provider-mode-profile-editor/docs/plans/20261110-provider-mode-profile-editor.md | branch: provider-mode-profile-editor | base: main | mode: full | executor: claude | task model: claude:opus:high | review model: claude:opus:xhigh | started: 2026-11-10T20:09:39Z | finished: 2026-11-10T22:22:03Z

## Summary
- task iterations: 7
- failed retries: 0
- external reviewers: 1
- post-review iterations: 1
| phase | duration_ms |
|---|---:|
| evaluation | 446501 |
| external review | 308733 |
| internal review | 3913453 |
| other | 0 |
| tasks | 3275503 |

## Change scope
- commits: 11
- files: 43
- additions: 19089
- deletions: 431
| status | path |
|---|---|
| M | apps/docs/en/manual/guide.md |
| M | apps/docs/manual/guide.md |
| M | apps/web/src/features/guide/GuidePage.test.tsx |
| M | apps/web/src/features/guide/GuidePage.tsx |
| M | apps/web/src/features/guide/diagrams/README.md |
| A | apps/web/src/features/guide/diagrams/api-key-routing.html |
| A | apps/web/src/features/guide/diagrams/api-key-routing.workflow.json |
| M | apps/web/src/features/guide/diagrams/key-routing.html |
| M | apps/web/src/features/guide/diagrams/key-routing.workflow.json |
| M | apps/web/src/features/guide/diagrams/pool-selection.html |
| M | apps/web/src/features/guide/diagrams/pool-selection.workflow.json |
| M | apps/web/src/features/guide/guideWiring.test.ts |
| M | apps/web/src/features/personal-quota-support/services/api/routingProfiles.test.ts |
| M | apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts |
| M | apps/web/src/features/quota/clientKeysModal.lifecycle.test.tsx |
| M | apps/web/src/features/quota/components/ClientKeysModal.tsx |
| M | apps/web/src/features/quota/components/FallbackSettingsEditor.test.tsx |
| M | apps/web/src/features/quota/components/FallbackSettingsEditor.tsx |
| M | apps/web/src/features/quota/components/KeyProfileEditor.module.scss |
| M | apps/web/src/features/quota/components/KeyProfileEditor.test.tsx |
| M | apps/web/src/features/quota/components/KeyProfileEditor.tsx |
| A | apps/web/src/features/quota/components/ProviderRoutingBlock.module.scss |
| A | apps/web/src/features/quota/components/ProviderRoutingBlock.test.tsx |
| A | apps/web/src/features/quota/components/ProviderRoutingBlock.tsx |
| M | apps/web/src/features/quota/components/QuotaSettingsToolbar.tsx |
| M | apps/web/src/features/quota/components/RoutingProfilesModal.tsx |
| M | apps/web/src/features/quota/hooks/useKeyProfiles.ts |
| M | apps/web/src/features/quota/keyProfiles.lifecycle.test.tsx |
| M | apps/web/src/features/quota/keyProfiles.locale.test.ts |
| M | apps/web/src/features/quota/keyProfilesModel.test.ts |
| M | apps/web/src/features/quota/keyProfilesModel.ts |
| M | apps/web/src/features/quota/profilesKeysFlow.lifecycle.test.tsx |
| A | apps/web/src/features/quota/providerRoutingModel.test.ts |
| A | apps/web/src/features/quota/providerRoutingModel.ts |
| M | apps/web/src/features/quota/routingProfilesModal.lifecycle.test.tsx |
| M | apps/web/src/features/quota/useKeyProfiles.lifecycle.test.tsx |
| M | apps/web/src/i18n/locales/en.json |
| M | apps/web/src/i18n/locales/ru.json |
| M | apps/web/src/i18n/locales/zh-CN.json |
| M | apps/web/src/i18n/locales/zh-TW.json |
| M | docs/personal-quota.md |
| M | docs/plans/20261110-provider-mode-profile-editor.md |
| M | tests/installerScript.test.mjs |

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
- ➕ added exported helpers in `routingProfiles.ts`: `effectiveFallbackTarget`, `claudeFallbackOf` (legacy view), `providersFromClaudeFallback` (old-backend derivation, also used by test fixtures), `validClaudeMappings` (save guard, shared with `providerFieldErrors`: CPA checks the Claude mapping rows under every target but API key, so a hidden invalid table under target Off or in API key mode (saved as Off) blocks the save, with a message in the block; an older backend checks the `claude-fallback` rows under every target; at least one row is required only for the Codex target)
- ➕ `KeyProfileEditor` got an interim adapter (legacy toggle editor bound to `providers.claude.fallback`) so the build stays green until Task 4 replaces the layout
- ➕ `chainSummary` takes an optional fifth argument `ApiKeyLabelSource` (`apiCredentials` + `providerConfigs`) to name an API key; without it the key shows by its first 8 index characters. Task 4 passes it from `useKeyProfiles().apiKeyConfigs` and `state.apiCredentials` in `RoutingProfilesModal`, `ClientKeysModal` and `KeyProfileEditor`
- ➕ `useKeyProfiles` keeps `ApiKeyConfigSummary` (index, prefix, mask, base URL) instead of `ProviderKeyConfig`, so a raw upstream key never reaches React state; exposed as `apiKeyConfigs`
- ➕ `providerRoutingErrors` returns i18n keys per field (`apiCredential`, `mappings`); the mappings error reuses `quota_management.fallback.invalid`. Keys added now: `quota_management.provider_routing.{key_disabled,key_unknown,errors.key_required}` and the new `quota_management.key_profiles.summary.*` fragments (`to_codex`, `codex_forced`, `to_api_key`, `api_key`, `api_key_unset`); the unused `summary.fallback_*` keys were removed
- ➕ `intro_pool_selection` keeps its error sentences unchanged and gains a leading sentence on Subscription mode (OAuth credentials only) and API key mode (the profile's one key); `guideWiring.test.ts` also checks the English tab label and that the intros mention the API-key fallback
- ➕ verification found that `ClientKeysModal` still called `chainSummary` without API-key labels (an API-key-mode profile showed the first 8 index characters there); it now passes `state.apiCredentials` and `apiKeyConfigs` like `RoutingProfilesModal`, with a test in `clientKeysModal.lifecycle.test.tsx`
- ➕ lint: 0 errors, only the 7 known warnings from `docs/backlog/web-lint-warnings.md`
- ➕ the repo suite's `tests/installerScript.test.mjs` timed out at random at the 5s default (each case runs the real installer); its `describe` now has a 30s timeout
### Blocked
- none
### Skipped
- none

## Backlog
- none

## External review
### codex:gpt-6-astra:xhigh
- label: codex
- iterations: 2
- duration_ms: 755198
- ended by: done
- had findings: true
#### Iteration 1
- truncated: false
Reviewer output:
```
- **[P2] Clear ignored Codex fields when changing fallback target** — [routingProfiles.ts:394](/Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/provider-mode-profile-editor/apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:394). CPA accepts arbitrary fallback modes and invalid mapping rows under `target: api`, where they are ignored. Switching Codex to Off or API key mode sends only `fallback.target`; merge-PATCH retains those existing fields. CPA then validates them under `target: off` and rejects the save with `422 invalid_config`. The editor reports no validation error and provides no controls to repair these Codex fields. Explicitly clear or normalize them when writing the Codex fallback.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex finding with technical rigor.Writing the failing test first, next to the existing profileBody tests.Fails as expected. Now the fix in profileBody:Now the two existing expectations that encoded the old target-only body:Now aligning the plan text and any other comments that still say the Codex block sends only its target:Now the full verification: tests, typecheck, lint.Another test encoded the old body. Updating it:All 5353 tests pass, type-check is clean, lint has 0 errors. Checking whether the 7 lint warnings touch this branch's files:Codex finding [P2], "clear ignored Codex fields when changing fallback target": valid. I fixed it. Nothing is committed and there is no backlog entry.

Why it is real (checked in the backend fork CLIProxyAPI-migration):
- internal/config/provider_routing.go, normalize(): under target api, a stored Codex fallback mode or mapping list is only logged as ignored. Under target off, the same values go through normalizeFallbackRules, which requires mode to be "", auto or always and every mapping row to be valid.
- internal/api/handlers/management/config_v8.go, mergeConfigV8Patch: a PATCH merges into the stored config, so any key the panel leaves out keeps its old value. A null is kept and reads back as empty.
- The panel sent only fallback: {target} for Codex (routingProfiles.ts:394). Take a stored codex.fallback of {target: api, mode: bogus, mappings: [{from: "", to: ""}]}, from a hand edit or another client. Switching it to Off, or to API key mode (which forces target off), merges into an invalid block and CPA returns 422 invalid_config. The editor has no Codex mode or mapping controls, so the user can't fix it from the panel.
- The plan's decision "the Codex block sends only fallback.target" was deliberate, but it assumed CPA keeps no Codex mode or mappings. The backend shows it keeps them under target api, so the decision was wrong for that case and I updated it.

The fix:
- routingProfiles.ts, profileBody: the Codex block now sends fallback: {target, mode: null, mappings: null}. This matches how the body already clears api-credential and tiebreak with null. I chose null over mode: "auto": CPA logs an "ignored" warning when a mode is set under target api, and null avoids that warning.
- The read-back check is unchanged. normalizeProfile already treats the Codex fallback as target only, and what CPA now stores (empty mode, no mappings) reads back to the same profile.

Tests and docs:
- routingProfiles.test.ts: a new test reads a stored Codex target api block with mode bogus and an empty mapping row, switches it to off, and checks that the body clears mode and mappings. It failed before the fix and passes after. I also updated the two existing body expectations that used the old target-only shape.
- profilesKeysFlow.lifecycle.test.tsx: one exact-match expectation updated the same way.
- docs/personal-quota.md and docs/plans/20261110-provider-mode-profile-editor.md (the decision line, the Task 1 checkbox and the PATCH body example) now describe the new Codex body.

Verification (apps/web):
- vitest: 318 files, 5353 tests, all pass.
- tsc --noEmit: clean.
- eslint: 0 errors and 7 warnings. All 7 are in files this branch doesn't touch (AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx, UsageMaintenanceCapabilityViews.tsx), and the lint command still succeeds. I left them alone.
- prettier: the changed files pass.

Insight:
- The backend checks values it otherwise ignores only under some targets. Combined with a deep-merge PATCH, any field the panel never sends can carry an old invalid value into a later save. The safe rule is to send every field the backend checks for some target, even when the panel has no control for it.
```
#### Iteration 2
- truncated: false
Reviewer output:
```
NO ISSUES FOUND

The previous P2 finding is resolved. Sending `mode: null` and `mappings: null` clears stale Codex fallback values during merge-PATCH and remains compatible with read-back normalization. The regression test covers the reported failure case.

```
Evaluator response:
```
Codex found no issues, so this is the commit step. I'll use the verification-before-completion skill to make sure the accumulated fixes still pass before I commit them.The shell stayed in apps/web after the first command, so the second `cd` failed. I'll run everything from there: the full test suite, typecheck and lint.Lint has 0 errors and 7 warnings. Before committing I'll check which files the warnings are in.Codex found no issues this round. It confirmed that the earlier problem is fixed: the save now sends mode: null and mappings: null in the Codex fallback, so old values stored in CPA are cleared when the target switches to off.

I committed this loop's work as 307045fa ("fix: address codex review findings"). Five files are in it, all from the fix for that earlier finding:
- routingProfiles.ts: the Codex fallback in the save request now also sends mode: null and mappings: null alongside the target.
- routingProfiles.test.ts: expected request bodies updated, plus a regression test that switches a stored Codex fallback from api to off.
- profilesKeysFlow.lifecycle.test.tsx: expected Codex block updated.
- docs/personal-quota.md and docs/plans/20261110-provider-mode-profile-editor.md: the documented request body now matches the code.

Checks run before committing:
- Tests: all 5353 passed across 318 files.
- Typecheck: passed.
- ESLint: 0 errors. There are 7 warnings, all in files this branch doesn't touch (AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx, UsageMaintenanceCapabilityViews.tsx).

The working tree is clean and nothing was filed to the backlog.

Insight:
- The save is a merge-PATCH, so any key left out of the body keeps its stored value. Sending null is the only way to remove a field, which is why the body carries explicit nulls instead of just dropping mode and mappings.
- CPA treats the Codex fallback differently by target: under api it accepts any stored mode and mapping rows, but under off it checks them. So a bad value saved earlier only causes a failure on the later switch to off, which is why the regression test starts from mode "bogus" and an empty mapping row.

<<<RALPHEX:EXTERNAL_REVIEW_DONE>>>
```

## Validation
- none
- duration_ms: 0
- runs: 0