# Quota toolbar: separate Profiles and Keys modals with key add and delete

## Overview
- After the per-key routing profiles UI was deployed, the user found the Quota toolbar overloaded and the "Keys 0/2" button unclear. Profile creation and the default profile must sit behind one button, and client keys together with the per-key profile choice behind another.
- On a backend that serves `/routing/profiles`, the toolbar keeps only:
  - Codex Fast mode;
  - the per-provider "last routed" indicators;
  - a **Профили** button;
  - a **Ключи · N** button (N = number of client keys).
- **Профили** opens `RoutingProfilesModal`. It holds the default (shared) profile, including the global sticky TTL, and every key that has its own profile. From there a profile can be created for a key, edited, or reset to the default.
- **Ключи** opens `ClientKeysModal`:
  - one row per client key, with a "По умолчанию / Свой профиль" select;
  - "Настроить…" for keys with their own profile, and "Удалить";
  - an add form at the bottom that creates keys, with generate, copy and an optional alias.
  
  Choosing "Свой профиль" opens the Profiles modal on a draft for that key.
- UI only. The CPA backend (CLIProxyAPI-migration `ced98b16`) and the manager server are unchanged. On a backend without `/routing/profiles` (404) the toolbar stays exactly as it is today.

## Decisions
- **Context**: user feedback after deploying `per-key-routing-profiles-ui`:
  1. add and delete client API keys directly in the keys modal;
  2. "Keys 0/2" is unclear;
  3. profile creation and the default profile go behind one button;
  4. keys and the per-key profile select go behind another, and a custom profile is reached through a button that opens the profiles modal.
- **Direction chosen by the user**: rearrange the UI only. Profiles stay bound to a single key (`routing.key-profiles: <raw key> → RoutingProfile`). There are no named reusable profiles.
- **Chosen approach**:
  - **Toolbar.**
    - When `state && !state.unsupportedBackend` (the backend serves `/routing/profiles`, whether `supported` is true or false), it keeps Fast mode, the last-routed indicators (`QuotaSettingsToolbar.tsx:196-243`, data from `useSubscriptionActivity`), Профили and Ключи · N.
    - The selection slots, Session Affinity toggle, TTL input, preferred-account selects, the Claude → Codex fallback toggle and gear (`ClaudeFallbackControl`) and the toolbar Save move out.
    - Before the first profiles load, the slim toolbar renders with both buttons disabled.
    - On a 404 backend (`unsupportedBackend`), the toolbar is exactly today's legacy toolbar: no Профили, no Ключи.
  - **`KeyProfileEditor`** becomes a pure single-profile editor. Its props are `{initial, isNew, variant: 'default' | 'key', ttl, …}`:
    - in variant `default` the TTL can be edited;
    - in variant `key` the TTL is shown as text;
    - there is no shared/own mode switch, because resetting is the caller's action.
  - **`RoutingProfilesModal`** contains:
    - a "По умолчанию" row;
    - one row per key with its own profile, with Изменить and Сбросить на умолчание (confirm, then a `null` PATCH);
    - "+ Профиль для ключа", which picks among keys on the default and starts a draft from `copyOfShared`.
    
    Only one editor is open at a time. An optional `focus` (the raw key, in memory only) opens that key's editor directly: a new draft when the key's row has no profile, its own profile otherwise. "← К ключам" appears when the modal was opened from the Keys modal.
  - **`supported: false`** (Home or scheduler-plugin mode; the route is served):
    - key rows, Сбросить and "+" are read-only;
    - the По умолчанию row stays editable, because today's toolbar edits the shared values in this mode too;
    - adding and deleting keys stay available.
  - **Saving the default profile**: `saveSharedProfile(profile, ttl)` sends one `PATCH /config` with `routing.{selection, session-affinity, preferred-accounts, claude-fallback}`, plus `session-affinity-ttl` when it changed, then reads it back and compares. On a capable backend the toolbar no longer writes the shared profile, so there is a single writer.
  - **`ClientKeysModal`**:
    - rows with the alias or mask, the select, a chain summary, Настроить… and Удалить;
    - the add form: key input, Сгенерировать, Копировать (`utils/clipboard.ts` `copyToClipboard`), alias, Добавить.
  - **`clientKeys.ts` service.** It uses the quota `apiClient` (v8):
    - it reads the key list from a fresh `GET /config` through `clientApiKeys`;
    - it writes the full list with `PATCH /config {access: {api-keys: [...]}}`, or the legacy top-level `api-keys` when that is where `clientApiKeys` found the list;
    - the v8 saver prunes the profiles of removed keys;
    - aliases follow the `ApiKeysCardEditor` rules.
    
    After every key operation, config, profiles and aliases are refreshed.
  - **Navigation**: one state `{open: 'keys' | 'profiles' | null, focus?: string, fromKeys: boolean}` in `QuotaSettingsBar`. Only one modal is shown at a time.
- **Rejected alternatives** (not judged by the user; open to critique):
  - named reusable profiles in the backend;
  - keeping the shared profile in the toolbar;
  - an inline editor in key rows;
  - nested modals;
  - reusing ConfigPage's `persistApiKeyMutation`;
  - two writers for the shared profile;
  - `apiKeysApi` on the general client.
- **Verified facts**:
  - **Backend routes.**
    - `/api-keys` is registered only under `/v0/management` (backend `internal/api/server_management.go:88-91`). The v8 group has `GET/PUT/PATCH /config` and `GET /routing/profiles` (`server_management_v8.go:21-36`), and no `/api-keys`.
    - `GET /v8/management/routing/profiles` returns `{supported, shared, keys, selection_options}`, and `keys` lists only keys that have a profile.
    - `PATCH /v8/management/config` merges objects, replaces lists whole, and deletes on `null`. A PATCH that drops a key whose profile is unchanged is accepted, and the saver prunes that profile. A PATCH that *adds* a profile for a key that is not listed answers 400 `unknown_api_key` (`config_v8.go:84-150`, `routing_profiles.go:100-143`).
  - **Panel clients.**
    - The general `apiClient` that `apiKeysApi` uses points at `/v0/management` (`utils/constants.ts:16`, `utils/connection.ts:16-19`).
    - The quota `apiClient` points at `/v8/management` with the pinned connection (`features/personal-quota-support/services/api/client.ts:45-57`).
    - `guardConfigConnection()` tracks only the quota client (`configValue.ts:4-11`).
  - **Flags.** `RoutingProfilesState` has two of them (`routingProfiles.ts:33-41`): `unsupportedBackend` means 404, and `supported: false` means the route is served but per-key profiles are inert. Today `useKeyProfiles.saveKeyProfile` returns early unless `state?.supported` (`useKeyProfiles.ts:94`), and `total` already counts every client key (`:135`).
  - **TTL.** It is global. `config.routingSessionAffinityTTL` exposes it (`services/api/config.ts:26-29`), and `readSubscriptionRouting` turns a missing value into `'1h'` (`subscriptionRouting.ts:21`). `routingFormState` rejects an empty or invalid TTL (`routingModel.ts:31-41`).
  - **Alias and key rules in `ApiKeysCardEditor`.** It saves one alias item, not the whole list: `saveApiKeyAliases(base, [{apiKeyHash, alias}], managementKey, activeApiKeyHashes, allowOrphanAliasCleanup?)` (`usageService.ts:3326-3358`; `ApiKeysCardEditor.tsx:248-277`). It deletes with `deleteApiKeyAlias(base, hash, managementKey)` (`usageService.ts:3361`). The hash is `sha256Hex(key).toLowerCase()` (`utils/apiKeyHash.ts:92`). Before writing, it:
    - checks the key with `isValidApiKeyCharset` (`utils/validation.ts:41`);
    - rejects an empty alias, one longer than 120 characters, or a duplicate alias (`ApiKeysCardEditor.tsx:139-158,230-246`);
    - refuses to delete a key on a manager-hosted panel while the alias state is unknown (`:390-397`).
    
    The key generator is a closure inside the component (`:113-118`).
  - **Raw-key scrubbing.** `translateWriteError` already scrubs the raw key from 422 messages (`routingProfiles.ts:207-213`).
  - **Alias refresh.** `useKeyProfiles` uses its own `useApiKeyAliases` instance (`useKeyProfiles.ts:34`). That instance refreshes only through `replaceAliases` and `removeAlias` or its own reload, not through config reloads (`hooks/useApiKeyAliases.ts:79-95`).
  - **Hooks and models.** `useSubscriptionActivity` drives the last-routed indicators, and the fallback `models` come from `useClaudeFallback().state.models` (`QuotaSettingsToolbar.tsx:347,385`).
  - **Live config.** It has 2 client keys and no key profiles.
  - **Tests.**
    - The suite uses vitest with react-test-renderer, with no Testing Library and no jsdom.
    - `Modal` renders through `createPortal`, so tests mock it.
    - UI tests mock `useKeyProfiles` entirely (`keyProfiles.lifecycle.test.tsx:31`) and use the real `en` i18n.
    - There is no repo-wide locale parity test; `features/accounts/components/QuotaWindowCard.locale.test.ts` is the pattern for a feature-level one.

## Context (from discovery)
- **Files and components involved:**
  - `features/quota/components/`:
    - `QuotaSettingsToolbar.tsx` (392 lines; `QuotaSettingsBar` at :323)
    - `KeyProfilesModal.tsx` (194)
    - `KeyProfileEditor.tsx` (278)
    - `ClaudeFallbackControl.tsx` (142)
    - `FallbackSettingsEditor.tsx`, `Select.tsx`, `ProviderPill.tsx`
  - `features/quota/hooks/`: `useKeyProfiles.ts`, `useSubscriptionRouting.ts`, `useClaudeFallback.ts`
  - `features/quota/keyProfilesModel.ts`: `normalizeProfile`, `copyOfShared`, `profileDirty`, `chainSummary`, `buildKeyRows`
  - `features/quota/routingModel.ts`: `routingFormState`, `preferredAccountOptions`, `selectionSlotOptions`, `isPickerSlot`
  - `features/personal-quota-support/services/api/`:
    - `routingProfiles.ts`: `saveKeyProfile`, `keyProfilePatch`, `clientApiKeys`, `translateWriteError`, error classes
    - `subscriptionRouting.ts`, `claudeFallback.ts`, `config.ts`, `client.ts`, `configValue.ts`
  - `services/api/usageService.ts`, `hooks/useApiKeyAliases.ts`, `utils/apiKeyHash.ts`, `utils/validation.ts`, `utils/clipboard.ts`
  - `components/config/ApiKeysCardEditor.tsx` (key generator source)
  - locales `i18n/locales/{en,ru,zh-CN,zh-TW}.json` (`quota_management.key_profiles.*`)
  - `docs/personal-quota.md`
- **Existing tests to update:**
  - `features/quota/keyProfiles.lifecycle.test.tsx`
  - `features/quota/useKeyProfiles.lifecycle.test.tsx`
  - `features/quota/components/KeyProfileEditor.test.tsx`
  - `features/quota/quotaSettingsToolbar.test.ts`
  - `features/quota/QuotaPage.lifecycle.test.tsx` (stubs `/routing/profiles` with a 404)
  - `features/quota/claudeFallback.lifecycle.test.tsx`
  - `features/quota/settingsHooks.lifecycle.test.tsx`
  - `features/quota/quotaSettingsHooks.test.ts`
- **Patterns:**
  - Capture `guardConfigConnection()` before the read and check it before the write.
  - After a write, read back and compare through `normalizeProfile`.
  - A 400 `unknown_api_key` triggers a reload; a 422 `invalid_config` shows the backend message, scrubbed of the raw key.

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
- Each task gate runs `npm run type-check` and `npm run test:web`. Vitest does not type-check, so both are needed
- Each UI task adds the locale keys it uses to all four locale files in the same task
- Maintain backward compatibility (a 404 backend keeps today's toolbar)

## Testing Strategy
- **Unit tests**: required for every task.
  - Use vitest with react-test-renderer, and mock `Modal`'s portal as the existing quota tests do.
  - Service tests mock the quota `apiClient` and assert request paths and bodies.
  - Modal tests mock `useKeyProfiles` and assert hook calls.
  - Confirmations are triggered by stubbing `useNotificationStore().showConfirmation` and invoking its `onConfirm`.
  - Clipboard goes through `vi.mock('@/utils/clipboard')`.
- **Security assertions**:
  - A raw key never appears in request URLs; this is asserted in the service tests, Task 2.
  - A raw key never appears in rendered output, titles or aria labels; this is asserted in the modal tests, Tasks 6–7. The only exception is the add-form input value before submission.
  - A raw key never appears in error messages; this is asserted in the service tests.
- **E2E**: the project has no UI e2e suite for the Quota page.

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
- 2026-11-05 brainstorm: **accepted** - toolbar contents. Fast mode, last-routed indicators, Профили and Ключи · N; the shared-profile controls leave the toolbar. Evidence: user request; `QuotaSettingsToolbar.tsx:95-300`; the indicator shows state, not a setting (`:196-243`).
- 2026-11-05 brainstorm: **accepted** - labels. "Ключи · N" counts all client keys, and "Профили" has no counter. Evidence: the user found "Keys 0/2" unclear.
- 2026-11-05 brainstorm: **accepted** - Profiles modal. A default row and rows for keys with their own profile, with Изменить, Сбросить and "+ Профиль для ключа"; one editor open at a time. Evidence: user request.
- 2026-11-05 brainstorm: **accepted** - default profile save. One `PATCH /config` with a read-back, so there is a single writer. Evidence: the `saveKeyProfile` pattern in `routingProfiles.ts:227-250`.
- 2026-11-05 brainstorm: **accepted** - Keys modal row. A По умолчанию / Свой профиль select, Настроить… and Удалить. Evidence: user request.
- 2026-11-05 brainstorm: **accepted** - navigation. Свой профиль opens the Profiles modal on a draft. One modal at a time, with "← К ключам". Evidence: `Modal` renders through `createPortal`, and the codebase has no nested-modal pattern.
- 2026-11-05 brainstorm: **accepted** - adding a key. A form with generate, copy and alias. Write: read a fresh list, check for duplicates, write the full list. Evidence: `ApiKeysCardEditor.tsx:113`. ConfigPage's mutation is coupled to the source-editor dirty state (`ConfigPage.tsx:636-650`).
- 2026-11-05 brainstorm: **accepted** - raw-key visibility. The raw key shows only in the add-form input before submission. Evidence: the standing constraint that raw keys never appear in URLs, logs or rendered UI.
- 2026-11-05 brainstorm: **accepted** - deleting a key. Confirm, read a fresh list, write the list without the key, then delete the alias. The backend drops the key's profile, and the last key cannot be deleted. Evidence: `apiKeys.ts:52` (`deleteValue` puts the raw key in the URL); backend reconcile and prune of key profiles.
- 2026-11-05 brainstorm: **accepted** - `KeyProfileEditor`. A pure editor with no mode switch; the `default` variant has an editable TTL. Evidence: `KeyProfileEditor.tsx:32-75`.
- 2026-11-05 grill: **accepted** - on a 404 backend the toolbar is exactly today's, with no Ключи button. This replaces the brainstorm entry "404: Ключи offers add and delete only". The user chose to drop it, because keys on such a backend are edited on the Config page and the live CPA supports profiles.
- 2026-11-05 grill: **accepted** - `clientKeys.ts` reads keys from the quota client's `GET /config` (`clientApiKeys`) and writes them with `PATCH /config {access: {api-keys}}` (or the legacy top-level path). It does not use `apiKeysApi` or `PUT /v8/management/api-keys`. Decided by grill: `/api-keys` exists only under `/v0/management` (backend `server_management.go:88-91`, `server_management_v8.go:21-36`); `apiKeysApi` uses the v0 general client (`utils/constants.ts:16`); `guardConfigConnection` tracks only the quota client (`configValue.ts:4-11`); and the v8 saver prunes the profiles of removed keys (`config_v8.go:84-150`).
- 2026-11-05 grill: **accepted** - aliases follow `ApiKeysCardEditor`. One alias item is saved with the active hashes; aliases are validated before the key write (empty, longer than 120 characters, duplicate); an orphan conflict fails with `AliasWriteError` and is not cleaned up; the alias is deleted with `deleteApiKeyAlias`; a key cannot be removed while the alias state is unknown on a manager-hosted panel. After alias writes, `replaceAliases` and `removeAlias` run (Tasks 1, 2, 4). Decided by grill: `usageService.ts:3326-3361`, `ApiKeysCardEditor.tsx:139-158,230-277,390-397`, `useApiKeyAliases.ts:79-95`.
- 2026-11-05 grill: **accepted** - keys are checked with `isValidApiKeyCharset`, and duplicate, last-key and unknown checks compare trimmed values (Task 2). Decided by grill: `utils/validation.ts:41`, `ApiKeysCardEditor.tsx:439`.
- 2026-11-05 grill: **accepted** - key-write errors are scrubbed of the raw key (Task 2). Decided by grill: `translateWriteError` already does this for profiles (`routingProfiles.ts:207-213`).
- 2026-11-05 grill: **accepted** - `addClientKey` returns `{aliasError?}` once the key is written. The modal clears the key input as soon as the key is saved and shows the alias warning separately (Tasks 2, 7). Decided by grill: the boolean result convention in `useKeyProfiles.ts:93-117`; retrying a written key would hit the duplicate check.
- 2026-11-05 grill: **accepted** - the toolbar gates on `!unsupportedBackend`, and `supported` gates only the per-key profile mutations. With `supported: false` the По умолчанию row stays editable, and adding or deleting keys is never gated on `supported` (Tasks 4, 5, 6, 8). Decided by grill: the two flags in `routingProfiles.ts:33-41`; today's toolbar edits the shared values in this mode (`QuotaSettingsToolbar.tsx:336-343,374`); the guard at `useKeyProfiles.ts:94`.
- 2026-11-05 grill: **accepted** - the TTL comes from `useKeyProfiles` (`config.routingSessionAffinityTTL || '1h'`), not from `useSubscriptionRouting` local state. An empty or invalid TTL is rejected before any request through an extracted `invalidTTL` helper, and an unchanged TTL is omitted from the PATCH (Tasks 1, 3, 4). Decided by grill: `QuotaSettingsToolbar.tsx:386`, `useSubscriptionRouting.ts:52-53,97`, `subscriptionRouting.ts:21`, `routingModel.ts:31-41`.
- 2026-11-05 grill: **accepted** - `saveSharedProfile` captures the guard first, checks `validFallbackSettings`, reuses `translateWriteError`, and shares one profile-body helper with `keyProfilePatch` (Task 3). Decided by grill: `routingProfiles.ts:181-196,227-250`.
- 2026-11-05 grill: **accepted** - task order:
  - Task 4 (editor) adapts the `KeyProfilesModal` call site and its tests so that every gate stays green.
  - Locale keys land in the task that uses them.
  - Every gate runs `type-check`.
  - The toolbar task is split into toolbar and navigation (Task 8) and the single writer (Task 9).
  - The key generator gets its own task (Task 1).
  
  Decided by grill: `KeyProfilesModal.tsx:168-182`, `keyProfiles.lifecycle.test.tsx:4,20,31`.
- 2026-11-05 grill: **accepted** - modal tests assert hook calls with a mocked `useKeyProfiles`, a stubbed `showConfirmation` and a mocked `copyToClipboard`. URL leak checks move to the service tests (Tasks 2, 6, 7). Decided by grill: `keyProfiles.lifecycle.test.tsx:31`, `ApiKeysCardEditor.tsx:9,52,399`, `utils/clipboard.ts:1`.
- 2026-11-05 grill: **accepted** - simplifications:
  - the existing `total` replaces `keyCount`;
  - there is no `ClientKeyOutcomeUnknownError`, because the hook's generic path already refetches after non-422 errors;
  - `focus` is the key alone, and draft or edit is derived from `rows[].profile`;
  - the editor props are `{initial, isNew}`;
  - `useSubscriptionRouting` loses its slot plumbing;
  - `useClaudeFallback` stays mounted only for `models`;
  - the Task 10 grep becomes a check that the assertions exist.
  
  Decided by grill: `useKeyProfiles.ts:111-114,124-135`, `KeyProfileEditor.tsx:76-101`, `useSubscriptionRouting.ts:22-127`, `QuotaSettingsToolbar.tsx:347,385`.
- 2026-11-05 grill: **accepted** - Task 6 cites `KeyProfilesModal.tsx:152-154` for "Edit is disabled while reloading" instead of a commit hash. The editor is keyed by the row's key hash so that it reinitializes. Decided by grill: the snapshot-visible code.
- 2026-11-05 grill: **accepted** - a new `features/quota/keyProfiles.locale.test.ts` checks that the `key_profiles` and `client_keys` subtrees have the same key set in all four locales (Task 10). Decided by grill: there is no repo-wide parity test, and `QuotaWindowCard.locale.test.ts` is the pattern.

## Implementation Steps

### Task 1: Shared key generator and TTL validator
- [x] move `generateSecureApiKey` out of `components/config/ApiKeysCardEditor.tsx:113-118` into `utils/apiKeyGenerator.ts` as `generateClientKey()`, with the same format, and point `ApiKeysCardEditor` at it
- [x] extract `invalidTTL(ttl: string): boolean` from `routingFormState` (`features/quota/routingModel.ts:31-41`). It rejects an empty value and any value with `goDurationSeconds <= 0`. Make `routingFormState` use it
- [x] write tests:
  - `generateClientKey` with a stubbed `crypto.getRandomValues`: prefix, length and charset accepted by `isValidApiKeyCharset`;
  - `invalidTTL`: empty, `0s`, garbage, `30m`, `24h`;
  - existing `ApiKeysCardEditor` and `routingModel` tests stay green
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 2

### Task 2: Client key service on the v8 config API
- [x] create `features/personal-quota-support/services/api/clientKeys.ts`. It uses the quota `apiClient` only, captures `guardConfigConnection()` before the read and checks it before every write. Reading: `GET /config`, then `clientApiKeys(raw)` with a record of whether the list came from `access.api-keys` or the legacy top-level `api-keys`
- [x] `addClientKey(key, alias?, aliasContext?)`:
  1. trim the key and reject one that fails `isValidApiKeyCharset` (`InvalidClientKeyError`);
  2. read a fresh list and reject a trimmed duplicate (`DuplicateClientKeyError`);
  3. when an alias is given, validate it before any write: not empty after trim, at most 120 characters, and not equal (case-insensitive) to an alias of another active key (`InvalidAliasError` / `DuplicateAliasError`);
  4. `PATCH /config` with the full list at the path it was read from;
  5. write the alias with `usageServiceApi.saveApiKeyAliases(base, [{apiKeyHash: sha256Hex(key).toLowerCase(), alias}], managementKey, activeHashes)`.
  
  It returns `{aliasError?: Error, aliases?: ApiKeyAlias[]}` once the key is written. An alias failure, including an orphan conflict, is returned in `aliasError` and never rolls back the key. `aliasContext = {serviceBase, managementKey, aliases, aliasStateKnown}`
- [x] `removeClientKey(key, aliasContext?)`:
  - read a fresh list;
  - throw `UnknownApiKeyError` when no trimmed entry matches, and `LastClientKeyError` when it is the only key;
  - throw `AliasStateUnknownError` when the panel is manager-hosted and the alias state is unknown (`ApiKeysCardEditor.tsx:390-397`);
  - `PATCH /config` with the list minus every entry whose trimmed value equals the key;
  - `deleteApiKeyAlias(base, hash, managementKey)` when an alias exists; a failure is returned as `aliasError`.
  
  Never use `apiKeysApi`, `DELETE`, or any URL that carries the key
- [x] write errors go through the same scrubbing as `translateWriteError`: the raw key becomes `***` in the message. A 400 `unknown_api_key` maps to `UnknownApiKeyError`, and a 422 to `InvalidRoutingConfigError`
- [x] write tests in `clientKeys.test.ts` with `vi.mock` on the quota client and `usageServiceApi`:
  - the PATCH body after an add and after a remove, for both the `access.api-keys` path and the legacy path;
  - an invalid charset;
  - a duplicate key, including an untrimmed stored entry;
  - removing the last key;
  - removing an unknown key;
  - an invalid alias and a duplicate alias, both rejected with no PATCH call;
  - a saved alias, and an alias failure that keeps the key (`aliasError` returned);
  - a deleted alias;
  - removal refused while the alias state is unknown;
  - an error message containing the key comes back masked;
  - a connection change between read and write aborts the write;
  - no request URL contains the raw key
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 3

### Task 3: Shared profile writer
- [x] extract `profileBody(normalized, selectionOptions)` from `keyProfilePatch` (`routingProfiles.ts:181-196`). It produces kebab-case `selection` with `tiebreak: null` for a picker primary, `session-affinity`, `preferred-accounts` with `null` for a cleared provider, and the complete `claude-fallback`. Make `keyProfilePatch` use it
- [x] add `sharedProfilePatch(profile, ttl | undefined, selectionOptions)`, which returns `{routing: {...profileBody, 'session-affinity-ttl'?: ttl}}` with the TTL only when it is passed. Add `routingProfilesApi.saveSharedProfile(profile, ttl | undefined, selectionOptions)`:
  - capture the guard first;
  - reject invalid fallback mappings (`validFallbackSettings`);
  - reject `invalidTTL(ttl)` before any request;
  - send one `PATCH /config`;
  - read back `/routing/profiles` and compare `shared` through `normalizeProfile`, and read back config for the TTL when it was sent;
  - throw "CPA did not retain the routing profile" on a mismatch;
  - map errors through `translateWriteError`
- [x] write tests:
  - the full PATCH body;
  - a cleared preferred account sent as `null`;
  - a picker primary sending `tiebreak: null`;
  - a TTL included only when passed;
  - an invalid TTL and invalid fallback rejected with no `patch` call;
  - a successful read-back;
  - a mismatch on the profile, and a mismatch on the TTL;
  - a 422 with the backend message;
  - existing `keyProfilePatch` tests unchanged
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 4

### Task 4: KeyProfileEditor as a pure profile editor
- [x] change the `KeyProfileEditor.tsx` props to `{initial: RoutingProfile, isNew: boolean, variant: 'default' | 'key', ttl: string, files, showEmails, selectionOptions, models, saving, readOnly, onSave(profile, ttl?), onCancel}`:
  - the baseline is `isNew ? null : withFallbackSuggestions(initial)`;
  - dirty is `!baseline || profileDirty(...)`, as at `:99-101` today;
  - remove the shared/own `mode` switch
- [x] variant `default` renders an editable TTL field validated with `invalidTTL`. Save is disabled while it is invalid, and `onSave` passes the TTL only when it changed. Variant `key` shows the TTL as text. Keep `withSuggestions` on the draft, the picker rule on the tiebreak slot, the chain summary and the read-only hint
- [x] adapt the `KeyProfilesModal.tsx:168-182` call site so it compiles and behaves as before until Task 8 replaces it:
  - "own" uses `variant='key'` with `initial = profile ?? copyOfShared(shared)` and `isNew = !profile`;
  - "back to shared" becomes a modal button that calls `saveKeyProfile(key, null)`.
  
  Update `keyProfiles.lifecycle.test.tsx` to match
  - note: the reset button (`data-key-reset`, locale `key_profiles.reset`) shows in the expanded row of a key with its own profile, with no confirmation; Task 6 adds the confirmed Сбросить. The TTL field reuses the existing `session_affinity_ttl`, `routing.ttl_hint` and `routing.invalid_ttl` locale keys
- [x] update `KeyProfileEditor.test.tsx`:
  - both variants;
  - TTL validation;
  - TTL passed only when changed;
  - `isNew` counts as dirty;
  - read-only mode;
  - no mode switch rendered
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 5

### Task 5: useKeyProfiles state for both modals
- [x] extend `features/quota/hooks/useKeyProfiles.ts`:
  - `ttl`, from `config.routingSessionAffinityTTL || '1h'` of the config it loads;
  - `saveShared(profile, ttl?)`, which calls `saveSharedProfile` and then reloads profiles and config;
  - `addKey(key, alias?)` and `removeKey(key)` through `clientKeys.ts`, each followed by a forced config reload and a profiles reload, with `replaceAliases(response.items)` or `removeAlias(hash)` from its `useApiKeyAliases` instance after an alias write or delete
- [x] gates:
  - `addKey`, `removeKey` and `saveShared` are gated only on `disabled`, `loading` and `savingRef`, never on `state.supported`;
  - `saveKeyProfile` keeps its `supported` gate.
  
  `addKey` resolves to `{ok, aliasWarning?}`, so the caller can clear the key input when the key was written
- [x] error mapping:
  - invalid key, duplicate key, invalid or duplicate alias, last key and alias state unknown become localized messages;
  - non-domain errors take the existing generic path (`errorText` and `refetch`);
  - keep the 400/422 handling;
  - a save error survives the reload it triggers.
  
  Add the locale keys these messages use to all four locales
- [x] apply the connection-revision guard on every new path, as in the current hook
- [x] update `useKeyProfiles.lifecycle.test.tsx`:
  - `ttl` after load and after `saveShared`;
  - a shared save, then the reload;
  - adding a key, then the reload, with its alias shown on the new row without a remount;
  - removing a key, then the reload, with its profile row gone;
  - add and remove working with `supported: false`;
  - the message for each domain error;
  - an alias warning returned with `ok: true`;
  - a stale result dropped after a connection change
- ➕ `useApiKeyAliases` now also returns `serviceBase`, `managementKey` and `stateKnown` (host confirmed and, on a manager-hosted panel, the alias list loaded), which `useKeyProfiles` passes to `clientKeys.ts` as the alias context; covered in `useApiKeyAliases.test.tsx`
- ➕ `saveShared` also returns false without a loaded state or on a 404 backend (`unsupportedBackend`), because it needs `selectionOptions` and its read-back would fail after a landed PATCH there; `removeKey` resolves to the same `{ok, aliasWarning?}` shape as `addKey`. Domain errors live under `quota_management.client_keys.errors.*`
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 6

### Task 6: RoutingProfilesModal
- [x] create `features/quota/components/RoutingProfilesModal.tsx` and its SCSS module on `Modal`. It shows:
  - a "По умолчанию" row with `chainSummary(shared)` and Изменить, which opens the editor in variant `default` with `ttl` from the hook and saves through `saveShared`;
  - one row per key with its own profile: alias or mask, the summary, Изменить (variant `key`), and Сбросить на умолчание (`showConfirmation`, then `saveKeyProfile(key, null)`)
- [x] "+ Профиль для ключа": a `Select` of keys on the default, by alias or mask. It opens an editor with `initial = copyOfShared(shared)` and `isNew`. The control is hidden when every key has a profile
- [x] props:
  - `focus?: string` opens that key's editor on open (`isNew` when its row has no profile);
  - `onBackToKeys?: () => void` renders "← К ключам".
  
  Only one editor is open at a time, keyed by the row's key hash. Edit is disabled while profiles reload unless that editor is already open (carry over `KeyProfilesModal.tsx:152-154`)
- [x] with `supported: false`, key rows are read-only and Сбросить and "+" are hidden. The По умолчанию row stays editable. Add this task's locale keys (title, По умолчанию, Сбросить and its confirmation, "+ Профиль для ключа", "← К ключам") to all four locales
- [x] write tests in `routingProfilesModal.lifecycle.test.tsx` with a mocked `useKeyProfiles` and a stubbed `showConfirmation`:
  - the default row calls `saveShared(profile, ttl)`;
  - a key row calls `saveKeyProfile(key, profile)`;
  - a reset after confirm calls `saveKeyProfile(key, null)`, and a cancelled confirm makes no call;
  - "+" creates a profile for the picked key;
  - `focus` on a key on the default opens a new draft, and its Cancel makes no call;
  - `focus` on a key with a profile opens edit;
  - the back button;
  - `supported: false`, where only the default row can be edited;
  - Edit is disabled during a reload;
  - no raw key in the output, titles or aria labels
- ➕ the modal takes the `useKeyProfiles` result as its `keyProfiles` prop, as `KeyProfilesModal` did, so the tests pass a stand-in object for the hook. Locale keys live under `quota_management.key_profiles.profiles.*`. The focus is applied during render once the profiles are loaded (the React Compiler lint rejects setState in an effect), and a focus on a key on the default is ignored when `supported: false`
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 7

### Task 7: ClientKeysModal
- [x] create `features/quota/components/ClientKeysModal.tsx` and its SCSS module on `Modal`. Each row has:
  - the alias or mask;
  - a `Select` with По умолчанию / Свой профиль, disabled with a hint when `supported: false`;
  - the chain summary;
  - Настроить… when the key has its own profile;
  - Удалить, which asks for confirmation and is disabled with a hint when it is the only key
- [x] select behavior:
  - choosing "Свой профиль" for a key on the default calls `onOpenProfiles(key)` and makes no request;
  - choosing "По умолчанию" for a key with its own profile asks for confirmation, then calls `saveKeyProfile(key, null)`;
  - Настроить… calls `onOpenProfiles(key)`
- [x] add form:
  - a key input (type `password`, with a show toggle);
  - Сгенерировать fills it with `generateClientKey()`;
  - Копировать calls `copyToClipboard`; `false` shows a fallback message;
  - an optional alias input, disabled when the alias service is unavailable;
  - Добавить calls `addKey`. When it returns `ok`, both inputs clear, and an `aliasWarning` is shown separately.
  
  The raw key appears only in this input
- [x] with no client keys, the modal shows the add form and a hint. Errors from the hook appear in a `role="alert"` block, masked as the current modal does. Add this task's locale keys (title, По умолчанию / Свой профиль, Настроить…, the add form labels, the generate, copy and copied messages, the delete confirmation, the last-key hint) to all four locales
- [x] write tests in `clientKeysModal.lifecycle.test.tsx` with a mocked `useKeyProfiles`, a stubbed `showConfirmation` and a mocked `copyToClipboard`:
  - rows render with alias or mask;
  - Добавить calls `addKey(raw, alias)` and clears the inputs on `ok`;
  - an alias warning keeps the key cleared and shows the warning;
  - a duplicate error from the hook is shown;
  - generate fills the input;
  - copy succeeds, and copy fails with the fallback message;
  - delete after confirm calls `removeKey(raw)`, and a cancelled confirm makes no call;
  - the last key cannot be deleted;
  - "Свой профиль" calls `onOpenProfiles(key)` with no hook write;
  - "По умолчанию" after confirm calls `saveKeyProfile(key, null)`;
  - `supported: false` disables the select;
  - no raw key in the output, titles or aria labels once the input is cleared
- ➕ `useKeyProfiles` also returns `aliasesEditable` (the alias service is reachable and its state is known, the condition `addClientKey` needs for an alias), which disables the alias input; covered in `useKeyProfiles.lifecycle.test.tsx`. A failed copy also reveals the key, so it can be copied by hand. Locale keys live under `quota_management.client_keys.*`; the reset confirmation reuses `key_profiles.profiles.reset_confirm*`
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 8

### Task 8: Slim toolbar and modal navigation
- [x] in `QuotaSettingsToolbar.tsx`, when `state && !state.unsupportedBackend`, or before the first profiles load, render only:
  - Codex Fast mode;
  - the last-routed indicators (`ProviderPill` and time per provider from `useSubscriptionActivity`, with the account in the title);
  - **Профили**;
  - **Ключи · {total}**.
  
  Before the first load, both buttons are disabled. After a failed first load, both are enabled, so the modal can show the error and retry. When `state.unsupportedBackend`, render today's legacy toolbar unchanged, without Профили and Ключи. Add the button locale keys to all four locales
- [x] in `QuotaSettingsBar`:
  - one navigation state `{open: 'keys' | 'profiles' | null, focus?: string, fromKeys: boolean}`;
  - opening either modal reloads the profiles;
  - Keys → Профили goes through `onOpenProfiles(key)`, which sets `focus` and `fromKeys`;
  - Профили → Keys goes through `onBackToKeys`;
  - delete `KeyProfilesModal.tsx` and its SCSS, and point `keyProfiles.lifecycle.test.tsx` at the new modals or fold it into the new modal tests
- [x] ➕ reword `key_profiles.editor.ttl` in all four locales: it still says the TTL is "set in the toolbar", which is wrong once the TTL lives in the По умолчанию row
- [x] update tests:
  - `quotaSettingsToolbar.test.ts` and the bar-level lifecycle tests: the slim toolbar on a capable backend, including `supported: false`; buttons disabled before the first load; labels "Ключи · 2" and "Профили"; Keys → Профили with `focus` and back;
  - `QuotaPage.lifecycle.test.tsx`: the 404 stub still renders the legacy toolbar, with no Профили and no Ключи
- ➕ the toolbar takes a `profileButtons` prop (`{total, disabled, onOpenProfiles, onOpenKeys}`); when set it renders the slim row (`data-toolbar="slim"`), otherwise the legacy one. The last-routed indicator is a shared `LastRouted` piece for both rows. Button keys live under `key_profiles.profiles_button*` and `client_keys.button*`. The navigation `focus` is passed to the Profiles modal only after the reload it started is seen (`focusArmed`), so a draft or edit never copies the cached rows. The modals render only on the slim toolbar. `keyProfiles.lifecycle.test.tsx` now covers the bar: slim toolbar, buttons, navigation, focus and the legacy 404 toolbar
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 9

### Task 9: Single writer for the shared profile
- [x] on a capable backend, nothing in the toolbar writes the shared profile. `useSubscriptionRouting` serves only the 404 legacy path:
  - remove its slot plumbing (`selection`, `selectionOptions`, `slots` branches, `useSubscriptionRouting.ts:22-127`) and the `profiles` parameter;
  - `RoutingProfilesSource` shrinks to what the legacy path needs (`failed` for `strategyLocked`)
- [x] `useClaudeFallback` stays mounted only to supply `models` to the editors. Remove its `onSaved` wiring (`QuotaSettingsToolbar.tsx:345`), and remove `ClaudeFallbackControl`'s `fallback` prop if it becomes unused
- [x] update tests:
  - `quotaSettingsHooks.test.ts`, `settingsHooks.lifecycle.test.tsx` and `claudeFallback.lifecycle.test.tsx` for the removed branches;
  - assert that on a capable backend the bar renders no `[data-routing-save]` and no `ClaudeFallbackControl`, and that `useClaudeFallback` gets no `onSaved`;
  - the legacy 404 save path still sends `routing.strategy`
- ➕ the legacy `SubscriptionRoutingSettings.selection` and the selection branch of `subscriptionRoutingPatch` are removed too, so the legacy save can only send `routing.strategy`. `RoutingProfilesSource` is now `{failed?}`. `useClaudeFallback` loses its `onSaved` parameter (the bar was its only caller). `ClaudeFallbackControl` keeps its `fallback` prop, because the legacy 404 toolbar still renders it. The toolbar-only `quota_management.routing.selection_hint` locale key is removed from all four locales
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 10

### Task 10: Locale cleanup and parity
- [x] remove the keys that are no longer used from all four locales (`key_profiles.button` and `button_hint` with `{{count}}/{{total}}`, `editor.mode*`, `editor.shared_hint`, `badge_shared`, if unused). Grep `apps/web/src` to confirm that none are still referenced
- [x] create `features/quota/keyProfiles.locale.test.ts`, modelled on `features/accounts/components/QuotaWindowCard.locale.test.ts`. It asserts that the `quota_management.key_profiles` and `client_keys` subtrees have the same key set in en, ru, zh-CN and zh-TW, and that the removed keys are absent
- [x] run `npm run type-check` and `npm run test:web`; both must pass before Task 11
- ➕ removed 13 keys from `quota_management.key_profiles` in all four locales: `button`, `button_hint`, `title`, `shared_title`, `shared_hint`, `badge_shared`, `badge_own`, `reset`, `empty`, `editor.mode`, `editor.mode_shared`, `editor.mode_own`, `editor.shared_hint`. The grep covered the literal keys and the `${prefix}` lookups in `ClientKeysModal` and `useKeyProfiles`, which only use `client_keys`. The locale test also checks that every value is a non-empty string

### Task 11: Verify acceptance criteria
- [x] verify the Overview requirements:
  - the slim toolbar on a capable backend, including `supported: false`;
  - both modals and the navigation between them;
  - adding a key (generate, copy, alias) and deleting one (not the last);
  - the default and key profile writes go through one PATCH each, with read-back;
  - the 404 path is unchanged
- [x] verify the edge cases each have a test: an invalid key, a duplicate key, an invalid or duplicate alias, the last key, alias state unknown, an alias failure after the key was written, a reload during editing, `supported: false`, no client keys, an invalid TTL
- [x] confirm that the raw-key assertions from Tasks 2, 6 and 7 exist (URLs, error messages, rendered output, titles, aria labels)
- [x] run `npm run type-check`, `npm run lint` and `npm run test:web`. All must pass, with no new lint warnings
- ➕ verified: type-check clean, lint 0 errors and 7 warnings, all pre-existing in files this branch does not touch (AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx, UsageMaintenanceCapabilityViews.tsx), test:web 305 files and 5052 tests passed. Edge cases map to clientKeys.test.ts, useKeyProfiles.lifecycle.test.tsx, clientKeysModal/routingProfilesModal lifecycle tests, KeyProfileEditor.test.tsx, routingProfiles.test.ts and quotaSettingsHooks.test.ts (invalidTTL); raw-key checks: clientKeys.test.ts "never puts a raw key in a request URL" and the masking tests, plus the "never renders a raw key" tests in both modal suites and keyProfiles.lifecycle.test.tsx

### Task 12: [Final] Update documentation
- [x] update `docs/personal-quota.md`:
  - the toolbar now holds Fast mode, the indicators, Профили and Ключи;
  - the Profiles modal (default with TTL, key profiles, `supported: false` behavior);
  - the Keys modal (select, add with generate, copy and alias, delete with the last-key rule);
  - the 404 behavior

## Technical Details
- **Shared PATCH body**:
  `{"routing": {"selection": {"primary": "reserves", "tiebreak": "earliest-reset"}, "session-affinity": true, "session-affinity-ttl": "24h" /* only when changed */, "preferred-accounts": {"claude": null, "codex": null}, "claude-fallback": {"enabled": true, "mode": "auto", "mappings": [...]}}}`
- **Key profile PATCH**: unchanged, `{"routing": {"key-profiles": {"<raw key>": {...} | null}}}`.
- **Key add and remove**:
  - `GET /v8/management/config`, then `clientApiKeys(raw)`;
  - `PATCH /v8/management/config` with `{"access": {"api-keys": [...full list]}}`, or `{"api-keys": [...]}` for a legacy config;
  - the raw key travels only in request bodies;
  - the backend prunes the profile of a removed key.
- **Alias save**: `PUT <manager>/api-key-aliases` through `usageServiceApi.saveApiKeyAliases(base, [{apiKeyHash, alias}], managementKey, activeHashes)`. Delete through `deleteApiKeyAlias(base, hash, managementKey)`.
- **Navigation state**: `{open: 'keys' | 'profiles' | null, focus?: string, fromKeys: boolean}`.
- **Toolbar on a capable backend**: `[Codex Fast mode] [Claude ● 10:53] [Codex ● 10:52] [Профили] [Ключи · 2]`.

## Post-Completion
**Deploy** (panel only, per the local CPAMP deploy procedure):
1. Build the web panel.
2. Copy `apps/web/dist/index.html` to `releases/panel-<name>-<date>/management.html`.
3. Back up the plist and the current panel.
4. Run `plutil -replace EnvironmentVariables.PANEL_PATH`.
5. Run `launchctl bootout`, then `bootstrap`.
6. Verify `/health`, the served panel sha, and admin `GET /v8/management/routing/profiles`.

**Manual verification on the live panel**:
- Add a test key (generate, copy, alias) and then delete it. Confirm that `config.yaml` and the alias list have no leftover entry.
- Create a profile for a key from Ключи → Свой профиль. Check the `Routing profile selection` log lines in CPA `logs/stdout.log`, then reset the key to the default.
- Edit the default profile, including the TTL, and confirm `GET /routing/profiles` `shared` and the TTL in `config.yaml`.
- Check the light and dark themes and the narrow-width toolbar.
