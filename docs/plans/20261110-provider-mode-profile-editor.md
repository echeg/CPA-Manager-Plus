# Per-provider mode and API-key fallback in the routing profile editor

## Overview
- The routing profile editor (Quota Management -> Routing profiles) gets one block per provider, Claude and Codex. Each block sets the provider's **mode** (Subscription or API key), its **API key**, and its **fallback target** (Claude: Off / Codex / API key; Codex: Off / API key). This is the panel side of the backend feature `routing.providers` (CLIProxyAPI-migration plan `20261110-provider-api-mode-and-fallback.md`).
- Problem it solves: operators can keep upstream API keys out of normal routing, pin a client key to its own API key for billing, or let a client key fall back to its own API key when subscriptions fail, without editing YAML.
- The Guide section gets a third tab, "Routing with API keys", and updated versions of the two existing diagrams.
- Integration: the same `KeyProfileEditor` serves the Default profile and key profiles; writes stay a merge-PATCH to `/config` followed by a read-back check.

**Prerequisites before this plan runs** (it may be written and committed earlier):
- the branch `guide-section-routing-diagrams` is merged into `main` (Task 5 extends the Guide page);
- the backend plan is merged and deployed, so manual verification runs against the real API. The code and tests of this plan do not need the backend.

## Decisions
- **Context**: the backend adds `providers` to every routing profile and `api_credentials` to `GET /v8/management/routing/profiles`. Contract:
  ```json
  {
    "supported": true,
    "shared": {
      "session-affinity": true,
      "preferred-accounts": {"claude": "idx"},
      "selection": {"primary": "reserves", "tiebreak": "earliest-reset"},
      "claude-fallback": {"enabled": true, "mode": "auto", "mappings": [{"from": "claude-opus-*", "to": "gpt-6-astra"}]},
      "providers": {
        "claude": {"mode": "subscription", "api-credential": "", "fallback": {"target": "codex", "mode": "auto", "mappings": [{"from": "claude-opus-*", "to": "gpt-6-astra"}]}},
        "codex":  {"mode": "api", "api-credential": "codex-key-idx", "fallback": {"target": "off", "mode": "", "mappings": []}}
      }
    },
    "keys": [{"key": "client-key-a", "profile": {"...": "same shape"}}],
    "api_credentials": {
      "claude": [{"auth_index": "idx", "label": "claude-apikey", "base_url": "", "disabled": false}],
      "codex": []
    },
    "selection_options": {"narrowing": ["..."], "pickers": ["..."]}
  }
  ```
  Backend rules the panel must respect: `mode` is `subscription` or `api`; `fallback.target` is `off`, `codex` (Claude only), or `api`; `api-credential` is required when `mode` is `api` or the target is `api`; `mode: api` requires `target: off`; `target: codex` needs at least one valid mapping; an unknown `api-credential` is accepted with a backend warning. `claude-fallback` in the response is a legacy view (`enabled` is true only for `target: codex`).
- **Chosen approach — layout**: shared stages stay on top (Sticky session, Pool selection); below them two provider blocks. The "Preferred subscription" selects and the fallback editor move into the blocks.
  - Subscription mode shows: Preferred subscription, then Fallback (segmented control). Target Codex shows the existing mode select (Automatic / Force Codex now) and the model-mapping table. Target API key shows the API-key select and the hint "Used only after subscriptions fail. The next request tries subscriptions again. Billed to this key."
  - API key mode shows only the API-key select and the hint "Subscriptions are skipped. Billed to this key."
- **Chosen approach — field behavior**:
  - Hidden values are kept in the draft and in the stored profile: the mapping table and the chosen API key survive switching mode or target back and forth.
  - Save normalization: in API key mode the body carries `fallback.target: off`.
  - Save is disabled with a message at the field when: mode or fallback is "API key" and no key is chosen; target is Codex and the mapping table is invalid (existing `validFallbackSettings` rule).
  - No API key configured for a provider: the "API key" options stay visible but disabled, with a hint and a link to AI Providers (`/ai-providers`).
  - A disabled or unknown (no longer listed) chosen key stays in the select, marked `disabled` / `unknown`, with a warning; saving is allowed.
  - `supported: false` (Home mode or a scheduler plugin): in the Default profile mode and fallback are locked in both blocks and Preferred stays editable; key profiles stay read-only as today. A save keeps the stored `providers`.
- **Chosen approach — API-key labels**: `<group or entry name> · <masked key>`, plus `· <host>` when the key has a custom base URL. The panel joins `api_credentials[].auth_index` with the provider key configs it already loads (`providersApi.getClaudeConfigs()` / `getCodexConfigs()` in `apps/web/src/services/api/providers.ts`, which read `auth-index`). Without a match the label is `<label> · <first 8 characters of auth_index>`. A failed configs request is not an error: labels fall back to the unmatched form.
- **Chosen approach — chain summary** (editor footer and profile list), one entry per provider:
  - `Claude: <preferred or Automatic> → Codex` (subscription, Codex fallback, auto)
  - `Claude: Codex (forced)` (Codex fallback, mode always)
  - `Codex: <preferred or Automatic> → API key` (subscription, API-key fallback)
  - `Codex: API key <label>` (API key mode)
  - `<Provider>: <preferred or Automatic>` (fallback off)
  Example: `Sticky session · Claude: Automatic → Codex · Codex: API key codex-1 · reserves → earliest-reset`.
- **Chosen approach — old backend**: one layout, not two. A response without `providers` on the shared profile marks the backend as old (`providersSupported: false`). The panel then derives `providers` from `claude-fallback` (mode Subscription, target Codex or Off), disables the mode control and every "API key" option with the hint "Requires an updated CPA backend", and writes the previous body with `claude-fallback`.
- **Chosen approach — write body on a new backend**: the complete `providers` block and no `claude-fallback`; a cleared `api-credential` is sent as `null` so the merge-PATCH does not keep the old value; the Codex block sends `fallback.target` with `mode` and `mappings` as `null` (CPA accepts any stored Codex mode and mapping rows under target api but checks them under off, so the merge must not keep them).
- **Chosen approach — toolbar**: the standalone "Configure Claude fallback" control (`ClaudeFallbackControl`) duplicates the Default profile and cannot show the API-key target, so it is hidden when `providersSupported` is true.
- **Known consequence**: keeping the mapping table under `target: api` makes the backend log a warning on each config load ("mode/mappings ignored"). Accepted in exchange for not losing the table.
- **Rejected alternatives**:
  - Stage-ordered layout with a new Mode section: one provider's settings end up in three sections, and API mode has to disable fields elsewhere.
  - Claude / Codex tabs inside the editor: the other provider's settings are hidden.
  - Backend-provided key names and masks in `api_credentials`: cleaner contract, but it would change a backend plan already in progress.
  - Labels from backend fields only: two keys of one provider differ only by index.
  - Spend per API key inside the editor, or a link to Usage Analytics: out of scope; Usage Analytics already attributes spend by credential.
  - A separate legacy editor for old backends: two layouts to maintain.
- **Verified facts**:
  - `apps/web/src/features/quota/components/KeyProfileEditor.tsx`: four `section` stages, `fallbackReadOnly` prop for `supported: false`, `chainSummary` in the footer, draft state from `copyOfShared(initial)`.
  - `apps/web/src/features/quota/components/FallbackSettingsEditor.tsx`: toggle + mode select + mapping rows with datalists; styles from `QuotaSettingsToolbar.module.scss`.
  - `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts`: `RoutingProfile`, `readProfile`, `readRoutingProfiles`, `profileBody` (complete body, `null` to clear), `keyProfilePatch`, `sharedProfilePatch`, `saveKeyProfile` / `saveSharedProfile` with the read-back check, `translateWriteError` for `422 invalid_config`.
  - `apps/web/src/features/quota/keyProfilesModel.ts`: `normalizeProfile`, `profileDirty`, `copyOfShared`, `chainSummary`.
  - `apps/web/src/features/quota/components/QuotaSettingsToolbar.tsx` (~line 426) passes `ClaudeFallbackControl` as `fallbackControl`; the editor's `models` come from `useClaudeFallback` (`GET /routing/claude-fallback`), which the backend keeps.
  - `apps/web/src/services/api/providers.ts`: `providersApi.getClaudeConfigs()` (line ~1173) and `getCodexConfigs()` (line ~1047) return `ProviderKeyConfig[]` and handle `auth-index` (`AUTH_INDEX_FIELDS`). Which name field a v8 key group exposes was not checked during planning; Task 2 verifies it.
  - Guide feature on the branch `guide-section-routing-diagrams`: `apps/web/src/features/guide/{GuidePage,DiagramFrame}.tsx`, `guideWiring.test.ts`, `diagrams/{key-routing,pool-selection}.{html,workflow.json}`, `diagrams/README.md`.
  - Ready diagram files (archify `deliver` 9/9 checks, browser `visual-check` pass at 1440x900 ... 2048x1320): `/Users/echeg/Projects/CPA/diagrams/{key-routing,pool-selection,api-key-routing}.html` with their `.workflow.json` sources. `key-routing` and `pool-selection` are updated versions of the ones in the repo.
  - Locales: `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json`; existing texts under `quota_management.fallback.*` and `quota_management.key_profiles.*`.

## Context (from discovery)
- Files/components involved:
  - `apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts` (+ test)
  - `apps/web/src/features/quota/keyProfilesModel.ts`, new `apps/web/src/features/quota/providerRoutingModel.ts` (+ tests)
  - `apps/web/src/features/quota/components/KeyProfileEditor.tsx`, `FallbackSettingsEditor.tsx`, new `ProviderRoutingBlock.tsx` (+ styles, tests)
  - `apps/web/src/features/quota/hooks/useKeyProfiles.ts` (API credentials and provider configs for labels)
  - `apps/web/src/features/quota/components/QuotaSettingsToolbar.tsx` and its wiring (hide the standalone fallback control)
  - `apps/web/src/features/guide/` (third tab, diagram files)
  - `apps/web/src/i18n/locales/*.json`
- Related patterns: controlled editors with a draft and a baseline; canonical `normalizeProfile` for dirty checks and read-back; `Select` from `features/quota/components/Select.tsx`; lifecycle tests (`keyProfiles.lifecycle.test.tsx`) and locale tests (`keyProfiles.locale.test.ts`).
- Dependencies: none new.

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
  - tests are not optional - they are a required part of the checklist
  - tests cover both success and error scenarios
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- Run tests after each change (`cd apps/web && npm test`)
- Never render or log a raw client key or a raw upstream API key; labels use masks only
- Add no new lint warnings (known ones are in `docs/backlog/web-lint-warnings.md`)

## Testing Strategy
- **Unit tests**: Vitest + Testing Library, required for every task
- **Locale test**: every new key exists in `en`, `ru`, `zh-CN`, `zh-TW`
- **E2E tests**: the project has no browser e2e suite; `npm run build` plus a grep of `dist/index.html` stands in for an integration check of the Guide tab

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): tasks achievable within this codebase
- **Post-Completion** (no checkboxes): manual testing, deployment
- **Checkbox placement**: Checkboxes belong only in Task sections.

## Decision Log
- 2026-11-10 brainstorm: **accepted** - provider blocks layout (shared stages on top, one block per provider).
- 2026-11-10 brainstorm: **accepted** - API-key labels are joined in the panel from provider key configs by `auth_index`.
- 2026-11-10 brainstorm: **accepted** - no spend UI in this plan.
- 2026-11-10 brainstorm: **accepted** - hidden values survive switching; API key mode saves `target: off`.
- 2026-11-10 brainstorm: **accepted** - one layout with a capability flag for old backends; the toolbar fallback control is hidden on a new backend.
- 2026-11-10 brainstorm: **rejected** - "stage-ordered layout with a Mode section" - scatters one provider's settings.
- 2026-11-10 brainstorm: **rejected** - "tabs per provider" - hides half of the profile.
- 2026-11-10 brainstorm: **rejected** - "extend `api_credentials` in the backend" - would change a backend plan in progress.
- 2026-11-10 pre-launch check: **accepted** - `/Users/echeg/Projects/CPA/diagrams/pool-selection.*` was rebuilt so it keeps the Guide run's review fix (the "No credential" node reads "not found · cooldown · unavailable"; the cards list `auth_not_found`, 429 and `auth_unavailable`) together with the subscription-mode wording; `deliver` 9/9 and `visual-check` pass again.
- 2026-11-10 pre-launch check: **accepted** - Task 5 and Task 7 also refresh the two existing Guide intros and both manual pages, which still described a Claude → Codex-only fallback.

## Implementation Steps

### Task 1: Extend the profile model and API client with `providers`
- [x] confirm the Guide feature is on this branch (`apps/web/src/features/guide/GuidePage.tsx` exists); if it does not, stop and record a ⚠️ blocker: the prerequisite merge is missing
- [x] in `routingProfiles.ts` add types `ProviderRouting { mode: 'subscription' | 'api'; apiCredential: string; fallback: { target: 'off' | 'codex' | 'api'; mode: 'auto' | 'always'; mappings: {from, to}[] } }`, `RoutingProfile.providers: { claude, codex }`, `ApiCredential { authIndex, label, baseUrl, disabled }`, and on `RoutingProfilesState`: `providersSupported: boolean`, `apiCredentials: { claude: ApiCredential[]; codex: ApiCredential[] }`
- [x] `readProfile`: read `providers` when present (validate enums, default missing values to `subscription` / `off` / `auto` / `[]`); when absent derive it from `claude-fallback`; remove `claudeFallback` from `RoutingProfile` and update every reader (`claude` fallback now lives in `providers.claude.fallback`)
- [x] `readRoutingProfiles`: set `providersSupported` from the shared profile and read `api_credentials` (absent -> empty lists); update `emptyProfile` and `unsupportedRoutingProfiles`
- [x] `profileBody(profile, selectionOptions, providersSupported)`: on a new backend send the complete `providers` block (cleared `api-credential` as `null`, Codex block with `fallback.target` and `mode`/`mappings` as `null`, API key mode forces `target: off`) and no `claude-fallback`; on an old backend send the previous body with `claude-fallback` built from `providers.claude.fallback`; thread the flag through `keyProfilePatch`, `sharedProfilePatch`, `saveKeyProfile`, `saveSharedProfile`
- [x] update `normalizeProfile`, `profileDirty`, `copyOfShared` in `keyProfilesModel.ts` for `providers` (trimmed credential, canonical key order, Codex fallback mode and mappings ignored, mappings normalized as today) so the read-back check compares what the backend keeps
- [x] write tests in `routingProfiles.test.ts`: reading a new response, an old response (derived providers, flag false), invalid enum values; PATCH bodies for both backends including `null` credential and API-mode normalization; read-back equality and inequality
- [x] write tests in the model tests for `normalizeProfile` / `profileDirty` / `copyOfShared` with `providers` (independence of copies, hidden values kept)
- [x] run `npm test` in `apps/web` - must pass before task 2
- ➕ added exported helpers in `routingProfiles.ts`: `effectiveFallbackTarget`, `claudeFallbackOf` (legacy view), `providersFromClaudeFallback` (old-backend derivation, also used by test fixtures), `validClaudeMappings` (save guard, shared with `providerFieldErrors`: CPA checks the Claude mapping rows under every target but API key, so a hidden invalid table under target Off or in API key mode (saved as Off) blocks the save, with a message in the block; an older backend checks the `claude-fallback` rows under every target; at least one row is required only for the Codex target)
- ➕ `KeyProfileEditor` got an interim adapter (legacy toggle editor bound to `providers.claude.fallback`) so the build stays green until Task 4 replaces the layout

### Task 2: Provider routing model: validation, API-key options, summary
- [x] check which fields `ProviderKeyConfig` from `providersApi.getClaudeConfigs()` / `getCodexConfigs()` exposes for a v8 key group (name, masked or raw key, base URL, `authIndex`) and record the answer in Technical Details
- [x] create `apps/web/src/features/quota/providerRoutingModel.ts` with: `providerRoutingErrors(profile, providersSupported)` (missing key for API mode or API fallback, invalid Codex mappings), `apiCredentialOptions(provider, apiCredentials, providerConfigs, selected, t)` returning select options with labels per Decisions (matched, unmatched, `disabled`, `unknown` for a selected index not in the list), and `fallbackTargets(provider)` (`claude`: off/codex/api; `codex`: off/api)
- [x] load provider key configs for labels in `useKeyProfiles.ts` (or a small hook next to it) together with the profiles; a failed configs request leaves labels in the unmatched form and never blocks the editor; never keep a raw upstream key in rendered output (mask with the existing `maskApiKey`)
- [x] rewrite `chainSummary` in `keyProfilesModel.ts` to the per-provider format in Decisions
- [x] write tests for `providerRoutingErrors` (each rule, valid cases, old backend)
- [x] write tests for `apiCredentialOptions` (match, no match, custom host, disabled, unknown selected, empty list, no raw key in any label) and for `chainSummary` (every combination listed in Decisions, masked account names when emails are hidden)
- [x] run `npm test` in `apps/web` - must pass before task 3
- ➕ `chainSummary` takes an optional fifth argument `ApiKeyLabelSource` (`apiCredentials` + `providerConfigs`) to name an API key; without it the key shows by its first 8 index characters. Task 4 passes it from `useKeyProfiles().apiKeyConfigs` and `state.apiCredentials` in `RoutingProfilesModal`, `ClientKeysModal` and `KeyProfileEditor`
- ➕ `useKeyProfiles` keeps `ApiKeyConfigSummary` (index, prefix, mask, base URL) instead of `ProviderKeyConfig`, so a raw upstream key never reaches React state; exposed as `apiKeyConfigs`
- ➕ `providerRoutingErrors` returns i18n keys per field (`apiCredential`, `mappings`); the mappings error reuses `quota_management.fallback.invalid`. Keys added now: `quota_management.provider_routing.{key_disabled,key_unknown,errors.key_required}` and the new `quota_management.key_profiles.summary.*` fragments (`to_codex`, `codex_forced`, `to_api_key`, `api_key`, `api_key_unset`); the unused `summary.fallback_*` keys were removed

### Task 3: Provider block component
- [x] check `apps/web/src/components/ui/` for an existing segmented control (reused `SegmentedTabs`: tab semantics, arrow keys, per-item `disabled` + `title`) or radio group and reuse it; only if none exists, add a small accessible `SegmentedControl` (radiogroup semantics, keyboard arrows, `disabled` per option with a `title` hint)
- [x] split `FallbackSettingsEditor.tsx`: extract the mode select + mapping table into a part that renders without the enable toggle, and keep `FallbackSettingsEditor` working for `ClaudeFallbackControl` (old backend)
- [x] create `ProviderRoutingBlock.tsx` (+ `.module.scss`): props `provider`, `value: ProviderRouting`, `preferred`, `preferredOptions`, `apiKeyOptions`, `models`, `disabled`, `modeLocked` (for `supported: false`), `providersSupported`, `onChange`, `onPreferredChange`; renders the mode control, then by mode the fields described in Decisions, including hints, the no-keys state with a link to `/ai-providers`, and the disabled/unknown key warning
- [x] add the i18n keys under `quota_management.provider_routing.*` to all four locales (mode labels, fallback labels, both billing hints, no-keys hint, link text, disabled/unknown key warning, old-backend hint, validation messages, summary fragments); Russian and Chinese texts written naturally, not word for word
- [x] write `ProviderRoutingBlock.test.tsx`: both modes for both providers; switching mode and target calls `onChange` without dropping hidden values; Codex has no "Codex" target; options disabled with no keys; `modeLocked` and `providersSupported: false` states; warning for a disabled key
- [x] extend `FallbackSettingsEditor.test.tsx` for the extracted part and confirm the standalone editor still works
- [x] run `npm test` in `apps/web` - must pass before task 4

### Task 4: Integrate into `KeyProfileEditor` and the toolbar
- [x] `KeyProfileEditor.tsx`: keep the Sticky session and Pool selection sections, remove the Preferred and fallback sections, render two `ProviderRoutingBlock`s; pass `providersSupported`, `apiCredentials`, and provider configs from `RoutingProfilesModal.tsx`
- [x] validation and save: `invalid` uses `providerRoutingErrors`; `save` applies API-mode normalization; with `fallbackReadOnly` (backend `supported: false`) keep the stored `providers` mode and fallback and save only Preferred and the shared stages
- [x] keep `withSuggestions` behavior for an empty mapping table (the baseline uses the same suggestions) now applied to `providers.claude.fallback` (a save still stores the suggested table, as before)
- [x] hide `ClaudeFallbackControl` in the toolbar wiring when `providersSupported` is true; keep it for old backends
- [x] update `KeyProfileEditor.test.tsx` and `keyProfiles.lifecycle.test.tsx`: new layout, Save disabled for each validation error, saved body for API mode and for API fallback, hidden values round trip, `supported: false`, old backend (API options disabled, legacy body sent)
- [x] update `keyProfiles.locale.test.ts` for the new keys and a test for the toolbar control visibility (the visibility tests live in `keyProfiles.lifecycle.test.tsx`; PATCH bodies are checked with the real hook in `profilesKeysFlow.lifecycle.test.tsx`)
- [x] run `npm test` in `apps/web` - must pass before task 5

### Task 5: Guide: third tab and updated diagrams
- [x] copy byte-for-byte into `apps/web/src/features/guide/diagrams/`: `/Users/echeg/Projects/CPA/diagrams/api-key-routing.html` and `api-key-routing.workflow.json` (new), and replace `key-routing.html`, `key-routing.workflow.json`, `pool-selection.html`, `pool-selection.workflow.json` with the files of the same names from `/Users/echeg/Projects/CPA/diagrams/`
- [x] add the tab `api-key-routing` to `GuidePage.tsx` (`?raw` import, i18n keys `guide.tab_api_key_routing` and `guide.intro_api_key_routing` in all four locales; the intro explains in two or three sentences that API keys are used only through API key mode or an API-key fallback, and that the fallback leg does not bind the session)
- [x] update `guide.intro_key_routing` and `guide.intro_pool_selection` in all four locales to match the replaced diagrams: in Subscription mode only OAuth credentials are candidates, the fallback target is a Codex subscription or the profile's API key (Codex: its API key only), and API keys are never picked on their own; keep the existing sentences about `auth_not_found`, 429 with `Retry-After` and `auth_unavailable` unchanged in meaning
- [x] update `GuidePage.test.tsx` (three tabs; the third iframe `srcdoc` contains "Routing with API keys") and `guideWiring.test.ts` (new keys in all locales)
- [x] run `npm test` in `apps/web` - must pass before task 6
- ➕ `intro_pool_selection` keeps its error sentences unchanged and gains a leading sentence on Subscription mode (OAuth credentials only) and API key mode (the profile's one key); `guideWiring.test.ts` also checks the English tab label and that the intros mention the API-key fallback

### Task 6: Verify acceptance criteria
- [x] verify every item of Decisions against the code: layout, field behavior, labels, summary, old backend, write body, toolbar
- [x] verify edge cases: a profile whose stored API credential is unknown; both providers in API key mode; switching Subscription -> API key -> Subscription keeps Preferred, the mapping table and the key; no raw key in the DOM (search rendered output in tests for a sample key)
- [x] run the full `apps/web` suite (`npm test`)
- [x] run `npm run lint` in `apps/web` - no new warnings
- [x] run `npm run build` in `apps/web` and verify `dist/index.html` contains "Routing with API keys"
- ➕ verification found that `ClientKeysModal` still called `chainSummary` without API-key labels (an API-key-mode profile showed the first 8 index characters there); it now passes `state.apiCredentials` and `apiKeyConfigs` like `RoutingProfilesModal`, with a test in `clientKeysModal.lifecycle.test.tsx`
- ➕ lint: 0 errors, only the 7 known warnings from `docs/backlog/web-lint-warnings.md`

### Task 7: Update documentation
- [x] update the panel's user-facing docs or README section that describes Routing profiles (if one exists) with the provider blocks and the API-key options (`docs/personal-quota.md`, linked from `README.md`: new section "Per-provider mode and API-key fallback", and the features list, Guide paragraph, fallback storage, profile save body, chain summary, read-only/older-backend notes and the YAML example updated)
- [x] update `apps/web/src/features/guide/diagrams/README.md` to list the third diagram
- [x] update `apps/docs/en/manual/guide.md` and `apps/docs/manual/guide.md`: list the third diagram and replace the "Claude → Codex fallback" wording with the per-provider fallback (Codex subscription or API key)
- ➕ the repo suite's `tests/installerScript.test.mjs` timed out at random at the 5s default (each case runs the real installer); its `describe` now has a 30s timeout

## Technical Details
- **Capability flag**: `providersSupported = isRecord(raw.shared.providers)`.
- **PATCH body, new backend** (key profile; the shared profile uses the same fields at `routing.*`):
  ```json
  {"routing": {"key-profiles": {"<key>": {
    "session-affinity": true,
    "preferred-accounts": {"claude": null, "codex": null},
    "selection": {"primary": "reserves", "tiebreak": "earliest-reset"},
    "providers": {
      "claude": {"mode": "subscription", "api-credential": "idx-or-null",
                 "fallback": {"target": "api", "mode": "auto", "mappings": [{"from": "claude-opus-*", "to": "gpt-6-astra"}]}},
      "codex":  {"mode": "api", "api-credential": "idx", "fallback": {"target": "off", "mode": null, "mappings": null}}
    }
  }}}}
  ```
- **PATCH body, old backend**: today's body; `claude-fallback.enabled = (providers.claude.fallback.target === 'codex')`.
- **Read-back comparison**: compare `normalizeProfile` of the stored and the sent profile; ignore Codex fallback mode and mappings.
- **`ProviderKeyConfig` fields available for labels** (checked in Task 2): `providersApi.getClaudeConfigs()` / `getCodexConfigs()` call the v0 routes `/claude-api-key` and `/codex-api-key` (the v8 management group has no such routes) and return `apiKey` (raw), `prefix`, `baseUrl`, `authIndex` (from `auth-index`, injected by the backend from the live auth manager), plus priority, models and other settings. There is no name field; `prefix` is the only name and the AI Providers table also sorts by it. The backend `api_credentials[].label` is generic (`claude-apikey`, `codex-apikey`). So the label name is `prefix`, else the backend label; the key part is `maskApiKey(apiKey)`; the host comes from the entry's `baseUrl`, else the credential's `base_url`. Entries without `auth-index` cannot be matched and are dropped.

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification** (needs the deployed backend):
- With one test `api-keys.claude` entry: set a client key to fallback "API key", save, reopen, confirm the stored value and the summary line; switch the key to API key mode and back; confirm the Default profile still saves.
- Confirm the "API key" options are disabled for a provider without keys and the link opens AI Providers.
- Check the editor at ~1280px width and in the dark theme; check the third Guide tab.

**Deployment**:
- Panel-only deploy per the local launchd procedure (build web, new `releases/panel-<name>-<date>/management.html`, back up the plist, switch `PANEL_PATH`, bootout/bootstrap).
