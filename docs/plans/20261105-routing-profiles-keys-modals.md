# Quota toolbar: separate Profiles and Keys modals with key add and delete

## Overview
- After the per-key routing profiles UI was deployed, the user found the Quota toolbar overloaded and the "Keys 0/2" button unclear. Profile creation and the default profile must sit behind one button, and client keys together with the per-key profile choice behind another.
- On a backend that serves `/routing/profiles`, the toolbar keeps only Codex Fast mode, the per-provider "last routed" indicators, a **Профили** button and a **Ключи · N** button (N = number of client keys).
- **Профили** opens `RoutingProfilesModal`: the default (shared) profile, which includes the global sticky TTL, and every key that has its own profile. From there a profile can be created for a key, edited, or reset to the default.
- **Ключи** opens `ClientKeysModal`: one row per client key with a "По умолчанию / Свой профиль" select, "Настроить…" for keys with their own profile, and "Удалить". An add form at the bottom creates keys, with generate, copy and optional alias. Choosing "Свой профиль" opens the Profiles modal on a draft for that key.
- UI only. The CPA backend (CLIProxyAPI-migration `ced98b16`) and the manager server are unchanged.

## Decisions
- **Context**: user feedback after deploying `per-key-routing-profiles-ui`:
  1. add and delete client API keys directly in the keys modal;
  2. "Keys 0/2" is unclear;
  3. profile creation and the default profile go behind one button;
  4. keys and the per-key profile select go behind another, and a custom profile is reached through a button that opens the profiles modal.
- **Direction chosen by the user**: rearrange the UI only. Profiles stay bound to a single key (`routing.key-profiles: <raw key> → RoutingProfile`). There are no named reusable profiles.
- **Chosen approach**:
  - **Toolbar**, on a capable backend:
    - Keeps Fast mode, the last-routed indicators (`QuotaSettingsToolbar.tsx:196-243`), Профили and Ключи · N.
    - Moves out: the selection slots, the Session Affinity toggle, the TTL input, the preferred-account selects, the Claude → Codex fallback toggle and gear (`ClaudeFallbackControl`), and the toolbar Save.
    - On a 404 backend the toolbar stays exactly as it is today: legacy strategy select, Save, fallback control, no Профили button. Ключи still opens, for adding and deleting keys only.
  - **`KeyProfileEditor`** becomes a pure single-profile editor with variant `default` (TTL editable) or `key` (TTL shown as text). It has no shared/own mode switch; resetting a profile is the caller's action.
  - **`RoutingProfilesModal`**:
    - a "По умолчанию" row;
    - one row per key with its own profile, offering Изменить and Сбросить на умолчание (confirm, then a `null` PATCH);
    - "+ Профиль для ключа", which picks among keys on the default and starts a draft from `copyOfShared`;
    - only one editor open at a time;
    - an optional `focus {key, draft}`, and "← К ключам" when opened from the Keys modal.
  - **Default profile save**: `saveSharedProfile(profile, ttl)` sends one `PATCH /config` with `routing.{selection, session-affinity, session-affinity-ttl, preferred-accounts, claude-fallback}`, reads it back and compares. On a capable backend, `useSubscriptionRouting` and `useClaudeFallback` no longer write the shared profile, so it has a single writer.
  - **`ClientKeysModal`**:
    - rows with alias or mask, the select, a chain summary, Настроить… and Удалить;
    - an add form: key input, Сгенерировать, Копировать, alias, Добавить.
  - **`clientKeys.ts` service**:
    - `addClientKey`: fresh `/api-keys` list, duplicate check, `PUT` of the new list, then the alias.
    - `removeClientKey`: fresh list, refuse the last key, `PUT` without the key, then delete its alias.
    - After every key operation, config and profiles reload.
  - **Navigation**: a single state `{open: 'keys' | 'profiles' | null, focus}` in `QuotaSettingsBar`. Only one modal is shown at a time.
- **Rejected alternatives** (not judged by the user; open to critique):
  - named reusable profiles in the backend;
  - keeping the shared profile in the toolbar;
  - an inline editor in key rows;
  - nested modals;
  - reusing ConfigPage's `persistApiKeyMutation`;
  - two writers for the shared profile.
- **Verified facts**:
  - **Backend.** `GET /v8/management/routing/profiles` returns `{supported, shared, keys, selection_options}`, and `keys` lists only keys with a profile (backend `routing_profiles.go:18-56`). `PATCH /v8/management/config` merges objects, and `null` deletes. The api-keys `PUT`/`PATCH`/`DELETE` handlers reconcile `routing.key-profiles` under one lock: a removed key loses its profile, and a one-for-one swap moves it (`config_lists.go:150-180`, `routing_profiles.go:59-98`).
  - **`RoutingProfile`** is `{sessionAffinity, preferredAccounts, selection, claudeFallback}`. The TTL is global, read from `routing['session-affinity-ttl']` (`services/api/config.ts:27`) and written in `subscriptionRouting.ts:49`.
  - **Raw key in URLs.** `apiKeysApi.deleteValue` puts the raw key in the URL (`services/api/apiKeys.ts:52`), so it must not be used.
  - **Key helpers.** ApiKeysCardEditor generates keys with `crypto.getRandomValues` (`components/config/ApiKeysCardEditor.tsx:113`). Aliases are stored by key hash through `usageServiceApi.getApiKeyAliases` / `saveApiKeyAliases` (`services/api/usageService.ts:3306-3360`), on the base from `resolveAliasServiceBase` (`hooks/useApiKeyAliases.ts`).
  - **Live config.** 2 client keys, no key profiles.
  - **Tests** use vitest with react-test-renderer; there is no Testing Library and no jsdom. `Modal` uses `createPortal`, so tests mock it. `apiClient` errors carry `status`, `apiCode` and `message`.

## Context (from discovery)
- **Files and components involved**:
  - `features/quota/components/`: `QuotaSettingsToolbar.tsx` (392 lines; `QuotaSettingsBar` at :323), `KeyProfilesModal.tsx` (194), `KeyProfileEditor.tsx` (278), `ClaudeFallbackControl.tsx` (142), `FallbackSettingsEditor.tsx`, `Select.tsx`, `ProviderPill.tsx`
  - `features/quota/hooks/`: `useKeyProfiles.ts`, `useSubscriptionRouting.ts`, `useClaudeFallback.ts`
  - `features/quota/keyProfilesModel.ts`: `normalizeProfile`, `copyOfShared`, `profileDirty`, `chainSummary`, `buildKeyRows`
  - `features/quota/routingModel.ts`: `preferredAccountOptions`, `selectionSlotOptions`, `isPickerSlot`
  - `features/personal-quota-support/services/api/`: `routingProfiles.ts` (`saveKeyProfile`, `keyProfilePatch`, `clientApiKeys`, error classes), `subscriptionRouting.ts`, `claudeFallback.ts`, `config.ts`
  - `services/api/apiKeys.ts`, `services/api/usageService.ts`, `hooks/useApiKeyAliases.ts`
  - locales `i18n/locales/{en,ru,zh-CN,zh-TW}.json` (`quota_management.key_profiles.*`)
  - `docs/personal-quota.md`
- **Existing tests to update**:
  - `features/quota/keyProfiles.lifecycle.test.tsx`
  - `features/quota/useKeyProfiles.lifecycle.test.tsx`
  - `features/quota/components/KeyProfileEditor.test.tsx`
  - `features/quota/quotaSettingsToolbar.test.ts`
  - `features/quota/QuotaPage.lifecycle.test.tsx`, which stubs `/routing/profiles` with a 404
  - `features/quota/claudeFallback.lifecycle.test.tsx`
  - `features/quota/settingsHooks.lifecycle.test.tsx`
  - `features/quota/quotaSettingsHooks.test.ts`
- **Patterns**:
  - Wrap every await in `guardConfigConnection()`.
  - After a write, read the result back and compare it through `normalizeProfile`.
  - On a 400 `unknown_api_key`, reload; on a 422 `invalid_config`, show the backend message.

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
- Maintain backward compatibility (404 backend keeps today's toolbar)

## Testing Strategy
- **Unit tests**: required for every task. They use vitest with react-test-renderer and mock `Modal`'s portal as the existing quota tests do.
- **Security assertions**: a raw key must never appear in rendered output, titles, aria labels or request URLs. The only exception is the add-form input value before the key is submitted.
- **E2E**: the project has no UI e2e suite for the Quota page; no e2e work.

## Validation Commands
Run from the repository root:
- `npm run type-check`
- `npm run lint`
- `npm run test:web`

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code changes, tests, documentation in this repo
- **Post-Completion** (no checkboxes): deploy and live checks

## Decision Log
- 2026-11-05 brainstorm: **accepted**: toolbar contents.
  - Chosen: Fast mode, the last-routed indicators, Профили and Ключи · N. The shared-profile controls leave the toolbar.
  - Evidence: user request; `QuotaSettingsToolbar.tsx:95-300`. The indicator reports state rather than a setting (`:196-243`).
- 2026-11-05 brainstorm: **accepted**: labels.
  - Chosen: "Ключи · N" counts all client keys, and "Профили" has no counter.
  - Evidence: the user found "Keys 0/2" unclear.
- 2026-11-05 brainstorm: **accepted**: Profiles modal.
  - Chosen: the default row plus rows for keys with their own profile, with Изменить, Сбросить and "+ Профиль для ключа"; one editor open at a time.
  - Evidence: user request.
- 2026-11-05 brainstorm: **accepted**: default profile save.
  - Chosen: one `PATCH /config` with read-back, through a single writer.
  - Evidence: the `saveKeyProfile` pattern in `routingProfiles.ts:227-250`.
- 2026-11-05 brainstorm: **accepted**: Keys modal row.
  - Chosen: the По умолчанию / Свой профиль select, Настроить… and Удалить.
  - Evidence: user request.
- 2026-11-05 brainstorm: **accepted**: navigation.
  - Chosen: Свой профиль opens the Profiles modal on a draft. Only one modal is shown at a time, with "← К ключам" to go back.
  - Evidence: `Modal` renders through `createPortal`, and the codebase has no nested-modal pattern.
- 2026-11-05 brainstorm: **accepted**: adding a key.
  - Chosen: a form with generate, copy and alias. The write is a fresh list, a duplicate check, then `PUT /api-keys`.
  - Evidence: `ApiKeysCardEditor.tsx:113`. ConfigPage's mutation is coupled to the source-editor dirty state (`ConfigPage.tsx:636-650`).
- 2026-11-05 brainstorm: **accepted**: raw key visibility.
  - Chosen: the raw key is visible only in the add-form input before submission.
  - Evidence: the standing constraint that raw keys never appear in URLs, logs or rendered UI.
- 2026-11-05 brainstorm: **accepted**: deleting a key.
  - Chosen: confirm, read a fresh list, `PUT` it without the key, then delete the alias. The backend drops the key's profile. The last key cannot be deleted.
  - Evidence: `apiKeys.ts:52` (`deleteValue` puts the raw key in the URL); `config_lists.go:170` → `reconcileKeyProfiles`.
- 2026-11-05 brainstorm: **accepted**: 404 backend.
  - Chosen: the legacy toolbar stays unchanged and there is no Профили button. Ключи offers adding and deleting only.
  - Evidence: the 404 stub in `QuotaPage.lifecycle.test.tsx`.
- 2026-11-05 brainstorm: **accepted**: `KeyProfileEditor`.
  - Chosen: a pure editor with no mode switch; the `default` variant has an editable TTL.
  - Evidence: `KeyProfileEditor.tsx:32-75`.

## Implementation Steps

### Task 1: Client key service
- [ ] create `features/personal-quota-support/services/api/clientKeys.ts` with `addClientKey(key, alias?, aliasContext?)`:
  - trim the key and reject an empty one;
  - read a fresh `apiKeysApi.list()`;
  - throw `DuplicateClientKeyError` when the key already exists;
  - `apiKeysApi.replace([...keys, key])`;
  - when an alias is given and the alias service base is available, read the current aliases and save them with the new `{apiKeyHash, alias}` entry, the way `ApiKeysCardEditor` does;
  - a failed alias write is reported separately (`AliasWriteError`) and does not roll back the key
- [ ] add `removeClientKey(key, aliasContext?)`:
  - read a fresh list;
  - throw `LastClientKeyError` when the key is the only one, and `UnknownApiKeyError` when it is missing;
  - `apiKeysApi.replace(list without the key)`;
  - delete the alias entry by key hash when the service is available.
  - Never call `apiKeysApi.deleteValue` or delete by index.
- [ ] wrap a network error from the `PUT` as `ClientKeyOutcomeUnknownError`, so the caller reloads the list. Wrap every await in `guardConfigConnection()`
- [ ] add `generateClientKey()`, reusing or extracting the generator from `ApiKeysCardEditor.tsx:113` without duplicating it, and point `ApiKeysCardEditor` at the shared helper
- [ ] write tests in `clientKeys.test.ts` with `vi.mock` on the API clients:
  - the `PUT` body after an add, and after a remove;
  - a duplicate add;
  - removing the last key;
  - removing an unknown key;
  - an alias written and an alias deleted;
  - an alias failure that keeps the key;
  - an unknown `PUT` outcome;
  - no raw key in any request URL
- [ ] run `npm run test:web`; it must pass before Task 2

### Task 2: Shared profile writer
- [ ] add `sharedProfilePatch(profile, ttl, selectionOptions)` and `routingProfilesApi.saveSharedProfile(profile, ttl, selectionOptions)` to `routingProfiles.ts`:
  - one `apiClient.patch('/config', {routing: {selection: {primary, tiebreak|null}, 'session-affinity', 'session-affinity-ttl', 'preferred-accounts': {claude|null, codex|null}, 'claude-fallback': {...complete}}})`;
  - a picker primary sends `tiebreak: null` (reuse the `keyProfilePatch` field mapping);
  - read back `/routing/profiles` and compare `shared` through `normalizeProfile`;
  - read back config for the TTL;
  - throw "CPA did not retain the routing profile" on a mismatch, and `InvalidRoutingConfigError` on a 422
- [ ] extract the routing-profile-to-kebab-case body mapping shared by `keyProfilePatch` and `sharedProfilePatch` into one helper
- [ ] write tests:
  - the full PATCH body;
  - a cleared preferred account sent as `null`;
  - a picker primary sending `tiebreak: null`;
  - an empty TTL handled as the current `subscriptionRoutingPatch` does;
  - a successful read-back;
  - a mismatch;
  - a 422 carrying the backend message
- [ ] run `npm run test:web`; it must pass before Task 3

### Task 3: KeyProfileEditor as a pure profile editor
- [ ] change `KeyProfileEditor.tsx` props to `{value, baseline, variant: 'default' | 'key', ttl?, files, showEmails, selectionOptions, models, saving, readOnly, onSave(profile, ttl?), onCancel}`. Remove the shared/own `mode` switch and its locale usage
- [ ] variant `default` adds an editable TTL field, validated the way the toolbar validates the TTL today (`invalidTTL` in `QuotaSettingsToolbar.tsx`). Variant `key` shows the TTL as text, as `sessionAffinityTTL` does now
- [ ] keep the existing behavior:
  - the dirty check against `baseline`;
  - `withSuggestions` applied to both the draft and the baseline;
  - the chain summary;
  - picker rule on the tiebreak slot;
  - the read-only hint when `supported: false`.
  
  A new key draft counts as dirty even when it equals the baseline, controlled by a `isNew` prop
- [ ] update `KeyProfileEditor.test.tsx`:
  - both variants;
  - TTL validation and the TTL save argument;
  - a new draft counting as dirty;
  - read-only mode;
  - no mode switch rendered
- [ ] run `npm run test:web`; it must pass before Task 4

### Task 4: useKeyProfiles state for both modals
- [ ] extend `features/quota/hooks/useKeyProfiles.ts`:
  - `saveShared(profile, ttl)`, which calls `saveSharedProfile` and then reloads profiles and config;
  - `addKey(key, alias?)` and `removeKey(key)` through `clientKeys.ts`, each followed by a forced config reload (key list) and a profiles reload;
  - `keyCount`, the total number of client keys;
  - per-row `label`/`masked` from `buildKeyRows`, unchanged
- [ ] error mapping:
  - duplicate, last-key, unknown-outcome and alias-failure errors become localized messages;
  - on an unknown outcome, reload the list;
  - keep the existing 400/422 handling;
  - a save error survives the reload it triggers (current behavior)
- [ ] connection-revision guard on every new path, as in the current hook
- [ ] update `useKeyProfiles.lifecycle.test.tsx`:
  - a shared save followed by a reload;
  - adding a key, then the reload;
  - removing a key, then the reload, with the removed key's profile row gone;
  - error messages for each error class;
  - a stale result dropped after a connection change
- [ ] run `npm run test:web`; it must pass before Task 5

### Task 5: RoutingProfilesModal
- [ ] create `features/quota/components/RoutingProfilesModal.tsx` with its SCSS module, built on the existing `Modal`. The modal shows:
  - a "По умолчанию" row with `chainSummary(shared)` and Изменить, which opens the editor in variant `default` with the current TTL and saves through `saveShared`;
  - one row per key with its own profile: alias or mask, an "Свой профиль" badge, the summary, Изменить (editor variant `key`) and Сбросить на умолчание (confirmation via `showConfirmation`, then `saveKeyProfile(key, null)`)
- [ ] "+ Профиль для ключа": a `Select` of keys on the default, by alias or mask, then an editor on `copyOfShared(shared)` with `isNew`. Hide the control when every key has a profile
- [ ] props `focus?: {key: string; draft: boolean}` (open that key's editor directly; `draft` starts from `copyOfShared`) and `onBackToKeys?: () => void`, which renders "← К ключам"
- [ ] only one editor is open at a time. Edit stays disabled while profiles reload unless that editor is already open (carry over the fix from `c172d749`)
- [ ] with `supported: false`, the modal is read-only: no Сбросить and no "+"
- [ ] write tests in `routingProfilesModal.lifecycle.test.tsx`:
  - the default row saves through one PATCH;
  - a key row is edited and saved;
  - a reset is confirmed and sends a `null` PATCH;
  - "+" creates a profile for the picked key;
  - `focus` with a draft whose Cancel writes nothing;
  - the back button;
  - read-only mode;
  - Edit is disabled during a reload;
  - no raw key in the output, titles or aria labels
- [ ] run `npm run test:web`; it must pass before Task 6

### Task 6: ClientKeysModal
- [ ] create `features/quota/components/ClientKeysModal.tsx` with its SCSS module. Each row has:
  - the alias or mask;
  - a `Select` with По умолчанию / Свой профиль (hidden on a 404 backend);
  - the chain summary;
  - Настроить… when the key has its own profile;
  - Удалить, with confirmation, disabled with a hint when it is the only key
- [ ] select behavior:
  - choosing "Свой профиль" for a key on the default calls `onOpenProfiles({key, draft: true})` and writes nothing;
  - choosing "По умолчанию" for a key with its own profile confirms, then sends `saveKeyProfile(key, null)`;
  - Настроить… calls `onOpenProfiles({key, draft: false})`
- [ ] add form:
  - a key input (type `password`, with a show toggle);
  - Сгенерировать, which fills it with `generateClientKey()`;
  - Копировать, through `navigator.clipboard.writeText`, with a fallback message when the clipboard is unavailable;
  - an optional alias input, disabled when the alias service is unavailable;
  - Добавить, which calls `addKey` and clears both inputs on success.
  
  The raw key appears only in this input
- [ ] empty state (no client keys) shows the add form and a hint. Errors from the hook appear in a `role="alert"` block, masked as the current modal does
- [ ] write tests in `clientKeysModal.lifecycle.test.tsx`:
  - rows render with alias or mask;
  - adding sends the `PUT` body and clears the inputs;
  - generate fills the input;
  - copy calls the clipboard;
  - a duplicate error;
  - deleting confirms and sends the `PUT` body;
  - the last key cannot be deleted;
  - "Свой профиль" calls `onOpenProfiles` with a draft and makes no request;
  - "По умолчанию" sends a `null` PATCH after confirmation;
  - the 404 variant has no select;
  - no raw key in the output, titles, aria labels or URLs once the key is added
- [ ] run `npm run test:web`; it must pass before Task 7

### Task 7: Toolbar slim-down and modal navigation
- [ ] in `QuotaSettingsToolbar.tsx`, when `profiles.supported` (the backend serves `/routing/profiles`), render only:
  - Codex Fast mode;
  - the last-routed indicators: a `ProviderPill` and the time per provider, with the account in the title, reusing `latestSubscriptionActivity`;
  - a **Профили** button;
  - a **Ключи · N** button.
  
  Do not render the selection slots, sticky toggle, TTL, preferred selects, `fallbackControl` or the toolbar Save. The 404 path renders today's legacy toolbar unchanged, plus a Ключи · N button
- [ ] in `QuotaSettingsBar`:
  - one navigation state `{open: 'keys' | 'profiles' | null, focus}`;
  - opening either modal reloads the profiles, as the Keys modal does now;
  - Keys → Профили via `onOpenProfiles`, and Профили → Keys via `onBackToKeys`;
  - delete `KeyProfilesModal.tsx` and its SCSS once nothing imports them
- [ ] single writer: on a capable backend, `useSubscriptionRouting` and `useClaudeFallback` are not used to save the shared profile. Keep them for the 404 legacy path and for activity and fallback models data. Remove `useClaudeFallback`'s `onSaved` wiring if it becomes unused
- [ ] update tests:
  - `quotaSettingsToolbar.test.ts` / `keyProfiles.lifecycle.test.tsx`: the slim toolbar on a capable backend; the button labels "Ключи · 2" and "Профили"; the navigation between modals;
  - `QuotaPage.lifecycle.test.tsx`: the legacy toolbar plus Ключи on a 404;
  - `claudeFallback.lifecycle.test.tsx` and `settingsHooks.lifecycle.test.tsx`: adjust to the moved controls
- [ ] run `npm run test:web`; it must pass before Task 8

### Task 8: Locales
- [ ] add the new keys under `quota_management.key_profiles.*` (or a sibling `quota_management.client_keys.*`) in `en`, `ru`, `zh-CN` and `zh-TW`:
  - the button labels "Профили" and "Ключи · {{count}}";
  - the modal titles;
  - По умолчанию / Свой профиль;
  - Настроить…, Сбросить на умолчание and its confirmation;
  - "+ Профиль для ключа", "← К ключам";
  - the add form labels;
  - the generate, copy and copied messages;
  - the delete confirmation;
  - the last-key hint;
  - the duplicate, unknown-outcome and alias-failure errors
- [ ] remove the keys that are no longer used (`button`, `button_hint` with `{{count}}/{{total}}`, `editor.mode*`, `editor.shared_hint`). Run the existing locale parity test, if there is one, or check that all four files have the same key set
- [ ] write or extend the locale key parity test for the new keys
- [ ] run `npm run test:web`; it must pass before Task 9

### Task 9: Verify acceptance criteria
- [ ] verify the Overview requirements:
  - the slim toolbar on a capable backend;
  - both modals and the navigation between them;
  - adding and deleting keys;
  - the default and key profile writes go through one PATCH each, with read-back;
  - the 404 path is unchanged
- [ ] verify the edge cases: the last key, a duplicate, an unknown outcome, an alias failure, a reload during editing, `supported: false`, and no client keys
- [ ] grep the new components and tests for raw-key leaks (rendered output, titles, aria labels, URLs)
- [ ] run `npm run type-check`, `npm run lint` and `npm run test:web`. All must pass, with no new lint warnings

### Task 10: [Final] Update documentation
- [ ] update `docs/personal-quota.md`:
  - the toolbar now holds Fast mode, the indicators, Профили and Ключи;
  - the Profiles modal (default + key profiles);
  - the Keys modal (select, add with generate, copy and alias, delete with the last-key rule);
  - the 404 behavior

## Technical Details
- **Shared PATCH body**:
  `{"routing": {"selection": {"primary": "reserves", "tiebreak": "earliest-reset"}, "session-affinity": true, "session-affinity-ttl": "24h", "preferred-accounts": {"claude": null, "codex": null}, "claude-fallback": {"enabled": true, "mode": "auto", "mappings": [...]}}}`
- **Key profile PATCH**: unchanged, `{"routing": {"key-profiles": {"<raw key>": {...} | null}}}`.
- **Key add/remove**: `GET /api-keys`, then `PUT /api-keys` with the full JSON array. Raw keys travel only in request bodies.
- **Navigation state**: `{open: 'keys' | 'profiles' | null, focus?: {key, draft}}`. The Profiles modal receives `onBackToKeys` only when it was opened from Keys.
- **Toolbar on a capable backend**: `[Codex Fast mode] [Claude ● 10:53] [Codex ● 10:52] [Профили] [Ключи · 2]`.

## Post-Completion
**Deploy** (panel only, per the local CPAMP deploy procedure):
1. Build the web panel.
2. Copy `apps/web/dist/index.html` to `releases/panel-<name>-<date>/management.html`.
3. Back up the plist and the current panel.
4. `plutil -replace EnvironmentVariables.PANEL_PATH`.
5. `launchctl bootout` and `bootstrap`.
6. Verify `/health`, the served panel sha, and admin `GET /v8/management/routing/profiles`.

**Manual verification on the live panel**:
- Add a test key (generate, copy, alias) and then delete it. Confirm `config.yaml` has no leftover entry.
- Create a profile for a key from Ключи → Свой профиль. Check the `Routing profile selection` log lines in CPA `logs/stdout.log`, then reset the key to the default.
- Edit the default profile and confirm `GET /routing/profiles` `shared` and the TTL in `config.yaml`.
- Check the light and dark themes and the narrow-width toolbar.
