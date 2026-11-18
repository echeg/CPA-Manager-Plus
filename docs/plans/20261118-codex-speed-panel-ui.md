# Codex speed in the routing profile editor and a speed table

## Overview
- The panel gets controls for the Codex speed (`standard` / `fast` / `ultrafast`) and the "ignore the client tier" flag of a routing profile: a row in the Codex block of the profile editor, and a table that lists the Default profile and every client key and changes a speed with one click.
- The Codex Fast mode toggle and all its code are removed.
- Problem it solves: the backend moved the speed from the global `oauth.providers.codex.fast-mode` flag into the routing profiles. The panel still reads and writes the removed path, so its toggle shows "off" and fails on a click. A key profile created in the panel loses the Default profile's speed, because the panel neither copies nor sends `speed` and a key profile replaces the Default profile entirely.
- Integration: web only (`apps/web`). The same `KeyProfileEditor` serves the Default profile and key profiles; writes stay a merge-PATCH to `/config` followed by a read-back check. `apps/manager-server` is not touched, so the result ships as a panel-only release.

## Success Criteria
1. In the profile editor the Codex speed and the flag are saved and shown again after a reload.
2. A new key profile created in the editor inherits the Default profile's speed and flag.
3. The speed table shows the effective speed and flag of the Default profile and of every client key, and changes them with one click; a key without its own profile gets a complete copy of the Default profile with the new value.
4. The panel sends no request to `/config/oauth/providers/codex/fast-mode`, and no Fast mode code or strings remain.
5. On a backend whose response has no `speed`, no speed controls are rendered and the saved bodies carry no `speed` or `ignore-client-tier`.
6. `npm run test:web`, `npm run type-check` and `npm run lint` pass.

## Decisions
- **Context**: the backend (CLIProxyAPI fork, deployed 2026-11-18 as `v8.0.77-personal.codex-speed.20261118`) added two fields to `routing.providers.codex` of the shared profile and of every key profile, and removed `oauth.providers.codex.fast-mode`. The contract is in the backend repository, `docs/management-api-v8.md`, section "Codex speed". What the panel needs from it:
  ```json
  {
    "supported": true,
    "shared": {
      "providers": {
        "claude": {"mode": "subscription", "api-credential": "", "fallback": {"target": "codex", "mode": "auto", "mappings": []}, "speed": "", "ignore-client-tier": false},
        "codex":  {"mode": "subscription", "api-credential": "", "fallback": {"target": "off", "mode": "", "mappings": []}, "speed": "fast", "ignore-client-tier": false}
      }
    },
    "keys": [{"key": "client-key-a", "profile": {"...": "same shape"}}]
  }
  ```
  Backend rules the panel must respect:
  - `speed` is empty, `standard`, `fast` or `ultrafast`. The view shows `standard` for a Codex block that does not set it and `""` for Claude.
  - A non-empty `speed` or `ignore-client-tier: true` under `providers.claude` is rejected with 422 `invalid_config`.
  - A key profile replaces the shared profile completely: a key profile without the fields runs Codex at `standard` with the client tier respected.
  - A PATCH that names a key without a profile creates a profile that holds only the written fields, so a new profile must be sent complete.
  - Codex API-key credentials are never changed by these fields.
  - With `supported: false` (a scheduler plugin) the shared Codex speed and flag keep applying, while key profiles, the provider mode and both fallback targets do not.
  - `ultrafast` on a model that offers only Fast is lowered to `priority` by the backend; on a model that offers neither, no tier is sent.
  - A GET of the removed fast-mode path returns 404 and a write returns 400.
- **Chosen approach — model**: `speed` and `ignoreClientTier` are fields of the shared `ProviderRouting` type. Claude always reads as `standard` / `false` and is never written; the reader is the single place that forces these defaults. Reading follows the existing `readEnum` rule: absent, `null` or `""` gives `standard`; any other unknown value fails the load.
- **Chosen approach — older backend**: a response whose `shared.providers.codex` has no `speed` key marks the backend as old (`speedSupported: false`). The panel then renders no speed controls and sends neither field. This is the same idea as `providersSupported`.
- **Chosen approach — editor**: in the Codex block, below the fallback row, a "Speed" row with a segmented control Standard / Fast / Ultrafast, a switch "Ignore the tier the client sends" with a hint, and a hint: Ultrafast applies to models that offer it, models that offer only Fast use Fast, and other models get no speed tier. In API key mode the row is disabled with an explanation and the stored values are kept, unless the profile's Claude falls back to Codex: that leg runs on Codex subscriptions with the profile's Codex speed, so the row stays enabled with a note. With Subscription mode and fallback target API key the controls stay enabled. The Claude block gets nothing. The speed controls are not tied to `modeLocked`: under `supported: false` the Default profile's speed stays editable, also when its stored Codex mode is API key, because CPA ignores the mode there.
- **Chosen approach — table**: a toolbar button in place of the Fast toggle (part of the slim toolbar's `ProfileButtonsProps`) shows the Default profile's speed (for example "Codex speed: Fast") and opens a modal. Rows: the Default profile, then every client key in config order, labelled like the Keys modal (alias, CP name or masked key; never the raw key). Each row has a three-way speed selector and the flag switch; a click is applied at once, without a confirmation. The selector is a group of three buttons activated by a click, Enter or Space, not `SegmentedTabs`, whose arrow-key navigation changes the value and would write on every key press. A key without its own profile shows the Default values with a "Default" badge; a click on it creates a key profile that is a complete copy of the Default profile with the new value, and the badge becomes "Own profile". While a write runs all controls are disabled. The rows always show the stored values, so after a failed write the error is shown in the modal and the row keeps its stored speed. Disabled with an explanation: a row whose Codex mode is API key (except the Default row under `supported: false`, and a row whose Claude falls back to Codex, which shows a note instead); key rows when `supported: false`.
- **Chosen approach — writes from the table**: the existing `saveKeyProfile` / `saveShared` of `useKeyProfiles`, with the complete profile and the read-back check.
- **Chosen approach — Fast mode**: removed everywhere, including the legacy toolbar of a backend without `/routing/profiles`. A backend without `speed` gets no speed control in the panel.
- **Chosen approach — chain summary**: for Codex in Subscription mode with speed `fast` or `ultrafast` the provider name carries the speed, for example `Codex (Fast): Automatic → API key`. Unchanged for `standard` and for API key mode.
- **User decisions**:
  - Scope is the speed UI only. The pricing fixes (speed tier under long context, Ultrafast import, unpriced-tier marker) are a later plan; the findings are in `docs/backlog/ultrafast-service-tier-priced-as-standard.md`.
  - The table applies a change on click.
  - A click on a key without its own profile creates a key profile as a complete copy of the Default profile.
  - The table is opened by a toolbar button in place of the Fast toggle.
  - The Fast flag is deleted, not kept for compatibility.
- **Non-goals**:
  - Cost calculation for Fast / Ultrafast.
  - Returning a key to the Default profile from the table (it stays in the Keys modal).
  - A bulk "set every key" action.
  - Showing which models support Ultrafast.
  - Changes to `apps/manager-server`.
  - Deployment (see Post-Completion).
- **Verified facts**:
  - `ProviderRouting` is one type for both providers (`apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts:22-33`); the editor handles both blocks through `draft.providers[provider]` (`apps/web/src/features/quota/components/KeyProfileEditor.tsx:244-269`).
  - `providersSupported` is derived from the response shape (`routingProfiles.ts:315`) and passed down to `profileBody`, `keyProfilePatch`, `sharedProfilePatch`, `saveKeyProfile` and `saveSharedProfile`.
  - `profileBody` builds the Codex block without the two fields (`routingProfiles.ts:392-398`); `copyOfProviderRouting` and `normalizeProviderRouting` do not carry them (`apps/web/src/features/quota/keyProfilesModel.ts:27-50`, `:93-101`).
  - Under `fallbackReadOnly` the editor saves `initial.providers` instead of the draft (`KeyProfileEditor.tsx:138-147`), so a speed edited there would be dropped unless the save keeps the draft's two Codex fields.
  - `profileBody` builds the request body from `normalizeProfile(profile)` (`routingProfiles.ts:368`), so the body cannot carry a field the normalizer drops.
  - `apps/web/tsconfig.app.json:27` includes all of `src`, so test files are type-checked: every `ProviderRouting` and `RoutingProfilesState` literal in tests must gain the new fields.
  - `SegmentedTabs` uses the default id prefix `segmented-tabs` unless `idBase` is passed and calls `onChange` on arrow, Home and End keys (`apps/web/src/components/ui/SegmentedTabs.tsx:54`, `:79-104`).
  - `keyProfiles.locale.test.ts` scans only `KeyProfileEditor.tsx`, `ProviderRoutingBlock.tsx` and `providerRoutingModel.ts` for used keys (`:6-8`, `:113-125`), checks the subtrees listed at `:18`, and takes run-time keys from `dynamicProviderRoutingKeys` (`:38-54`).
  - The write-error path reloads the profiles except after a 422 (`useKeyProfiles.ts:187-203`).
  - `useKeyProfiles` has one write slot (`beginWrite` / `endWrite`), `saveKeyProfile` refuses when `supported` is false, and `saveShared` is not gated on it (`apps/web/src/features/quota/hooks/useKeyProfiles.ts:209-262`).
  - `CodexFastMode.tsx` is imported nowhere. The Fast toggle is rendered by `QuotaSettingsToolbar.tsx:160-175` in both toolbar variants.
  - The `'codex-fast-mode'` member of `RawConfigSection` in `personal-quota-support/types/config.ts:11` has no user outside its own type file.
  - The panel has no demo fixtures for routing profiles, so demo mode needs no change.
  - The repository has no `AGENTS.md` or `CLAUDE.md`. Earlier panel plans: `docs/plans/completed/20261110-provider-mode-profile-editor.md`, `docs/plans/completed/20261117-claude-reset-grant-picker.md`.
  - Live state for manual verification: the shared profile has Codex `speed: fast`; 7 client keys, 0 key profiles.

## Context (from discovery)
- Files/components involved:
  - `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts`: types, reading, PATCH bodies, save and read-back.
  - `apps/web/src/features/personal-quota-support/services/api/config.ts`, `apps/web/src/features/personal-quota-support/types/config.ts`: the `codexFastMode` field and `updateCodexFastMode`.
  - `apps/web/src/features/quota/keyProfilesModel.ts`: normalization, dirty check, copy of the Default profile, chain summary.
  - `apps/web/src/features/quota/providerRoutingModel.ts`: `withApiModeNormalization`.
  - `apps/web/src/features/quota/components/ProviderRoutingBlock.tsx`, `KeyProfileEditor.tsx`, `RoutingProfilesModal.tsx`, `ClientKeysModal.tsx`, `QuotaSettingsToolbar.tsx`.
  - `apps/web/src/features/quota/hooks/useKeyProfiles.ts`, `hooks/useCodexFastMode.ts`, `routingModel.ts` (`saveCodexFastMode`), `components/CodexFastMode.tsx` with its stylesheet.
  - `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json`.
  - `docs/personal-quota.md` (Fast mode at lines 15, 171, 234, 239).
- Related patterns found:
  - A capability flag read from the response shape, with controls hidden and fields not sent on an older backend.
  - Values hidden by the current mode stay in the stored profile.
  - Component tests use `react-test-renderer` with a mocked `Modal` (`clientKeysModal.lifecycle.test.tsx`, `components/ProviderRoutingBlock.test.tsx`).
  - Locale tests check that every key used in the sources exists in all four locales and that removed keys are gone (`keyProfiles.locale.test.ts`).
- Dependencies identified: none new. `SegmentedTabs` and `ToggleSwitch` from `apps/web/src/components/ui` cover the controls.

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
- Maintain backward compatibility with a backend that has no `speed`
- Never render a raw client key and never put one in a URL; rows show the alias, the CP name or the masked key
- Every new user-visible string goes into all four locales

## Testing Strategy
- **Unit tests**: required for every task (see Development Approach above). Model tests are plain vitest; component tests use `react-test-renderer` like the existing ones.
- **E2E tests**: the project has no UI e2e suite; component and lifecycle tests cover the UI.
- Commands, from the repository root: `npm run test:web`, `npm run type-check`, `npm run lint`.

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

## Decision Log
- 2026-11-18 brainstorm: **accepted** - `speed` and `ignoreClientTier` live on the shared `ProviderRouting` type, with Claude always `standard` / `false` and never sent. Evidence: the backend serves both fields in both provider blocks; the editor handles both blocks through `draft.providers[provider]` (`KeyProfileEditor.tsx:244-269`).
- 2026-11-18 brainstorm: **accepted** - `speedSupported` is read from the presence of `speed` in `shared.providers.codex`; when false the controls are hidden and the fields are not sent. Evidence: the `providersSupported` pattern (`routingProfiles.ts:315`); the backend rejects unknown keys on a write.
- 2026-11-18 brainstorm: **accepted** - the speed table writes through the existing `saveKeyProfile` / `saveShared` with the complete profile and the read-back check. Evidence: the backend doc says to send the full profile when creating one; `useKeyProfiles.ts` already has the write slot and the verification.
- 2026-11-18 brainstorm: **accepted** - in Codex API key mode the speed controls are disabled with a hint and the stored values are kept; under Subscription with an API-key fallback they stay enabled. Evidence: the backend never changes API-key credential requests; hidden values already survive in the provider block (`ProviderRoutingBlock.tsx:45`).
- 2026-11-18 brainstorm: **accepted** - under `supported: false` the Default profile's speed stays editable and key rows are read-only; the speed is not tied to the mode and fallback lock. Evidence: the backend keeps applying the shared speed there.
- 2026-11-18 brainstorm: **accepted** - the Fast toggle is removed everywhere, including the legacy toolbar, with its hook, API call, config field and strings. Evidence: the user's decision to delete the flag; the backend answers 404 on the old path.
- 2026-11-18 brainstorm: **accepted** - the chain summary names the Codex speed when it is `fast` or `ultrafast` in Subscription mode. Evidence: `chainSummary` is the one-line view of what a profile does (`keyProfilesModel.ts:199`), shown in the Keys modal and the profile list.
- 2026-11-18 brainstorm: **rejected** - "fix the Fast / Ultrafast cost calculation in this plan" - the user chose the speed UI only; the pricing work is a separate subsystem (Go and TypeScript copies of the cost logic, a full release instead of panel-only) and becomes a later plan.
- 2026-11-18 grill: **accepted** - the normalizer and the copy of a provider block moved from Task 2 into Task 1, and the old Task 1 was split into Task 1 (model) and Task 2 (bodies and capability flag); later tasks renumbered - decided by grill: `profileBody` builds the body from `normalizeProfile` (`routingProfiles.ts:368`), and `keyProfilesModel.ts:33-48`, `:92-100` build `ProviderRouting` literals that stop compiling once the fields are required.
- 2026-11-18 grill: **accepted** - Tasks 1 and 2 update every `ProviderRouting` and `RoutingProfilesState` literal in tests - decided by grill: `apps/web/tsconfig.app.json:27` type-checks the tests; eight test files hold such literals.
- 2026-11-18 grill: **accepted** - Task 2 updates the exact-argument save assertions in `useKeyProfiles.lifecycle.test.tsx` - decided by grill: lines 267-613 use `toHaveBeenCalledExactlyOnceWith` with four arguments.
- 2026-11-18 grill: **accepted** - `speedSupported = false` is the default of all five body and save functions, with a test that a dropped speed fails the read-back - decided by grill: the five functions share one default style (`routingProfiles.ts:363-506`); a mixed default would either contradict the safety reason or fail silently.
- 2026-11-18 grill: **accepted** - Task 2 gains save and read-back tests for both save functions - decided by grill: Success Criterion 1 had no end-to-end test; the read-back goes through `sameProfile` (`routingProfiles.ts:440-444`).
- 2026-11-18 grill: **accepted** - the summary task (now Task 3) adds the speed names and `provider_speed` itself and lists them in the locale test - decided by grill: the old Task 2 used strings of a later task, and `keyProfiles.locale.test.ts:18`, `:38-54` cannot see run-time keys or the `codex_speed` subtree.
- 2026-11-18 grill: **accepted** - Tasks 5 and 6 add the new sources and the toolbar button keys to the locale test - decided by grill: the used-keys scan covers three files only (`keyProfiles.locale.test.ts:6-8`, `:113-125`).
- 2026-11-18 grill: **accepted** - Task 4 updates the existing `fallbackReadOnly` editor test instead of only adding one - decided by grill: `KeyProfileEditor.test.tsx:653-658` asserts `toBe(stored.providers)`, which the new save breaks.
- 2026-11-18 grill: **accepted** - under `supported: false` the Default profile's speed is editable also when its stored Codex mode is API key, in the editor and in the table - decided by grill: the backend ignores the provider mode there while the shared speed applies; `ProviderRoutingBlock.tsx:200` already notes that CPA ignores the mode while it is locked.
- 2026-11-18 grill: **accepted** - the table's speed selector is a button group with explicit activation and per-row accessible names, not `SegmentedTabs` - decided by grill: `SegmentedTabs.tsx:79-104` calls `onChange` on arrow, Home and End keys, and every change in the table is a write that can create a key profile; the user's decision is "applied on click".
- 2026-11-18 grill: **accepted** - the Ultrafast hint says models with only Fast use Fast and other models get no tier - decided by grill: the backend contract quoted in Decisions distinguishes the two cases.
- 2026-11-18 grill: **accepted** - the table shows stored values only, and Task 5 tests a failed write and a vanished key - decided by grill: `useKeyProfiles.ts:187-203` reloads after a failed write except after a 422, so "reloaded from the server" was not always true.
- 2026-11-18 grill: **accepted** - the speed button is part of `ProfileButtonsProps` instead of a separate optional prop - decided by grill: `QuotaSettingsToolbar.tsx:49-55` already bundles the slim toolbar's buttons and their disabled state.
- 2026-11-18 grill: **accepted** - Claude's defaults are forced only by the reader; the normalizer carries the fields for both providers - decided by grill: no code path can give a Claude block another value once the reader forces the defaults and the body never sends them.
- 2026-11-18 grill: **accepted** - Tasks 6 and 7 name every Fast mode test to remove or change, and the old "no request" test became a concrete case in `profilesKeysFlow.lifecycle.test.tsx` with a gate test for an older backend - decided by grill: `settingsHooks.lifecycle.test.tsx:12` imports the hook, `keyProfiles.lifecycle.test.tsx:43` mocks its module, three `Config` fixtures set `codexFastMode`, and the flow test spied only on `apiClient.patch` (`:230`).
- 2026-11-18 grill: **accepted** - the README check was removed from the documentation task and the final search is limited to `apps/web/src` - decided by grill: `README.md` and `README_CN.md` do not mention Fast mode; `apps/manager-server/internal/httpapi/server_v8_proxy_test.go:57-58` mentions the old path and is out of scope.
- 2026-11-18 review: **accepted** - in Codex API key mode the speed row stays enabled, with a note, when the profile's Claude falls back to Codex - decided by internal review: the fallback leg requires OAuth auths and keeps the request's routing profile, and `applyCodexServiceTierDoc` skips only API-key auths (backend `sdk/cliproxy/auth/provider_fallback.go:186`, `internal/runtime/executor/codex_executor_request.go:629-645`, `docs/management-api-v8.md:405`), so the stored speed reaches those Claude requests.
- 2026-11-18 grill: **deferred** - "remove the speed from the chain summary: no Success Criterion needs it and the speed is already visible in the toolbar button, the table and the editor" - not selected this round

## Implementation Steps

### Task 1: Add the two fields to the profile model: read, normalize, copy
- [x] in `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts` add `export type CodexSpeed = 'standard' | 'fast' | 'ultrafast'` and the fields `speed: CodexSpeed` and `ignoreClientTier: boolean` to `ProviderRouting`; `defaultProviderRouting()` returns `standard` / `false`
- [x] `readProviderRouting`: for Codex read `speed` with `readEnum` (default `standard`) and `ignore-client-tier` as `true` only for the boolean `true`; for Claude always return `standard` / `false` whatever the response holds; `providersFromClaudeFallback` returns the defaults for both providers
- [x] in `apps/web/src/features/quota/keyProfilesModel.ts` make `normalizeProviderRouting` carry `speed` and `ignoreClientTier` for both providers and `copyOfProviderRouting` copy them; both functions build `ProviderRouting` literals, so they must change in the same task as the type
- [x] update every `ProviderRouting` literal in source and tests so the type check passes (among them `routingProfiles.test.ts`, `keyProfilesModel.test.ts`, `providerRoutingModel.test.ts`, `components/ProviderRoutingBlock.test.tsx`, `components/KeyProfileEditor.test.tsx` and the lifecycle tests); a shared test helper for a default block is fine
- [x] write tests for reading: Codex values, the default for an absent, `null` and empty `speed`, an unknown `speed` fails the load, Claude always `standard` / `false`
- [x] write tests for normalization and `profileDirty`: a changed speed is dirty, a changed flag is dirty, equal profiles are not
- [x] write tests for `copyOfShared` (both fields copied, the copy is independent) and for `withApiModeNormalization` in `providerRoutingModel.ts` (API key mode keeps both fields)
- [x] run `npm run test:web` and `npm run type-check` - must pass before task 2

### Task 2: Send the fields and detect a backend without them
- [x] add `speedSupported: boolean` to `RoutingProfilesState`: true when `raw.shared.providers.codex` is a record with a `speed` key; false in `unsupportedRoutingProfiles()`
- [x] `profileBody`, `keyProfilePatch`, `sharedProfilePatch`, `saveKeyProfile` and `saveSharedProfile` take `speedSupported = false` as their last parameter (a caller that forgets it cannot send the fields to an older backend); `profileBody` adds `speed` and `ignore-client-tier` to the Codex block only when `providersSupported` and `speedSupported` are both true; the Claude block never carries them
- [x] in `apps/web/src/features/quota/hooks/useKeyProfiles.ts` pass `state.speedSupported` to `saveKeyProfile` and `saveSharedProfile`
- [x] update every `RoutingProfilesState` literal in tests with `speedSupported` (`clientKeysModal`, `keyProfiles`, `profilesKeysFlow`, `routingProfilesModal` and `useKeyProfiles` lifecycle tests, `routingProfiles.test.ts`, `components/KeyProfileEditor.test.tsx`, `components/ProviderRoutingBlock.test.tsx`)
- [x] update the `saveKeyProfile` / `saveSharedProfile` call assertions in `useKeyProfiles.lifecycle.test.tsx` (they use `toHaveBeenCalledExactlyOnceWith` with four arguments) to the new argument list, and add a case that `speedSupported: false` is passed through
- [x] write tests for `speedSupported` (true with the key, false without it, false for the unsupported backend) and for the bodies: the two fields in the Codex block with the flag, absent without it, never in the Claude block, for both the key profile and the shared profile patch
- [x] write tests for the save and read-back in `routingProfiles.test.ts`: `saveKeyProfile` with `speed: 'fast'` resolves when the mocked GET returns `fast` and rejects with the existing verification error when it returns `standard`; the same pair for `saveSharedProfile`; a new key profile saved without the flag on a backend that stores `standard` rejects when the sent profile has `fast`
- [x] run `npm run test:web` and `npm run type-check` - must pass before task 3

### Task 3: Name the Codex speed in the chain summary
- [x] add the three speed names (`quota_management.codex_speed.speed_standard`, `speed_fast`, `speed_ultrafast`) and `quota_management.key_profiles.summary.provider_speed` (`{{provider}} ({{speed}})`) to all four locales
- [x] `providerSummary` in `keyProfilesModel.ts`: for Codex in Subscription mode with speed `fast` or `ultrafast` use the provider name with the speed; no change for `standard`, for API key mode and for Claude
- [x] in `keyProfiles.locale.test.ts` add `codex_speed` to `subtrees` and add `key_profiles.summary.provider_speed` and the three speed-name keys to `dynamicProviderRoutingKeys`, because the summary builds them at run time and the source scan cannot find them
- [x] write tests for `chainSummary`: Fast, Ultrafast, Standard, API key mode, Subscription with an API-key fallback, and Claude unchanged
- [x] update the existing literal summary assertions only where a fixture now carries a non-standard speed
- [x] run `npm run test:web` and `npm run type-check` - must pass before task 4

### Task 4: Speed controls in the Codex block of the profile editor
- [x] in `apps/web/src/features/quota/components/ProviderRoutingBlock.tsx` add a `speedSupported` prop and, for `provider === 'codex'` with the flag true, a "Speed" row below the fallback row: `SegmentedTabs` with Standard / Fast / Ultrafast (pass an `idBase` from `useId`, like the mode and target controls), a `ToggleSwitch` "Ignore the tier the client sends" with a hint, and the Ultrafast hint
- [x] the row is disabled for `disabled`, and for API key mode unless `modeLocked` is true: under the lock CPA ignores the stored mode, so the Default profile's speed stays editable; it is never disabled by `modeLocked` itself; under Subscription with fallback target API key it is enabled
- [x] render the row in API key mode too (disabled, with the explanation), so the stored values stay visible; render nothing for Claude and nothing when `speedSupported` is false
- [x] in `KeyProfileEditor.tsx` add the `speedSupported` prop and pass it to the blocks; under `fallbackReadOnly` save the stored `providers` with the draft's Codex `speed` and `ignoreClientTier`, so a speed edited in the Default profile under `supported: false` is not dropped
- [x] pass `state.speedSupported` to both editors in `RoutingProfilesModal.tsx`
- [x] add the remaining editor strings to all four locales under `quota_management.codex_speed` (the row label, the flag label and hint, the Ultrafast hint, the API key mode explanation). Ultrafast hint: "Ultrafast applies to models that offer it. Models that offer only Fast use Fast; other models get no speed tier."
- [x] write tests for the block: each of the three speeds calls `onChange` with the new value, the flag switch does, the row is disabled in API key mode and enabled with an API-key fallback, enabled under `modeLocked` with a stored API key mode, absent for Claude and on an older backend
- [x] update the existing test "fallbackReadOnly ... saves the stored providers" in `components/KeyProfileEditor.test.tsx` (it asserts `toBe(stored.providers)`): the saved mode, fallback and credential equal the stored values and the Codex `speed` / `ignoreClientTier` equal the edited ones
- [x] write tests for the editor: a changed speed enables Save and is in the saved profile; a new key profile opened from a Default profile with `fast` saves `fast`
- [x] run `npm run test:web` and `npm run type-check` - must pass before task 5

### Task 5: Speed table model and modal
- [x] create `apps/web/src/features/quota/codexSpeedModel.ts` with `buildSpeedRows(state, rows)`: one row for the Default profile and one per client key in list order, each with its display label and mask (from `KeyDisplayRow`), whether the key has its own profile, the effective `speed` and `ignoreClientTier` (the key's own, else the Default profile's), and why it is disabled: `read_only` for every key row when `supported` is false; `api_mode` when the effective Codex mode is API key, except for the Default row when `supported` is false
- [x] in the same file add `withCodexSpeed(profile, patch)` that returns a copy of a profile with the Codex `speed` and / or `ignoreClientTier` replaced and nothing else changed
- [x] create `apps/web/src/features/quota/components/CodexSpeedModal.tsx` with its stylesheet: the existing `Modal`, a table of the rows, the "Default" / "Own profile" badge on key rows, the masked key beside a named row as the Keys modal shows it, the speed selector and the flag switch per row, and a hint under the table about Ultrafast and about a click on a "Default" key creating its own profile
- [x] the speed selector of a row is a group of three buttons with `aria-pressed`, activated only by a click, Enter or Space; do not use `SegmentedTabs` here, because it calls `onChange` on arrow, Home and End navigation and every change in this table is a write; every control has an accessible name that includes the row label, and ids come from `useId` or the key hash, never from the raw key
- [x] a change on the Default row calls `saveShared(withCodexSpeed(state.shared, patch))` without a TTL; a change on a key row calls `saveKeyProfile(key, withCodexSpeed(row.profile ?? copyOfShared(state.shared), patch))`; a click on the value a row already has does nothing
- [x] the rows always show the stored values: no optimistic update; disable every control while `saving` or `loading`; show `keyProfiles.error` the way the Keys modal does (masked with `maskQuotaText` unless emails are shown); show the loading and empty states like the Keys modal
- [x] add the table strings to all four locales under `quota_management.codex_speed`, and add `CodexSpeedModal.tsx?raw` and `codexSpeedModel.ts?raw` to the used-keys scan of `keyProfiles.locale.test.ts`
- [x] write tests for `buildSpeedRows` (Default row first, key order, inherited and own values, both disabled reasons, the Default row stays enabled under `supported: false` with a stored API key mode, no raw key in any label) and `withCodexSpeed` (only the two Codex fields change, the input is not mutated)
- [x] write lifecycle tests for the modal with a fake `keyProfiles` state: a click on the Default row saves the shared profile with the new speed; a click on a key without a profile saves a complete copy of the Default profile with the new speed; a click on a key with its own profile saves that profile; the flag switch saves; an arrow key on a focused speed button saves nothing and Enter saves
- [x] write lifecycle tests for the failure and disabled paths: controls are disabled while saving, in API key mode and for key rows under `supported: false`; after `saveKeyProfile` resolves `false` with `error` set the row still shows the stored speed and the error text is shown; a row disappears when the reloaded rows no longer hold its key; no raw key is rendered
- [x] run `npm run test:web` and `npm run type-check` - must pass before task 6

### Task 6: Toolbar button and modal wiring in place of the Fast toggle
- [x] in `QuotaSettingsToolbar.tsx` remove the `fastMode` prop and `fastModeSwitch` from both toolbar variants and drop `fastMode.error` from both error lines; add `codexSpeed?: CodexSpeed` and `onOpenSpeed` to `ProfileButtonsProps`; the slim toolbar renders a button "Codex speed: <speed>" (`data-open-speed`) in the place of the toggle when `codexSpeed` is set, disabled like the Profiles and Keys buttons; the legacy toolbar renders no speed control
- [x] in `QuotaSettingsBar` stop calling `useCodexFastMode`, add `'speed'` to the modal navigation, set `codexSpeed` from `profilesState.shared.providers.codex.speed` only when `profilesState?.speedSupported` is true, and render `CodexSpeedModal` with the `keyProfiles` state; opening it reloads the profiles like the other two modals
- [x] add the button strings (label with the speed, hint) to all four locales and add their keys by name to the checked list of `keyProfiles.locale.test.ts`
- [x] update `quotaSettingsToolbar.test.ts`: remove the `fastMode` fixtures and the `codex_fast.title` / `codex_fast.description` assertions (lines 81, 92, 174); the button shows the Default profile's speed, is absent without `codexSpeed`, and no `data-switch="fast-mode"` remains in either toolbar variant
- [x] update `QuotaPage.lifecycle.test.tsx`, `profilesKeysFlow.lifecycle.test.tsx` and `keyProfiles.lifecycle.test.tsx` only where they pass or assert the removed prop or toggle; the tests of the `useCodexFastMode` hook itself stay until Task 7
- [x] add lifecycle cases in `profilesKeysFlow.lifecycle.test.tsx` for the gate: with a profiles state where `speedSupported` is false no `[data-open-speed]` is rendered; with true the button text contains the Default speed name and a click opens the modal
- [x] add a lifecycle case in the same file for the removed path: spy `apiClient.get`, `put` and `patch`, mount `QuotaSettingsBar`, open the speed modal and click a speed; assert that no call's first argument contains `fast-mode`
- [x] run `npm run test:web` and `npm run type-check` - must pass before task 7

### Task 7: Delete the Fast mode code, strings and tests
- [x] delete `apps/web/src/features/quota/hooks/useCodexFastMode.ts`, `apps/web/src/features/quota/components/CodexFastMode.tsx` and `CodexFastMode.module.scss`
- [x] remove `saveCodexFastMode` from `routingModel.ts`, `updateCodexFastMode` and the `codexFastMode` field from `personal-quota-support/services/api/config.ts`, the field from `personal-quota-support/types/config.ts`, and the `'codex-fast-mode'` member of `RawConfigSection` there if nothing uses it
- [x] delete the three `useCodexFastMode` tests and the hook import in `settingsHooks.lifecycle.test.tsx`, and the `vi.mock('./hooks/useCodexFastMode', ...)` in `keyProfiles.lifecycle.test.tsx`
- [x] drop `codexFastMode` from the `Config` fixtures in `useKeyProfiles.lifecycle.test.tsx`, `profilesKeysFlow.lifecycle.test.tsx` and `QuotaPage.lifecycle.test.tsx`
- [x] update `config.test.ts`, `useConfigStore.test.ts` and `quotaSettingsHooks.test.ts`: remove the Fast mode cases; where `codexFastMode` only serves as an arbitrary config payload, use another `Config` field and keep the case
- [x] remove the `quota_management.codex_fast` subtree from all four locales and add a check to `keyProfiles.locale.test.ts` that no locale has it
- [x] confirm with a search that no file under `apps/web/src` mentions `codexFastMode`, `CodexFastMode`, `codex_fast` or `fast-mode`, except the test that asserts the absence of such a request (also matched: the `keyProfiles.locale.test.ts` check that no locale has `codex_fast`, which this task adds; the toolbar tests now assert the switch list instead of naming `fast-mode`)
- [x] run `npm run test:web`, `npm run type-check` and `npm run lint` - must pass before task 8

### Task 8: Verify acceptance criteria
- [x] map each of the six Success Criteria to the named tests that cover it and record the mapping under Technical Details; add a test for any criterion without one (added two end-to-end tests in `profilesKeysFlow.lifecycle.test.tsx` for criteria 1 and 2)
- [x] confirm each edge case maps to a named test and add any that is missing: an older backend response (no `speed`), `supported: false` with a stored API key mode, Codex in API key mode, a failed write, a key removed from the config while the table is open
- [x] run the full suite: `npm run test:web`
- [x] run `npm run type-check` and `npm run lint` - no errors; no new warnings in the files this plan touches
- [x] confirm `apps/manager-server` has no changes in this branch

### Task 9: Update documentation
- [x] update `docs/personal-quota.md`: replace the Codex Fast mode description and the toolbar sketch with the speed button, describe the Speed row of the Codex block and the speed table, and state that a key profile is a full copy, so a click on a "Default" key in the table gives the key its own profile

## Technical Details
- **Capability flag**: `speedSupported = isRecord(raw.shared?.providers?.codex) && 'speed' in raw.shared.providers.codex`. The backend view always includes the key, with `standard` for a profile that does not set it.
- **PATCH body, backend with `speed`** (key profile; the shared profile uses the same fields at `routing.*`):
  ```json
  {"routing": {"key-profiles": {"<key>": {
    "session-affinity": true,
    "preferred-accounts": {"claude": null, "codex": null},
    "selection": {"primary": "reserves", "tiebreak": "earliest-reset"},
    "providers": {
      "claude": {"mode": "subscription", "api-credential": null,
                 "fallback": {"target": "codex", "mode": "auto", "mappings": [{"from": "claude-opus-*", "to": "gpt-6-astra"}]}},
      "codex":  {"mode": "subscription", "api-credential": null,
                 "fallback": {"target": "off", "mode": null, "mappings": null},
                 "speed": "fast", "ignore-client-tier": false}
    }
  }}}}
  ```
- **PATCH body, backend without `speed`**: today's body, without the two fields.
- **Body source**: `profileBody` builds the body from `normalizeProfile(profile)`, so the normalizer must carry the fields before the body can send them.
- **Read-back comparison**: `normalizeProfile` of the stored and the sent profile, now including `speed` and `ignoreClientTier`. Claude never holds a non-default value, because the reader forces the defaults.
- **Effective values of a key row**: the key's own profile when it has one, else the Default profile. The table never merges the two.
- **New key profile from the table**: `copyOfShared(state.shared)` without the mapping suggestions the editor adds; the stored Default profile is valid by construction, because the backend validated it.
- **Disabled reasons**: `read_only` for a key row under `supported: false`; `api_mode` when the effective Codex mode is API key, except for the Default profile under `supported: false`, where CPA ignores the stored mode. A row in Codex API key mode whose Claude falls back to Codex stays enabled with `claudeFallbackOnly`, since that leg gets the speed. The Default row is never `read_only`.
- **Write errors**: the table has no optimistic state. After a failed write the hook reloads the profiles unless the backend answered 422, which leaves the file unchanged; in both cases the rows show the stored values.
- **Strings**: one subtree `quota_management.codex_speed` for the speed names, the editor row, the table and the toolbar button; `quota_management.key_profiles.summary.provider_speed` for the summary.
- **Success Criteria → tests** (paths under `apps/web/src/features/`; `PQ` = `personal-quota-support/services/api`):
  1. Saved and shown after a reload: `quota/profilesKeysFlow.lifecycle.test.tsx` "a Codex speed edited in the Default profile is saved and shown again after a reload" (added in Task 8: edit, PATCH, read-back, fresh mount shows the stored speed in the editor and on the button); `quota/components/KeyProfileEditor.test.tsx` "a changed Codex speed enables Save and is in the saved profile", "a changed ignore-client-tier flag enables Save and is in the saved profile"; `PQ/routingProfiles.test.ts` "saves a key profile with speed fast and verifies it by reading it back", "saves the shared profile with speed fast and verifies it by reading it back", "rejects a key profile whose speed / flag the backend did not retain", "reads only the boolean true as ignoring the client tier"; `quota/components/ProviderRoutingBlock.test.tsx` "choosing %s calls onChange with the new speed".
  2. A new key profile inherits the Default speed and flag: `quota/profilesKeysFlow.lifecycle.test.tsx` "a new key profile created in the editor inherits the Default profile's speed and flag" (added in Task 8: "+ Profile for a key" → PATCH body carries `fast` and `true`); `quota/components/KeyProfileEditor.test.tsx` "a new key profile opened from a Default profile with Fast saves Fast"; `quota/keyProfilesModel.test.ts` "copies the Codex speed and flag into an independent copy".
  3. Speed table: `quota/codexSpeedModel.test.ts` (`buildSpeedRows`: Default row first and key order, inherited and own values; `withCodexSpeed` changes only the two fields); `quota/codexSpeedModal.lifecycle.test.tsx` "the Default row comes first, keys follow with their badges and stored speeds", "a click on the Default row saves the shared profile with the new speed", "a click on a key without a profile saves a full copy of the Default profile", "a click on a key with its own profile saves that profile", "the flag switch saves", "arrow keys save nothing; Enter and Space save"; `quota/profilesKeysFlow.lifecycle.test.tsx` "the button names the Default profile's speed and opens the table".
  4. No Fast mode request, code or strings: `quota/profilesKeysFlow.lifecycle.test.tsx` "the panel never calls the removed fast-mode path"; `quota/keyProfiles.locale.test.ts` "drops the strings of the removed Codex Fast mode toggle"; `quota/quotaSettingsToolbar.test.ts` "the legacy toolbar has no Fast mode switch and no speed control"; a search of `apps/web/src` for `codexFastMode|CodexFastMode|codex_fast|fast-mode` finds only those two absence tests.
  5. Older backend: `PQ/routingProfiles.test.ts` "marks a backend without speed in the shared Codex block as not speed-capable", "sends neither field without the speed flag / by default", "sends neither field to a backend without providers…"; `quota/useKeyProfiles.lifecycle.test.tsx` "saves on a backend without speed pass speedSupported false"; `quota/components/ProviderRoutingBlock.test.tsx` "an older backend gets no speed row"; `quota/components/KeyProfileEditor.test.tsx` "without speedSupported no speed control is rendered"; `quota/profilesKeysFlow.lifecycle.test.tsx` "an older backend without speed gets no speed button"; `quota/quotaSettingsToolbar.test.ts` "renders no speed button without a Codex speed".
  6. `npm run test:web` (325 files, 5484 tests), `npm run type-check` and `npm run lint` (0 errors; the 7 warnings are in files this branch does not touch) pass as of Task 8.
- **Edge cases → tests**:
  - Older backend response (no `speed`): see criterion 5.
  - `supported: false` with a stored API key mode: `ProviderRoutingBlock.test.tsx` "the mode lock keeps the row enabled, also with a stored API key mode"; `KeyProfileEditor.test.tsx` "fallbackReadOnly locks mode and fallback, keeps Preferred and the speed editable, saves the stored providers with the edited speed"; `codexSpeedModel.test.ts` "under supported: false every key row is read_only and the Default row stays enabled"; `codexSpeedModal.lifecycle.test.tsx` "under supported: false key rows are read-only and the Default row stays editable".
  - Codex in API key mode: `ProviderRoutingBlock.test.tsx` "API key mode keeps the row visible but disabled, with the explanation", "an API-key fallback in Subscription mode keeps the row enabled"; `codexSpeedModel.test.ts` "a key row is api_mode when its effective Codex mode is API key"; `codexSpeedModal.lifecycle.test.tsx` "a row in API key mode is disabled with the reason"; `keyProfilesModel.test.ts` "Codex API key mode does not name the speed".
  - A failed write: `codexSpeedModal.lifecycle.test.tsx` "after a failed write the row shows the stored speed and the error", "every control is disabled while saving or loading"; `routingProfiles.test.ts` "rejects a key profile whose speed the backend did not retain", "rejects a shared profile whose speed the backend did not retain".
  - A key removed from the config while the table is open: `codexSpeedModal.lifecycle.test.tsx` "a row disappears when the reloaded rows no longer hold its key".

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification** (needs the deployed backend):
- Open the speed table: the Default row shows Fast, the seven keys show Fast with the "Default" badge.
- Change the Default profile to Standard and back to Fast; confirm `routing.providers.codex.speed` in the backend config follows.
- Click Ultrafast on one test key: confirm it gets the "Own profile" badge, that its profile in Routing profiles equals the Default profile except for the speed, and return it to Default in the Keys modal afterwards.
- Open the editor of the Default profile: the Speed row shows the stored value; switch Codex to API key mode (if a Codex API key exists) and confirm the row is disabled.
- Check the table and the editor at about 1280px width and in the dark theme.

**Deployment**:
- Panel-only deploy per the local launchd procedure (build web, new `releases/panel-<name>-<date>/management.html`, back up the plist, switch `PANEL_PATH`, bootout/bootstrap).

**Follow-up**:
- The pricing plan from `docs/backlog/ultrafast-service-tier-priced-as-standard.md`.
