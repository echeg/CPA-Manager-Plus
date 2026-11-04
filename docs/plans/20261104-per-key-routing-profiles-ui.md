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
     - The shared selection is not written here; the toolbar saves it through `subscriptionRoutingPatch` and reloads the profiles.
     - `guardConfigConnection` (`configValue.ts:4`) surrounds every await.
     - A 400 `unknown_api_key` and a 422 `invalid_config` become typed errors with readable messages.
  2. **Model** `apps/web/src/features/quota/keyProfilesModel.ts` (pure functions):
     - the chain summary (sticky; Claude and Codex account labels via `getQuotaDisplayName`, masked with `maskQuotaName` when emails are hidden; primary -> tiebreak; fallback mode);
     - `copyOfShared(shared)` for a new profile;
     - the dirty check;
     - the rule that a picker as primary disables the tiebreak;
     - key labels: the alias from `getApiKeyAliases` matched by `sha256Hex`, otherwise `maskApiKey`, following `buildApiKeyDisplayMap`.
  3. **Hooks**:
     - `useApiKeyAliases` (new, `apps/web/src/hooks/useApiKeyAliases.ts`) holds the alias loading that `components/config/ApiKeysCardEditor.tsx:96-156` does today, and `ApiKeysCardEditor` uses it;
     - `useKeyProfiles` (`apps/web/src/features/quota/hooks/useKeyProfiles.ts`) loads the profiles, takes the full key list from the loaded config, and takes aliases from `useApiKeyAliases`; without aliases, keys are shown masked;
     - it holds loading, saving, and error state with the connection-revision guard of `useClaudeFallback.ts`;
     - `QuotaSettingsBar` creates it once and lifts `useClaudeFallback`, so the modal reuses the fallback model suggestions and a fallback save reloads the profiles.
  4. **Toolbar** (`QuotaSettingsToolbar.tsx:78-91`, `useSubscriptionRouting.ts`, `subscriptionRouting.ts`):
     - when profiles are supported, the strategy select is replaced by primary and tiebreak selects, saved by the existing toolbar Save button (`SubscriptionRoutingSettings` and `subscriptionRoutingPatch` gain `selection`; the shared selection is read from the profiles response);
     - otherwise the legacy strategy select stays unchanged;
     - a "Ключи N/M" button opens the modal, where N is the number of keys with their own profile and M is the number of keys.
  5. **Modal and editor**: `KeyProfilesModal` and `KeyProfileEditor` under `features/quota/components/`, built from `components/ui/Modal`, `ToggleSwitch`, `Button`, and `features/quota/components/Select`.
     - The modal shows the shared-profile summary at the top (read-only; it is edited in the toolbar), then one row per key with its label, masked key, a badge "Общие настройки" or "Свой профиль", the chain summary, and an Edit button.
     - The editor has a segmented "Общие настройки / Свой профиль" switch and the four stages. Preferred-account selects are built from `files` the same way the toolbar builds them (through `preferredAccountOptions`, extracted from `QuotaSettingsToolbar.tsx:125-142`, including the disabled and missing-account labels). Cancel and Save act on one key.
     - When `supported` is false, the editor is read-only and explains why.
  6. **Shared fallback editor**: the modal body of `ClaudeFallbackControl.tsx:131-224` (toggle, mode, hints, mapping rows) moves into `FallbackSettingsEditor`, used by both `ClaudeFallbackControl` and `KeyProfileEditor`; it reuses `validFallbackSettings`, `normalizeFallbackSettings`, and `withSuggestions` from `claudeFallback.ts`.
  7. **i18n and docs**: keys under `quota_management` in `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json`; a section in `docs/personal-quota.md`.
- **Rejected alternatives**: none recorded by the user. The alternatives that were not chosen are listed in the decision table below and remain open to critique.
- **Decision table** (accepted by the user):

  | Decision | Chosen | Alternatives not taken | Evidence |
  |---|---|---|---|
  | Placement (user choice) | Quota toolbar "Ключи" button with a modal | per-key button on Config → API keys; separate Routing page | user answer; routing controls live in `QuotaSettingsToolbar.tsx` |
  | Shared strategy in the toolbar (hard to reverse) | two slots writing `routing.selection`; legacy strategy select only for backends without profiles | keep the strategy select with no shared selection | original "First/Second Strategy" discussion; backend docs "Legacy configuration"; `QuotaSettingsToolbar.tsx:78-91` |
  | Data source | `GET /routing/profiles` for profiles and slot options; the full key list from the loaded config's `access.api-keys`; accounts from the loaded `files`; models from `/routing/claude-fallback`; aliases from `getApiKeyAliases` by sha256 | read `routing.key-profiles` from `GET /config` | backend docs "Reading profiles"; `ApiKeysCardEditor.tsx:136`; `monitoring/model/apiKeys.ts` |
  | New profile | starts as a copy of the shared profile; "Общие настройки" deletes it with `null` | start empty | no inheritance in the backend; an empty profile silently turns sticky and fallback off |
  | Write format (hard to reverse) | one `PATCH /config` with the complete key profile, cleared preferences as `null`, lists replaced; read back and compare | two requests, `null` then the profile | backend docs "PATCH merges objects and replaces lists"; `claudeFallback.ts` save |
  | Raw keys | kept in memory and PATCH bodies only, never in URLs; the UI shows an alias or a mask | `/config/routing/key-profiles/<key>` path | backend docs: paths are written to the request log |
  | Backend support | a 404 hides the button and keeps the legacy select; `supported: false` makes the editor read-only with an explanation | always show | 404 handling in `claudeFallback.ts` |
  | Errors | 400 `unknown_api_key` -> "key was removed, list reloaded"; 422 -> backend message; `guardConfigConnection` | generic error text | backend docs "Writing profiles"; `configValue.ts:4` |
  | Fallback editor | extract `FallbackSettingsEditor` for the toolbar and the key profile | duplicate the markup | `ClaudeFallbackControl.tsx:131-224` |
  | List summary | one chain line per key | a table of every field | the agreed "итоговая цепочка" |
  | i18n and tests | four locales; vitest model tests and a lifecycle test like `claudeFallback.lifecycle.test.tsx` | — | existing Quota tests |

- **Verified facts**:
  - Backend contract (CLIProxyAPI-migration `main`, `docs/management-api-v8.md`):
    - `GET /v8/management/routing/profiles` returns `{supported, shared, keys: [{key, profile}], selection_options: {narrowing: [priority, reserves, earliest-reset, most-remaining], pickers: [round-robin, weighted-round-robin, fill-first]}}`. `keys` holds only keys that have their own profile, raw and in `access.api-keys` order (backend `internal/api/handlers/management/routing_profiles.go:27-41`), with `Cache-Control: no-store`. Keys without a profile come from the config's `access.api-keys`, or the legacy top-level `api-keys`.
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
  - Key aliases: `usageServiceApi.getApiKeyAliases` (`services/api/usageService.ts`, around line 3306) calls the manager service at `/v0/management/api-key-aliases` with axios, outside `apiClient`, and returns `{items: [{apiKeyHash, alias}]}`, where `apiKeyHash = sha256Hex(key)` (`utils/apiKeyHash.ts:92`), matched lowercased. Aliases exist only when the panel is hosted by the manager (`components/config/ApiKeysCardEditor.tsx:96-121`; a second copy of that guard is in `features/monitoring/hooks/useUsageData.ts:105-109`). `buildApiKeyDisplayMap` (`features/monitoring/model/apiKeys.ts:18-41`) already turns keys and aliases into labels and masks. `Modal` (`components/ui/Modal.tsx`) accepts `footer` and `width` and renders through `createPortal`.
  - Errors from `apiClient` carry `status`, `apiCode` (from the body's `error`), and `message` (`client.ts:61-86`, `apiError.ts:27-38`).
  - Scripts in `apps/web/package.json`: `test` (`vitest run`), `lint`, `type-check` (`tsc --noEmit`), `build` (`tsc && vite build`).

## Context (from discovery)
- Files/components involved:
  - new: `services/api/routingProfiles.ts`, `features/quota/keyProfilesModel.ts`, `hooks/useApiKeyAliases.ts`, `features/quota/hooks/useKeyProfiles.ts`, `features/quota/components/KeyProfilesModal.tsx`, `KeyProfileEditor.tsx`, `FallbackSettingsEditor.tsx`
  - changed: `QuotaSettingsToolbar.tsx`, `QuotaSettingsToolbar.module.scss`, `useSubscriptionRouting.ts`, `subscriptionRouting.ts`, `routingModel.ts` (extracted `preferredAccountOptions`), `ClaudeFallbackControl.tsx`, `claudeFallback.ts` (exported `withSuggestions`), `components/config/ApiKeysCardEditor.tsx` (uses the shared alias hook), `config.test.ts`, `QuotaPage.lifecycle.test.tsx`, the four locale files, `docs/personal-quota.md`
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
- **Lifecycle tests**: the repo has no Testing Library and no jsdom (`apps/web/package.json` has `react-test-renderer`; `vite.config.ts` sets no test environment). Use `react-test-renderer` with `act`, `IS_REACT_ACT_ENVIRONMENT = true`, `i18n.changeLanguage('en')` in `beforeAll`, and `vi.mock('@/components/ui/Modal')` because `Modal` renders through `createPortal` (`claudeFallback.lifecycle.test.tsx:17-34`). Toolbar markup tests use `renderToStaticMarkup` (`quotaSettingsToolbar.test.ts`); interaction goes in lifecycle tests. Request URLs are asserted only in the API-module test, where `./client` is mocked.
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
- 2026-11-04 grill: **accepted** - the full key list comes from `clientApiKeys(config.raw)` (`access.api-keys` with the legacy top-level `api-keys` fallback) of the config the toolbar already loads, merged with `/routing/profiles` by `mergeKeyRows`; `normalizeConfigResponse` and the config store stay unchanged (Task 1, Verified facts) - decided by grill: backend `routing_profiles.go:27-41` lists only keys with a profile, `useVisualConfig.test.ts:100-108` keeps the legacy list, `config.ts:23` keeps `raw`.
- 2026-11-04 grill: **accepted** - one writer for the shared selection: `routingProfilesApi.saveSharedSelection` is dropped, and the toolbar's `subscriptionRoutingPatch` sends the whole selection and reloads the profiles after save (Tasks 1, 5, 6) - decided by grill: nothing in the plan called `saveSharedSelection`; `subscriptionRouting.ts:21-43,77-78` already writes routing fields and `useSubscriptionRouting.ts:74-79` re-reads after save.
- 2026-11-04 grill: **accepted** - `useSubscriptionRouting(disabled, profiles?)` merges the selection after both loads, stays blocked while profiles load, and reloads them after save; the parameter is optional for existing callers (Task 6) - decided by grill: `useSubscriptionRouting.ts:13,39-45,58,74-79` and callers at `settingsHooks.lifecycle.test.tsx:135,163`, `SubscriptionRouting.tsx:37`.
- 2026-11-04 grill: **accepted** - `useKeyProfiles` is created once in `QuotaSettingsBar` and shared by the toolbar, the routing hook, and the modal; `useClaudeFallback` is lifted there so the modal reuses its models and a fallback save reloads the profiles; the profiles reload when the modal opens (Task 8) - decided by grill: `QuotaSettingsToolbar.tsx:261-274` creates each hook separately and `ClaudeFallbackControl.tsx:17-33` owns its own fallback state, which would leave the shared summary stale and fetch the fallback twice.
- 2026-11-04 grill: **accepted** - the button task no longer depends on the modal: Task 6 adds the button through a `keyProfiles` prop and Task 8 wires the modal (Tasks 6, 8) - decided by grill: the old Task 5 opened a modal that existed only in the old Task 6.
- 2026-11-04 grill: **accepted** - the extracted component is `FallbackSettingsEditor` covering `ClaudeFallbackControl.tsx:131-224` (toggle, mode, hints, rows) with its own `useId`, and `withSuggestions` is exported (Task 3) - decided by grill: the old range 150-215 left the toggle, mode, and invalid hint to be rebuilt in the key editor.
- 2026-11-04 grill: **accepted** - `preferredAccountOptions` is extracted from `QuotaSettingsToolbar.tsx:125-142` into `routingModel.ts` and reused by the toolbar, the editor, and `chainSummary` (Task 2) - decided by grill: the old plan copied that logic a second and third time.
- 2026-11-04 grill: **accepted** - key labels reuse `buildApiKeyDisplayMap` with lowercased hashes instead of a new `keyLabel` (Task 2) - decided by grill: `features/monitoring/model/apiKeys.ts:18-41` already matches, masks, and sanitizes aliases.
- 2026-11-04 grill: **accepted** - one `normalizeProfile` drives the dirty check, the picker rule, and the read-back comparison (Tasks 1, 2) - decided by grill: `claudeFallback.ts:105-108` compares normalized JSON the same way.
- 2026-11-04 grill: **accepted** - alias loading moves into a shared `useApiKeyAliases` hook used by `ApiKeysCardEditor` and `useKeyProfiles`, with lowercased hashes and a connection-revision check (Task 4) - the user chose the shared hook over a third copy of `ApiKeysCardEditor.tsx:96-121`.
- 2026-11-04 grill: **accepted** - the test strategy uses `react-test-renderer`, `act`, `IS_REACT_ACT_ENVIRONMENT`, `i18n.changeLanguage('en')`, and a `Modal` mock; URLs are asserted only in the API-module test; "no raw key" is checked on `renderer.toJSON()` and rendered titles and aria labels (Testing Strategy, Tasks 1, 8) - decided by grill: `apps/web/package.json` has no Testing Library or jsdom, `Modal.tsx` uses `createPortal`, `claudeFallback.lifecycle.test.tsx:17-34` mocks it, and lifecycle tests mock API objects so they see no URLs.
- 2026-11-04 grill: **accepted** - error tests fake the real client error shape (`status`, `apiCode`, `message`) (Task 1) - decided by grill: `client.ts:61-86` and `apiError.ts:27-38`.
- 2026-11-04 grill: **accepted** - locale keys are added in the task that first renders them, and tests assert English text (Tasks 2, 6, 7, 8) - decided by grill: `quotaSettingsToolbar.test.ts:74-95` compares against `i18n.t(key)`, which returns the key itself when it is missing.
- 2026-11-04 grill: **accepted** - the editor and the modal are separate tasks, and the existing tests that break are listed: `config.test.ts`, `QuotaPage.lifecycle.test.tsx` (stub `/routing/profiles` with a 404), and the extracted-options regression in `quotaSettingsToolbar.test.ts` (Tasks 6, 7, 8) - decided by grill: one task held the modal, the editor, four locales, and the full toolbar mount; `QuotaPage.lifecycle.test.tsx` mounts the real toolbar with only two mocks.
- 2026-11-04 grill: **accepted** - line references corrected: strategy select `QuotaSettingsToolbar.tsx:78-91`, account options `:125-142`, fallback modal body `ClaudeFallbackControl.tsx:131-224`, alias guard at `components/config/ApiKeysCardEditor.tsx` - decided by grill: the files at those lines.

## Implementation Steps

### Task 1: Routing profiles API module and client key list
- [x] create `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts` with the types `SelectionSlots {primary: string; tiebreak?: string}`, `RoutingProfile {sessionAffinity; preferredAccounts: {claude?, codex?}; selection; claudeFallback: ClaudeFallbackSettings}`, and `RoutingProfilesState {supported; unsupportedBackend; shared; keys: {key, profile}[]; selectionOptions: {narrowing; pickers}}`
- [x] implement `readRoutingProfiles(raw)`, which validates and maps the kebab-case response the way `readClaudeFallback` does (reuse its fallback-settings validation), and `routingProfilesApi.get()`, which maps a 404 to `{supported: false, unsupportedBackend: true}`. `keys` holds only keys that have a profile (backend `routing_profiles.go:27-41` skips keys without one)
- [x] add the pure helper `clientApiKeys(rawConfig)`: it returns `access['api-keys']` and falls back to the legacy top-level `api-keys` when `access.api-keys` is absent (`hooks/useVisualConfig.test.ts:100-108`), keeping only non-empty strings. It reads `Config.raw` (`services/api/config.ts:23`) from the config the toolbar already loads, so `normalizeConfigResponse`, `Config`, and `useConfigStore` stay unchanged and there is no second `GET /config`
- [x] add the pure helper `mergeKeyRows(apiKeys, keys)`: one entry per client key in `access.api-keys` order with `profile: RoutingProfile | null`; profile entries for keys missing from the list are dropped
- [x] implement `keyProfilePatch(key, profile | null)` and `routingProfilesApi.saveKeyProfile`:
  - it sends one `apiClient.patch('/config', body)`, then reads `/routing/profiles` again and compares the stored value through `normalizeProfile` (Task 2), throwing "CPA did not retain the routing profile" on a mismatch;
  - it wraps every await in `guardConfigConnection()`;
  - an error with `status: 400` and `apiCode: 'unknown_api_key'` becomes `UnknownApiKeyError`, and `status: 422` with `apiCode: 'invalid_config'` becomes `InvalidRoutingConfigError` carrying the backend `message` (`client.ts:61-86`, `apiError.ts:27-38` attach `status`, `apiCode`, `message`)
- [x] the shared selection has no writer here: it is saved by the toolbar through `subscriptionRoutingPatch` (Task 6)
- [x] write tests in `routingProfiles.test.ts` with `vi.mock('./client')` as in `claudeFallback.test.ts:2-5`:
  - parsing a full response, including an omitted `preferred-accounts`;
  - `clientApiKeys` for `access.api-keys`, the legacy top-level `api-keys`, a missing list, and non-string entries;
  - `mergeKeyRows` for a key without a profile (`profile: null`) and a profile key missing from the list (dropped);
  - a full PATCH body, with a cleared provider as `null`, an empty tiebreak as `null`, and the complete `mappings` list; a reset body that is `null`;
  - every `get` and `patch` first argument, across success and error paths including the read-back, contains neither the raw key nor its `sha256Hex`
- [x] write tests for errors: a malformed response; a 404 that maps to unsupported; a 404 on PATCH is not mapped to unsupported; reject with `Object.assign(new Error('x'), {status: 400, apiCode: 'unknown_api_key'})` and with `{status: 422, apiCode: 'invalid_config', message: 'routing.key-profiles.ab12cd34ef56.selection.primary: ...'}` and assert `instanceof UnknownApiKeyError` / `InvalidRoutingConfigError` and that the message contains no raw key; a mismatch after save; a connection change that aborts
- [x] run `npx vitest run src/features/personal-quota-support/services/api/routingProfiles.test.ts` and `npm run type-check` from `apps/web` - must pass before task 2
- ➕ note: `normalizeProfile` was created in `keyProfilesModel.ts` during this task because the read-back needs it; Task 2 extends that file. `keyProfilePatch` and `saveKeyProfile` take an optional third `selectionOptions` argument so a picker primary sends `tiebreak: null`; `readFallbackSettings` was extracted from `readClaudeFallback` and is shared by both readers

### Task 2: Key profiles model and shared preferred-account options
- [x] create `apps/web/src/features/quota/keyProfilesModel.ts` with `normalizeProfile(profile, selectionOptions)`: it drops the tiebreak when the primary is a picker, trims mappings through `normalizeFallbackSettings` (`claudeFallback.ts`), and drops empty preferred entries. `profileDirty(a, b)` compares `JSON.stringify(normalizeProfile(...))` of both, and the Task 1 read-back uses the same function. Keep any picker check private to this module
- [x] add `copyOfShared(shared)` (a deep copy) and `buildKeyRows(rows, aliases)`, which takes labels from `buildApiKeyDisplayMap(apiKeys, aliases)` (`features/monitoring/model/apiKeys.ts:18-41`, matched by `sha256Hex(key).toLowerCase()`); it never puts `copyValue` or the raw key into a row's display fields
- [x] extract `preferredAccountOptions(provider, files, selected, displayName, t)` from `QuotaSettingsToolbar.tsx:125-142` into `routingModel.ts` (provider filter, automatic, disabled suffix, missing-account entry) and make the toolbar use it with unchanged output
- [x] add `chainSummary(profile, files, showEmails, t)`: sticky or no sticky, Claude and Codex accounts resolved through the same lookup as `preferredAccountOptions` (automatic, a display name masked with `maskQuotaName` when emails are hidden, or a missing account), `primary → tiebreak`, and the fallback state and mode
- [x] add the `quota_management.key_profiles.summary.*` keys used by `chainSummary` to `en.json`, `ru.json`, `zh-CN.json`, and `zh-TW.json`
- [x] write tests in `keyProfilesModel.test.ts`: `normalizeProfile` and `profileDirty` (picker drops tiebreak, trimmed mappings, empty preferences), a deep `copyOfShared` (mutating the copy leaves the source unchanged), `buildKeyRows` with and without an alias and with an alias for an unknown hash, and `chainSummary` with emails shown and hidden, a missing account, and every fallback state; assert English text after `i18n.changeLanguage('en')`, not `i18n.t(key)` against itself
- [x] keep `quotaSettingsToolbar.test.ts` passing unchanged as the regression check for the extracted options, and add a `preferredAccountOptions` unit test for the disabled and missing-account cases
- [x] run the focused tests, `npm run type-check`, and `npm run lint` - must pass before task 3
- ➕ note: `providerAccountFiles(provider, files)` was also extracted into `routingModel.ts` because the toolbar still needs the provider's files for the last-selected activity; `buildKeyRows` returns `{key, profile, label, masked, hasAlias}` and falls back to the mask when an alias repeats the raw key; `chainSummary` reuses the `quota_management.routing.automatic` and `missing_account` labels through `preferredAccountOptions` and shows slot ids (`reserves → round-robin`) as written in the config

### Task 3: Extract FallbackSettingsEditor
- [x] create `apps/web/src/features/quota/components/FallbackSettingsEditor.tsx` from the modal body of `ClaudeFallbackControl.tsx:131-224`: the enabled toggle, the mode select, the hints, the datalists, the mapping rows, the add button, and the invalid hint. Props: `{value: ClaudeFallbackSettings; models: {claude, codex}; disabled; onChange}`. The component calls its own `useId` so two open editors never share datalist ids
- [x] export `withSuggestions` (`ClaudeFallbackControl.tsx:48-53`) from `claudeFallback.ts` so both editors fill an empty mapping list the same way
- [x] make `ClaudeFallbackControl` render `FallbackSettingsEditor` inside its modal with no change in behavior, aria labels, or placeholders
- [x] keep `claudeFallback.lifecycle.test.tsx` passing unchanged as the regression check
- [x] write `FallbackSettingsEditor.test.tsx` limited to the `disabled` prop, the `onChange` contract, and distinct datalist ids for two instances, using `react-test-renderer` and `act`
- [x] run the focused tests, `npm run type-check`, and `npm run lint` - must pass before task 4

### Task 4: Shared useApiKeyAliases hook
- [x] create `apps/web/src/hooks/useApiKeyAliases.ts` from the alias loading in `components/config/ApiKeysCardEditor.tsx:96-156`: `usePanelFeatureAvailability`, `useAuthStore` `managementKey`, the `panelHostMode === 'manager_embedded'` check, and `usageServiceApi.getApiKeyAliases`. It returns `{aliases, available, loading, reload}`, lowercases `apiKeyHash`, and drops a result that arrives after the quota connection revision changed
- [x] make `ApiKeysCardEditor` use the hook with unchanged behavior; its alias save path stays where it is
- [x] keep `components/config/ApiKeysCardEditor.test.tsx` passing unchanged as the regression check
- [x] write `useApiKeyAliases.test.tsx` mocking `@/hooks/usePanelFeatureAvailability` and `@/services/api/usageService` as in `ApiKeysCardEditor.test.tsx:45-60`: aliases load when hosted by the manager; a non-manager host does not call `getApiKeyAliases` and reports unavailable; a failure reports unavailable without throwing; a result after a connection change is ignored
- [x] run the focused tests, `npm run type-check`, and `npm run lint` - must pass before task 5
- ➕ note: the hook also returns `replaceAliases(items)` and `removeAlias(hash)` so the editor's save and delete paths keep updating the list locally as before; `resolveAliasServiceBase(availability)` is exported and shared by the hook and the editor's save path

### Task 5: useKeyProfiles hook
- [x] create `apps/web/src/features/quota/hooks/useKeyProfiles.ts`: load `routingProfilesApi.get()`, take the client keys from `clientApiKeys(config.raw)` of `useConfigStore.fetchConfig()`, and take aliases from `useApiKeyAliases`; build the rows with `mergeKeyRows` and `buildKeyRows`; when aliases are unavailable, keys are shown masked
- [x] expose `{state, rows, count, total, loading, saving, error, reload, saveKeyProfile(key, profile | null)}`; follow `useClaudeFallback.ts` for the connection-revision and mounted guards; after an `UnknownApiKeyError`, reload and set the "key was removed on the Config page" error
- [x] write `useKeyProfiles.lifecycle.test.tsx` with `react-test-renderer`, `act`, `IS_REACT_ACT_ENVIRONMENT`, and `i18n.changeLanguage('en')` as in `claudeFallback.lifecycle.test.tsx:17-34`, mocking `routingProfilesApi`, the config store, and `useApiKeyAliases`: the load with N/M counts; a key save that replaces the state with the read-back result; a reset to shared that sends `null`
- [x] write tests for errors: a 404 gives unsupported; unavailable aliases leave the masks in place; a 400 reloads and sets its message; a 422 shows the backend message; a connection change discards stale results
- [x] run the focused tests and `npm run type-check` - must pass before task 6
- ➕ note: the test file is `features/quota/useKeyProfiles.lifecycle.test.tsx`. The first load reads the cached config and later reloads force it, so keys added or removed on the Config page appear. A save error survives the reload it triggers and is cleared by the next save or by `reload()`. A failed read-back reloads the stored state, but a 422 does not because the file is unchanged. The new locale key is `quota_management.key_profiles.errors.unknown_key`

### Task 6: Shared selection slots and the Keys button in the toolbar
- [x] change the hook to `useSubscriptionRouting(disabled, profiles?: {supported, selection, loading, reload})`; the parameter is optional so `SubscriptionRouting.tsx:37` and the existing `settingsHooks.lifecycle.test.tsx:135,163` calls still compile. Merge `selection` into both `values` and `baseline` only after the config and the profiles have loaded, keep `blocked` true while the profiles are loading, and after a save call `profiles.reload()` in addition to the existing config re-read (`useSubscriptionRouting.ts:74-79`)
- [x] extend `SubscriptionRoutingSettings` and `subscriptionRoutingPatch` (`subscriptionRouting.ts:21-43`) with an optional `selection`: when it changed, the patch sends the whole `{primary, tiebreak: tiebreak ?? null}` because PATCH merges objects; `strategy` is left untouched when profiles are supported. `routingFormState` (`routingModel.ts:34`) already derives dirty from the patch and stays unchanged
- [x] in `QuotaSettingsToolbar.tsx:78-91`: render the primary and tiebreak selects built from `selection_options` when profiles are supported, disable the tiebreak with a hint when the primary is a picker, and otherwise render the legacy strategy select exactly as today; add the styles in `QuotaSettingsToolbar.module.scss`
- [x] add the "Ключи N/M" button through a `keyProfiles?: {count, total, hidden, disabled, onOpen}` toolbar prop; the modal itself is wired in Task 8
- [x] add the `quota_management.routing.*` and `quota_management.key_profiles.button*` keys used by this task to all four locale files
- [x] update `config.test.ts` routing expectations if `readSubscriptionRouting` gains `selection`, and stub `routingProfilesApi.get` with a 404 in `QuotaPage.lifecycle.test.tsx` `beforeEach` so the page tests stay offline and keep the legacy select
- [x] write tests: in `settingsHooks.lifecycle.test.tsx`, a supporting backend loads the selection after both loads, a slot change marks the form dirty, saving sends the full `routing.selection` and calls `profiles.reload`, a picker primary sends `tiebreak: null`, and without profiles the legacy select still writes `routing.strategy`; in `quotaSettingsToolbar.test.ts` (static markup), two slots with a disabled tiebreak for a picker primary, the legacy select on 404, and the button hidden, disabled, and showing N/M; a `subscriptionRoutingPatch` test proves a selection change makes `routingFormState` dirty
- [x] run the focused tests, `npm run type-check`, and `npm run lint` - must pass before task 7
- ➕ note: the `profiles` parameter also carries `selectionOptions`, and its `supported` means the backend serves `/routing/profiles` (Task 8 passes `!unsupportedBackend`). The hook keeps the last loaded shared selection while the profiles reload and replaces the slot draft only when the stored selection changes, so a key-profile reload keeps an unsaved toolbar edit. The picker check moved to `routingModel.ts` as `isPickerSlot` (used by `normalizeProfile`), with `withPickerRule` and `selectionSlotOptions`. `readSubscriptionRouting` did not gain `selection`, so `config.test.ts` needed no change; the patch tests are in `quotaSettingsHooks.test.ts`

### Task 7: KeyProfileEditor
- [ ] create `KeyProfileEditor.tsx` with props `{profile: RoutingProfile | null; shared; files; showEmails; selectionOptions; models; saving; readOnly; onSave(profile | null); onCancel}`:
  - the segmented "Общие настройки / Свой профиль" switch; switching to "Свой профиль" seeds a draft with `copyOfShared`;
  - the four stages: a sticky toggle with the global TTL as text, Claude and Codex selects from `preferredAccountOptions`, primary and tiebreak selects with the picker rule, and `FallbackSettingsEditor`;
  - a footer with the draft's `chainSummary`, Cancel, and Save; Save is disabled when `profileDirty` is false or the fallback settings are invalid; choosing "Общие настройки" and saving calls `onSave(null)`;
  - `readOnly` disables every control and shows the explanation
- [ ] add the editor's `quota_management.key_profiles.*` keys to all four locale files
- [ ] write `KeyProfileEditor.test.tsx` with a `react-test-renderer` harness and props: seeding from `copyOfShared`, the picker rule, the missing-account label, Save disabled when clean or invalid, `onSave` with the full draft, `onSave(null)` for "Общие настройки", and the read-only state
- [ ] run the focused tests, `npm run type-check`, and `npm run lint` - must pass before task 8

### Task 8: KeyProfilesModal and QuotaSettingsBar wiring
- [ ] create `KeyProfilesModal.tsx`: a read-only shared-profile summary at the top; one row per key with its label, masked key, badge, chain summary, and an Edit or Collapse button; one expanded `KeyProfileEditor` at a time; loading, error, and read-only (`supported: false`) states
- [ ] in `QuotaSettingsBar` (`QuotaSettingsToolbar.tsx:258-276`): call `useKeyProfiles(disabled)` once and pass it to `useSubscriptionRouting` (selection), the toolbar button (count, total, hidden on an unsupported backend), and the modal; lift `useClaudeFallback` into `QuotaSettingsBar` and pass it to `ClaudeFallbackControl`, so the modal takes `models` from it without a second request and a successful fallback save calls `keyProfiles.reload()`; reload the profiles when the modal opens
- [ ] add the remaining `quota_management.key_profiles.*` keys to all four locale files
- [ ] write `keyProfiles.lifecycle.test.tsx` with `vi.mock('@/components/ui/Modal')` as in `claudeFallback.lifecycle.test.tsx:17-34` and `useKeyProfiles` mocked: the button `onOpen` opens the modal; rows, badges, and summaries render; editing and saving calls `saveKeyProfile` with the draft; a reset calls it with `null`; a fallback save triggers `reload`
- [ ] write tests for errors: read-only when `supported` is false; the 400 and 422 messages; account names masked when emails are hidden; `JSON.stringify(renderer.toJSON())` and every rendered `title` and `aria-label` never contain the raw key
- [ ] keep `claudeFallback.lifecycle.test.tsx` and `QuotaPage.lifecycle.test.tsx` passing
- [ ] run the focused tests, `npm run type-check`, and `npm run lint` - must pass before task 9

### Task 9: Verify acceptance criteria
- [ ] verify every Overview requirement: the two toolbar slots, the "Ключи N/M" button and modal, creating, editing, and resetting with read-back, the unchanged behavior on a 404 backend, and that no raw key appears in rendered output or request URLs
- [ ] verify edge cases: no client keys, a v8 config with only the legacy top-level `api-keys`, a key without an alias, a missing preferred account, the backend reporting `supported: false`, a disconnected panel, and a connection change during a save
- [ ] run from `apps/web`: `npm test`, `npm run type-check`, `npm run lint`, and `VERSION=0.0.0-plan npm run build` - all must pass
- [ ] confirm that `routingProfiles.ts`, `keyProfilesModel.ts`, `useApiKeyAliases.ts`, and `useKeyProfiles.ts` have tests covering their branches

### Task 10: [Final] Update documentation
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

  A reset is `{"routing": {"key-profiles": {"<raw key>": null}}}`. The toolbar sends the shared selection whole, `{"routing": {"selection": {"primary": "reserves", "tiebreak": null}}}`, because PATCH merges objects.
- **Read-back**: after a key-profile write, `GET /routing/profiles`; the saved key's profile, or its absence, must equal the draft under `normalizeProfile`, otherwise the save fails with "CPA did not retain the routing profile". The shared selection is saved by the toolbar, which re-reads the config and reloads the profiles.
- **Errors**: 400 `unknown_api_key` -> reload and "key was removed on the Config page"; 422 -> the backend message, which is safe because it carries only a hash prefix; a 404 on GET -> the unsupported backend path.
- **Counter**: N = the number of keys with their own profile and M = the number of client keys from `clientApiKeys(config.raw)` (`access.api-keys`, or the legacy top-level `api-keys`). A key without a profile is listed with the shared profile's summary and the badge "Общие настройки". `/routing/profiles` returns entries only for keys with a profile.
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
