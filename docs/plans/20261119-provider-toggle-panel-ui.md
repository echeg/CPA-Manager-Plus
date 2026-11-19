# Provider on/off toggle in the routing profile editor

## Overview
- The backend (CLIProxyAPI fork, plan `20261119-provider-disable-in-profiles`) adds `providers.claude.disabled` and `providers.codex.disabled` to every routing profile; a request to a disabled provider gets 403.
- This plan adds an explicit **Enabled** toggle to the Claude block and the Codex block of the profile editor (Default profile and every key profile), so a key can be made Codex-only (or Claude-only) from the panel.
- Turning a provider off keeps its other settings in the draft and in CPA; turning it on restores them.
- The chain summary, the editor hints and the Codex speed table reflect a disabled provider.
- On a backend without the field the toggle is shown locked with a hint, and the panel never sends `disabled`.

**Prerequisite:** run this plan only after `docs/plans/20261118-codex-speed-panel-ui.md` is merged into `main`. File and function references below are taken from that branch (`codex-speed-panel-ui`), which is what `main` holds after the merge.

## Success Criteria
- In the profile editor, each provider block has an Enabled toggle; switching Claude off and saving writes `providers.claude.disabled: true` for that profile, and the toggle reads back off after a reload.
- With Claude off, the Claude block's mode, API key, fallback and mappings controls are disabled but keep their values; switching back on restores them unchanged.
- The chain summary shows the disabled provider as off (for example `Claude: off`) instead of its account and fallback.
- With Codex off, the Claude block warns that its Codex fallback will not run; with both providers off, the editor warns that the profile allows no provider.
- In the Codex speed table, a profile whose Codex is off shows its speed buttons disabled with a reason.
- On a backend whose `GET /v8/management/routing/profiles` provider blocks carry no `disabled` key, the toggle is disabled with the existing "requires a newer backend" style hint and `disabled` is never sent.
- Under `supported: false` (a scheduler plugin) the toggle is locked like the mode, and a stored `disabled` locks no other control, shows no off hint or warning, and does not change the speed table (CPA does not enforce it there).
- A speed-table write keeps the stored `disabled` of the profile it writes, including a new key profile copied from the Default profile.
- All strings exist in en, ru, zh-CN and zh-TW; `npm test`, `npm run type-check`, `npm run lint` pass in `apps/web`.

## Decisions
- **Context**: CPA's routing profiles get a per-provider `disabled` flag (backend plan 1). The user wants to switch Claude or Codex on and off explicitly in a profile from the panel, to create a key that can only use Codex.
- **Chosen approach**: a `disabled: boolean` on the panel's `ProviderRouting`, read from and written to each provider block; support detected from the presence of `disabled` in the shared profile's provider blocks (`providerToggleSupported`), like `speedSupported`; a `ToggleSwitch` labeled Enabled in the header of `ProviderRoutingBlock`; hidden or disabled values stay in the draft, as the block already does for mode-dependent fields.
- **User direction**: a disabled provider means refused (no translation of Claude requests to Codex); both plans were written at once, the panel plan to run after the speed plan merges.
- **Rejected alternatives**: a third button in the mode `SegmentedTabs` (`off` next to Subscription / API key) - it would overwrite the mode, losing it on re-enable, and the backend stores `disabled` separately from `mode`.
- **Verified facts** (on branch `codex-speed-panel-ui`):
  - `ProviderRouting`, `readProviderRouting`, `defaultProviderRouting`, `providersFromClaudeFallback`, `readRoutingProfiles`, `unsupportedRoutingProfiles`, `profileBody`, `keyProfilePatch`, `sharedProfilePatch` live in `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts`; `speedSupported` is detected by `hasCodexSpeed` (presence of `speed` in `shared.providers.codex`) and threaded as the last argument of `profileBody` / `keyProfilePatch` / `sharedProfilePatch`.
  - `profileBody` writes the complete `providers` block on a backend with `providers`, so `disabled` must be part of it (else a PATCH merge keeps the stored value).
  - `ProviderRoutingBlock.tsx` keeps hidden values in `value` (component docstring), uses `ToggleSwitch` for `ignoreClientTier`, and locks routing with `routingLocked = disabled || modeLocked`; `KeyProfileEditor.tsx` passes `modeLocked={fallbackReadOnly}` and, under `fallbackReadOnly`, saves `initial.providers`.
  - The Codex speed rule is `codexSpeedUse(providers, ignoreMode)` in `apps/web/src/features/quota/codexSpeedModel.ts` (`applies` / `claude_fallback` / `unused`); `buildSpeedRows` turns it into `disabledReason` (`'' | 'read_only' | 'api_mode'`) and `claudeFallbackOnly`.
  - The chain summary is `providerSummary` / `chainSummary` in `apps/web/src/features/quota/keyProfilesModel.ts`, keys under `quota_management.key_profiles.summary`.
  - Field validation is `providerFieldErrors` / `providerRoutingErrors` in `apps/web/src/features/quota/providerRoutingModel.ts`. CPA still validates every field of a disabled provider, so the panel keeps validating them.
  - Locale completeness is checked by `apps/web/src/features/quota/keyProfiles.locale.test.ts`.

## Context (from discovery)
- Files/components involved:
  - `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts` (+ `routingProfiles.test.ts`)
  - `apps/web/src/features/quota/providerRoutingModel.ts` (+ test)
  - `apps/web/src/features/quota/keyProfilesModel.ts` (+ test)
  - `apps/web/src/features/quota/codexSpeedModel.ts` (+ test), `components/CodexSpeedModal.tsx`
  - `apps/web/src/features/quota/components/ProviderRoutingBlock.tsx` (+ test), `KeyProfileEditor.tsx` (+ test)
  - `apps/web/src/features/quota/hooks/useKeyProfiles.ts` (the two `routingProfilesApi` save calls) and `components/RoutingProfilesModal.tsx` (the two `KeyProfileEditor` call sites), where `speedSupported` is threaded today
  - lifecycle tests: `useKeyProfiles.lifecycle.test.tsx`, `routingProfilesModal.lifecycle.test.tsx`, `codexSpeedModal.lifecycle.test.tsx`, `profilesKeysFlow.lifecycle.test.tsx` (one round-trip test)
  - `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json`, `keyProfiles.locale.test.ts`
  - `docs/personal-quota.md`
- Related patterns found: the Codex speed feature on the same branch (`speedSupported` detection and threading, `ToggleSwitch` row, summary label, speed table reasons).
- Dependencies identified: backend plan `20261119-provider-disable-in-profiles` (field `disabled`, always present in GET provider blocks, 403 at runtime). The panel works against an older backend by locking the toggle.

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
- **Unit tests**: required for every task (see Development Approach above); vitest in `apps/web`.
- **E2E tests**: the project has no browser e2e suite; UI flows are covered by the existing `*.lifecycle.test.tsx` tests with mocked API calls.

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code, tests and docs in this repository
- **Post-Completion** (no checkboxes): deploy and manual checks against the live CPA

## Decision Log
- 2026-11-19 brainstorm: **accepted** - `ToggleSwitch` labeled Enabled in the header of each provider block; when off, the rest of the block is disabled and values are kept; evidence: `ProviderRoutingBlock.tsx` docstring (hidden values stay in `value`) and its `ToggleSwitch` row for `ignoreClientTier`.
- 2026-11-19 brainstorm: **accepted** - support detection `providerToggleSupported` from the presence of `disabled` in the shared profile's provider blocks; `disabled` sent only when supported; evidence: `hasCodexSpeed` / `speedSupported` in `routingProfiles.ts`.
- 2026-11-19 brainstorm: **accepted** - the toggle follows the mode lock: `supported: false` and read-only lock it; evidence: `KeyProfileEditor.tsx` `modeLocked={fallbackReadOnly}`.
- 2026-11-19 brainstorm: **accepted** - the chain summary names a disabled provider as off instead of its leg; evidence: `providerSummary` in `keyProfilesModel.ts` (the `provider_speed` label pattern).
- 2026-11-19 brainstorm: **accepted** - hints: in the Claude block when Claude falls back to a disabled Codex ("the fallback will not run"), and in the editor when both providers are off.
- 2026-11-19 brainstorm: **accepted** - in the speed table, a profile whose Codex is off shows its speed buttons disabled with a reason; the row is not hidden.
- 2026-11-19 brainstorm: **accepted** - strings in en, ru, zh-CN, zh-TW; evidence: `keyProfiles.locale.test.ts`.
- 2026-11-19 planning: **accepted** - a disabled provider's fields are still validated and their errors still block the save, while its Enabled toggle stays usable so the user can switch it back on to fix them; evidence: the backend validates every field of a disabled provider (backend plan Task 1).
- 2026-11-19 user: **rejected** - "Translate Claude requests to Codex when Claude is disabled and a Codex fallback is configured" - the user chose that disabled must mean refused.
- 2026-11-19 grill: **accepted** - Task 1 names `normalizeProviderRouting` / `copyOfProviderRouting` in `keyProfilesModel.ts` and adds `profileDirty` / `copyOfShared` tests - decided by grill: both build objects field by field and drive the dirty check and `copyOfShared` (`keyProfilesModel.ts:28-56`, `:81-108`)
- 2026-11-19 grill: **accepted** - Task 2 no longer refers to non-existent partial speed patches; the speed table writes full profiles (`saveShared` / `saveKeyProfile` with `copyOfShared`), so Task 5 tests that a speed write keeps the stored `disabled` - decided by grill: `CodexSpeedModal.tsx` `write()` on the speed branch
- 2026-11-19 grill: **accepted** - `CodexSpeedUse` keeps its three values; `buildSpeedRows` sets `codex_off` directly, and the block hides the Speed row hints while the provider is off - decided by grill: an `off` value mapped to `unused` would render `api_mode_hint` in the editor (`ProviderRoutingBlock.tsx` speed hunk)
- 2026-11-19 grill: **accepted** - under `modeLocked` a stored `disabled` locks no control and shows no hint or warning, keeping the preferred account and `withDraftCodexSpeed` editable - decided by grill: CPA does not enforce `disabled` under a scheduler plugin (backend plan), `ProviderRoutingBlock.tsx:153`, `KeyProfileEditor.tsx` `withDraftCodexSpeed`
- 2026-11-19 grill: **accepted** - the Claude fallback warning requires Claude enabled and no mode lock; the summary renders Claude's leg without fallback when its Codex target is disabled - decided by grill: CPA skips that fallback (backend plan Task 4), `keyProfilesModel.ts` `providerSummary`
- 2026-11-19 grill: **accepted** - the summary shows the stored `disabled` even under `supported: false`, like the stored mode it already shows - decided by grill: `providerSummary` reads the stored mode without regard to the lock
- 2026-11-19 grill: **accepted** - strings move into the task that first renders them (Task 3 block strings, Task 4 both-off warning, Task 5 summary and speed reason); existing `provider_routing.requires_backend` and `provider_routing.locked` are reused - decided by grill: `keyProfiles.locale.test.ts` scans `ProviderRoutingBlock.tsx` and `KeyProfileEditor.tsx` for literal keys, so a later string fails the earlier task's test gate
- 2026-11-19 grill: **accepted** - the editor prop and `RoutingProfilesModal.tsx` wiring move from Task 2 to Task 4; `ClientKeysModal.tsx` dropped - decided by grill: `speedSupported` is passed only by `RoutingProfilesModal.tsx` at two call sites, and the editor prop does not exist before Task 4
- 2026-11-19 grill: **accepted** - Task 2 tests exact PATCH bodies at the API level with `apiClient.patch` mocked (including explicit `disabled: false`) and only forwarding in the hook test; duplicate lifecycle body checks dropped; one round-trip test added in Task 5 - decided by grill: `useKeyProfiles.lifecycle.test.tsx` mocks the API methods, so it cannot see the body

## Implementation Steps

### Task 1: Read, normalize, copy and send `disabled`
- [x] add `disabled: boolean` to `ProviderRouting` in `routingProfiles.ts` (doc comment: both providers; keeps the other fields); `defaultProviderRouting()` and `providersFromClaudeFallback` set `false`; update every `ProviderRouting` literal in source and tests so type-check passes
- [x] `readProviderRouting` reads `raw.disabled === true` for both providers
- [x] in `keyProfilesModel.ts`, add `disabled: routing.disabled` to both return branches of `normalizeProviderRouting` and to `copyOfProviderRouting` (they build objects field by field; `profileDirty` compares the normalized profiles and `profileBody` reads `normalizeProfile`)
- [x] add `providerToggleSupported: boolean` to `RoutingProfilesState`, set in `readRoutingProfiles` from the presence of `disabled` in `shared.providers.claude` and `shared.providers.codex` (a helper like `hasCodexSpeed`), `false` in `unsupportedRoutingProfiles`
- [x] `profileBody`, `keyProfilePatch` and `sharedProfilePatch` take `providerToggleSupported = false` as a new last argument; when true and `providersSupported`, both provider blocks carry `disabled` (an explicit `false` when on, so re-enabling overwrites a stored `true`); when false the key is never sent
- [x] write tests in `routingProfiles.test.ts`: reading `disabled: true` / absent / `false` for each provider; `providerToggleSupported` true with the key, false without it and for `unsupportedRoutingProfiles`; `profileBody` of a profile built through `normalizeProfile` sends `disabled: true` and explicit `disabled: false` for both providers only when supported, never on an old backend or without `providers`
- [x] write tests in `keyProfilesModel.test.ts`: `profileDirty` is true when only `providers.claude.disabled` or only `providers.codex.disabled` differs; `normalizeProfile` and `copyOfShared` keep `disabled: true`
- [x] ➕ `saveKeyDefaultCopy` passes `from.providerToggleSupported` to `keyProfilePatch`, so a speed-table copy of the Default keeps its stored `disabled` (tested in `routingProfiles.test.ts`)
- [x] run `npm test` (affected files) and `npm run type-check` in `apps/web` - must pass before task 2

### Task 2: Thread support through the save paths
- [x] in `useKeyProfiles.ts`, pass `state.providerToggleSupported` to the two `routingProfilesApi` save calls (`saveSharedProfile`, `saveKeyProfile`) next to `state.speedSupported`, and add the matching last parameter to those API methods so they pass it to `sharedProfilePatch` / `keyProfilePatch`
- [x] write API-level tests that run the real `saveSharedProfile` / `saveKeyProfile` with `apiClient.patch` mocked: exact request bodies carry `disabled` (including an explicit `disabled: false` for re-enabling) on a supporting backend and omit it on an older one
- [x] extend `useKeyProfiles.lifecycle.test.tsx` to assert the hook forwards `providerToggleSupported` to both save calls (true and false)
- [x] run `npm test` and `npm run type-check` - must pass before task 3

### Task 3: Enabled toggle in the provider block
- [x] add props `providerToggleSupported?: boolean` (default `false`) and `codexDisabled?: boolean` to `ProviderRoutingBlock`; render a `ToggleSwitch` labeled Enabled (aria label names the provider) in the block header next to the title, bound to `!value.disabled`, calling `onChange({ ...value, disabled: !checked })`
- [x] the toggle is disabled when `disabled` (read-only/saving), `modeLocked` (reusing the existing `provider_routing.locked` hint), or `!providerToggleSupported` (reusing the existing `provider_routing.requires_backend` hint); it is never disabled by validation errors
- [x] when `value.disabled` and not `modeLocked`, disable every other control of the block (mode, API key, preferred account, fallback target, mappings, Codex speed and flag), show a short hint that the provider is off for this profile, and render none of the Speed row hints (`api_mode`, `claude_fallback`); keep all values in `value`. Under `modeLocked` (CPA does not enforce `disabled` under a scheduler plugin) a stored `disabled` locks nothing and shows no off hint, so the preferred account and the `withDraftCodexSpeed` speed controls stay editable
- [x] in the Claude block, show a warning that the Codex fallback will not run when `codexDisabled && !value.disabled && !modeLocked && effectiveFallbackTarget(value) === 'codex'`
- [x] add the new strings used in this task (Enabled label, aria label, off hint, Claude fallback warning) under `quota_management.provider_routing` in en, ru, zh-CN and zh-TW
- [x] write tests in `ProviderRoutingBlock.test.tsx`: the toggle renders on and off; switching it calls `onChange` with only `disabled` changed; controls are disabled while off, values are preserved, and `[data-provider-speed-api-mode]` is absent while Codex is off; the toggle is locked for `modeLocked`, `disabled` and an unsupported backend with the existing hints; with `modeLocked` and a stored `disabled: true` the preferred account and the speed control stay enabled and no off hint shows; the Claude fallback warning shows only for the exact condition above and not when both providers are off
- [x] run `npm test` - must pass before task 4

### Task 4: Wire the toggle in the profile editor
- [x] add `providerToggleSupported?: boolean` (default `false`) to `KeyProfileEditorProps`; pass it and `codexDisabled={draft.providers.codex.disabled}` to both blocks; under `fallbackReadOnly` the saved providers keep the stored `disabled` (as `initial.providers` / `withDraftCodexSpeed` do today)
- [x] in `RoutingProfilesModal.tsx`, pass `providerToggleSupported={state.providerToggleSupported}` at both `KeyProfileEditor` call sites, next to `speedSupported={state.speedSupported}`
- [x] show an editor-level warning when both providers are off ("this profile allows no provider"), not blocking the save, and not under `fallbackReadOnly`; add its string in en, ru, zh-CN and zh-TW
- [x] keep `providerRoutingErrors` validating a disabled provider's fields so CPA's 422 never surprises the save; the save stays blocked by those errors while the Enabled toggle stays usable
- [x] write tests in `KeyProfileEditor.test.tsx`: toggling Claude off and saving submits `disabled: true` with the other Claude fields unchanged; both off shows the warning and still saves; under `fallbackReadOnly` with both stored off the toggle is locked, no warning shows, a speed change saves and `disabled` is saved back unchanged; a disabled provider with an invalid field still blocks the save and the toggle can switch it back on
- [x] write a test in `routingProfilesModal.lifecycle.test.tsx`: when the GET provider blocks carry no `disabled`, the toggle is locked with the backend hint
- [x] run `npm test` and `npm run type-check` - must pass before task 5

### Task 5: Summary and speed table
- [x] in `keyProfilesModel.ts` `providerSummary`, return `t(\`${SUMMARY}.provider_off\`, { provider })` when the provider is disabled (before the mode check), showing the stored value as the summary already does for the stored mode; when Claude is enabled, its effective target is `codex` and Codex is disabled, render Claude's leg as without fallback (the `account` text), since CPA skips that fallback
- [x] keep `CodexSpeedUse` as `'applies' | 'claude_fallback' | 'unused'`; in `codexSpeedUse(providers, modeLocked)`, a disabled Claude no longer counts as a fallback to Codex unless `modeLocked`
- [x] extend `SpeedDisabledReason` with `'codex_off'`; `buildSpeedRows` sets it when `state.supported && providers.codex.disabled`, before the `api_mode` check (and `claudeFallbackOnly` is false then); `CodexSpeedModal.tsx` shows its reason text like `api_mode`
- [x] add `quota_management.key_profiles.summary.provider_off` and the `codex_speed` reason string in en, ru, zh-CN and zh-TW; add `provider_off` to the dynamic summary keys checked by `keyProfiles.locale.test.ts`
- [x] write tests: `keyProfilesModel.test.ts` summary for Claude off, Codex off, and Claude falling back to a disabled Codex in `auto` and `always` (rendered without fallback, stored target unchanged); `codexSpeedModel.test.ts` `codexSpeedUse` / `buildSpeedRows` for Codex off, Codex off under `supported: false` (no `codex_off`), and Claude off with Codex in API key mode (`unused`)
- [x] write tests in `codexSpeedModal.lifecycle.test.tsx`: a Codex-off row has disabled buttons with the reason; a speed click on a key without its own profile, while the Default profile has `claude.disabled: true`, sends `claude.disabled: true` in the new key profile's PATCH (⚠️ the PATCH-body half lives in `profilesKeysFlow.lifecycle.test.tsx`: `codexSpeedModal.lifecycle.test.tsx` mocks the hook, so it cannot see the request body)
- [x] write a round-trip test in `profilesKeysFlow.lifecycle.test.tsx`: toggle Claude off for a key, save, the mocked GET then returns `disabled: true`, and the reopened editor's toggle is off and the summary shows `provider_off`
- [x] run `npm test` - must pass before task 6

### Task 6: Verify acceptance criteria
- [x] confirm each Success Criterion maps to a test from Tasks 1-5; add any missing one (all mapped; an existing-profile speed write is a partial merge PATCH whose exact body, `sharedCodexSpeedPatch` / `keyCodexSpeedPatch` tests, never carries `disabled`)
- [x] run `npm test` in `apps/web`
- [x] run `npm run type-check` in `apps/web`
- [x] run `npm run lint` in `apps/web` - no new errors or warnings in touched files

### Task 7: [Final] Update documentation
- [ ] `docs/personal-quota.md`: describe the Enabled toggle per provider, what CPA does with a disabled provider (403, no fallback into a disabled Codex, open Codex websockets run until closed), the summary label, the speed table reason, behavior under a scheduler plugin, and the older-backend behavior

## Technical Details

### Wire format
`GET /v8/management/routing/profiles` provider blocks carry `"disabled": false|true` on a supporting backend. The panel writes it inside the complete `providers` block of a profile body:
```json
{"routing": {"key-profiles": {"<key>": {"providers": {
  "claude": {"mode": "subscription", "api-credential": null, "fallback": {"target": "off", "mode": "auto", "mappings": []}, "disabled": true},
  "codex":  {"mode": "subscription", "api-credential": null, "fallback": {"target": "off", "mode": null, "mappings": null}, "speed": "standard", "ignore-client-tier": false, "disabled": false}
}}}}}
```

### Speed use and speed table with a disabled provider
| Codex | Claude | `codexSpeedUse` | speed table `disabledReason` |
|---|---|---|---|
| off (`supported: true`) | any | (not consulted first) | `codex_off` |
| on, subscription | any | `applies` | `''` |
| on, API key | on, fallback to Codex | `claude_fallback` | `''` (Claude fallback only) |
| on, API key | off, or no fallback to Codex | `unused` | `api_mode` |
Under `supported: false` (`modeLocked`) the disabled flags are ignored, as CPA ignores them; `codexSpeedUse` returns `applies` as today.

### Non-goals
- Hiding models of a disabled provider anywhere in the panel.
- Per-model restrictions.
- Changes to the backend (plan 1).

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- After the backend plan is deployed and this plan is merged: panel-only deploy (`PANEL_PATH`), open Routing profiles, switch Claude off for a test key, save, reload the page and confirm the toggle is off and the summary says Claude is off; call `/v1/messages` with that key (403) and `/v1/responses` (200); switch Claude back on and confirm the earlier mode and fallback are intact.

**External system updates**:
- None beyond the backend plan.
