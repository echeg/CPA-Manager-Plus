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
- Under `supported: false` (a scheduler plugin) the toggle is locked like the mode, and a stored `disabled` does not change the speed table (CPA does not enforce it there).
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
  - `apps/web/src/features/quota/hooks/useKeyProfiles.ts` and the components that pass `speedSupported` today (`RoutingProfilesModal.tsx`, `ClientKeysModal.tsx` or wherever `speedSupported` is threaded on the merged `main`)
  - lifecycle tests: `profilesKeysFlow.lifecycle.test.tsx`, `useKeyProfiles.lifecycle.test.tsx`, `routingProfilesModal.lifecycle.test.tsx`, `codexSpeedModal.lifecycle.test.tsx`
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

## Implementation Steps

### Task 1: Read, normalize, copy and send `disabled`
- [ ] add `disabled: boolean` to `ProviderRouting` in `routingProfiles.ts` (doc comment: both providers; keeps the other fields); `defaultProviderRouting()` and `providersFromClaudeFallback` set `false`; update every `ProviderRouting` literal in source and tests so type-check passes
- [ ] `readProviderRouting` reads `raw.disabled === true` for both providers
- [ ] add `providerToggleSupported: boolean` to `RoutingProfilesState`, set in `readRoutingProfiles` from the presence of `disabled` in `shared.providers.claude` and `shared.providers.codex` (a helper like `hasCodexSpeed`), `false` in `unsupportedRoutingProfiles`
- [ ] `profileBody`, `keyProfilePatch` and `sharedProfilePatch` take `providerToggleSupported = false` as a new last argument; when true and `providersSupported`, both provider blocks carry `disabled`; when false the key is never sent
- [ ] check the copy and normalize helpers that build `ProviderRouting` copies (e.g. `copyOfProviderRouting`, `normalizeProviderRouting` or their merged equivalents) carry `disabled`
- [ ] write tests in `routingProfiles.test.ts`: reading `disabled: true` / absent / `false` for each provider; `providerToggleSupported` true with the key, false without it and for `unsupportedRoutingProfiles`; `profileBody` sends `disabled` for both providers only when supported, never on an old backend or without `providers`; key and shared patches pass the flag through
- [ ] run `npm test` in `apps/web` (the affected files) and `npm run type-check` - must pass before task 2

### Task 2: Thread support through the hook and save paths
- [ ] in `useKeyProfiles.ts` (and wherever the merged `main` threads `state.speedSupported` into `saveSharedProfile` / `saveKeyProfile` / `keyProfilePatch` / `sharedProfilePatch`), pass `state.providerToggleSupported` the same way
- [ ] pass `providerToggleSupported` from the routing profiles state into `KeyProfileEditor` for the Default profile and key profiles (as `speedSupported` is passed)
- [ ] confirm the speed table's partial Codex patches (`sharedCodexSpeedPatch`, `keyCodexSpeedPatch`) are unchanged: they never send `disabled`
- [ ] write tests (extending the existing `speedSupported` assertions in `useKeyProfiles.lifecycle.test.tsx` / `routingProfilesModal.lifecycle.test.tsx`): a save on a supporting backend sends `disabled` with exact PATCH bodies for the shared and a key profile; a save on an older backend sends no `disabled`
- [ ] run `npm test` and `npm run type-check` - must pass before task 3

### Task 3: Enabled toggle in the provider block
- [ ] add props `providerToggleSupported?: boolean` (default `false`) to `ProviderRoutingBlock`; render a `ToggleSwitch` labeled Enabled (aria label names the provider) in the block header next to the title, bound to `!value.disabled`, calling `onChange({ ...value, disabled: !checked })`
- [ ] the toggle is disabled when `disabled` (read-only/saving), `modeLocked`, or `!providerToggleSupported` (with the "requires a newer backend" style hint); it is not disabled by validation errors
- [ ] when `value.disabled`, disable every other control of the block (mode, API key, preferred account, fallback target, mappings, Codex speed and flag) and show a short hint that the provider is off for this profile; keep all values in `value`
- [ ] add prop `codexDisabled?: boolean`; in the Claude block, when `codexDisabled` and the effective Claude fallback target is `codex`, show a warning that the Codex fallback will not run because Codex is off
- [ ] write tests in `ProviderRoutingBlock.test.tsx`: the toggle renders on and off; switching it calls `onChange` with only `disabled` changed; controls are disabled while off and values are preserved; the toggle is locked for `modeLocked`, `disabled` and an unsupported backend (with the hint); the Claude fallback warning shows only with `codexDisabled` and target `codex`
- [ ] run `npm test` - must pass before task 4

### Task 4: Wire the toggle in the profile editor
- [ ] in `KeyProfileEditor.tsx`, pass `providerToggleSupported` and `codexDisabled={draft.providers.codex.disabled}` to the blocks; under `fallbackReadOnly` the saved `initial.providers` keeps the stored `disabled`
- [ ] show an editor-level warning when both providers are off ("this profile allows no provider"), not blocking the save
- [ ] keep `providerRoutingErrors` validating a disabled provider's fields so CPA's 422 never surprises the save; the save stays blocked by those errors while the Enabled toggle stays usable
- [ ] write tests in `KeyProfileEditor.test.tsx`: toggling Claude off and saving submits `disabled: true` with the other Claude fields unchanged; both off shows the warning and still saves; under `fallbackReadOnly` the toggle is locked and the stored value is saved back; a disabled provider with an invalid field still blocks the save and the toggle can switch it back on
- [ ] run `npm test` - must pass before task 5

### Task 5: Summary and speed table
- [ ] in `keyProfilesModel.ts` `providerSummary`, return `t(\`${SUMMARY}.provider_off\`, { provider })` when the provider is disabled (before the mode check)
- [ ] in `codexSpeedModel.ts`, make `codexSpeedUse` return a new value (e.g. `'off'`) when Codex is disabled, unless `ignoreMode` is set (under `supported: false` CPA enforces neither mode nor `disabled`); a Claude fallback to Codex no longer counts when Codex is off
- [ ] extend `SpeedDisabledReason` with `'codex_off'`; `buildSpeedRows` sets it for that use; `CodexSpeedModal.tsx` shows its reason text like `api_mode`; the editor's Speed row treats `'off'` like `'unused'`
- [ ] add the strings: `quota_management.key_profiles.summary.provider_off`, the block's Enabled label, its aria label, the off hint, the old-backend hint (reuse if one fits), the Claude fallback warning, the both-off warning, and the speed table reason, in en, ru, zh-CN, zh-TW; extend `keyProfiles.locale.test.ts` subtrees/dynamic keys so the new keys are checked
- [ ] write tests: `keyProfilesModel.test.ts` summary for Claude off and Codex off; `codexSpeedModel.test.ts` `codexSpeedUse` and `buildSpeedRows` for Codex off, for Codex off under `supported: false`, and for Claude off with Codex in API key mode; `codexSpeedModal.lifecycle.test.tsx` a Codex-off row has disabled buttons with the reason
- [ ] run `npm test` - must pass before task 6

### Task 6: Verify acceptance criteria
- [ ] confirm each Success Criterion maps to a test from Tasks 1-5; add any missing one
- [ ] run `npm test` in `apps/web`
- [ ] run `npm run type-check` in `apps/web`
- [ ] run `npm run lint` in `apps/web` - no new errors or warnings in touched files

### Task 7: [Final] Update documentation
- [ ] `docs/personal-quota.md`: describe the Enabled toggle per provider, what CPA does with a disabled provider (403, no fallback into a disabled Codex, open Codex websockets run until closed), the summary label, the speed table reason, and the older-backend behavior

## Technical Details

### Wire format
`GET /v8/management/routing/profiles` provider blocks carry `"disabled": false|true` on a supporting backend. The panel writes it inside the complete `providers` block of a profile body:
```json
{"routing": {"key-profiles": {"<key>": {"providers": {
  "claude": {"mode": "subscription", "api-credential": null, "fallback": {"target": "off", "mode": "auto", "mappings": []}, "disabled": true},
  "codex":  {"mode": "subscription", "api-credential": null, "fallback": {"target": "off", "mode": null, "mappings": null}, "speed": "standard", "ignore-client-tier": false, "disabled": false}
}}}}}
```

### Speed use with a disabled provider
| Codex | Claude | `codexSpeedUse` |
|---|---|---|
| off (supported) | any | `off` |
| on, subscription | any | `applies` |
| on, API key | on, fallback to Codex | `claude_fallback` |
| on, API key | off, or no fallback to Codex | `unused` |
Under `supported: false` the disabled flags are ignored, as CPA ignores them.

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
