# Report: Per-key routing profiles UI on the Quota page
Plan: `docs/plans/20261104-per-key-routing-profiles-ui.md` · Branch: `per-key-routing-profiles-ui` · Base: `main` · Mode: full · Executor: claude · Task model: claude:opus:high · Review model: claude:opus:high · Started: 2026-11-04T21:33:35Z · Finished: 2026-11-04T22:52:40Z

## Summary
This branch adds a UI on the Quota page for CPA's per-key routing profiles:
- **Toolbar slots.** The single strategy select becomes two slots, Primary and On a tie, which write `routing.selection` as one object. The tie slot is disabled when the primary slot is a picker, and its empty value is sent as `null`. On a backend without `/routing/profiles`, the legacy strategy select stays and still writes `routing.strategy`.
- **Keys button and modal.** A "Ключи N/M" toolbar button opens a modal with a read-only summary of the shared profile and one row per client key: its alias or masked key, a "Shared settings" or "Own profile" badge, and a one-line chain summary. Edit opens a `KeyProfileEditor` for sticky session, preferred Claude and Codex accounts, primary and tiebreak selection, and the Claude → Codex fallback.
- **Saving a profile.** A new profile starts as a copy of the shared profile. A save sends one `PATCH /config` with the complete profile, and choosing shared settings sends `null`. The panel then reads `/routing/profiles` again and compares the result through `normalizeProfile`.
- **Errors.** A 400 `unknown_api_key` reloads the list and explains that the key was removed. A 422 `invalid_config` shows the backend's message. A 404 hides the button. `supported: false` makes the editor read-only.
- **Supporting refactors:** `FallbackSettingsEditor` was extracted from `ClaudeFallbackControl`. The shared `useApiKeyAliases` hook now also serves `ApiKeysCardEditor`. `preferredAccountOptions`, `providerAccountFiles` and `isPickerSlot` moved into `routingModel.ts`. `useClaudeFallback` was lifted into `QuotaSettingsBar`, so a fallback save reloads the profiles.
- **Raw keys** stay in memory and PATCH bodies only. Tests check that they never appear in rendered output, titles, aria labels or request URLs.
- **Docs:** `docs/personal-quota.md` has a new "Routing profiles per API key" section and updated routing text.

All 10 plan tasks are checked off: 10 task iterations, 0 failed retries. Internal review ran 1 loop and ended with `review_done`. Post-review ran 1 iteration. The Codex external review raised one finding, which was fixed, and its second pass was clean.

Phase durations (through finalize, before report assessment and archival):

| phase | duration_ms | ≈ |
|---|---:|---|
| tasks | 3017292 | 50m 17s |
| internal review | 1354025 | 22m 34s |
| external review | 216348 | 3m 36s |
| evaluation | 157727 | 2m 38s |
| other | 0 | 0s |

Finalize did not run, so the branch was not synced with origin/main. Local `main` (`f7748d9f`) is 4 commits ahead of `origin/main` (`bcce4abb`), so the diff is measured against `main`.

## Change scope
- **Diff:** 37 files, +4759 / −321 (`git diff main...HEAD`).
- **New files (15):**
  - API module `routingProfiles.ts` with its test
  - `keyProfilesModel.ts` with its test
  - hooks `useKeyProfiles.ts` and `useApiKeyAliases.ts` (with `useApiKeyAliases.test.tsx`)
  - components `KeyProfilesModal.tsx`, `KeyProfileEditor.tsx` and `FallbackSettingsEditor.tsx`, with tests for the editor components and SCSS modules for the modal and the key editor
  - lifecycle tests `keyProfiles.lifecycle.test.tsx` and `useKeyProfiles.lifecycle.test.tsx`
- **Modified files (22):**
  - `ApiKeysCardEditor.tsx` (now uses the shared alias hook)
  - `claudeFallback.ts` and its test (`readFallbackSettings` extracted, `withSuggestions` exported)
  - `subscriptionRouting.ts` (optional `selection` in the settings and the patch)
  - `ClaudeFallbackControl.tsx` (optional `fallback` prop)
  - `QuotaSettingsToolbar.tsx` and `.module.scss` (slots, Keys button, `QuotaSettingsBar` wiring)
  - `useClaudeFallback.ts` (`onSaved`)
  - `useSubscriptionRouting.ts` (optional `profiles` parameter)
  - `routingModel.ts`
  - 5 existing test files
  - 4 locale files (en, ru, zh-CN, zh-TW)
  - `docs/personal-quota.md`
  - the plan file
- **Commits (12):**
  - `17c3d57b` routing profiles API module and client key list
  - `3c551e4f` key profiles model and shared preferred-account options
  - `4f7dec3f` extract `FallbackSettingsEditor`
  - `f1f1f733` shared `useApiKeyAliases` hook
  - `c51087f5` `useKeyProfiles` hook
  - `78bb157a` selection slots and the Keys button in the toolbar
  - `3c2bfbaa` `KeyProfileEditor`
  - `7ff722f8` `KeyProfilesModal` and toolbar wiring
  - `5fce7e7f` acceptance verification and remaining branch coverage
  - `b90318af` docs
  - `3aab6118` internal review fixes
  - `c172d749` Codex review fix

## Evidence
The supplied validation facts record no runs (`runs: 0`). The only before/after proof is in the external review transcript:
- **Before:** Codex reproduced the bug in memory. Opening the Keys modal starts a reload of the profiles. During that reload, Edit opened an editor from cached rows. The refreshed `sessionAffinity: true` was never shown in the editor, and Save wrote `false` with no user edit.
- **After:** `KeyProfilesModal.tsx` sets `disabled={saving || (loading && !isOpen)}` on the Edit button. A new regression test in `keyProfiles.lifecycle.test.tsx`, "a key editor cannot open from cached rows while the profiles reload", checks three things:
  - the toggle is disabled while profiles load;
  - it is enabled again once loading finishes;
  - an editor that is already open can still be collapsed during a later reload.

  The evaluator reported that this test and the full suite passed, but no run of the test against the code before the fix was recorded.

## Risk
**medium**
- **Public APIs:** no backend or manager-server API changes. The panel uses the existing `GET /v8/management/routing/profiles` and `PATCH /v8/management/config`. `useSubscriptionRouting(disabled, profiles?)`, `useClaudeFallback(disabled, onSaved?)` and `ClaudeFallbackControl`'s `fallback` prop were extended with optional parameters, so existing callers are unchanged.
- **Data schemas and configuration:** no repo schema changes, but the panel now writes new keys into the live CPA `config.yaml`:
  - On backends that support profiles, the toolbar's Save writes `routing.selection` instead of `routing.strategy`.
  - Key profiles are written under `routing.key-profiles.<raw key>`. PATCH replaces lists, so each save sends the complete profile.

  A wrong body could change how a client key is routed. This is mitigated by the read-back comparison, the backend's 400/422 validation, and tests on the PATCH bodies.
- **Concurrency:** the profiles reload while the modal is open, and both the toolbar and the modal share one `useKeyProfiles` state. The Codex finding showed that this caused a real stale-draft overwrite, which is now fixed. Every await is wrapped in `guardConfigConnection`, and a connection-revision guard drops stale results. Interleavings beyond the tested ones are where any remaining risk lies.
- **Migrations:** none.
- **Backward compatibility:** a 404 backend keeps the legacy select and hides the button. `QuotaPage.lifecycle.test.tsx` stubs a 404 to cover this.
- **Security:** a raw key must never reach URLs or rendered output. Tests assert this on request URLs, `renderer.toJSON()`, titles and aria labels.

## Merge danger
**Door:** two-way
Reverting the commits restores the old toolbar and modal-free panel. Any `routing.selection` or key profiles saved in the meantime stay in `config.yaml`, but they are valid backend config and can be removed with a `null` PATCH.

**Blast radius:** Quota-page
Only the Quota toolbar, the Claude fallback control and the Config → API keys alias loading are affected, but a bad save would change routing for real client keys.

## Migrations and operational steps
No database, schema or data migration is required. The feature needs the CLIProxyAPI-migration backend at `ced98b16` or later, which the plan says was deployed on 2026-11-04. Older backends fall back to the legacy behavior. The manager server already proxies `/routing/profiles`.

Deployment and manual checks are still to do (plan Post-Completion; none are recorded as done):
- Build and deploy the CPAMP release through the local launchd flow (release dir, backup, symlink switch, `launchctl kickstart`), keeping the previous release for rollback.
- On the live panel:
  - Set the shared slots and confirm that `GET /v8/management/routing/profiles` reflects them.
  - Give one key a profile with a preferred Claude account and sticky off, and check the `Routing profile selection` log lines in CPA `logs/stdout.log`.
  - Reset that key to shared settings and confirm that its profile is gone from `config.yaml`.
- Check the light and dark themes and the narrow-width toolbar wrap.

## Plan deviation
All 10 tasks were completed as planned. No items were blocked or skipped. These added notes record where the work went beyond or refined the plan:
1. **Task 1:** `normalizeProfile` was created early in `keyProfilesModel.ts` for the read-back. `keyProfilePatch` and `saveKeyProfile` gained an optional `selectionOptions` argument so a picker primary sends `tiebreak: null`. `readFallbackSettings` was extracted from `readClaudeFallback` and is shared by both readers.
2. **Task 2:**
   - `providerAccountFiles` was also extracted into `routingModel.ts`.
   - `buildKeyRows` returns `{key, profile, label, masked, hasAlias}` and falls back to the mask when an alias repeats the raw key.
   - `chainSummary` reuses the existing `automatic` and `missing_account` labels and shows slot ids as written in the config.
3. **Task 4:** `useApiKeyAliases` also returns `replaceAliases` and `removeAlias`, and `resolveAliasServiceBase(availability)` is exported, so `ApiKeysCardEditor`'s save and delete paths keep updating the list locally.
4. **Task 5:**
   - The test file lives at `features/quota/useKeyProfiles.lifecycle.test.tsx`.
   - The first load reads the cached config and later reloads force a fresh read.
   - A save error survives the reload it triggers.
   - A failed read-back reloads the stored state, but a 422 does not.
   - The new locale key is `quota_management.key_profiles.errors.unknown_key`.
5. **Task 6:**
   - The `profiles` parameter also carries `selectionOptions`, and `supported` means the backend serves `/routing/profiles`.
   - An unsaved toolbar slot edit survives a profiles reload.
   - `isPickerSlot`, `withPickerRule` and `selectionSlotOptions` moved to `routingModel.ts`.
   - `readSubscriptionRouting` did not gain `selection`, so `config.test.ts` was not changed (the plan said it might need to be). The patch tests went into `quotaSettingsHooks.test.ts`.
6. **Task 7:**
   - The editor has an optional `sessionAffinityTTL` prop and its own SCSS module.
   - Creating a profile counts as dirty even when it equals the shared settings.
   - The draft and the baseline both pass through `withSuggestions`.
   - Switching to shared settings and back keeps the unsaved draft.
7. **Task 8:**
   - `useClaudeFallback(disabled, onSaved?)` was added, and `ClaudeFallbackControl` gained an optional `fallback` prop, so `claudeFallback.lifecycle.test.tsx` is unchanged.
   - The button keeps its N/M counts during reloads. It is hidden until the first load and on a 404 backend, but shown after a failed first load so the modal can show the error and retry.
   - The modal has its own SCSS module and a listed set of new locale keys.
8. **Task 9:** tests were added for the remaining branches of `routingProfiles.ts`: a non-string tiebreak, non-list selection options, a 422 without a message, and a non-object write error. A disconnected-panel case was added to `keyProfiles.lifecycle.test.tsx`. Lint has 7 warnings, all in files this branch does not touch.

Beyond the plan, two review-fix commits were added: `3aab6118` (internal review) and `c172d749` (Codex: Edit is disabled while profiles reload).

## Backlog
There were no backlog entries.

## External review
### codex:gpt-6-astra:high
- label: codex
- iterations: 2
- duration_ms: 374038
- ended by: done
- had findings: true

Iteration 1:
- [P2] Edit could open a key editor from cached rows while the profiles were still reloading, so Save could overwrite newer settings (`KeyProfilesModal.tsx:152`) -> fixed: Edit is disabled while loading unless that row's editor is already open, and a regression test was added (`c172d749`).

Iteration 2:
- NO ISSUES FOUND.

## Validation
- Commands: none
- Timings: duration_ms 0, runs 0

No validation-phase runs were recorded. The Codex evaluator's responses report these checks, which are not in the deterministic facts:
- Iteration 1: vitest 300 files / 4937 tests passed, `tsc --noEmit` clean, Prettier clean on the changed files, eslint 0 errors and 7 warnings in untouched files.
- Iteration 2: quota tests 26 files / 322 tests passed, eslint clean on the two changed files.