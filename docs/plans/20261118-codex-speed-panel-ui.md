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
- **Chosen approach — model**: `speed` and `ignoreClientTier` are fields of the shared `ProviderRouting` type. Claude always reads as `standard` / `false` and is never written. Reading follows the existing `readEnum` rule: absent, `null` or `""` gives `standard`; any other unknown value fails the load.
- **Chosen approach — older backend**: a response whose `shared.providers.codex` has no `speed` key marks the backend as old (`speedSupported: false`). The panel then renders no speed controls and sends neither field. This is the same idea as `providersSupported`.
- **Chosen approach — editor**: in the Codex block, below the fallback row, a "Speed" row with a segmented control Standard / Fast / Ultrafast, a switch "Ignore the tier the client sends" with a hint, and a hint that Ultrafast applies to models that offer it while other models use Fast. In API key mode the row is disabled with an explanation and the stored values are kept. With Subscription mode and fallback target API key the controls stay enabled. The Claude block gets nothing. The speed controls are not tied to `modeLocked`: under `supported: false` the Default profile's speed stays editable.
- **Chosen approach — table**: a toolbar button in place of the Fast toggle shows the Default profile's speed (for example "Codex speed: Fast") and opens a modal. Rows: the Default profile, then every client key in config order, labelled like the Keys modal (alias, CP name or masked key; never the raw key). Each row has the three-way control and the flag switch; a click is applied at once, without a confirmation. A key without its own profile shows the Default values with a "Default" badge; a click on it creates a key profile that is a complete copy of the Default profile with the new value, and the badge becomes "Own profile". While a write runs all controls are disabled; a write error is shown in the modal and the values are reloaded from the server. Disabled with an explanation: a row whose Codex mode is API key; key rows when `supported: false`.
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

## Implementation Steps

### Task 1: Read and write `speed` and `ignore-client-tier` in the profile API client
- [ ] in `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts` add `export type CodexSpeed = 'standard' | 'fast' | 'ultrafast'` and the fields `speed: CodexSpeed` and `ignoreClientTier: boolean` to `ProviderRouting`; `defaultProviderRouting()` returns `standard` / `false`
- [ ] `readProviderRouting`: for Codex read `speed` with `readEnum` (default `standard`) and `ignore-client-tier` as `true` only for the boolean `true`; for Claude always return `standard` / `false` whatever the response holds; `providersFromClaudeFallback` returns the defaults for both providers
- [ ] add `speedSupported: boolean` to `RoutingProfilesState`: true when `raw.shared.providers.codex` is a record with a `speed` key; false in `unsupportedRoutingProfiles()`
- [ ] `profileBody` takes `speedSupported` after `providersSupported` (default `false`, so a caller that forgets it cannot send the fields to an older backend) and adds `speed` and `ignore-client-tier` to the Codex block only when both flags are true; the Claude block never carries them; pass the flag through `keyProfilePatch`, `sharedProfilePatch`, `saveKeyProfile` and `saveSharedProfile`
- [ ] in `apps/web/src/features/quota/hooks/useKeyProfiles.ts` pass `state.speedSupported` to `saveKeyProfile` and `saveSharedProfile`
- [ ] write tests for reading: Codex values, default for an absent, `null` and empty `speed`, an unknown `speed` fails the load, Claude always `standard` / `false`, `speedSupported` true and false
- [ ] write tests for the bodies: the two fields in the Codex block with `speedSupported`, absent without it, never in the Claude block, for both the key profile and the shared profile patch
- [ ] update the existing fixtures of `ProviderRouting` in the tests so they compile with the new fields
- [ ] run `npm run test:web` and `npm run type-check` - must pass before task 2

### Task 2: Carry the fields through normalization, the copy of the Default profile and the summary
- [ ] in `apps/web/src/features/quota/keyProfilesModel.ts` make `normalizeProviderRouting` keep `speed` and `ignoreClientTier` for Codex and return `standard` / `false` for Claude, so `profileDirty` and the read-back comparison see a changed speed or flag
- [ ] make `copyOfProviderRouting` copy both fields, so `copyOfShared` gives a new key profile the Default profile's speed and flag
- [ ] check `withApiModeNormalization` in `apps/web/src/features/quota/providerRoutingModel.ts` keeps both fields in API key mode (it spreads the block; add a test that locks it)
- [ ] `providerSummary`: for Codex in Subscription mode with speed `fast` or `ultrafast` use the provider name with the speed, built from a new string `quota_management.key_profiles.summary.provider_speed` (`{{provider}} ({{speed}})`) and the speed labels of Task 3; no change for `standard`, for API key mode and for Claude
- [ ] add the strings this task uses to all four locales
- [ ] write tests for normalization and `profileDirty`: a changed speed is dirty, a changed flag is dirty, a Claude block with stray values is not
- [ ] write tests for `copyOfShared` (both fields copied, the copy is independent) and for `chainSummary` (Fast, Ultrafast, Standard, API key mode, with an API-key fallback)
- [ ] run `npm run test:web` and `npm run type-check` - must pass before task 3

### Task 3: Speed controls in the Codex block of the profile editor
- [ ] in `apps/web/src/features/quota/components/ProviderRoutingBlock.tsx` add a `speedSupported` prop and, for `provider === 'codex'` with the flag true, a "Speed" row below the fallback row: `SegmentedTabs` with Standard / Fast / Ultrafast, a `ToggleSwitch` "Ignore the tier the client sends" with a hint, and the Ultrafast hint
- [ ] disable the row with an explanation when the mode is API key; keep it enabled under Subscription with fallback target API key; disable it for `disabled`, but not for `modeLocked`
- [ ] render the row in API key mode too (disabled), so the stored values stay visible; render nothing for Claude and nothing when `speedSupported` is false
- [ ] in `KeyProfileEditor.tsx` add the `speedSupported` prop and pass it to the blocks; under `fallbackReadOnly` save the stored `providers` with the draft's Codex `speed` and `ignoreClientTier`, so a speed edited in the Default profile under `supported: false` is not dropped
- [ ] pass `state.speedSupported` to both editors in `RoutingProfilesModal.tsx`
- [ ] add the strings to all four locales under a new subtree `quota_management.codex_speed` (speed label, the three speed names, the flag label and hint, the Ultrafast hint, the API key mode explanation); add the subtree to `keyProfiles.locale.test.ts`
- [ ] write tests for the block: the three speeds call `onChange` with the new value, the flag switch does, the row is disabled in API key mode and enabled with an API-key fallback, enabled under `modeLocked`, absent for Claude and on an older backend
- [ ] write tests for the editor: a changed speed enables Save and is in the saved profile; under `fallbackReadOnly` the saved profile keeps the stored mode and fallback and carries the edited speed and flag; a new key profile starts with the Default profile's speed
- [ ] run `npm run test:web` and `npm run type-check` - must pass before task 4

### Task 4: Speed table model and modal
- [ ] create `apps/web/src/features/quota/codexSpeedModel.ts` with `buildSpeedRows(state, rows)`: one row for the Default profile and one per client key in list order, each with its display label and mask (from `KeyDisplayRow`), whether the key has its own profile, the effective `speed` and `ignoreClientTier` (the key's own, else the Default profile's), and why it is disabled (`api_mode` when the effective Codex mode is API key; `read_only` for a key row when `supported` is false)
- [ ] in the same file add `withCodexSpeed(profile, patch)` that returns a copy of a profile with the Codex `speed` and / or `ignoreClientTier` replaced and nothing else changed
- [ ] create `apps/web/src/features/quota/components/CodexSpeedModal.tsx` with its stylesheet: the existing `Modal`, a table of the rows, the "Default" / "Own profile" badge on key rows, the masked key beside a named row as the Keys modal shows it, the three-way control and the flag switch per row, a hint under the table about Ultrafast and about a click on a "Default" key creating its own profile
- [ ] a change on the Default row calls `saveShared(withCodexSpeed(state.shared, patch))` without a TTL; a change on a key row calls `saveKeyProfile(key, withCodexSpeed(row.profile ?? copyOfShared(state.shared), patch))`
- [ ] disable every control while `saving` or `loading`; show `keyProfiles.error` in the modal (masked with `maskQuotaText` unless emails are shown); show the loading and empty states like the Keys modal
- [ ] add the strings to all four locales under `quota_management.codex_speed`
- [ ] write tests for `buildSpeedRows` (Default row first, key order, inherited and own values, both disabled reasons, no raw key in any label) and `withCodexSpeed` (only the two Codex fields change, the input is not mutated)
- [ ] write lifecycle tests for the modal with a fake `keyProfiles` state: a click on the Default row saves the shared profile with the new speed; a click on a key without a profile saves a complete copy of the Default profile with the new speed; a click on a key with its own profile saves that profile; the flag switch saves; controls are disabled while saving, in API key mode and for key rows under `supported: false`; an error is shown; no raw key is rendered
- [ ] run `npm run test:web` and `npm run type-check` - must pass before task 5

### Task 5: Toolbar button and modal wiring in place of the Fast toggle
- [ ] in `QuotaSettingsToolbar.tsx` replace the `fastMode` prop and `fastModeSwitch` with an optional `speedButton` prop (`speed`, `disabled`, `onOpen`); the slim toolbar renders a button "Codex speed: <speed>" in the place of the toggle when the prop is set; the legacy toolbar renders no speed control
- [ ] drop `fastMode.error` from both error lines of the toolbar
- [ ] in `QuotaSettingsBar` remove `useCodexFastMode`, add `'speed'` to the modal navigation, pass `speedButton` when `profilesState?.speedSupported` is true (speed from `profilesState.shared.providers.codex.speed`, disabled like the Profiles and Keys buttons), and render `CodexSpeedModal` with the `keyProfiles` state; opening it reloads the profiles like the other two modals
- [ ] add the button strings (label with the speed, hint) to all four locales
- [ ] update `quotaSettingsToolbar.test.ts`: the button shows the Default profile's speed, is absent without `speedButton`, and no `data-switch="fast-mode"` remains in either toolbar variant
- [ ] update `QuotaPage.lifecycle.test.tsx`, `profilesKeysFlow.lifecycle.test.tsx`, `settingsHooks.lifecycle.test.tsx`, `keyProfiles.lifecycle.test.tsx` and `useKeyProfiles.lifecycle.test.tsx` for the removed prop and hook; add a case that the speed button opens the modal and that no request goes to a path containing `fast-mode`
- [ ] run `npm run test:web` and `npm run type-check` - must pass before task 6

### Task 6: Delete the Fast mode code and strings
- [ ] delete `apps/web/src/features/quota/hooks/useCodexFastMode.ts`, `apps/web/src/features/quota/components/CodexFastMode.tsx` and `CodexFastMode.module.scss`
- [ ] remove `saveCodexFastMode` from `routingModel.ts`, `updateCodexFastMode` and the `codexFastMode` field from `personal-quota-support/services/api/config.ts`, the field from `personal-quota-support/types/config.ts`, and the `'codex-fast-mode'` member of `RawConfigSection` there if nothing uses it
- [ ] remove the `quota_management.codex_fast` subtree from all four locales and add its keys to the removed-keys check of a locale test
- [ ] update `config.test.ts`, `useConfigStore.test.ts` and `quotaSettingsHooks.test.ts`: remove the Fast mode cases and fixtures, keep the other cases
- [ ] confirm with a search that no source or test file mentions `codexFastMode`, `CodexFastMode`, `codex_fast` or `fast-mode`, except a test that asserts the absence of such a request
- [ ] run `npm run test:web`, `npm run type-check` and `npm run lint` - must pass before task 7

### Task 7: Verify acceptance criteria
- [ ] map each of the six Success Criteria to the tests that cover it and record the mapping under Technical Details; add a test for any criterion without one
- [ ] verify the edge cases: an older backend response (no `speed`), `supported: false`, Codex in API key mode, a key removed from the config while the table is open (the existing `unknown_api_key` path reloads the list)
- [ ] run the full suite: `npm run test:web`
- [ ] run `npm run type-check` and `npm run lint` - no errors; no new warnings in the files this plan touches
- [ ] confirm `apps/manager-server` has no changes in this branch

### Task 8: Update documentation
- [ ] update `docs/personal-quota.md`: replace the Codex Fast mode description and the toolbar sketch with the speed button, describe the Speed row of the Codex block and the speed table, and state that a key profile is a full copy, so a click on a "Default" key in the table gives the key its own profile
- [ ] check `README.md` and `README_CN.md` for a mention of Codex Fast mode and update it if there is one

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
- **Read-back comparison**: `normalizeProfile` of the stored and the sent profile, now including the Codex `speed` and `ignoreClientTier`; Claude's are normalized to `standard` / `false` on both sides.
- **Effective values of a key row**: the key's own profile when it has one, else the Default profile. The table never merges the two.
- **New key profile from the table**: `copyOfShared(state.shared)` without the mapping suggestions the editor adds; the stored Default profile is valid by construction, because the backend validated it.
- **Disabled reasons**: `api_mode` (effective Codex mode is API key) and `read_only` (key row under `supported: false`). The Default row is never `read_only`.
- **Strings**: one subtree `quota_management.codex_speed` for the editor row, the table and the toolbar button; `quota_management.key_profiles.summary.provider_speed` for the summary.

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
