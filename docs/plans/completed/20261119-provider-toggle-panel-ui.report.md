# Report: 2026 11 19 provider toggle panel ui
plan: /Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/provider-toggle-panel-ui/docs/plans/20261119-provider-toggle-panel-ui.md | branch: provider-toggle-panel-ui | base: main | mode: full | executor: claude | task model: claude:opus:high | review model: claude:opus:xhigh | started: 2026-11-19T10:45:07Z | finished: 2026-11-19T13:29:51Z

## Summary
- task iterations: 7
- failed retries: 0
- external reviewers: 1
- post-review iterations: 1
| phase | duration_ms |
|---|---:|
| evaluation | 5415762 |
| external review | 1609617 |
| internal review | 1598860 |
| other | 0 |
| tasks | 1260013 |

## Change scope
- commits: 9
- files: 32
- additions: 3420
- deletions: 209
| status | path |
|---|---|
| M | apps/web/src/features/personal-quota-support/services/api/routingProfiles.test.ts |
| M | apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts |
| M | apps/web/src/features/quota/clientKeysModal.lifecycle.test.tsx |
| M | apps/web/src/features/quota/codexSpeedModal.lifecycle.test.tsx |
| M | apps/web/src/features/quota/codexSpeedModel.test.ts |
| M | apps/web/src/features/quota/codexSpeedModel.ts |
| M | apps/web/src/features/quota/components/CodexSpeedModal.tsx |
| M | apps/web/src/features/quota/components/KeyProfileEditor.module.scss |
| M | apps/web/src/features/quota/components/KeyProfileEditor.test.tsx |
| M | apps/web/src/features/quota/components/KeyProfileEditor.tsx |
| M | apps/web/src/features/quota/components/ProviderRoutingBlock.module.scss |
| M | apps/web/src/features/quota/components/ProviderRoutingBlock.test.tsx |
| M | apps/web/src/features/quota/components/ProviderRoutingBlock.tsx |
| M | apps/web/src/features/quota/components/RoutingProfilesModal.tsx |
| M | apps/web/src/features/quota/hooks/useKeyProfiles.ts |
| M | apps/web/src/features/quota/keyProfiles.lifecycle.test.tsx |
| M | apps/web/src/features/quota/keyProfiles.locale.test.ts |
| M | apps/web/src/features/quota/keyProfilesModel.test.ts |
| M | apps/web/src/features/quota/keyProfilesModel.ts |
| M | apps/web/src/features/quota/profilesKeysFlow.lifecycle.test.tsx |
| M | apps/web/src/features/quota/providerRoutingModel.test.ts |
| M | apps/web/src/features/quota/routingProfilesModal.lifecycle.test.tsx |
| M | apps/web/src/features/quota/useKeyProfiles.lifecycle.test.tsx |
| M | apps/web/src/i18n/locales/en.json |
| M | apps/web/src/i18n/locales/ru.json |
| M | apps/web/src/i18n/locales/zh-CN.json |
| M | apps/web/src/i18n/locales/zh-TW.json |
| A | docs/backlog/editor-saves-suggested-fallback-mappings.md |
| A | docs/backlog/guide-disabled-provider.md |
| A | docs/backlog/profile-editor-save-lost-update.md |
| M | docs/personal-quota.md |
| M | docs/plans/20261119-provider-toggle-panel-ui.md |

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
- ➕ `saveKeyDefaultCopy` passes `from.providerToggleSupported` to `keyProfilePatch`, so a speed-table copy of the Default keeps its stored `disabled` (tested in `routingProfiles.test.ts`)
- ➕ external review: a key save that creates the profile sends a left-out `disabled` as the Default holds it at save time (`routingProfiles.test.ts`, `profilesKeysFlow.lifecycle.test.tsx`); a shared save under `supported: false` forwards `providerToggleSupported: false` (`useKeyProfiles.lifecycle.test.tsx`)
- ➕ external review: that key save reads the file (`configSnapshot`, `sharedDisabledOf`), not the loaded profiles, and is conditional on its version; a 412 is `ConfigChangedError`; a weak or missing ETag writes unconditionally; a fresh `/routing/profiles` read that reports a missing route, `supported: false` or no `disabled` writes nothing (`routingProfiles.test.ts`, `profilesKeysFlow.lifecycle.test.tsx`)
- ➕ external review: `sharedDisabledOf` reads `yes` / `on` (yaml.v3's YAML 1.1 true strings) as off and every other non-`true` value as on; a key save that sends both flags still reads `/routing/profiles`, writes nothing on a missing route, `supported: false` or no `disabled`, and otherwise reads no `/config` and writes unconditionally (`routingProfiles.test.ts`)
- ➕ external review: a key save from an editor without the switch writes nothing once the backend serves it; a key reset reads `/routing/profiles` first and writes nothing on a missing route or `supported: false`, but needs no config read or switch match; a Default save that sends a flag (`true` or an explicit `false`) writes nothing on a missing route, `supported: false` or no `disabled`, and one without a flag reads nothing before the write (`routingProfiles.test.ts`)
- ➕ external review: a key write, a key reset and a Default flag write whose read-back reports `supported: false` raise `RoutingNotAppliedError`, and one whose value did not stick still reports not retained (`routingProfiles.test.ts`); the hook shows `not_applied` and reloads (`useKeyProfiles.lifecycle.test.tsx`)
- ➕ external review: `RoutingNotAppliedError` is scoped (`key` / `default`) and the hook shows `not_applied` or `not_applied_default`; a key write whose read-back finds the switch an upgrade added raises `ProviderToggleChangedError` and the hook shows `toggle_unsent` and reloads (`routingProfiles.test.ts`, `useKeyProfiles.lifecycle.test.tsx`)
- ➕ external review: an open Default or key editor whose save was refused starts over from the stored profile when the reload finds the switch gone or `supported: false` (`routingProfilesModal.lifecycle.test.tsx`)
- ➕ external review: with no reload after a save that sent Claude off, switching it back on keeps Save available and writes an explicit `disabled: false` (`KeyProfileEditor.test.tsx`)
- ➕ external review: with no reload after an unconfirmed save that sent Claude on, switching it back off keeps Save available and writes `disabled: true`; a save that resolves `unwritten` or `saved` leaves no switch behind, so a later save of another field leaves Claude out (`KeyProfileEditor.test.tsx`, `routingProfilesModal.lifecycle.test.tsx`); `wroteNothing` is true for a save refused before or by its PATCH and false for one without an answer or with a failed read-back (`routingProfiles.test.ts`), and the hook resolves `unwritten` or `unconfirmed` from it (`useKeyProfiles.lifecycle.test.tsx`)
### Blocked
- none
### Skipped
- none

## Backlog
| status | path | title |
|---|---|---|
| A | docs/backlog/editor-saves-suggested-fallback-mappings.md | Profile editor saves suggested Claude mappings the user never adopted |
| A | docs/backlog/guide-disabled-provider.md | Guide does not mention a switched-off provider |
| A | docs/backlog/profile-editor-save-lost-update.md | Routing profile editor saves overwrite changes made elsewhere |

## External review
### codex:gpt-6.2-astra:xhigh
- label: codex
- iterations: 10
- duration_ms: 7025343
- ended by: max_iterations
- had findings: true
#### Iteration 1
- truncated: true
Reviewer output:
```
- **P1 — A stale editor can silently re-enable a provider.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:514` — Every full-profile save writes both `disabled` flags without a version check. If one admin disables Claude while another has the same profile open, the second admin can save an unrelated setting and restore `disabled: false`. The read-back then confirms the stale value. Guard existing-profile saves with the version the editor loaded, or omit unchanged flags from the merge PATCH.
- **P2 — The both-off warning overstates what is blocked.** `apps/web/src/i18n/locales/en.json:5771` says CPA refuses *every* request. The policy only disables Claude and Codex; a key can still use another configured provider such as Gemini. Scope the warning in all four locales, and the corresponding claim in `docs/personal-quota.md:195`, to Claude and Codex.
- **P2 — A toggle-only save changes an empty mapping table.** `apps/web/src/features/quota/components/KeyProfileEditor.tsx:134` fills an empty Claude mapping list with suggestions when the editor opens. Switching only **Enabled** and saving writes those suggestions back, even when the fallback is off and the table was never shown. Preserve the stored empty list unless the user edits or adopts the suggestions.
- **P3 — The WebSocket documentation conflates two transports.** `docs/personal-quota.md:207` says an open Codex WebSocket keeps running until it closes. That exception applies to an open *duplex* stream. A Responses WebSocket rechecks its pinned credential on the next turn and can reroute or return 403 without a reconnect.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings rigorously.Checking each finding against the code; P1 touches the editor's save model, so I'm reading the hook and editor next.Checking the backend's provider-disable plan to verify the "refuses every request" and WebSocket claims (P2 and P3).Now the docs (P2 claim at line 195 and P3 at line 205-207).Now syncing the plan (wording of the warning, Task 7 websocket note, decision log).Now the two backlog entries. Getting exact line references first.Both backlog entries are staged. Running the verification gates: affected tests, locale test, type-check, lint, then the full suite.Lint shows 0 errors and 7 warnings. Checking that the warnings are the ones already tracked in the backlog, then running the full suite and Prettier.I fixed the two documentation and text findings (P2 warning text, P3 WebSocket docs). The other two (P1 stale editor, P2 mapping suggestions) are real but come from editor behavior older than this branch, so I filed them to the backlog. Nothing is committed. The full web suite passes (5617 tests), type-check is clean, and lint has 0 errors. The 7 lint warnings are in four files this branch doesn't touch and are already tracked in docs/backlog/web-lint-warnings.md.

Fixed:

- P2, the both-off warning overstated what is blocked. The backend plan says "a request for another provider (e.g. gemini) is untouched", and its management-api-v8.md refuses only "a request that needs only the disabled provider". The no_provider warning now says CPA refuses every Claude and Codex request made with the profile and that other providers are not affected, in en, ru, zh-CN and zh-TW. docs/personal-quota.md says the same and adds that the switches cover only Claude and Codex. The KeyProfileEditor test checks the new wording.
- P3, the docs mixed up two WebSocket types. The backend runtime rules say a Responses WebSocket checks its pinned credential at the start of every turn: the turn moves to another credential or gets an error event with status 403. Only an open Codex duplex WebSocket keeps running until it closes. docs/personal-quota.md now describes the two separately, and the plan's Task 7 text matches.

Filed to the backlog (staged, uncommitted):

- P1, a stale editor can re-enable a provider. Filed as docs/backlog/profile-editor-save-lost-update.md (major).
  - The race is real, but it comes from how the editor saves, not from the disabled flag. Both editor saves send the whole profile with no version check (routingProfiles.ts:768 and :911). A stale save already reverts mode, API key, preferred account, fallback and speed, for example putting back a paid Claude API key another admin replaced.
  - This was decided on purpose: the Codex speed plan made only the speed table's key writes conditional and recorded "the editors stay unconditional" (docs/plans/completed/20261118-codex-speed-panel-ui.md:164). This plan's verified facts also require disabled to be in the full body, because the PATCH merges and re-enabling has to overwrite a stored true.
  - Your second suggestion, leaving an unchanged flag out of the PATCH, only moves the race. If another admin deleted the key profile, the PATCH creates a new profile without disabled, so Cla
[truncated]
```
#### Iteration 2
- truncated: true
Reviewer output:
```
- **P1 — A stale save can restore provider access.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:514` now includes `disabled: false` in an unconditional profile save. If one admin disables Claude while another has the profile open, the second admin can save an unrelated Codex change and re-enable Claude. Before this branch, the PATCH omitted `disabled`, so it preserved the restriction. The backlog entry describes the race correctly, but does not resolve it. Reject saves against a stale profile version.
- **P2 — A toggle-only save does not preserve empty mappings.** `apps/web/src/features/quota/components/KeyProfileEditor.tsx:134` fills an empty Claude mapping list with suggestions; saving the toggle writes them even when the mapping table was never shown. The helper predates the branch, but the new toggle explicitly promises to preserve other settings. The preservation test at `apps/web/src/features/quota/components/KeyProfileEditor.test.tsx:810` starts with a nonempty mapping and misses this case.
- **P3 — The guide still promises a provider-exclusive key.** `docs/personal-quota.md:186` says switching Claude off can make a key “Codex-only.” On a deployment that also serves Gemini, the key can still use Gemini. Qualify that claim: the key is Codex-only **if Claude and Codex are the only configured providers**.

The revised both-off warning correctly scopes the restriction to Claude and Codex. The WebSocket documentation also correctly distinguishes per-turn Responses checks from an already-open Codex duplex stream.

```
Evaluator response:
```
Using superpowers:receiving-code-review, since this task is evaluating external review feedback.Status: I'm checking each of the three findings against the code and the plan. Next I'll look at the save and read-back paths and the existing conditional-save machinery.Still evaluating. All three findings hold up. Next I'll check when the Claude mapping table is shown, so the fixes keep a stored empty mapping list and stop a stale save from re-enabling a provider.Now implementing the fixes. P1 first, in the routing profile API: a save sends disabled only for a provider that is off, or one the user switched back on in this editor.Now editing `profileBody` and the patch builders.Now the two save methods and their read-back checks.Now the hook, the modal, and the editor, which pass along the profile the editor opened with.Now the editor: it keeps the profile it opened with, passes it to `onSave`, and writes an untouched suggestion list back as the stored empty list.Type-check passes. Running the affected test files to see which assertions need updating.P2 change reverted. Re-running tests to see what P1 still breaks.I'll update the tests that check exact argument lists first, starting with the hook test.The hook tests pass. Adding one hook test that checks `opened` is forwarded to both save calls.Now the editor tests: the three `onSave` argument assertions.Now the modal lifecycle tests.Modal tests pass. Next, the end-to-end flow tests that use the real hook and API.Adding two end-to-end tests: a stale editor save keeps Claude off, and switching Claude back on sends an explicit `false`.The error selector I used doesn't exist, so that assertion proved nothing. Replacing it with the modal's real `role="alert"` element.Flow tests pass. Now updating the API-level tests in `routingProfiles.test.ts` for the new rule.API tests pass. Running the full suite, type-check, and lint.Type-check is clean, 5625 tests pass, and lint reports 0 errors. Checking whether any of the 7 warnings are in files I touched.All 7 warnings are in files this branch doesn't touch, and the touched files lint clean. Now P3, the "Codex-only" wording in the guide.The paragraph also describes the old write rule ("an explicit `false` when on"), which P1 just changed, so I'm rewriting both parts together.Status: P1 and P3 are fixed and all tests pass. Now I'm updating the plan's decision log and the two backlog entries to match.Now the backlog entries. Getting current line numbers first.Final verification: type-check, the full suite, and lint on the touched files.Codex's three findings: I fixed P1 and P3, and rejected P2 as an intentional design. All 5625 tests and the type-check pass, the touched files lint and format clean, and nothing is committed.

P1, a stale save can re-enable a provider — fixed.
- The finding is real, and this branch caused it. The old save left `disabled` out, so the stored value survived. The branch then sent an explicit `disabled: false` on every save, so an editor opened before another admin switched Claude off would switch it back on. Since this is the branch's own code, filing it to the backlog last round was wrong.
- I did not add `If-Match` conditional saves to the editor, because the earlier plan 20261118-codex-speed-
[truncated]
```
#### Iteration 3
- truncated: true
Reviewer output:
```
- **P1 — A stale key-profile draft can still restore provider access.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:818` sends an unconditional PATCH. If a key follows Default when its editor opens and another admin then disables Claude on Default, saving an unrelated Codex change creates an independent key profile. Omitting `disabled` means *enabled* on that new profile; there is no stored key-level flag to preserve. The same issue occurs if an existing profile is reset to a restrictive Default before a stale save recreates it. Guard creation and re-creation against changes to the source profile or key-profile ownership.
- **P2 — A locked toggle can still send an explicit re-enable.** `apps/web/src/features/quota/components/KeyProfileEditor.tsx:176` takes locked provider values from the latest `initial` but passes the original `opened` to the save. If the editor opened with Claude off and a reload shows it on, a TTL-only save sends `disabled: false` even though the switch was locked. That can overwrite a newer restriction. Omit both toggle fields when saving the locked Default editor.
- **P3 — The guide promises more than the editor preserves.** `docs/personal-quota.md:191` says mappings are restored unchanged. The earlier plan and test confirm that saving suggested rows over an empty list is intentional, so the code dismissal is justified. The guide should state that exception: even a toggle-only save can replace an empty Claude mapping list with suggestions.

The original stale-save fix works when the same profile remains in place and an untouched provider was enabled when the editor opened. The revised wording about other providers is also correct.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings rigorously.Reading the save paths and the backend's handling of a new key profile to check whether P1 and P2 hold up.P1 and P2 both hold. Now checking how the hook tests and the flow test call these save paths, so the fixes don't break them.Writing the P1 fix in `routingProfiles.ts`. The existing read-back helper already does "take left-out flags from another profile", so the pre-write path reuses it.Now `saveKeyProfile` itself, plus the shared read-back that used the old helper name.Now the P2 fix in the hook's shared save.Adding tests. API level first: a save that creates a key profile carries the Default's current flag; a failed pre-read writes nothing; no pre-read on an older backend.Now an end-to-end flow test with the real hook: a new key draft opens with Claude on, the Default switches Claude off elsewhere, and the save keeps it off.All 254 pass. Before trusting the new tests, I'll check that they fail with each fix turned off.All four new tests fail with the fixes off and pass with them on. Confirming the files were restored, then moving to the docs (P3 plus the new P1/P2 behavior).The read-only section already covers the scheduler-plugin case, so I'll move that sentence there instead of repeating it.Guide updated. Now recording the three decisions in the plan's decision log and correcting the lost-update backlog entry, which still claims the creation case was safe.Now the backlog entry. I'll fix its claim about the `disabled` flag and refresh its line references.Now the full verification: the whole test suite, type-check, and lint.No errors; lint shows 7 warnings. A `web-lint-warnings.md` backlog entry already exists, so I'm checking whether these are the known ones and what they touch.Only the editor and the reset (with `null`, which skips the pre-read) call it. A last look at the final `saveKeyProfile` code:Code reads as intended. Last check: formatting, since one of my test lines looks long.All three findings were valid and I fixed them. Nothing is committed, so the next Codex pass sees these changes in the uncommitted diff.

P1 (valid, fixed) - a stale save could still switch a provider back on when it created a key profile.
- I checked the backend plan: Disabled is a plain bool that defaults to false, and a key profile doesn't inherit anything from Default. So when the PATCH creates a profile, a left-out disabled means the provider is on. The fix from the last round only worked when the key still owned its profile.
- Fix in routingProfiles.ts saveKeyProfile: on a backend that supports the toggle, when a flag would be left out, the panel now reads the profiles before writing. If the key owns no profile at that moment (a new key, or one reset after its editor opened), each left-out flag is sent with the value the Default has then. The old read-back helper was renamed withUnsentDisabledOf and now serves both the pre-write step and the read-back check. A key that does own a profile works as before: the merge keeps the stored flag.
- Tests:
  - routingProfiles.test.ts: a save that creates the profile sends claude disabled: true when the Default turned Claude off after the editor opened; a failed pre-read sends no PATCH; an old
[truncated]
```
#### Iteration 4
- truncated: true
Reviewer output:
```
- **P1 — A new key profile can still enable a provider that Default disables.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:830` reads CPA’s *loaded* profiles, but the PATCH merges into the config *on disk*. If an admin has already disabled Claude on disk and hot reload is pending, the pre-read still sees Claude on. The PATCH then creates the key profile without `disabled`, and read-back accepts Claude as enabled. Unlike the acknowledged race, this requires **no change between the GET and PATCH**. Use the persisted Default flags and key ownership from one config snapshot, and condition the write on that snapshot’s version.
- **P2 — The key save proceeds even when its pre-read reports that editing is unavailable.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:832` checks only whether the key owns a profile. A 404 becomes `unsupportedBackend: true` rather than throwing; a scheduler takeover returns `supported: false`. In either case the PATCH still runs with the editor’s old capabilities. Abort before writing when the fresh response no longer supports the operation. The new offline-error test does not cover either response.

The previous locked-Default fix is correct: `apps/web/src/features/quota/hooks/useKeyProfiles.ts:297` suppresses both flags. The guide at `docs/personal-quota.md:193` now explains the suggested-mappings exception.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings rigorously.Checking the two findings against the backend's PATCH handler to see what it merges into.Next: the test fixtures for the provider toggle, so I can extend them for the snapshot pre-read.Confirming where the backend stores `disabled` on disk, then I'll write the fix.Writing the service change now.Now the save itself: the doc comment, the pre-read and the conditional PATCH.Those failures were expected: they are the tests that don't mock the new `/config` read yet. Updating the test fixtures next.All of those go through the shared `snapshot()` helper, so one edit covers them:Now the API tests: the snapshot shape, a `/config` fixture for the save tests, and new cases covering both findings.Now the save-methods block: `routeGets` also serves the stored config, and the exact-body test expects the `If-Match`.The API tests pass (169). The new cases fail against the old code: the loaded Default still has Claude on, and none of the abort cases threw. Next, the flow tests that drive the real hook.Adding a stored-file helper to the provider-routing describe block and wiring it into the four toggle flow tests.The flow tests pass (19), including the new scheduler-takeover case. Running the full suite, type-check and lint:Now the backlog entry for the acknowledged race. One of its two gaps is closed now, and its line anchors have moved.Last, the plan's decision log and the Task 2 checklist:Both findings were valid and are fixed. They are defects in this branch's own pre-read, so nothing went to the backlog as a new entry. Nothing is committed and I'm not printing the done signal, so the loop can run Codex again.

P1 (valid, fixed): a new key profile could switch on a provider the Default had off.
- I checked the backend (CLIProxyAPI-migration). GetRoutingProfiles serves h.cfg, the config CPA has loaded. ConfigV8 reads the file with os.ReadFile and merges the PATCH into it. A hand edit reaches h.cfg only after the 150 ms hot-reload debounce. So during that window the pre-read could see Claude on in a Default the file already has off, with nothing changing between the read and the PATCH. The plan's acknowledged race did not cover this.
- Fix in routingProfiles.ts: the pre-read in saveKeyProfile is now configSnapshot() (GET /config, the file). Key ownership comes from its profiledKeys, and the Default's flags from a new sharedDisabledOf (routing.providers.<provider>.disabled, added to ConfigSnapshot as sharedDisabled).
- The PATCH now carries that read's version as If-Match. A change landing in between gets a 412, which becomes ConfigChangedError; the hook already shows "configuration changed" and reloads.
- Without a strong ETag (a proxy dropped or weakened it), the PATCH goes out unconditionally, as the other editor saves do. Refusing instead would break the editor behind such a proxy, and the existing config_version_missing text is written for the speed table.
- withUnsentDisabledOf now takes a flags record, and the read-backs pass it through a small disabledOf helper.

P2 (valid, fixed): the save ignored a fresh read that said editing was unavailable.
- The pre-read used only the key list. A 404 (unsupportedBackend) or a scheduler takeover
[truncated]
```
#### Iteration 5
- truncated: true
Reviewer output:
```
- **P1 — A new key profile can enable a provider that Default disables.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:700` correctly reads the persisted file now, but recognizes only literal `true`. CPA’s typed YAML decoder treats `disabled: yes` and `disabled: on` as true, while `GET /config` returns those values as strings. If that hand edit lands after the editor opens, the save can omit `disabled` and create an enabled key profile even with a matching strong ETag. The test at `apps/web/src/features/personal-quota-support/services/api/routingProfiles.test.ts:764` asserts the incorrect interpretation. Match CPA’s boolean decoding or refuse the write when the value is ambiguous.
- **P2 — Editing both provider flags bypasses the scheduler check.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:864` correctly aborts on an unsupported response, but fetches that response only when at least one flag is omitted. If a user turns both providers off and a scheduler takes over before Save, the panel sends the PATCH without checking. The stored flags then take effect when the scheduler is removed. Check capability for every toggle-capable key-profile save; only the Default-inheritance lookup needs to depend on an omitted flag.

```
Evaluator response:
```
Relevant skill: superpowers:receiving-code-review (evaluating external review findings with rigor).Checking the backend's YAML decoding and GET /config handler to verify finding 1.yaml.v3 confirmed to accept yes/on for typed bools. Now checking whether CPA's config normalization rewrites those values before GET /config returns them.Making the two edits in `routingProfiles.ts`.Now updating the saveKeyProfile doc comment so it says the capability check always runs.Updating the unit test that asserted the wrong reading of `yes`, and adding coverage for the both-flags-sent capability check.Removing a redundant mock setup from the second new test.The unit file passes (173 tests). Running the full web suite, type-check, lint and prettier.All 5643 tests pass, tsc is clean, and lint has 0 errors. Formatting the test file and checking whether any of the 7 lint warnings are in files this branch touched.Updating docs/personal-quota.md to match the new behavior.That on-disk change is my own reflow edit. Final re-run of the touched test file plus type-check after the prettier pass:Both findings were real and both are fixed. Nothing is committed and no signal is output, so Codex can check the fixes on the next pass.

P1, yes/on read as enabled: valid, fixed.
- I checked the backend (CLIProxyAPI-migration, branch provider-disable-in-profiles). GET /config decodes the file without types (config_v8.go, value.Decode(&result) into any). With yaml.v3, a plain disabled: yes therefore comes back as the string "yes".
- CPA's typed load, and the ParseConfigBytes check that PATCH runs, decode into a Go bool. yaml.v3 v3.0.1 (decode.go, the reflect.Bool case) reads y, Y, yes, Yes, YES, on, On, ON as true, quoted or not.
- The old check (block.disabled === true) read such a Default as enabled. A save that creates the key profile then left Claude's flag out, and the new profile started with Claude on. That is the failure Codex described.
- Fix: a new yamlTrue helper in routingProfiles.ts holds the same string set, and sharedDisabledOf uses it.
- No "refuse when ambiguous" branch is needed. Any other non-bool value (1, "true", "yEs") fails ParseConfigBytes, so CPA answers the PATCH with 422 and writes nothing.
- The test that asserted 'yes' means enabled now expects off for all eight strings, and enabled for false, no, off, n, "false", "true", yEs, 1, null and undefined.

P2, saving both flags skipped the scheduler check: valid, fixed.
- saveKeyProfile read /routing/profiles only when it left a flag out. Its own doc comment already said every save is checked.
- With both flags sent, a scheduler takeover or a backend downgrade let the PATCH through. It stored flags CPA would not enforce until the scheduler is removed, and the user saw a normal save.
- Fix: on a backend that serves disabled, every key save now reads /routing/profiles and throws ConfigChangedError if the route is gone, supported is false, or providers or disabled are missing. Only the configSnapshot read, its If-Match, and filling a left-out flag from the Default still depend on a flag being left out.
- Two new tests:
  - A save that sends both flags writes nothing on a missing route, a scheduler, or no disabled, and does not read /config.
  - A save that sends both flag
[truncated]
```
#### Iteration 6
- truncated: true
Reviewer output:
```
Both previous fixes are correct: the raw-config reader recognizes yaml.v3’s `yes`/`on` spellings, and a key-profile save that sends both flags now checks capability before writing. Three related paths remain:

- **P1 — A backend upgrade can still leave a new key with access that Default denies.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:888` skips both fresh reads when the editor opened on a backend without toggle support. If CPA is upgraded and Claude is disabled on Default before Save, the stale editor creates the key profile without `disabled`; Claude starts enabled. Recheck capability even when the cached value is `false`, and reject the stale save if it changed.
- **P2 — A Default toggle save can report success after a scheduler takes over.** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:297` uses cached `state.supported`, and `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:1064` sends the PATCH before rereading profiles. If a scheduler takes over after the editor opens, the panel can save “Claude off” and confirm the stored value even though CPA still permits Claude. Recheck support before a Default save that sends a toggle flag.
- **P2 — Resetting a key bypasses the new read-only guard.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:888` skips the capability check when `profile` is `null`. If a scheduler takes over while the reset confirmation is open, confirming still deletes the stored profile. When normal routing resumes, the key follows Default instead of its former restrictions. Apply the fresh support check to resets too; they do not need the Default-inheritance lookup.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings rigorously.Evaluating the three Codex findings; I've read the save paths and am now checking the tests before changing anything.Code changed; now running the affected test files to see what the new pre-read breaks.Name clash with the read-back's `stored`; renaming the pre-read snapshot to `file`.Only the API unit tests that never mocked a pre-write read fail now; updating them.Existing tests pass. Now adding regression tests for the three scenarios Codex described.New tests pass. Checking they actually catch the bugs by temporarily disabling each guard.Each guard is now covered by a test that fails without it. Running the full web suite, type-check and lint.I checked all three Codex findings against the code. All three were real defects in this branch's own save guard, so I fixed them; nothing went to the backlog and nothing is committed.

- P1 (stale editor creates a key profile after a backend upgrade) — fixed. The check before the write was skipped whenever the editor had opened on a backend without the toggle. After an upgrade, a save could then create a key profile with Claude on even though Default has it off, because a new profile starts with both providers on. Now every key save in routingProfiles.ts reads /routing/profiles first. A profile save writes nothing (ConfigChangedError) when the backend's toggle support no longer matches what the editor opened with, in either direction. The /config read and If-Match are still used only when a flag is left out.

- P2 (Default save reports success after a scheduler takes over) — fixed. saveSharedProfile now reads /routing/profiles before any write that sends a disabled flag, including an explicit false. It writes nothing if the route is gone, a scheduler owns routing, or the field is gone. A Default save with no flag needs no extra read, because the merge keeps the stored flags. The user then sees the existing "configuration changed" message, and the reload locks the switches. The hook's doc comment in useKeyProfiles.ts now mentions this.

- P2 (reset bypasses the read-only guard) — fixed. A reset also reads /routing/profiles first and writes nothing if the route is gone or a scheduler owns routing. It skips the Default-inheritance read and the toggle-support match, since it sends no profile.

Tests:
- The write-error tests in routingProfiles.test.ts now mock the read before the write. Their call-count assertions moved from 0 to 1, and from 2 to 3 in "both save methods omit disabled".
- I added tests for each scenario: a stale editor after an upgrade (with and without providers), a reset under a missing route or scheduler, a reset that needs no config read or toggle match, a Default save sending true or an explicit false under each refusal case, and a Default save without a flag that reads nothing first. There is also a test for a connection change during the read before the write.
- I disabled each guard in turn, and the matching new tests failed each time, so they catch the bugs.

Docs: docs/personal-quota.md describes the new checks, and the plan has two new decision-log entries and a Task 2 line.

Verification in apps/web: npm test passes (325 files, 5652 tests), npm run type
[truncated]
```
#### Iteration 7
- truncated: true
Reviewer output:
```
The three prior findings are fixed when the change is visible to the pre-write check. Two cases remain:

- **P2 — Retrying after a backend downgrade can silently discard “Claude off.”** `apps/web/src/features/quota/hooks/useKeyProfiles.ts:260` passes the capability from the latest reload, while `apps/web/src/features/quota/components/KeyProfileEditor.tsx:138` retains the original draft. The first save correctly refuses the downgrade and triggers a reload. On retry, the editor still shows Claude off, but the save omits `disabled`, accepts the enabled read-back, and closes. Remount the editor when toggle support changes, or refuse the stale draft until it is reopened.
- **P2 — Read-back can confirm a restriction that CPA says it is not enforcing.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:941` and `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:1100` check stored values but not `saved.supported`. If a scheduler takes over after the pre-write check, the read-back can return both `disabled: true` and `supported: false`, and the panel reports success while Claude is still allowed. Check enforcement on read-back for key writes and Default toggle writes, and distinguish “stored but not enforced” from “nothing was written.”

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings rigorously.Evaluating both Codex findings; reading the disabled-flag helpers next.Both findings check out against the code; now reading the remaining toggle tests before adding fixes.Both findings are valid and this branch introduced both code paths. Implementing fixes now.Now the hook branch for the new error:Adding the not_applied string in all four locales:Now finding 1 — remount the editor when what its save can store changes:Running the affected test files to see the baseline after these changes:All 887 pass. Now adding tests, starting with the API read-back checks:Cleaning up a leftover in the Default test I just wrote:New API tests pass. Now the hook test for the error message and reload:Hook test passes. Now writing the editor-remount test for finding 1 in the modal lifecycle tests.The new test fails without the remount key and passes with it. Restoring the fix:Fix restored. Now docs: checking what personal-quota.md says about scheduler takeover and save refusals.Now the full verification gate — tests, type-check, lint, and prettier on touched files:Tests (5660), type-check and lint (0 errors) pass. Prettier flags two test files; checking whether that's only my additions:Prettier only reformatted my new lines. Final re-run of the touched test files and a prettier check across every dirty source file:Both findings were valid. Both are in code this branch changed, so I fixed both rather than filing them. Nothing is committed and I'm not giving the done signal, so the loop can run Codex again on these fixes.

Finding 1 (P2): retrying after a backend downgrade could silently drop "Claude off". Fixed.
- I confirmed the path. The editor copies its draft once (KeyProfileEditor.tsx:137-140). The first save is refused with ConfigChangedError because the switch is gone, and the reload sets state.providerToggleSupported to false. On retry the hook passes false, so sentDisabled leaves every flag out. The read-back then takes its expected flags from the stored profile, so the save passes and the editor closes while it still shows Claude off.
- The same thing happened with a scheduler takeover in the Default editor. With the lock on, the save keeps initial.providers, so the draft's "Claude off" was dropped the same way.
- Fix in RoutingProfilesModal.tsx: both editors are now keyed on state.supported and state.providerToggleSupported. A reload that changes either one restarts an open editor from the stored profile. That matches the existing config_changed text ("Check the current values and try again"). It only happens on a reload while an editor is open, which means after a refused save or a manual Refresh.
- Test in routingProfilesModal.lifecycle.test.tsx, for both the Default editor and a key editor, after a reload that finds the switch gone or supported: false. It checks that the Claude switch reads on and is locked, and that Save is disabled. I confirmed it fails with the old keys and passes with the new ones.

Finding 2 (P2): the read-back accepted a flag that CPA had stored but does not apply. Fixed.
- The read before the write was the only enforcement check. A scheduler that took over after it went unnoticed, and the panel reporte
[truncated]
```
#### Iteration 8
- truncated: true
Reviewer output:
```
Both previous findings are fixed: the editors remount when toggle support or routing ownership changes, and a save whose read-back reports `supported: false` no longer reports success.

- **P2 — Retrying can silently discard an explicit re-enable.** `apps/web/src/features/quota/components/KeyProfileEditor.tsx:137` keeps the profile as it was when the editor opened. If Claude starts on, turning it off succeeds, and only the read-back fails, the reload finds Claude off but keeps the same editor mounted. Switching Claude back on and saving then omits `disabled: false` because `opened` still says it was on (`apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:506`). The read-back accepts the stored off value and the editor closes. Track explicit switch edits, or reset the editor baseline when a reload reveals that the previous write landed.
- **P3 — The new error identifies a scheduler plugin without evidence.** `apps/web/src/i18n/locales/en.json:5758` says a plugin took over, but Home mode also produces `supported: false`. The read-back establishes only that native routing is inactive. Say that CPA stored the change but native routing is inactive, without attributing it to a plugin, in all four locales.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Both findings check out so far. Next I'm tracing how the editor's Enabled switch reports changes, so I can track explicit switch edits.Now the API-side docs, so `opened`'s meaning stays accurate there:Now the locale strings (P3) in all four languages:Now the user doc paragraph that describes the not-applied case:Now tests for P2. Let me look at the editor test helpers:Now a full-flow test reproducing Codex's exact scenario. Checking how the hook handles a generic read-back failure:I left a stray line that would make the pre-write read fail instead of the read-back. Removing it:The second save was refused as "not dirty": in the unit test no reload brought the stored "Claude off" into `initial`. The real flow has that reload, so the test now simulates it:Both pass. Now I'll confirm both new tests fail without the fix, by temporarily disabling the `setOpened` call:Both new tests fail without the fix and pass with it. Next: plan decision-log entries, then the full suite, typecheck and lint.The full suite passes: 325 files, 5663 tests. Lint shows 0 errors and 7 warnings. I'll check whether those warnings are the ones the existing backlog entry already tracks:I fixed both Codex findings and left them uncommitted for the next review pass. The full web suite passes (325 files, 5663 tests), along with type-check and prettier. Lint exits 0 with 7 warnings, all in files this branch doesn't touch and already tracked in docs/backlog/web-lint-warnings.md.

P2 (a retry can silently drop an explicit re-enable) — valid, fixed.
- Codex's scenario is right. A save that stores Claude off but fails on the read-back leaves the editor open, and opened still says Claude was on. Switching Claude back on and saving then leaves the flag out of the request, CPA keeps the stored off, the read-back accepts it, and the editor closes.
- This breaks the plan's own rule (decision log, 2026-11-19 external review): "a save never switches a provider back on unless the editor did". The editor did switch it back on.
- Fix in apps/web/src/features/quota/components/KeyProfileEditor.tsx: after each save, any provider that save sent off now also counts as off in opened (new helper withSavedOff). A retry that switches it back on then writes an explicit disabled: false.
- I chose this over tracking every click on the switch on purpose. A reload still doesn't change opened, and a switch the user never saved still leaves the flag out. So an editor opened before someone else switched a provider off still keeps that off, as the plan's decision 103 requires.
- New tests, both confirmed to fail without the fix:
  - KeyProfileEditor.test.tsx: a save sends Claude off, a reload shows it off, and the retry with Claude on passes opened with Claude off, so the request carries disabled: false. A second test checks that a save sending nothing off leaves opened unchanged.
  - profilesKeysFlow.lifecycle.test.tsx: Codex's exact sequence end to end. The first request stores off, the read-back fails, the editor stays open and the reload shows off. The second request carries disabled: false, the stored value ends up on, and the editor closes.
- I also updated the docs on sentD
[truncated]
```
#### Iteration 9
- truncated: true
Reviewer output:
```
Both previous findings are fixed for the reported cases: after a successful reload, retrying a re-enable sends `disabled: false`; all four locales now describe inactive native routing without blaming a plugin. Three issues remain:

- **P2 — A backend upgrade between the pre-write check and PATCH can silently enable a restricted provider.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:960` checks the stored profile and `saved.supported`, but not whether toggle support changed. If the pre-write read saw an older backend and the PATCH creates a key profile on an upgraded backend whose Default has Claude off, the request omits `disabled`. The new key starts with Claude on, and the read-back accepts it. Check the capability again before reporting success; if it changed, tell the user the write may have landed and reload the profile.
- **P2 — Re-enabling is still blocked if the automatic reload also fails.** `apps/web/src/features/quota/components/KeyProfileEditor.tsx:186` compares the draft only with `initial`. If CPA stores “Claude off” but both the read-back and reload fail, `initial` still says “on.” Switching Claude back on makes the draft look clean, so Save is disabled even though CPA still has Claude off. Account for the unconfirmed write in the dirty check, or require a successful refresh before treating the switch as unchanged.
- **P3 — The inactive-routing message can misreport a Default speed change.** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:1136` raises `RoutingNotAppliedError` whenever a flag was *sent*, even if it did not change. With Claude already off, a speed-only edit resends `disabled: true`. If native routing becomes inactive during the save, the Default speed still applies, but the message says the change does not. For Default saves, say that the **provider switches** are not enforced rather than that the entire change is inactive.

```
Evaluator response:
```
The receiving-code-review skill applies here, since I'm evaluating external review findings. I'll load it first.Evaluating the three findings against the save paths and the editor's dirty check; next I'll look at how a generic save error is shown, then fix.All three findings hold up after tracing, so I'm fixing them now. First I'm checking the locale wording so the new error strings match it.Now the API layer: a scope on `RoutingNotAppliedError` (finding 3) and a new error for the switch appearing mid-save (finding 1).Now the hook, where each error picks its message.Next the locale strings. Checking how each locale names the Default profile and providers first:Now the tests. Looking at the existing ones for the previous iteration's `withSavedOff` and `RoutingNotAppliedError` changes, so the new cases sit beside them:The API tests pass (188). Next, the hook lifecycle test, which constructs `RoutingNotAppliedError()` with no argument and so has to change:Now the editor test for finding 2. It covers the case the reviewer described: a save sends Claude off, no reload follows, and Claude is switched back on.All 5667 tests pass, type-check is clean, and lint reports 0 errors. Checking that the 7 lint warnings are outside the files this loop touched:Last check: Prettier and the affected suites, run again after the doc edits.I fixed all three findings, and all of them are in this branch's own code, so nothing went to the backlog. Nothing is committed and I'm not sending the done signal.

Checks: all 5667 tests pass, type-check is clean, and Prettier is clean. Lint has 0 errors and 7 warnings. All 7 are in files this branch never touched (AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx, UsageMaintenanceCapabilityViews.tsx), and docs/backlog/web-lint-warnings.md already tracks them from an earlier plan, so I left them.

- P2, backend upgrade between the pre-write check and the PATCH: valid. Before the write, saveKeyProfile checks that the backend's switch support matches the editor's, but the read-back didn't check it again. If an upgrade landed in between, a PATCH that created a key profile carried no flags, so the new profile started with Claude on. The read-back then copies an unsent flag from the stored profile, so it matched and the save was reported as successful.
  - Fix: after the existing retained and not-applied checks, a key write now raises a new ProviderToggleChangedError when the editor saw no switch but the read-back shows one (routingProfiles.ts, near line 985).
  - The hook shows a new string, key_profiles.errors.toggle_unsent, in all four locales and reloads. The reload changes the editor's key, so the editor starts over from the stored profile with the switch.
  - Resets and the opposite direction aren't affected. In the opposite direction, a "true" that didn't stick already fails as not retained.
  - Tests: an API test for the race (the PATCH body has no disabled, and the error is ProviderToggleChangedError), and a hook test for the message and the reload.
- P2, re-enabling blocked when the reload also fails: valid. The dirty check compared the draft only with the baseline built from initial. KeyProfileEditor.tsx now also counts this as a change: a provider that opened has off w
[truncated]
```
#### Iteration 10
- truncated: true
Reviewer output:
```
The three previously reported cases are fixed. Two related retry issues remain:

- **P2 — A failed re-enable can leave access on with no way to save it back off.** `apps/web/src/features/quota/components/KeyProfileEditor.tsx:190` — Open an existing profile with Claude off, switch it on, and save. If CPA applies the write but both the read-back and reload fail, switching Claude back off matches the stale baseline and disables Save. The editor shows Claude off while CPA allows it. The dirty check needs to track unconfirmed writes in both directions.
- **P2 — A write that CPA definitively rejected can authorize a later re-enable.** `apps/web/src/features/quota/components/KeyProfileEditor.tsx:219` — `withSavedOff` records an off submission before its outcome is known. If CPA rejects it with a 422, the user can undo that edit, then save an unrelated setting. That save sends an explicit `disabled: false`, overwriting a restriction another admin added in the meantime. Preserve the attempted flag for ambiguous failures, but discard it when no write occurred.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Checking which save errors mean CPA wrote nothing, so the editor can drop an attempted flag only then.Both findings check out. Next I'm reading the docs and tests that describe the current retry behavior, then I'll pass the save outcome back to the editor.Implementing now: marking save errors that wrote nothing in the API layer, returning a three-way outcome from the hook, and tracking unconfirmed flags in both directions in the editor.Now the hook: return a three-way outcome instead of a boolean.Now the modal wiring.Now the editor itself: replacing `withSavedOff`/`reenablesUnconfirmed` with a per-provider record of flags sent by saves whose outcome is unknown.Only test mocks fail the type check. Updating them to return outcomes.The hook tests still assume booleans. Reading each affected test so every one asserts the outcome that matches its scenario.Code changes are in; now adding tests. First the API tests covering which save failures count as nothing written.Adding the API classification tests now.API tests pass (199). Now updating the hook tests to the outcome values and adding a hook-level test through the real API.The two failures are expected: those tests' `onSave` mock resolves to nothing, and the editor now records flags only for an `unconfirmed` outcome. Updating them and adding tests for both findings.Editor tests pass (54). Removing the lock-mode test I just added: under the lock the switches can't change, so it would pass with or without the fix.Adding one modal test to check the outcome is passed through to the editor that stays open.All 972 quota tests pass. Running the full type check, lint, and test suite.Lint exits 0. The 7 warnings are in files this branch never touches (accounts, dashboard, usage-maintenance), and none are errors. Running the full test suite.Full suite passes: 325 files, 5683 tests. Next, updating the user docs and the plan's decision log.Now the user doc paragraph in `docs/personal-quota.md` that describes the failed-save behavior.Rereading the final editor code once.I fixed both findings. Nothing is committed, and the full web test suite (5683 tests), the type check and lint all pass.

Finding 1 (P2, KeyProfileEditor.tsx:190) - valid, fixed. Your scenario reproduces exactly. The editor opens with Claude off. The user switches it on and saves, which sends an explicit disabled: false. The read-back fails and so does the reload, so the editor's baseline still shows Claude off. The old dirty check (reenablesUnconfirmed) only covered a possibly-stored off. So switching Claude back off matched the stale baseline and Save stayed disabled, while CPA may already allow Claude. This is the branch's own code, so it is in scope. Not intentional: the plan's decision log only recorded the off direction.
- The editor now keeps an unconfirmed record per provider and direction: did a save with an unknown outcome send this provider off, or on? Only flags the save actually sent are recorded, using sentDisabled with the same capability gate as the save, so nothing is recorded under the mode lock.
- The dirty check (differsFromUnconfirmed, which replaces reenablesUnconfirmed) counts any draft whose
[truncated]
```

## Validation
- none
- duration_ms: 0
- runs: 0