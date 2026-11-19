# Report: 2026 11 18 codex speed panel ui
plan: /Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/codex-speed-panel-ui/docs/plans/20261118-codex-speed-panel-ui.md | branch: codex-speed-panel-ui | base: main | mode: full | executor: claude | task model: claude:opus:high | review model: claude:opus:xhigh | started: 2026-11-18T20:18:03Z | finished: 2026-11-18T23:07:17Z

## Summary
- task iterations: 1
- failed retries: 0
- external reviewers: 1
- post-review iterations: 1
| phase | duration_ms |
|---|---:|
| evaluation | 6211154 |
| external review | 1852272 |
| internal review | 1977377 |
| other | 0 |
| tasks | 113641 |

## Change scope
- commits: 13
- files: 46
- additions: 4716
- deletions: 500
| status | path |
|---|---|
| M | apps/web/src/features/personal-quota-support/services/api/client.ts |
| M | apps/web/src/features/personal-quota-support/services/api/config.test.ts |
| M | apps/web/src/features/personal-quota-support/services/api/config.ts |
| M | apps/web/src/features/personal-quota-support/services/api/routingProfiles.test.ts |
| M | apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts |
| M | apps/web/src/features/personal-quota-support/stores/useConfigStore.test.ts |
| M | apps/web/src/features/personal-quota-support/types/config.ts |
| M | apps/web/src/features/quota/QuotaPage.lifecycle.test.tsx |
| M | apps/web/src/features/quota/clientKeysModal.lifecycle.test.tsx |
| A | apps/web/src/features/quota/codexSpeedModal.lifecycle.test.tsx |
| A | apps/web/src/features/quota/codexSpeedModel.test.ts |
| A | apps/web/src/features/quota/codexSpeedModel.ts |
| D | apps/web/src/features/quota/components/CodexFastMode.module.scss |
| D | apps/web/src/features/quota/components/CodexFastMode.tsx |
| A | apps/web/src/features/quota/components/CodexSpeedModal.module.scss |
| A | apps/web/src/features/quota/components/CodexSpeedModal.tsx |
| M | apps/web/src/features/quota/components/KeyProfileEditor.test.tsx |
| M | apps/web/src/features/quota/components/KeyProfileEditor.tsx |
| M | apps/web/src/features/quota/components/ProviderRoutingBlock.test.tsx |
| M | apps/web/src/features/quota/components/ProviderRoutingBlock.tsx |
| M | apps/web/src/features/quota/components/QuotaSettingsToolbar.tsx |
| M | apps/web/src/features/quota/components/RoutingProfilesModal.tsx |
| D | apps/web/src/features/quota/hooks/useCodexFastMode.ts |
| M | apps/web/src/features/quota/hooks/useKeyProfiles.ts |
| M | apps/web/src/features/quota/keyProfiles.lifecycle.test.tsx |
| M | apps/web/src/features/quota/keyProfiles.locale.test.ts |
| M | apps/web/src/features/quota/keyProfilesModel.test.ts |
| M | apps/web/src/features/quota/keyProfilesModel.ts |
| M | apps/web/src/features/quota/profilesKeysFlow.lifecycle.test.tsx |
| M | apps/web/src/features/quota/providerRoutingModel.test.ts |
| M | apps/web/src/features/quota/quotaSettingsHooks.test.ts |
| M | apps/web/src/features/quota/quotaSettingsToolbar.test.ts |
| M | apps/web/src/features/quota/routingModel.ts |
| M | apps/web/src/features/quota/routingProfilesModal.lifecycle.test.tsx |
| M | apps/web/src/features/quota/settingsHooks.lifecycle.test.tsx |
| M | apps/web/src/features/quota/useKeyProfiles.lifecycle.test.tsx |
| M | apps/web/src/i18n/locales/en.json |
| M | apps/web/src/i18n/locales/ru.json |
| M | apps/web/src/i18n/locales/zh-CN.json |
| M | apps/web/src/i18n/locales/zh-TW.json |
| A | docs/backlog/cpa-empty-claude-fallback-node-drops-legacy-block.md |
| A | docs/backlog/cpa-patch-etag-names-reread-file.md |
| A | docs/backlog/manager-server-proxied-cors-headers.md |
| A | docs/backlog/quota-modals-focus-lost-on-write.md |
| M | docs/personal-quota.md |
| M | docs/plans/20261118-codex-speed-panel-ui.md |

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
- ➕ (external review) the table writes through `useKeyProfiles.saveCodexSpeed(key | null, patch)`: inside the write slot it reads the profiles again, applies `withCodexSpeed` to the stored key profile or a `copyOfShared` of the stored Default profile and saves it with the read-back check; for the Default row it calls `routingProfilesApi.saveSharedCodexSpeed(patch)`, which PATCHes the changed Codex field alone and reads that field back; when the reread shows `supported: false` for a key, no speed, an unsupported backend, a row whose speed is unused, or a row that already holds the clicked values, it shows that state and writes nothing. This replaces the `saveShared` / `saveKeyProfile` calls of the modal named above
- ➕ (external review) the key row write of `saveCodexSpeed` is conditional on the config ETag read before the profiles (`routingProfilesApi.configSnapshot`, `If-Match` on the PATCH); a 412 is `ConfigChangedError`, which shows `key_profiles.errors.config_changed` and reloads
- ➕ (external review) a key that owns a profile in that config snapshot gets `routingProfilesApi.saveKeyCodexSpeed`: the changed Codex field alone, merged and conditional, read back for that field; a snapshot and profiles that disagree on whether the key owns a profile raise `ConfigChangedError` before any write
- ➕ (external review) a key on the Default profile gets `routingProfilesApi.saveKeyDefaultCopy`: an empty conditional PATCH that makes CPA load the version, a check that the Default read after it is the one copied (`ConfigChangedError` otherwise), then the complete copy conditional on the `ETag` of the empty write (`apiClient.patchRaw`), read back; `configSnapshot` accepts only a single strong `ETag` (`strongETag`)
- ➕ (external review) a failed read-back of the copy, one that shows another key profile or another Default beside the copy, or a copy PATCH without CPA's answer raises `DefaultCopyUnconfirmedError` (`key_profiles.errors.copy_unconfirmed`, reload); the copy is never deleted again; a key row whose key the config read no longer lists raises `UnknownApiKeyError` before any write or no-op
- ➕ (external review) `configSnapshot` also returns `legacyClaudeFallback` (`dropsLegacyClaudeFallback` on the raw shared profile and each key profile), `saveCodexSpeed` reads it for the Default row too, and a write is refused with `LegacyClaudeFallbackError` (`key_profiles.errors.legacy_fallback_default` / `legacy_fallback_key`) while the Default profile, or the key's own profile for a key speed write, has that shape
- ➕ (external review) a user reload (`reload`) clears the save error only once its load succeeds, so a failed **Refresh** keeps the write's warning beside `reload_failed`
- ➕ (external review) the check after the empty write also refuses the copy when key profiles are no longer used (`supported: false`) or the speed is gone; a copy write that fails with CPA's `write_failed` is unconfirmed; a reload that fails after a failed write adds `reload_failed` to the error
- ➕ (external review) under `supported: false` a key row shows the Default profile's speed and flag, which its requests get, also for a key with its own profile; the badge still names the own profile
- ➕ (external review) the table rows are rendered by a child component, so a closed modal builds no rows
- ➕ (review) in Codex API key mode the editor's Speed row and the table row stay enabled, with the `claude_fallback_hint` note, when the profile's Claude falls back to Codex; this amends the API key mode rule of Tasks 4 and 5. `codexSpeedUse(providers, modeLocked)` in `codexSpeedModel.ts` is the one rule for both: `buildSpeedRows` uses it, and `KeyProfileEditor` passes its result to `ProviderRoutingBlock` as `speedUse`
### Blocked
- none
### Skipped
- none

## Backlog
| status | path | title |
|---|---|---|
| A | docs/backlog/cpa-empty-claude-fallback-node-drops-legacy-block.md | A routing write drops an enabled legacy claude-fallback next to an empty providers.claude.fallback |
| A | docs/backlog/cpa-patch-etag-names-reread-file.md | CPA's config write answers with the ETag of a file it read again, not the one it wrote |
| A | docs/backlog/manager-server-proxied-cors-headers.md | Cross-origin panel cannot use CPA routes proxied by manager-server |
| A | docs/backlog/quota-modals-focus-lost-on-write.md | Keyboard focus is lost when a quota modal disables its controls for a write |

## External review
### codex:gpt-6.2-astra:xhigh
- label: codex
- iterations: 10
- duration_ms: 8063394
- ended by: max_iterations
- had findings: true
#### Iteration 1
- truncated: true
Reviewer output:
```
- **P2 — A speed click can overwrite unrelated routing changes.** `apps/web/src/features/quota/components/CodexSpeedModal.tsx:53` saves the entire profile from when the table loaded. If another tab changes the preferred account or fallback before the click, the speed write silently restores the old setting, and read-back verifies that stale snapshot as successful. Patch only the changed Codex field for existing profiles; reserve the full copy for creating a key profile.
- **P2 — Read-only key rows show the wrong effective speed.** `apps/web/src/features/quota/codexSpeedModel.ts:79` uses the key’s own profile even when `supported` is false. With a scheduler plugin, a key stored as Ultrafast can therefore show Ultrafast while its requests actually use the shared Standard speed. Use the shared speed and flag for those rows, or label the stored override separately as inactive.
- **P3 — The API-key hint incorrectly promises that requests never get a tier.** `apps/web/src/i18n/locales/en.json:5653` says API-key requests never get a speed tier, but the backend leaves those requests untouched: a client-supplied `priority` tier can still pass through. The editor and table hints should say the *profile* does not set or override the tier.
- **P3 — The closed speed table still builds every row.** `apps/web/src/features/quota/components/CodexSpeedModal.tsx:213` maps every key into translated controls even when the modal is closed. The toolbar’s ten-second activity poll repeats that work on the quota page. Defer row rendering until the table opens.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Evaluating the four Codex findings: I've read the modal, the speed model, the hook and the plan, and I'm now checking backend behavior for the API-key tier and the merge-PATCH semantics.Findings 1, 2, 3 and 4 all look valid after checking the backend. Next I'm reading the hook's existing save tests so the new re-read-then-write path matches their style.Now implementing. First the hook: a `saveCodexSpeed` that re-reads the stored profiles inside the write slot and applies only the speed change to them.My scripted replace matched an empty string and blew up the file. The file was clean at HEAD before my edits, so I'm restoring it and redoing the edits with exact replacements.Hook is in place. Now the modal: it calls `saveCodexSpeed`, and the table moves into its own component so a closed modal builds no rows (finding 4).Now finding 2: under `supported: false`, key rows show the shared speed and flag that CPA actually applies.Now the model change for finding 2:Adding a model test for the read-only rows:Finding 3: the backend leaves API-key requests untouched, so a client-supplied tier passes through. Rewriting the three hints in all four locales, then checking docs and comments for the same claim.Reflowing that comment:Updating the speed table docs for the reread-before-write and the read-only rows:Now the tests. First, the modal lifecycle tests move from `saveKeyProfile`/`saveShared` to `saveCodexSpeed`:Now the write assertions in the modal tests:Now the hook tests for `saveCodexSpeed`. Checking how the existing connection-change test switches revisions:Running the affected test files first:All 123 pass. Now the full suite, type-check and lint:Tests pass (5505) and lint has 0 errors, but type-check failed. Looking at the error:Type-check passes now. Prettier flags three files; checking they were clean at HEAD before formatting them:Formatting fixed. Now the plan: recording the changed write path and the read-only row values in Decisions, Task 5, Technical Details and the Decision Log.The plan's test mapping names three modal tests I renamed; updating it:Two SCSS files fail the Prettier check. Checking whether this branch touched them:I checked all four Codex findings against the code, the plan and the backend. All four were real, and I fixed all of them; none went to the backlog. Nothing is committed, and there is no done signal because there were fixes. The full web suite (325 files, 5505 tests) and type-check pass. Lint has 0 errors; its 7 warnings are in files this branch doesn't touch.

- P2, a speed click undoes other routing changes (apps/web/src/features/quota/components/CodexSpeedModal.tsx:53). Valid. The plan chose to write the whole profile, but it never considered that the table keeps the profiles it loaded on open. If another tab changes the preferred account and the user then clicks a speed, the old account comes back. The read-back then compares against that old copy and reports success.
  Fix: useKeyProfiles has a new saveCodexSpeed(key or null, patch). Before writing, it reads the stored profiles again. It applies only the speed change to the current key profile or Default profile. A key without its own profile gets a copy of the current Default profile. It still writes through the existing save functions, with the read-back check. If the fresh read shows the change no longer applies (key profiles unused, no speed support, or an older backend), it shows that and writes nothing. The modal now calls only saveCodexSpeed.
  I did not use Codex's suggestion of a 
[truncated]
```
#### Iteration 2
- truncated: true
Reviewer output:
```
- **P2 — A Default speed edit can still overwrite a concurrent change.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:285` re-reads the profile, but then writes it in full. If two tabs read the same Default profile and one changes the speed while the other changes the flag, the later PATCH can undo the first. The concern about accidentally creating a partial key profile does not apply to Default. PATCH only the changed Codex field there and verify that field on read-back.
- **P2 — The save can write to a row that is now disabled.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:274` checks backend capabilities but not the fresh profile’s `codexSpeedUse`. If another tab switches Codex to API-key mode with no Claude fallback, a stale click still saves the speed and can even create an own profile for an inherited key. When the fresh profile reports `unused`, show the refreshed state without writing.
- **P3 — A no-op can detach a key from Default.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:295` copies Default without checking whether the requested value is already effective. If Default changed from Standard to Fast after the table opened, clicking Fast on an inherited key creates an override even though its speed is already Fast. Compare the requested field with the fresh value before creating the profile.
- **P3 — The API-key hint still promises more than the backend guarantees.** `apps/web/src/i18n/locales/en.json:5653` says the client tier passes through unchanged. The *profile* leaves it alone, but the Responses translator runs first: it maps `fast` to `priority` and drops `flex`. Remove the unchanged-pass-through claim from the localized hints and matching docs; the table’s “profile does not set or override” wording is accurate.

The read-only rows now correctly show Default values, and the closed modal no longer builds rows.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Evaluating Codex's four findings: next I'm reading the shared-profile PATCH body and read-back in routingProfiles.ts to judge finding 1.Finding 1 looks plausible since the shared PATCH is a deep merge. Next I'm checking the backend to confirm the merge semantics and the translator's tier mapping for finding 4.The modal and flow tests confirm the scope. Now the locale strings for finding 4.Fixing finding 4 first (wording only): dropping the "passes through unchanged" clause in all four locales, the docs, and the model comment.Finding 4 done. Now finding 1: adding a Default-only Codex speed PATCH to the routing profiles service. Looking at the type section first.The service already depends on quota models, so to avoid a runtime import cycle I'll define the patch type and the "already holds" check in the service and re-export the type from codexSpeedModel.Now pointing codexSpeedModel at the moved type:Now the tests. Checking how effectiveFallbackTarget derives Claude's target so the "unused" fixture is right.Adding service tests for the Default-only PATCH and the "holds" check:Now the hook tests: retarget the Default-row assertions to the new service call and add cases for findings 2 and 3.Now the end-to-end flow test that asserted the old full-profile body for the Default row:All 222 tests in the affected files pass. Now updating the docs paragraph on how the table saves:Docs updated (that on-disk change is mine). Now the plan file: amending the Decisions, Task 5 item, Technical Details, the test mapping, and the Decision Log.Now the full verification: complete web test suite, type-check and lint.The committed versions were Prettier-clean, so the drift is from my additions. Formatting both test files:Formatting is clean and the reformatted tests still pass. A last look at the final hook logic:I checked all four findings against the code and the backend's management API doc, and all four were real. All four are fixed and nothing is committed yet; the next review pass will see the changes.

Verification: npm run test:web passes (325 files, 5513 tests), npm run type-check is clean, and npm run lint shows 0 errors. Its 7 warnings were there before and sit in files this branch does not touch. Prettier passes on every changed .ts and .tsx file.

- P2, a Default speed edit could overwrite a concurrent change: valid and fixed. The backend doc says PATCH merges objects (management-api-v8.md lines 31 and 670), and the Default profile always exists, so the "partial PATCH creates a partial profile" risk only applies to keys.
  - New routingProfilesApi.saveSharedCodexSpeed(patch) sends only the changed field, for example {"routing":{"providers":{"codex":{"speed":"fast"}}}}. On read-back it checks only that field, so another tab's change made in the meantime is kept and does not fail the check.
  - Key rows still send the complete profile.
  - The patch type and a new holdsCodexSpeed helper live in routingProfiles.ts. codexSpeedModel.ts re-exports the type, which avoids an import cycle between the two files.
- P2, a save could write to a row that is now disabled: valid and fixed. After re-reading, saveCodexSpeed now runs codexSpeedUse on the row's current effective profile, using the same mode lock as buildSpeedRows. If the result is unused, it shows the refreshed state and writes nothing, so a key still on the Default profile no longer gets its own profile. Under supported: false the Default row still saves even with a stored API key mode, because the backend ignores the mode there.
- P
[truncated]
```
#### Iteration 3
- truncated: true
Reviewer output:
```
The four findings from the last pass are fixed as described. Three issues remain:

- **P2 — A key-row save can still overwrite a concurrent edit.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:299` writes the entire key profile unconditionally. If another tab changes the preferred account or deletes the profile after the reread, the speed click restores the old profile and read-back reports success. Contrary to the review log, the backend checks `If-Match` and returns `412` for a stale config ETag (`/Users/echeg/Projects/CPA/CLIProxyAPI-migration/internal/api/handlers/management/config_v8.go:36`). Capture the config ETag before rereading profiles and condition the PATCH on it.
- **P2 — A speed-only edit can erase stored fallback settings without any race.** The same key-row save uses the editor serializer, which explicitly sends `null` for Codex fallback mode and mappings (`apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:436`). The backend permits and retains both under `target: api`. Changing only the speed therefore deletes unrelated stored values, and creating a key profile from Default fails to copy them. Preserve those fields when the speed edit does not change the fallback target.
- **P3 — The flag hint still overstates when the client tier wins.** `apps/web/src/i18n/locales/en.json:5651` says the profile speed applies “only when the client sends none.” With the flag off, a Responses client can send `flex`, have translation drop it, and still get the profile speed. The API-key hint is now accurate; the flag hint and `docs/personal-quota.md:160` should say the profile speed applies when no tier remains **after translation**.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Checking whether the backend's If-Match support is usable from the panel (zsh globbing tripped the grep).Still evaluating finding 1 (If-Match): looking for the review log Codex refers to and the progress file.Finding 1 confirmed technically possible (backend has If-Match since 2026-10-16, CORS exposes ETag). Now checking finding 2: whether Codex fallback mode/mappings mean anything to the backend.Plan for finding 1: read the config ETag before the reread and send it as If-Match on the key-row PATCH. First confirming the manager-server proxy passes If-Match and ETag through unchanged.Proxy forwards both headers. Now checking how the locale test covers `key_profiles.errors.*` keys, so a new error string is verified in all four locales.Now implementing finding 1. Service layer first: a `ConfigChangedError` for 412, a `configVersion()` reader, and an optional If-Match on `saveKeyProfile`.Now the hook: read the version before the reread for key rows, pass it as If-Match, and show a dedicated message on 412.Now the locale strings: the new `config_changed` error (finding 1) and the corrected flag hint (finding 3), in all four locales.Checking whether any test or doc quotes the old hint wording.Now the docs for finding 3, and the table-save paragraph for finding 1.Now the tests. Service tests first; reading the existing write-error tests to match their style.Adding service tests for the ETag read, the conditional PATCH, and the 412 mapping.Service tests pass (114). Now the hook tests: a default `configVersion` mock, updated key-row call assertions, and new cases for call order and the 412 path.Hook tests pass (62). Tidying the 412 test, which has an unused reload stub.Updating the end-to-end key-row flow test to stub the ETag read and assert the PATCH carries If-Match.The second anchor matched more than once, so the script wrote nothing. Retrying with a unique anchor.Affected tests pass. Now recording the decisions in the plan file (Decisions, Technical Details, test map, Decision Log).Running the full verification: web tests, type-check, lint, and Prettier on the changed files.All 5518 tests pass, type-check is clean, and lint has 0 errors (the 7 warnings are the existing ones in files this branch doesn't touch). One Prettier issue, in a line I added; fixing it.I checked all three findings against the code and the backend. Findings 1 and 3 are real and fixed. Finding 2 is not, explained below. Nothing is committed and nothing went to the backlog, since all three are about this branch's own code.

Verification: npm run test:web passes (325 files, 5518 tests), npm run type-check is clean, npm run lint has 0 errors (its 7 warnings were already there, in files this branch does not touch), and Prettier passes on every file I changed.

- P2, a key-row save could undo a change made in another tab: valid, fixed. The backend checks If-Match on /config writes against a hash of the config file and answers 412 when it changed (config_v8.go:36, added 2026-10-16). It exposes ETag over CORS, and the manager-server proxy passes both headers through. The panel just never used them.
  - New routingProfilesApi.configVersion() reads the ETag from GET /config, or returns "" when the backend sends none.
  - saveKeyProfile takes an optional ifMatch argument and only then sends the If-Match header. The editors still call it without one, so they behave as before.
  - In saveCodexSpeed, a key row now reads the version before the profiles and passes it to the PATCH. If the config changed after that read, 
[truncated]
```
#### Iteration 4
- truncated: true
Reviewer output:
```
The revised client-tier hint is accurate, and the `412` handling correctly protects against another tab saving after the ETag read. Three findings remain:

- **P2 — Cross-origin key-row saves fail through manager-server.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:576` adds `If-Match`, but manager-server answers `OPTIONS` itself and omits `If-Match` from its allowlist at `apps/manager-server/internal/http/middleware/cors.go:39`. When the panel and manager are on different origins, the browser blocks the PATCH before CPA receives it. Allow `If-Match` in the manager’s preflight response and test that path.
- **P2 — The ETag and profile can describe different config versions.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:287` reads an ETag for the **on-disk** config, then builds the write from `/routing/profiles`, which reads CPA’s **in-memory** config. If a file edit changes a key’s preferred account before the first read but hot reload is still pending at the second, the PATCH carries the new ETag and the old account. It succeeds and undoes the edit. Build the key-row change from the same persisted snapshot that supplied the ETag.
- **P3 — A speed-only click still clears stored fallback settings.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:309` uses the full editor serializer, which sends `null` for Codex fallback mode and mappings at `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:448`. Claude is right that CPA ignores those values under `target: api`, but CPA retains them: the click changes unrelated configuration, and a new key does not receive the promised complete copy. Preserve those fields on speed-only writes.

```
Evaluator response:
```
I'll use the superpowers:receiving-code-review skill, since this task is evaluating external review feedback.Let me read the plan and the code at the reported locations.Now let me trace finding 1: how the panel's requests reach CPA, and who answers the preflight.Finding 1 traced. Now finding 2: whether `GET /config`'s ETag and `GET /routing/profiles` really read different sources in CPA.The backend already has `isStaleConfigFileSnapshotLocked`. Let me see where it's used; if some endpoint already refuses or flags a stale in-memory snapshot, the panel may be able to use it.Now the hook tests that exercise `saveCodexSpeed`, and the flow test around line 548.Now the implementation in `routingProfiles.ts`. First the error class doc, the body builders, and the snapshot reader:Now the API methods: `configSnapshot` replaces `configVersion`, and the two field-only saves share one helper.Now the hook's `saveCodexSpeed`:Now the tests. Let me look at the hook test helpers (`profilesState`, `ownProfile`).Now update the hook test file: the `configSnapshot` mock, and the cases whose path changes.Tests that assert "nothing written" only spy on `saveKeyProfile`; for own-profile keys a wrong write would now go through `saveKeyCodexSpeed`, so those assertions need it too.Now the API-level tests in `routingProfiles.test.ts`:Now run type-check and the affected tests.All 215 pass. I'll add one end-to-end case through the real hook and `apiClient` for a key that owns a profile, since that path is new. First the flow-test fixtures:Passing. Now the docs: `docs/personal-quota.md` describes the key-row write as always complete.Now the plan: decision log, the ➕ task item, Technical Details, and the test mapping.Now the backlog entry for the pre-existing manager-server CORS defect. None of the existing entries covers CORS; let me match the format of one of them.Let me verify the line references in that entry, then stage only that file.That change was my own `sed` line-reference fix. Now the full verification: type-check, lint, and the whole web suite.Lint has 0 errors. The 7 warnings are in files this branch doesn't touch; let me confirm they are the ones already tracked in `docs/backlog/web-lint-warnings.md`.Same 7 tracked warnings, 0 errors. Now the full web suite:All 5528 tests pass. One more check: whether the repo has a separate formatting gate that lint doesn't cover.Prettier flags 4 files. Let me check whether they were clean at HEAD, so I only reformat what my edits broke.The files were clean at HEAD, so this loop's edits caused it. Reformatting those four:Those on-disk changes are from my Prettier run. A last read of the final hook logic after formatting:I fixed finding 2. Finding 1 can't happen in practice, so I filed it to the backlog. The part of finding 3 about existing key profiles is fixed by the same change, and I'm keeping the new-key behavior on purpose. Nothing is committed.

Finding 1 (P2, If-Match blocked by manager-server's preflight): not reachable as described. Filed to the backlog as out of scope.
- When the panel and manager-server are on different origins, every CPA route the manager proxies already fails the browser's CORS check, before any PATCH.
- rootHandler wraps the proxy in WithCORS (router.go:86-88 and :129-131), which sets Access-Control-Allow-Origin. CPA sets its own Access-Control-Allow-Origin: * on every response (CPA server.go:232, server_middleware.go:433-447).
- httputil.ReverseProxy adds the upstream headers to the ones already set. I reproduced it with an httptest reverse proxy: the response carries two values, "*" and "*".
- Browsers reject an
[truncated]
```
#### Iteration 5
- truncated: true
Reviewer output:
```
- **P2 — A key can still copy an outdated Default profile.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:327` copies `stored.shared` from `/routing/profiles`, not from the `/config` snapshot that supplied the ETag. If a file edit moves the Default profile from account A to B just before the click, both reads can agree the key has no profile while disagreeing on the account. The conditional PATCH then succeeds and pins the key to A. Build or verify the copy against the same persisted snapshot before writing.
- **P2 — A missing ETag makes a speed click destructive for an existing profile.** At `apps/web/src/features/quota/hooks/useKeyProfiles.ts:323`, an empty `version` sends an existing profile through the unconditional full-profile writer. Even without a concurrent edit, `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:450` clears stored Codex fallback mode and mappings. If another tab deletes the profile after the reread, the click also recreates it. Refuse the key-row write when a safe conditional update is unavailable rather than silently replacing the profile.

The field-only PATCH fixes the earlier overwrite finding for existing profiles **with a strong ETag**. The manager-server CORS dismissal is also justified: the duplicate origin header already blocks the prerequisite cross-origin reads, so that is a pre-existing proxy defect rather than a regression in this change.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Reviewing the two Codex findings against the hook, the API layer and the plan; next I'm checking the backend for when ETag support appeared relative to speed.Implementing the fix. First the API layer: a dedicated error and treating a weak ETag as no usable version.Now the hook: refuse the key write early when there's no version, and drop the branches that handled an empty version.Now the four locale strings.Now the tests: replace the "unconditional" hook test with a refusal test, and cover the weak ETag in the API test.Wrong vitest root; running from the web app package instead.Targeted tests pass. Updating the docs and the plan's decision log to the new behavior.Now the full verification: web tests, type-check and lint.Lint has 0 errors and 7 warnings; checking whether any warning touches files on this branch.Codex raised two findings. I fixed the second one. The first is a real race but not a defect, and I've left it unchanged; my reasoning is below so Codex can re-evaluate it. Nothing is committed and there's no signal, so the loop will run Codex again.

Finding 2 (a key write without an ETag replaces the whole profile with no condition) — valid, fixed

- Why it's valid: the backend added ETag / If-Match support on 2026-10-16 (CLIProxyAPI-migration fa68946a) and the Codex speed only on 2026-11-18 (f86fc058). saveCodexSpeed writes only when the backend serves the speed (stored.speedSupported). So every backend the table writes to sends a strong ETag. An empty version means something between the panel and CPA dropped it. The fallback therefore helped no real backend; it only switched off the guard that blocks lost updates, and it could bring back a profile deleted after the reread.
- A related case: CPA never matches a weak ETag in If-Match (ifMatchSatisfied). A compressing proxy turns the ETag into W/"...". Every key write then got a 412 and was wrongly reported as "the configuration changed".
- Changes:
  - apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts: new ConfigVersionUnavailableError. configSnapshot now treats a weak ETag as no version.
  - apps/web/src/features/quota/hooks/useKeyProfiles.ts: saveCodexSpeed refuses a key-row write right after the config read when there is no version, before any other request. The error shows quota_management.key_profiles.errors.config_version_missing (added in en, ru, zh-CN and zh-TW). It doesn't reload, because nothing was written. I removed the two code paths that handled an empty version. A key with its own profile still gets the field-only conditional PATCH. A key without one still gets the conditional full copy. The Default row keeps its one-field merge, and the profile editors still save without a condition, as before this plan.
- Tests: "without a config version a key profile is written complete and unconditionally" is replaced by "refuses a key write without a config version". It covers both a key with its own profile and a key on the Default profile, checks that the profiles are not read again, and checks that the Default row still writes. A new API test covers the weak ETag.
- Docs: docs/personal-quota.md and the plan (decision log, test list, request flow) now describe the refusal.
- Part of the finding claimed the write also clears the stored Codex fallback mode and mappings. That part does no harm: CPA never uses them for Codex (plan decision at line 162). That code path is gone now anyway.

Finding 1 (a key copies the Default profile from before a file edit) — dismissed

- The race is
[truncated]
```
#### Iteration 6
- truncated: true
Reviewer output:
```
- **P2 — A speed click can pin a new key to an account it never inherited.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:334` copies the Default profile from `/routing/profiles` but uses the ETag from `/config`. If one file edit both adds a key and changes Default from account A to B, the table can list the new key from disk (`apps/web/src/features/quota/hooks/useKeyProfiles.ts:141`) while CPA still reports A. Both reads agree the key has no profile, so the PATCH succeeds and pins it to A. The “click first” ordering cannot explain this case: the key did not exist before the edit. Build or verify the copy against the revision named by `If-Match`.
- **P3 — A wildcard can still bypass the version check.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:600` correctly rejects missing and weak ETags, but accepts an unquoted `*` from a misconfigured proxy. CPA treats `If-Match: *` as matching any version, so a concurrent profile deletion can still be followed by a speed-only PATCH that recreates the profile. Accept only a single quoted strong ETag; treat other values as unavailable.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the external findings with technical rigor.Evaluating two Codex findings on the speed table's conditional key writes; reading the plan's prior decisions now.Checked the backend: finding 2 (wildcard If-Match) is valid; now checking whether the backend exposes a "loaded config is stale" signal for finding 1.Now the routingProfiles.ts changes: the strict ETag reader, and the dedicated Default-copy write replacing the ifMatch parameter of saveKeyProfile.Now updating tests. Checking the test helpers first.Now editing the services tests.Now the hook test and the flow test.Now the flow test: switch the copy path to patchRaw and add an end-to-end stale-Default case.Now rewriting the flow copy test to use patchRaw and adding the stale-Default scenario Codex described.The error block includes a Refresh button; switching to a containment check.All 5535 tests pass, tsc is clean. Updating the plan and user docs to match.Updating the user doc paragraph first.Now the plan's decision log and the "Key row from the table" note.I fixed both findings. They're uncommitted, the full web suite passes (5535 tests), type-check is clean, and lint has 0 errors.

Finding 1 (P2, a speed click can pin a new key to a Default profile it never inherited) is valid, so I fixed it.
- I checked the backend. GET /config reads the file and hashes it for the ETag, while /routing/profiles serves the config CPA has loaded. The PATCH checks the key against the merged file, so in Codex's scenario both reads agree the key has no profile. The PATCH succeeds and pins the new key to the old Default.
- The plan had logged this as an accepted "remaining gap". The earlier argument was that the click could be treated as happening just before the edit. That fails when the same edit adds the key, because the key didn't exist before it.
- CPA doesn't report which file version it has loaded, so the copy can't be checked before writing. Building it from GET /config had already been rejected because it would mean copying the backend's defaults. But every management PATCH replaces CPA's loaded config with the version it just wrote (h.cfg = next, under the handler lock), so the read-back after the write shows that version's Default.
- New routingProfilesApi.saveKeyDefaultCopy(key, profile, from, ifMatch) in routingProfiles.ts:
  - It sends the conditional PATCH through a new apiClient.patchRaw, so it can read the response ETag.
  - It reads the key profile back as before, then compares the read-back Default with the one it copied.
  - If they differ, it deletes the copy with a PATCH that sets the key to null, conditional on the version its own write produced. Then it raises ConfigChangedError, which shows "config changed, reloaded, try again", and the key stays on the Default.
  - If the response carries no strong ETag, or the delete is refused, it raises a plain error saying the key kept a copy of an outdated Default.
- useKeyProfiles.saveCodexSpeed now uses this method for keys without a profile. saveKeyProfile loses the ifMatch parameter it gained for this path, so the editors' write is back to what it was before this branch.
- Tests added:
  - Service-level: the clean copy, the stale Default being deleted conditionally, no or weak/wildcard response ETag, a refused delete, a read-back mismatch, and a write with no version.
  - End-to-end in profilesKeysFlow: one edit adds the key and moves the Default to another account. The copy is deleted with If-Match set to the written version, the error shows, and the key stays on the Default.
- The hook's speed tests now spy on
[truncated]
```
#### Iteration 7
- truncated: true
Reviewer output:
```
The wildcard/list ETag fix is correct. The conditional rollback also handles the tested stale-Default case, but three issues remain:

- **P2 — A failed verification read leaves the stale profile in place.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:682` — If the copy PATCH succeeds but the following GET times out, execution never reaches the rollback. The hook reloads the table, but it does not undo the copy: the new key remains pinned to the old account. On verification failure, attempt cleanup using the PATCH response ETag; if cleanup cannot be confirmed, tell the user the key may now have its own profile.
- **P3 — A later Default edit is reported as a failed copy.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:687` — The GET reads the *current* Default, not necessarily the Default at the PATCH revision. If the key correctly copies account A and another tab then changes the Default to B, the comparison fails, the rollback gets a 412, and the panel reports that the key copied an outdated Default. The key actually received exactly what was requested. Distinguish a proven stale copy from a read-back at an unknown revision.
- **P3 — A deleted key can remain visible after a speed click.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:324` — If another tab deletes a key and the user clicks the speed the Default already has, the no-op branch updates the profiles but keeps the old key list. The deleted key now appears to exist and inherit that speed, with no error. Check membership in `access.api-keys` from the config snapshot before taking the no-op path.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings rigorously.Now the plan file, to check intended design.Evaluating the three findings against the code: checking the existing copy and rollback tests before I change anything.Now the hook-level tests for `saveCodexSpeed`.Checking which key list the backend uses for its "unknown key" check, so the panel's membership check matches it.Backend checks `access.api-keys`, same list the panel's `clientApiKeys` reads. Now checking the locale files for the error block and the editor's delete wording.All three findings check out against the code. Fixing them now, starting with the copy write in `routingProfiles.ts`.Now the hook: the new error in `failWrite` and the key-list membership check before the no-op path.Now the localized message in all four locales.Now the tests. First the service tests in `routingProfiles.test.ts`.Now the hook lifecycle tests: the snapshot helper, a deleted-key test, and the new error's message.Now the flow tests, whose mocked `GET /config` bodies carry no key list and would now trip the membership check.Running the affected test files, type check and lint.Affected tests pass (229). Now the full suite, type check and lint.Type check clean, 325 test files / 5541 tests pass, lint has 0 errors. Checking whether the 7 lint warnings touch any file changed here.Final look at the rewritten copy write:I fixed all three findings. Nothing is committed and I'm not emitting the done signal, so Codex can check the fixes on the next pass. Type check is clean, all 5541 tests pass, and lint has 0 errors. Its 7 warnings are all in files this branch doesn't touch.

1. P2, a failed check after the copy leaves the copy in place (routingProfiles.ts, saveKeyDefaultCopy): valid, fixed.
- Before: if the copy write succeeded but the follow-up read failed, the error went straight out. The copy was never deleted, and the user wasn't told the key might now have its own profile.
- Now, when that read fails, the copy is deleted again, but only if the config is still the version the copy wrote.
- If the delete goes through, the original read error is shown and the key stays on the Default profile.
- If it can't be made (no version on the write's answer, a 412, or a network error), the new DefaultCopyUnconfirmedError is raised.
- If the connection changed in the meantime, nothing is sent to the new connection.
- The hook shows a new localized message, key_profiles.errors.copy_unconfirmed, in en, ru, zh-CN and zh-TW, and reloads. The message says the key may now have its own profile, to check it, and to reset it to default if it should follow the Default profile.

2. P3, a later Default edit is reported as a failed copy: valid, fixed in the same place.
- The delete only succeeds while the config is still the version the copy wrote. So only a successful delete proves the copy was outdated, and that case still raises ConfigChangedError.
- A refused delete (412), a failed delete, or a write answer with no version only shows the config changed after the copy. The other Default may simply be a change saved after a correct copy.
- All those cases now raise DefaultCopyUnconfirmedError, whose wording makes no claim that the copy is outdated. The old plain English "copy of an outdated Default profile" message is gone.

3. P3, a deleted key stays visible after a speed click (useKeyProfiles.ts, saveCodexSpeed): valid, fixed.
- configSnapshot now also returns clientKeys, read with clientApiKeys from the same GET /config response that gives the version. That is the same access.api-keys list CPA checks for unknown_api_key.

[truncated]
```
#### Iteration 8
- truncated: true
Reviewer output:
```
The rollback on a thrown verification read, the handling of a 412 after a later Default edit, and the deleted-key check are correct for the cases reported. Three gaps remain:

- **P2 — A stale copy can route live requests before rollback.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:346` builds the copy from the Default CPA has loaded, not the persisted Default named by `If-Match`. If a file edit adds a key and changes its preferred account from A to B, the PATCH can activate account A for that key. A later rollback cannot undo a request already routed to A, and closing the tab before verification leaves the copy in place. Verify the Default against the persisted snapshot before creating the profile, or refuse the write.
- **P2 — A verification mismatch bypasses rollback.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:726` throws before `undo()` if the read returns a key profile with the wrong speed. The key can therefore stop following Default even though the panel reports that CPA did not retain the profile. A verification GET returning 404 also reaches this branch because `get()` converts it to `unsupportedBackend`. Use the same ETag-guarded cleanup and unconfirmed-copy warning as for a rejected GET.
- **P3 — Losing the PATCH response hides a potentially successful copy.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:699` propagates an ordinary network error if CPA saves the profile but the response times out. With no response ETag, rollback is unsafe, and the user is not told the key may now have its own profile. Report `DefaultCopyUnconfirmedError` for ambiguous transport failures while preserving explicit server rejections such as 412 and 422.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Now the hook side.Checking the backend's PATCH semantics to see whether a pre-write check of the copied Default is feasible, since that decides finding 1.Now the hook-level tests that exercise the copy path.Implementing now. First the API change in `routingProfiles.ts`.Now the `unanswered` helper and the error-class docs.Now the hook's doc comment, which describes the old post-write flow.Locale edits only touched that one key. Now rewriting the API tests for the copy path.API tests pass (131). Now the flow tests in `profilesKeysFlow.lifecycle.test.tsx`.Expected failure from the reworded string; updating that assertion.Now the docs: `docs/personal-quota.md` and the plan, which both describe the old post-write delete.Updating `docs/personal-quota.md` first.Now the plan: the chosen-approach line, a new decision entry, the ➕ items and the technical details line.Docs reference no renamed test titles. Running the full verification: web tests, type-check, lint.Tests (5541), type-check and lint all pass, with 0 lint errors. Lint does show 7 warnings, so I'm checking where they come from.The formatting drift is from my edits, so I'm running prettier on those three files and re-running their tests.All three Codex findings were real, and I fixed all three. Nothing is committed and no signal is output, so the loop can re-run Codex on these changes.

Verification: npm run test:web passes (325 files, 5541 tests), and npm run type-check passes. npm run lint shows 0 errors and 7 warnings. The warnings were already there, in files this branch does not touch: AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx and UsageMaintenanceCapabilityViews.tsx. I left them alone because changing DashboardPage's hook dependencies or splitting component files could change behavior outside this plan. Nothing was filed to the backlog.

Finding 1 (P2, a stale copy can route live requests before rollback): fixed.
- The problem: the copy was written first and only checked afterwards. When an edit of the file added the key and changed the Default, and CPA had not reloaded it yet, the key's requests could be routed by the old Default until the delete. If the tab closed before the delete, the copy stayed.
- The plan said the copy could not be checked before the write, because CPA serves no version of its loaded config. That is not true. A management PATCH sets the loaded config to the version it writes under the handler lock (config_v8.go, h.cfg = next). The backend also ignores a reload parsed from an older file (handler.go, isStaleConfigFileSnapshotLocked).
- The fix, in routingProfiles.ts saveKeyDefaultCopy:
  - First an empty PATCH /config with body {}, conditional on the version the panel read. This makes CPA load that version.
  - Then /routing/profiles must show the same Default that was copied, and no profile for the key. Otherwise ConfigChangedError is raised, and nothing but the empty write is made.
  - Only then is the copy written, with If-Match set to the ETag of the empty write. A later version fails that If-Match. If the empty write returns no strong ETag, ConfigVersionUnavailableError is raised.
- The empty body changes nothing CPA reads: mergeLegacyClaudeFallbackWrites skips a body without routing, and the file is normalized the same way as on any write.
- The copy is now correct before it is written, so the check of the Default after the write is removed. With the empty write first, that check could only give false "unconfirmed" warnings.

Finding 2 (P2, a verification mismatch
[truncated]
```
#### Iteration 9
- truncated: true
Reviewer output:
```
The empty PATCH fixes the previously reported case where a file edit was already on disk before the click. Verification mismatches now trigger conditional rollback, and timeouts, 502s, and 504s now produce the unconfirmed-copy warning. Five findings remain:

- **P2 — A PATCH response can name another writer’s version.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:711` trusts the returned ETag as the version CPA loaded. But CPA computes that tag by rereading the file *after* writing it, then installs its separately parsed config (`internal/api/handlers/management/config_v8.go:222` in CLIProxyAPI). A direct file edit between those operations can give the panel the new file’s ETag and the old Default. The copy can then pass `If-Match` with stale routing. The same assumption at `routingProfiles.ts:745` can let rollback delete another writer’s replacement profile. Refuse the copy or rollback when the tag cannot be tied to the content this operation wrote.
- **P2 — A speed-only edit can disable Claude fallback.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:819` sends only the Codex field. In a valid config with an enabled legacy `claude-fallback` and an explicit `providers.claude.fallback: {}`, CPA uses the legacy rules when serving requests, but its PATCH handler deletes those rules merely because the empty node exists (`internal/config/provider_routing.go:182`; `internal/api/handlers/management/routing_providers_write.go:91`). The speed read-back passes while Claude stops falling back to Codex. Preserve the effective fallback for this config shape or refuse the edit before writing.
- **P2 — The pre-write check ignores a newly read-only key.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:720` checks the Default and key ownership, but not `loaded.supported` or `loaded.speedSupported`. If a scheduler plugin takes over during the preflight, the second GET can explicitly report `supported: false` and the panel still creates the key profile. That profile can unexpectedly take effect when the plugin is removed. Recheck both capabilities before the copy PATCH.
- **P3 — A failed refresh presents stale rows as current.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:212` says the current values were reloaded before the refresh finishes. If the connection stays down after a lost PATCH response, the hook retains the old “Default” badge and `useKeyProfiles.ts:435` hides the refresh error behind the save warning. Keep the copy warning, but mark the displayed rows as stale until a refresh succeeds.
- **P3 — HTTP 500 does not always prove the copy was rejected.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:613` treats `500 write_failed` as a definite refusal. CPA can return that error after writing all bytes if `Sync` or `Close` fails (`internal/api/handlers/management/config_basic.go:118`). The watcher may still load the copy. Treat `write_failed` as unconfirmed while preserving definite rejections such as 412 and 422.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Reading the backend PATCH handler and WriteConfig to verify finding 1's race claim.Finding 1's race is real (WriteConfig normalizes, so the handler rereads the file for the ETag) — now checking finding 2's backend claims.Finding 2 traces to a backend merge rule (node presence vs. IsZero). Checking whether pre-existing panel writes hit it too, and how null is merged.Finding 2 is a backend inconsistency (empty fallback node counts as "set" on write but "unset" at runtime), and pre-existing panel key saves trigger it too. Now reading the hook for finding 4.Checking the backend's documented ETag contract for PATCH responses and how the panel's API client exposes error codes.Implementing finding 3: recheck `supported` and `speedSupported` on the preflight read before the copy.Now finding 5: treat CPA's `500 write_failed` as unconfirmed. Checking how the client maps the body's `error` to `apiCode`.`apiCode` comes from the body's `error` field, so `write_failed` is detectable. Editing `unanswered`:Now the tests for findings 3 and 5 in `routingProfiles.test.ts`.Findings 3 and 5 pass (132 tests). Now finding 4: checking which tests assert the "were reloaded" message texts.Now the hook change for finding 4: surface a failed refresh next to the save warning instead of hiding it.Now rewording the locale strings so none claims a reload that may not have happened, and adding `reload_failed` in all four locales.Refining the Chinese wording of `copy_unconfirmed` for clarity.Now updating the test assertions that quote the old texts, and adding a test for the failed refresh.All 832 tests pass. Now filing the two backend defects. Checking the existing backlog format first.Updating the user doc to match the three fixes (preflight capability check, `write_failed`, failed refresh).Now the two backlog entries for the backend defects (findings 1 and 2).Now recording the decisions in the plan's Decision Log and task list.Running the full web suite, type-check and lint from the repo root.The test catches the removed check. Verifying the `speedSupported` sub-case on its own too:Both sub-cases are guarded. Final full verification:Three of the five findings were real panel bugs and are fixed. The other two are real but caused by the backend, so I filed them to the backlog. Tests, type-check and lint all pass. Nothing is committed and I'm not sending the done signal.

Fixed:

- Finding 3 (P2, copy written after a scheduler plugin takes over) is valid. Before writing the copy, the panel now checks, after its empty write, that key profiles are still used and that the backend still has the Codex speed. If either is false it stops with ConfigChangedError and writes nothing else. Without this, a plugin that took over during the preflight left a hidden key profile that would start working once the plugin was removed. The new test in routingProfiles.test.ts fails if either check is removed. The no-speed case uses a Standard Default, because otherwise the Default comparison would refuse the copy anyway and the test would prove nothing.
- Finding 5 (P3, 500 write_failed) is valid. CPA sends write_failed also when every byte reached the file and only Sync or Close failed (config_basic.go:118-126), so the hot reload can still load the copy. A 500 write_failed on the copy write now raises DefaultCopyUnconfirmedError. Other 500s (such as read_failed, sent before writing), 412 and 422 still count as refusals. Tests cover both sides.
- Finding 4 (P3, failed refresh shown as current) is valid. The hook used to show
[truncated]
```
#### Iteration 10
- truncated: false
Reviewer output:
```
- **P2 — Rollback can delete another writer’s key profile.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:755` deletes the profile using the copy PATCH’s response ETag. CPA computes that tag by rereading the file after writing it. If another writer replaces the profile in that gap, verification can detect the mismatch and then delete the replacement using its own valid ETag. The backend diagnosis is correct, but the panel need not issue that delete: if it cannot establish that the stored profile is its copy, it can report the copy as unconfirmed instead. The same ETag assumption at `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:741` can admit a stale Default copy.
- **P2 — A speed-only save can silently disable Claude fallback.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:829` sends only the Codex field. With an enabled legacy `claude-fallback` beside `providers.claude.fallback: {}`, CPA drops the legacy settings, and the speed-only read-back reports success. Older key saves could already affect the shared profile, but the previous Default-row save sent the effective Claude fallback explicitly and preserved it. This path is therefore a regression; until CPA is fixed, the panel can refuse the edit when the stored profile contains that ambiguous combination.
- **P3 — A second failed refresh loses the unconfirmed-copy warning.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:167` clears `saveError` as soon as the user clicks **Refresh**. If that retry also fails, the old “Default” badge remains, but `apps/web/src/features/quota/hooks/useKeyProfiles.ts:431` shows only the network error. Keep the copy warning until a refresh actually succeeds. The first failed refresh is now handled correctly.

The preflight capability checks (finding 3) and the handling of `500 write_failed` as an unconfirmed copy (finding 5) are correct.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the external findings rigorously.Status: verifying the three Codex findings against the backend code; findings 1 and 3 look valid, now checking finding 2.Now finding the existing tests for the copy rollback and the Default-row speed path.Editing now: dropping the copy rollback in `routingProfiles.ts`, adding the legacy-fallback guard, then the refresh-error fix.Now the error classes.Now the hook: read the config snapshot for the Default row too, refuse on the legacy shape, and keep the copy warning until a refresh succeeds.Now finding 3: clear the save error only once a user-triggered reload succeeds.Updating the `saveCodexSpeed` doc comment to match.Now the locale strings, in all four locales via a small script that keeps key order.The zh-CN button is labelled "配置档", so the string should name it that way.Now updating the copy tests in `routingProfiles.test.ts`: the copy write goes through `patch`, and every failed confirmation reports instead of deleting.Now the snapshot tests: add the new field to the exact-equality case and cover the legacy-fallback detection.The failure is a test bug: passing `undefined` to the helper falls back to its default legacy block. Fixing the test case.Expected fallout: the test snapshot helper lacks the new field, plus the two flow tests. Updating them.Hook tests pass. Now adding hook tests for the legacy refusal and for the refresh behavior. Reading the neighbouring tests first.Hook tests pass. Quick check that the new refresh tests actually fail without the fix, by temporarily restoring the old `reload`.Both new tests fail against the old behavior and pass with the fix. Now the two flow tests in `profilesKeysFlow.lifecycle.test.tsx`.All flow tests pass. Now updating the docs that describe the rollback: `docs/personal-quota.md`, the plan, and the two related backlog entries.Now the plan: Technical Details, Task 5 notes, and new Decision Log entries.Now updating the two backlog entries to reflect what the panel now does, then re-staging them.The original says "in the race", not "in that race". Retrying with the exact text.Now the full verification: web tests, type-check and lint.Prettier only rewrapped one line I added. Last look at the final shape of `saveKeyDefaultCopy` and the hook's write path:I fixed all three findings, and none were dismissed. Nothing is committed and no done signal is sent, so the loop can re-run Codex on the changes. npm run test:web passes (325 files, 5546 tests), type-check is clean, and lint has 0 errors. Its 7 warnings are older ones in files this branch doesn't touch and are already in docs/backlog/web-lint-warnings.md.

Finding 1 (P2, rollback can delete another writer's key profile) is valid.
- The plan earlier rejected a different fix: tying CPA's response ETag to the bytes the panel wrote. Codex's new suggestion is simpler: don't send the delete at all. The delete wasn't protecting anything any more. The copy is only written after the empty write confirms the Default, so a copy that can't be confirmed is almost always a correct one. Deleting it could only throw away the user's click, or, in the race Codex describes, remove a profile someone else gave the key.
- Change in routingProfiles.ts (saveKeyDefaultCopy): the rollback is gone. If the read-back fails, shows a different profile for the key, or shows a different Default next to the copy, the panel raises DefaultCopyUnconfirmedError and deletes nothing. The copy write now uses apiClient.patch.
- The check on the Default after the write is back, but it only reports. It catches the race at :741, where the empty write's ETag names another writer's file and the copy ends up next to a Default it didn't copy. The panel can detect that afterwards but can't prevent it.
- The copy_unconfirmed message now says "a copy that could not be confirmed", in all four locales.
- The tests for the delete were replaced with tests that report and delete nothing, including one for the "copy next to another Default" case.

Finding 2 (P2, a speed-only save can turn off the Claude fallback) is valid. This reverses the earlier rejection.
- Codex is right that this branch made it worse. Before, the Default profile was only saved by the editor, which sends the full effective fallback and keeps it. The table's new one-field writes don't, and the read-back can't notice because /routing/profiles only shows the effective view.
- The panel now detects the bad shape in the raw GET /config: an empty providers.claude.fallback next to a legacy claude-fallback that sets something. Matching CPA's IsZero rule was a few lines. configSnapshot returns this per profile, and the Default row now reads the config too (it still doesn't use the version).
- In that case saveCodexSpeed refuses the write with LegacyClaudeFallbackError and writes nothing. It checks the Default profile on every row, plus the key's own profile when changing that key's speed. A click on a value the row already has still does nothing and isn't refused. The two new messages, in all four locales, ask the user to save that profile once in Profiles first, because that save keeps the fallback.
- New tests cover the detection rules, the snapshot, the refusals for each row type, and that a click that changes nothing is not refused.

Finding 3 (P3, a second failed refresh loses the warning) is valid.
- In useKeyProfiles.ts, clicking Refresh no longer clears the save error straight away. It clears only when that reload succeeds. Starting a new write still clears it, and resets the pending flag so the next error isn't wiped.
- New tests cover a second failed refresh keeping the warning plus "reload failed", the warning still showing while a reload is running, and the next write's own error staying visible. I checked that both refresh tests fail with the old code.

Docs: the plan has three new Decision Log entries (2026-11-19) that replace the earlier rollback decision and the earlier rejection of finding 2, plus updated task notes and technical details. docs/personal-quota.md describes the new copy and refusal behaviour. Both related backlog entries were updated: cpa-patch-etag-names-reread-file.md and cpa-empty-claude-fallback-node-drops-legacy-block.md. The backend fixes are still needed, mainly for the editors' key saves, which still drop the shared legacy block as they did before this branch. Both entries are staged again, and the code fixes are left unstaged for the next review.

Insight
- The ETag CPA returns after a write comes from reading the file again, not from the bytes it wrote. That makes the tag good enough for "only write if nothing changed" (a wrong tag just gets a 412 later). It is not good enough for "undo my own write", because then a wrong tag deletes someone else's change. So the panel keeps the checks that can only fail safely and drops the action that can't.
- /routing/profiles shows the effective config with legacy blocks already merged in, so the shape that loses data is only visible in the raw GET /config. Checking the raw document is how the panel guards against a backend rule it can't see in its usual API.
```

## Validation
- none
- duration_ms: 0
- runs: 0