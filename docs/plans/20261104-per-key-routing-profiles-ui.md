# Per-key routing profiles UI on the Quota page

## Overview
- The CPA backend (CLIProxyAPI-migration `main` at `ced98b16`, deployed on 2026-11-04) routes every client API key through a profile of four stages: sticky session, preferred subscription per provider (claude, codex), pool selection `{primary, tiebreak}`, and the Claude -> Codex fallback. A key without a profile uses the shared profile, which is the global routing configuration. A key profile is a full copy: nothing is inherited, an omitted block means off or empty, and an omitted selection means `{reserves, round-robin}`.
- Today the panel can edit only the shared fields, and it still writes the legacy `routing.strategy`. Key profiles can be changed only by hand in `config.yaml` or through a raw config PATCH.
- This plan adds the UI on the Quota page:
  1. the toolbar's single strategy select becomes two slots, "Основная" and "При равенстве", which write `routing.selection`;
  2. a toolbar button "Ключи N/M" opens a modal that lists every client key with a one-line chain summary and an editor for the four stages;
  3. a profile can be created as a copy of the shared profile, edited, and reset to the shared settings; every save is verified by reading the profiles again;
  4. against an older backend without `/routing/profiles` the panel behaves exactly as today;
  5. a raw client key never appears on screen or in a request URL.

## Decisions
- **Context**: the backend contract is documented in CLIProxyAPI-migration `docs/management-api-v8.md`, section "Per-key routing profiles and selection pipeline". The panel already has the pattern for this kind of feature in the Claude -> Codex fallback (`claudeFallback.ts`, `useClaudeFallback.ts`, `ClaudeFallbackControl.tsx`, `claudeFallback.lifecycle.test.tsx`). The user saw and accepted a static concept, `artifacts/key-profiles-ui/concept.html` (gitignored, reference only).
- **Chosen approach** (approved in brainstorming on 2026-11-04):
  1. **API module** `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts`:
     - `read()` validates `GET /routing/profiles` the way `readClaudeFallback` does, and maps a 404 to an unsupported-backend state.
     - `saveKeyProfile(key, profile | null)` sends one `PATCH /config` with the complete profile: an explicit `session-affinity`, a `preferred-accounts` entry for each provider (a cleared provider is sent as `null`), `selection` with `tiebreak: null` when empty, and the full `claude-fallback` object with its `mappings` list. It then reads the profiles again and compares, like `claudeFallbackApi.save`.
     - `saveSharedSelection(selection)` follows the same pattern.
     - `guardConfigConnection` (`configValue.ts:4`) surrounds every await.
     - A 400 `unknown_api_key` and a 422 `invalid_config` become typed errors with readable messages.
  2. **Model** `apps/web/src/features/quota/keyProfilesModel.ts` (pure functions):
     - the chain summary (sticky; Claude and Codex account labels via `getQuotaDisplayName`, masked with `maskQuotaName` when emails are hidden; primary -> tiebreak; fallback mode);
     - `copyOfShared(shared)` for a new profile;
     - the dirty check;
     - the rule that a picker as primary disables the tiebreak;
     - key labels: the alias from `getApiKeyAliases` matched by `sha256Hex`, otherwise `maskApiKey`, following `buildApiKeyDisplayMap`.
  3. **Hook** `apps/web/src/features/quota/hooks/useKeyProfiles.ts`:
     - loads the profiles, the fallback model suggestions, and the key aliases;
     - aliases are optional and guarded by the same feature-availability check as `ApiKeysCardEditor.tsx:96-139`; without them, keys are shown masked;
     - holds loading, saving, and error state with the connection-revision guard of `useClaudeFallback.ts`.
  4. **Toolbar** (`QuotaSettingsToolbar.tsx:76-88`, `useSubscriptionRouting.ts`, `subscriptionRouting.ts`):
     - when profiles are supported, the strategy select is replaced by primary and tiebreak selects, saved by the existing toolbar Save button (`SubscriptionRoutingSettings` and `subscriptionRoutingPatch` gain `selection`; the shared selection is read from the profiles response);
     - otherwise the legacy strategy select stays unchanged;
     - a "Ключи N/M" button opens the modal, where N is the number of keys with their own profile and M is the number of keys.
  5. **Modal and editor**: `KeyProfilesModal` and `KeyProfileEditor` under `features/quota/components/`, built from `components/ui/Modal`, `ToggleSwitch`, `Button`, and `features/quota/components/Select`.
     - The modal shows the shared-profile summary at the top (read-only; it is edited in the toolbar), then one row per key with its label, masked key, a badge "Общие настройки" or "Свой профиль", the chain summary, and an Edit button.
     - The editor has a segmented "Общие настройки / Свой профиль" switch and the four stages. Preferred-account selects are built from `files` the same way the toolbar builds them (`QuotaSettingsToolbar.tsx:117-140`, including the disabled and missing-account labels). Cancel and Save act on one key.
     - When `supported` is false, the editor is read-only and explains why.
  6. **Shared fallback editor**: the mapping rows of `ClaudeFallbackControl.tsx` (around lines 150-215) move into `FallbackMappingsEditor`, used by both `ClaudeFallbackControl` and `KeyProfileEditor`; it reuses `validFallbackSettings` and `normalizeFallbackSettings` from `claudeFallback.ts`.
  7. **i18n and docs**: keys under `quota_management` in `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json`; a section in `docs/personal-quota.md`.
- **Rejected alternatives**: none recorded by the user. The alternatives that were not chosen are listed in the decision table below and remain open to critique.
- **Decision table** (accepted by the user):

  | Decision | Chosen | Alternatives not taken | Evidence |
  |---|---|---|---|
  | Placement (user choice) | Quota toolbar "Ключи" button with a modal | per-key button on Config → API keys; separate Routing page | user answer; routing controls live in `QuotaSettingsToolbar.tsx` |
  | Shared strategy in the toolbar (hard to reverse) | two slots writing `routing.selection`; legacy strategy select only for backends without profiles | keep the strategy select with no shared selection | original "First/Second Strategy" discussion; backend docs "Legacy configuration"; `QuotaSettingsToolbar.tsx:76-88` |
  | Data source | `GET /routing/profiles` for profiles and slot options; accounts from the loaded `files`; models from `/routing/claude-fallback`; aliases from `getApiKeyAliases` by sha256 | read `routing.key-profiles` from `GET /config` | backend docs "Reading profiles"; `ApiKeysCardEditor.tsx:136`; `monitoring/model/apiKeys.ts` |
  | New profile | starts as a copy of the shared profile; "Общие настройки" deletes it with `null` | start empty | no inheritance in the backend; an empty profile silently turns sticky and fallback off |
  | Write format (hard to reverse) | one `PATCH /config` with the complete key profile, cleared preferences as `null`, lists replaced; read back and compare | two requests, `null` then the profile | backend docs "PATCH merges objects and replaces lists"; `claudeFallback.ts` save |
  | Raw keys | kept in memory and PATCH bodies only, never in URLs; the UI shows an alias or a mask | `/config/routing/key-profiles/<key>` path | backend docs: paths are written to the request log |
  | Backend support | a 404 hides the button and keeps the legacy select; `supported: false` makes the editor read-only with an explanation | always show | 404 handling in `claudeFallback.ts` |
  | Errors | 400 `unknown_api_key` -> "key was removed, list reloaded"; 422 -> backend message; `guardConfigConnection` | generic error text | backend docs "Writing profiles"; `configValue.ts:4` |
  | Fallback editor | extract `FallbackMappingsEditor` for the toolbar and the key profile | duplicate the markup | `ClaudeFallbackControl.tsx:150-215` |
  | List summary | one chain line per key | a table of every field | the agreed "итоговая цепочка" |
  | i18n and tests | four locales; vitest model tests and a lifecycle test like `claudeFallback.lifecycle.test.tsx` | — | existing Quota tests |

- **Verified facts**:
  - Backend contract (CLIProxyAPI-migration `main`, `docs/management-api-v8.md`):
    - `GET /v8/management/routing/profiles` returns `{supported, shared, keys: [{key, profile}], selection_options: {narrowing: [priority, reserves, earliest-reset, most-remaining], pickers: [round-robin, weighted-round-robin, fill-first]}}`. Keys are raw and listed in `access.api-keys` order, with `Cache-Control: no-store`.
    - `shared.selection` and each key's `selection` are effective values, so a derived legacy selection is shown rather than an empty object. `preferred-accounts` is omitted when empty.
    - `supported` is false in Home mode and with a scheduler plugin. Older backends return 404.
    - Writes go through `PATCH /v8/management/config`, which merges objects and replaces lists and scalars; `null` deletes. `{"routing":{"key-profiles":{"<key>":null}}}` deletes a profile, and `{"routing":{"selection":null}}` returns to the derived legacy selection.
    - A profile for a key missing from `access.api-keys` returns 400 `{"error":"unknown_api_key","count":N}`, with no key in the body and the file unchanged.
    - An invalid slot, a tiebreak without a primary, a provider other than claude or codex, or an invalid fallback block returns 422 `{"error":"invalid_config","message":"..."}`, naming the key profile by a 12-hex sha256 prefix.
    - `session-affinity-ttl` stays global.
  - Through the CPAMP proxy (`:18318`), `GET /v8/management/routing/profiles` already returned 200 after the backend deploy on 2026-11-04, so the manager server needs no change.
  - Quota API client: `features/personal-quota-support/services/api/client.ts` (`baseURL` is `${base}/v8/management`; it provides `get`, `put`, `patch`, `getConnectionRevision`, and `onQuotaConnectionChange`). Config normalization lives in `services/api/config.ts` (`normalizeConfigResponse`).
  - Routing settings: `hooks/useSubscriptionRouting.ts`, `routingModel.ts` (`routingFormState`, `routingStrategyOptions`), `services/api/subscriptionRouting.ts` (`subscriptionRoutingPatch`), with tests in `settingsHooks.lifecycle.test.tsx` and `quotaSettingsToolbar.test.ts`. The toolbar is rendered by `QuotaSettingsBar` at `QuotaPage.tsx:371`.
  - `SubscriptionRouting.tsx` and `SubscriptionAccounts.tsx` are dead code and are not extended (`docs/backlog/unused-subscription-routing-components.md`).
  - Key aliases: `usageServiceApi.getApiKeyAliases` (`services/api/usageService.ts`, around line 3306) returns `{items: [{apiKeyHash, alias}]}`, where `apiKeyHash = sha256Hex(key)` (`utils/apiKeyHash.ts:92`). `maskApiKey` lives at `utils/format.ts:19`. `Modal` (`components/ui/Modal.tsx`) accepts `footer` and `width`.
  - Scripts in `apps/web/package.json`: `test` (`vitest run`), `lint`, `type-check` (`tsc --noEmit`), `build` (`tsc && vite build`).

## Context (from discovery)
- Files/components involved:
  - new: `services/api/routingProfiles.ts`, `features/quota/keyProfilesModel.ts`, `features/quota/hooks/useKeyProfiles.ts`, `features/quota/components/KeyProfilesModal.tsx`, `KeyProfileEditor.tsx`, `FallbackMappingsEditor.tsx`
  - changed: `QuotaSettingsToolbar.tsx`, `QuotaSettingsToolbar.module.scss`, `useSubscriptionRouting.ts`, `subscriptionRouting.ts`, `routingModel.ts`, `ClaudeFallbackControl.tsx`, the four locale files, `docs/personal-quota.md`
- Related patterns found: capability through a dedicated GET with 404 handling, verify-after-write saves, and the connection-revision guard (`claudeFallback.ts`, `useClaudeFallback.ts`); masked display (`ledgerModel.ts`, `maskQuotaName`); key alias display (`monitoring/model/apiKeys.ts`); lifecycle tests with a mocked `apiClient` (`claudeFallback.lifecycle.test.tsx`).
- Dependencies identified: none new. The backend is already deployed.

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
- Run tests after each change: from `apps/web`, run `npx vitest run <files>` for the focused files, then `npm test`, `npm run type-check`, and `npm run lint`
- Maintain backward compatibility: against a backend without `/routing/profiles`, the toolbar, the strategy select, and the fallback control behave exactly as today
- A raw client key must never be rendered, logged, or placed in a URL; tests assert this

## Testing Strategy
- **Unit tests**: required for every task. Pure model and API tests in vitest next to the code, following `claudeFallback.test.ts`.
- **Lifecycle tests**: React Testing Library tests in the style of `claudeFallback.lifecycle.test.tsx` and `settingsHooks.lifecycle.test.tsx`, with `apiClient` mocked.
- **E2E tests**: the repo has no browser e2e suite for the Quota page; live verification goes to Post-Completion.

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code, tests, and docs in this repo
- **Post-Completion** (no checkboxes): building and deploying the CPAMP release, and manual checks against the live CPA
- **Checkbox placement**: checkboxes belong only in Task sections

## Decision Log
- 2026-11-04 brainstorm: **accepted** - placement: the per-key editor opens from a "Ключи" button in the Quota toolbar (the user's choice over Config → API keys and a separate page); routing controls already live in `QuotaSettingsToolbar.tsx`.
- 2026-11-04 brainstorm: **accepted** - shared strategy: two toolbar slots write `routing.selection`, and the legacy strategy select remains only for backends without profiles (original First/Second Strategy discussion; backend docs "Legacy configuration"; `QuotaSettingsToolbar.tsx:76-88`).
- 2026-11-04 brainstorm: **accepted** - data source: `GET /routing/profiles` for profiles and slot options, the loaded `files` for accounts, `/routing/claude-fallback` for models, and `getApiKeyAliases` by sha256 for key labels (backend docs "Reading profiles"; `ApiKeysCardEditor.tsx:136`; `monitoring/model/apiKeys.ts`).
- 2026-11-04 brainstorm: **accepted** - a new profile starts as a copy of the shared profile, and "Общие настройки" deletes it with `null` (the backend inherits nothing; an empty profile would turn sticky and fallback off).
- 2026-11-04 brainstorm: **accepted** - write format: one `PATCH /config` with the complete key profile, cleared preferences as `null`, lists replaced, then a read-back comparison (backend docs "PATCH merges objects and replaces lists"; `claudeFallback.ts` save).
- 2026-11-04 brainstorm: **accepted** - raw keys stay in memory and PATCH bodies only, never in URLs; the UI shows an alias or a mask (backend docs: paths are written to the request log).
- 2026-11-04 brainstorm: **accepted** - backend support: a 404 hides the button and keeps the legacy select; `supported: false` makes the editor read-only with an explanation (404 handling in `claudeFallback.ts`).
- 2026-11-04 brainstorm: **accepted** - errors: 400 `unknown_api_key` reloads the list with an explanation; 422 shows the backend message; `guardConfigConnection` aborts on a connection change (backend docs "Writing profiles"; `configValue.ts:4`).
- 2026-11-04 brainstorm: **accepted** - `FallbackMappingsEditor` is extracted from `ClaudeFallbackControl` and used by the toolbar control and the key editor (`ClaudeFallbackControl.tsx:150-215`).
- 2026-11-04 brainstorm: **accepted** - the key list shows one chain-summary line per key (the agreed "итоговая цепочка").
- 2026-11-04 brainstorm: **accepted** - four locales, vitest model tests, and lifecycle tests in the style of `claudeFallback.lifecycle.test.tsx` (existing Quota tests).

## Implementation Steps

### Task 1: Routing profiles API module
- [ ] create `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts` with the types `SelectionSlots {primary: string; tiebreak?: string}`, `RoutingProfile {sessionAffinity; preferredAccounts: {claude?, codex?}; selection; claudeFallback: ClaudeFallbackSettings}`, and `RoutingProfilesState {supported; unsupportedBackend; shared; keys: {key, profile}[]; selectionOptions: {narrowing; pickers}}`
- [ ] implement `readRoutingProfiles(raw)`, which validates and maps the kebab-case response the way `readClaudeFallback` does (reuse its fallback-settings validation), and `routingProfilesApi.get()`, which maps a 404 to `{supported: false, unsupportedBackend: true}`
- [ ] `/routing/profiles` lists only keys that have a profile, so `routingProfilesApi.get()` also reads `access.api-keys` from `GET /config` (`raw.access['api-keys']`, read through `configApi`/`normalizeConfigResponse` extended with `apiKeys: string[]`) and returns `allKeys` in that order; keys without a profile get `profile: null`
- [ ] implement `keyProfilePatch(key, profile | null)`, `sharedSelectionPatch(selection | null)`, `routingProfilesApi.saveKeyProfile`, and `routingProfilesApi.saveSharedSelection`:
  - each sends one `apiClient.patch('/config', body)`, then reads again and compares the stored value, throwing on a mismatch;
  - each wraps every await in `guardConfigConnection()`;
  - a 400 `unknown_api_key` becomes `UnknownApiKeyError`, and a 422 becomes `InvalidRoutingConfigError` carrying the backend message
- [ ] write tests in `routingProfiles.test.ts` for success:
  - parsing a full response, including an omitted `preferred-accounts`;
  - a full PATCH body, with a cleared provider as `null`, an empty tiebreak as `null`, and the complete `mappings` list;
  - a reset body that is `null`;
  - a shared-selection body;
  - the URL is always `/config` and never contains the key
- [ ] write tests for errors: a malformed response, a 404 that maps to unsupported, a 400 `unknown_api_key`, a 422 with its message, a mismatch after save, and a connection change that aborts
- [ ] run `npx vitest run src/features/personal-quota-support/services/api/routingProfiles.test.ts` and `npm run type-check` from `apps/web` - must pass before task 2

### Task 2: Key profiles model
- [ ] create `apps/web/src/features/quota/keyProfilesModel.ts` with:
  - `keyLabel(key, aliasesByHash)`, which returns `{label, masked}` from the alias matched by `sha256Hex(key)` or from `maskApiKey(key)`, so the raw key is never returned as a label;
  - `buildKeyRows(state, aliases)`
- [ ] add `chainSummary(profile, files, showEmails, t)`:
  - it covers sticky or no sticky, the Claude and Codex accounts (automatic, a display name masked with `maskQuotaName` when emails are hidden, or a missing account), `primary → tiebreak`, and the fallback state and mode
- [ ] add the remaining helpers:
  - `copyOfShared(shared)` (a deep copy);
  - `profileDirty(a, b)`;
  - `isPickerSlot(slot, options)`;
  - `normalizeSelection(selection, options)`, which drops the tiebreak when the primary is a picker
- [ ] write tests in `keyProfilesModel.test.ts` for labels with and without an alias, a summary with emails shown and hidden, a missing account, every fallback state, a deep `copyOfShared` (mutating the copy leaves the source unchanged), the dirty check, and the tiebreak rule
- [ ] write tests for edge cases: an empty key list, an alias for an unknown hash, an empty `preferred-accounts`, and an unknown slot value
- [ ] run the focused tests and `npm run type-check` - must pass before task 3

### Task 3: Extract FallbackMappingsEditor
- [ ] create `apps/web/src/features/quota/components/FallbackMappingsEditor.tsx` with the mapping rows, datalists, add and remove buttons, and the invalid hint moved out of `ClaudeFallbackControl.tsx` (around lines 150-215); its props are `{value: ClaudeFallbackSettings; models; disabled; onChange}`
- [ ] make `ClaudeFallbackControl` use it without any change in behavior or markup semantics (the same aria labels and placeholders)
- [ ] keep `claudeFallback.lifecycle.test.tsx` passing unchanged, as the regression check
- [ ] write `FallbackMappingsEditor.test.tsx`: editing a row, adding and removing rows, the invalid hint, and the disabled state
- [ ] run the focused tests, `npm run type-check`, and `npm run lint` - must pass before task 4

### Task 4: useKeyProfiles hook
- [ ] create `apps/web/src/features/quota/hooks/useKeyProfiles.ts`:
  - load the profiles through `routingProfilesApi.get()`, the fallback model suggestions through `claudeFallbackApi.get()`, and the aliases through `usageServiceApi.getApiKeyAliases` behind the feature-availability guard from `ApiKeysCardEditor.tsx:96-139`;
  - when aliases fail or are unavailable, the hook keeps working and keys are shown masked
- [ ] expose `{state, aliases, models, loading, saving, error, reload, saveKeyProfile(key, profile | null), saveSharedSelection}`; follow `useClaudeFallback.ts` for the connection-revision and mounted guards; reload after an `UnknownApiKeyError` and set the "key was removed, list reloaded" error
- [ ] write `useKeyProfiles.lifecycle.test.tsx` for success: the load, a key save that replaces the state with the read-back result, and a reset to shared that sends `null`
- [ ] write tests for errors: a 404 gives unsupported, an alias failure leaves the masks in place, a 400 reloads and sets its message, a 422 shows the backend message, and a connection change discards stale results
- [ ] run the focused tests and `npm run type-check` - must pass before task 5

### Task 5: Shared selection slots in the toolbar
- [ ] extend `SubscriptionRoutingSettings` and `subscriptionRoutingPatch` (`subscriptionRouting.ts`) with an optional `selection`; the patch includes `routing.selection` only when it changed, and `routingFormState` (`routingModel.ts`) treats a selection change as dirty
- [ ] in `useSubscriptionRouting.ts`, take the baseline shared selection from the profiles state provided by the toolbar container, and keep `strategy` untouched when profiles are supported; after a save, read the config and the profiles again
- [ ] in `QuotaSettingsToolbar.tsx:76-88`:
  - render the primary and tiebreak selects built from `selection_options` when profiles are supported;
  - disable the tiebreak, with a hint, when the primary is a picker;
  - otherwise render the legacy strategy select exactly as today;
  - add the matching styles in `QuotaSettingsToolbar.module.scss`
- [ ] add the "Ключи N/M" button next to the Save action. It is hidden when the backend is unsupported, disabled while loading or disconnected, and opens the modal from task 6 (wire the open state in `QuotaSettingsBar`)
- [ ] update `settingsHooks.lifecycle.test.tsx` and `quotaSettingsToolbar.test.ts`:
  - on a supporting backend the toolbar shows two slots and saving sends `routing.selection` only;
  - on a 404 backend the legacy select still writes `routing.strategy`;
  - a picker primary disables the tiebreak;
  - the button counter shows N/M
- [ ] run the focused tests, `npm run type-check`, and `npm run lint` - must pass before task 6

### Task 6: KeyProfilesModal and KeyProfileEditor
- [ ] create `KeyProfilesModal.tsx`:
  - a read-only shared-profile summary at the top;
  - one row per key with its label, masked key, badge, chain summary, and an Edit or Collapse button;
  - one expanded row at a time;
  - loading, error, and read-only (`supported: false`) states
- [ ] create `KeyProfileEditor.tsx`:
  - the segmented "Общие настройки / Свой профиль" switch;
  - switching to "Свой профиль" seeds a draft with `copyOfShared`;
  - the four stages: a sticky toggle with the global TTL shown as text, Claude and Codex preferred-account selects built from `files` like `QuotaSettingsToolbar.tsx:117-140`, primary and tiebreak selects with the picker rule, and the fallback toggle, mode, and `FallbackMappingsEditor`;
  - a footer with the draft's chain summary, Cancel, and Save; Save is disabled when the draft is clean or the mappings are invalid;
  - choosing "Общие настройки" and saving sends `null`
- [ ] never render a raw key: labels come from `keyLabel`, and `showEmails` masks the account names; add i18n keys for every string under `quota_management.key_profiles` in `en.json`, `ru.json`, `zh-CN.json`, and `zh-TW.json`
- [ ] write `keyProfiles.lifecycle.test.tsx` for success:
  - open the modal from the toolbar;
  - create a profile from the shared copy, edit it, and save; assert the PATCH body and that no request URL contains the key;
  - reset a profile to shared, which sends `null`;
  - the summary updates after the read-back
- [ ] write tests for errors:
  - read-only when `supported` is false;
  - a 400 on save shows "key was removed" and reloads;
  - a 422 shows the backend message;
  - with emails hidden, account names are masked;
  - the rendered DOM never contains the raw key string
- [ ] run the focused tests, `npm run type-check`, and `npm run lint` - must pass before task 7

### Task 7: Verify acceptance criteria
- [ ] verify every Overview requirement: the two toolbar slots, the "Ключи N/M" button and modal, creating, editing, and resetting with read-back, the unchanged behavior on a 404 backend, and that no raw key appears in the DOM or in URLs
- [ ] verify edge cases: no client keys, a key without an alias, a missing preferred account, the backend reporting `supported: false`, a disconnected panel, and a connection change during a save
- [ ] run from `apps/web`: `npm test`, `npm run type-check`, `npm run lint`, and `VERSION=0.0.0-plan npm run build` - all must pass
- [ ] confirm that `routingProfiles.ts`, `keyProfilesModel.ts`, and `useKeyProfiles.ts` have tests covering their branches

### Task 8: [Final] Update documentation
- [ ] add a "Routing profiles per API key" section to `docs/personal-quota.md`, after "Claude to Codex fallback": the two toolbar slots, the "Ключи" modal, copy-of-shared creation, reset to shared, the read-only and older-backend behavior, how keys are shown, and the backend version requirement
- [ ] update the existing routing description in `docs/personal-quota.md` where it mentions the single strategy select

## Technical Details
- **Read**: `GET /v8/management/routing/profiles` maps to `RoutingProfilesState`; kebab-case fields become camelCase in the panel types. `shared.selection` is always present (an effective value).
- **Key profile write** (one request):

  ```json
  {"routing": {"key-profiles": {"<raw key>": {
    "session-affinity": false,
    "preferred-accounts": {"claude": "<auth_index>", "codex": null},
    "selection": {"primary": "priority", "tiebreak": "round-robin"},
    "claude-fallback": {"enabled": true, "mode": "auto", "mappings": [{"from": "claude-opus-*", "to": "gpt-6-astra"}]}
  }}}}
  ```

  A reset is `{"routing": {"key-profiles": {"<raw key>": null}}}`. The shared selection is `{"routing": {"selection": {"primary": "reserves", "tiebreak": "earliest-reset"}}}`.
- **Read-back**: after a write, `GET /routing/profiles`; the saved key's profile, or its absence, must equal the normalized draft, otherwise the save fails with "CPA did not retain the routing profile".
- **Errors**: 400 `unknown_api_key` -> reload and "key was removed on the Config page"; 422 -> the backend message, which is safe because it carries only a hash prefix; a 404 on GET -> the unsupported backend path.
- **Counter**: N = the number of keys with their own profile and M = the length of `access.api-keys` (from `GET /config`). A key without a profile is listed with the shared profile's summary and the badge "Общие настройки". `/routing/profiles` returns entries only for keys with a profile.
- **Picker rule**: when `primary` is in `selection_options.pickers`, the tiebreak select is disabled and the tiebreak is sent as `null`.

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**
- Build and deploy the CPAMP release per the local deploy notes (release dir, backup, symlink switch, `launchctl kickstart`), keeping the previous release for rollback.
- On the live panel, open Quota, set the shared slots, and confirm that `GET /v8/management/routing/profiles` reflects them; give one of the two client keys its own profile with a preferred Claude account and sticky off, and confirm that the `Routing profile selection` log lines in the CPA `logs/stdout.log` show its hash prefix and the preferred stage.
- Reset the key to the shared settings and confirm that the profile is gone from `config.yaml`.
- Check the light and dark themes and the narrow-width toolbar wrap.

**External system updates**
- None. The backend is already deployed, and the manager server already proxies the endpoint.
