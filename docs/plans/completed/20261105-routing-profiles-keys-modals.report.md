# Report: 2026 11 05 routing profiles keys modals
plan: /Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/routing-profiles-keys-modals/docs/plans/20261105-routing-profiles-keys-modals.md | branch: routing-profiles-keys-modals | base: main | mode: full | executor: claude | task model: claude:opus:high | review model: claude:opus:xhigh | started: 2026-11-05T11:03:01Z | finished: 2026-11-05T13:05:56Z

## Summary
- task iterations: 12
- failed retries: 0
- external reviewers: 1
- post-review iterations: 1
| phase | duration_ms |
|---|---:|
| evaluation | 471082 |
| external review | 424470 |
| internal review | 3158046 |
| other | 0 |
| tasks | 3321248 |

## Change scope
- commits: 14
- files: 40
- additions: 5106
- deletions: 1480
| status | path |
|---|---|
| M | apps/web/src/components/config/ApiKeysCardEditor.tsx |
| A | apps/web/src/features/personal-quota-support/services/api/clientKeys.test.ts |
| A | apps/web/src/features/personal-quota-support/services/api/clientKeys.ts |
| M | apps/web/src/features/personal-quota-support/services/api/routingProfiles.test.ts |
| M | apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts |
| M | apps/web/src/features/personal-quota-support/services/api/subscriptionRouting.ts |
| M | apps/web/src/features/quota/QuotaPage.lifecycle.test.tsx |
| A | apps/web/src/features/quota/clientKeysModal.lifecycle.test.tsx |
| A | apps/web/src/features/quota/components/ClientKeysModal.module.scss |
| A | apps/web/src/features/quota/components/ClientKeysModal.tsx |
| M | apps/web/src/features/quota/components/KeyProfileEditor.module.scss |
| M | apps/web/src/features/quota/components/KeyProfileEditor.test.tsx |
| M | apps/web/src/features/quota/components/KeyProfileEditor.tsx |
| D | apps/web/src/features/quota/components/KeyProfilesModal.tsx |
| M | apps/web/src/features/quota/components/QuotaSettingsToolbar.tsx |
| R084 | apps/web/src/features/quota/components/RoutingProfilesModal.module.scss |
| A | apps/web/src/features/quota/components/RoutingProfilesModal.tsx |
| M | apps/web/src/features/quota/hooks/useClaudeFallback.ts |
| M | apps/web/src/features/quota/hooks/useKeyProfiles.ts |
| M | apps/web/src/features/quota/hooks/useSubscriptionRouting.ts |
| M | apps/web/src/features/quota/keyProfiles.lifecycle.test.tsx |
| A | apps/web/src/features/quota/keyProfiles.locale.test.ts |
| A | apps/web/src/features/quota/profilesKeysFlow.lifecycle.test.tsx |
| M | apps/web/src/features/quota/quotaSettingsHooks.test.ts |
| M | apps/web/src/features/quota/quotaSettingsToolbar.test.ts |
| M | apps/web/src/features/quota/routingModel.ts |
| A | apps/web/src/features/quota/routingProfilesModal.lifecycle.test.tsx |
| M | apps/web/src/features/quota/settingsHooks.lifecycle.test.tsx |
| M | apps/web/src/features/quota/useKeyProfiles.lifecycle.test.tsx |
| M | apps/web/src/hooks/useApiKeyAliases.test.tsx |
| M | apps/web/src/hooks/useApiKeyAliases.ts |
| M | apps/web/src/i18n/locales/en.json |
| M | apps/web/src/i18n/locales/ru.json |
| M | apps/web/src/i18n/locales/zh-CN.json |
| M | apps/web/src/i18n/locales/zh-TW.json |
| A | apps/web/src/utils/apiKeyGenerator.test.ts |
| A | apps/web/src/utils/apiKeyGenerator.ts |
| M | docs/backlog/unused-subscription-routing-components.md |
| M | docs/personal-quota.md |
| M | docs/plans/20261105-routing-profiles-keys-modals.md |

## Evidence
_assessment unavailable_

## Risk
_assessment unavailable_

## Merge danger
_assessment unavailable_

## Migrations and operational steps
_assessment unavailable_

## Plan deviation
_assessment unavailable_
### Added
- ➕ review: the legacy top-level path is dropped. CPA's v8 `GET /config` moves a legacy top-level list into `access.api-keys` (`NormalizeConfigLayout(data, true)`), and a v8 write rejects that field (`ValidateV8Config`), so keys are always written to `access.api-keys`. A write starts from the stored entries, so an entry the panel cannot show (an unquoted numeric key decodes as a number) is written back instead of being dropped
- ➕ `useApiKeyAliases` now also returns `serviceBase`, `managementKey` and `stateKnown` (host confirmed and, on a manager-hosted panel, the alias list loaded), which `useKeyProfiles` passes to `clientKeys.ts` as the alias context; covered in `useApiKeyAliases.test.tsx`
- ➕ `saveShared` also returns false without a loaded state or on a 404 backend (`unsupportedBackend`), because it needs `selectionOptions` and its read-back would fail after a landed PATCH there; `removeKey` resolves to the same `{ok, aliasWarning?}` shape as `addKey`. Domain errors live under `quota_management.client_keys.errors.*`
- ➕ the modal takes the `useKeyProfiles` result as its `keyProfiles` prop, as `KeyProfilesModal` did, so the tests pass a stand-in object for the hook. Locale keys live under `quota_management.key_profiles.profiles.*`. The focus is applied during render once the profiles are loaded (the React Compiler lint rejects setState in an effect), and a focus on a key on the default is ignored when `supported: false`
- ➕ review: with `supported: false` the default editor locks only its fallback stage (`fallbackReadOnly`, hint `quota_management.fallback.unsupported`) and a save keeps the stored fallback block, because CPA ignores the fallback in Home or scheduler-plugin mode, as the old toolbar's `ClaudeFallbackControl` did. The modals no longer carry an `unsupportedBackend` branch (they render only on the slim toolbar), and `key_profiles.unsupported` is removed from all four locales
- ➕ `useKeyProfiles` also returns `aliasesEditable` (the alias service is reachable and its state is known, the condition `addClientKey` needs for an alias), which disables the alias input; covered in `useKeyProfiles.lifecycle.test.tsx`. A failed copy also reveals the key, so it can be copied by hand. Locale keys live under `quota_management.client_keys.*`; the reset confirmation reuses `key_profiles.profiles.reset_confirm*`
- ➕ reword `key_profiles.editor.ttl` in all four locales: it still says the TTL is "set in the toolbar", which is wrong once the TTL lives in the По умолчанию row
- ➕ the toolbar takes a `profileButtons` prop (`{total, disabled, onOpenProfiles, onOpenKeys}`); when set it renders the slim row (`data-toolbar="slim"`), otherwise the legacy one. The last-routed indicator is a shared `LastRouted` piece for both rows. Button keys live under `key_profiles.profiles_button*` and `client_keys.button*`. The navigation `focus` is passed to the Profiles modal only after the reload it started is seen (`focusArmed`), so a draft or edit never copies the cached rows. The modals render only on the slim toolbar. `keyProfiles.lifecycle.test.tsx` now covers the bar: slim toolbar, buttons, navigation, focus and the legacy 404 toolbar
- ➕ the legacy `SubscriptionRoutingSettings.selection` and the selection branch of `subscriptionRoutingPatch` are removed too, so the legacy save can only send `routing.strategy`. `RoutingProfilesSource` is now `{failed?}`. `useClaudeFallback` loses its `onSaved` parameter (the bar was its only caller). `ClaudeFallbackControl` keeps its `fallback` prop, because the legacy 404 toolbar still renders it. The toolbar-only `quota_management.routing.selection_hint` locale key is removed from all four locales
- ➕ review: `failed`, `strategyLocked` and `RoutingProfilesSource` are removed. Task 8 renders the slim toolbar before the first load and after a failed one, so the legacy toolbar shows only for a loaded 404 state and the lock could never apply
- ➕ removed 13 keys from `quota_management.key_profiles` in all four locales: `button`, `button_hint`, `title`, `shared_title`, `shared_hint`, `badge_shared`, `badge_own`, `reset`, `empty`, `editor.mode`, `editor.mode_shared`, `editor.mode_own`, `editor.shared_hint`. The grep covered the literal keys and the `${prefix}` lookups in `ClientKeysModal` and `useKeyProfiles`, which only use `client_keys`. The locale test also checks that every value is a non-empty string
- ➕ verified: type-check clean, lint 0 errors and 7 warnings, all pre-existing in files this branch does not touch (AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx, UsageMaintenanceCapabilityViews.tsx), test:web 305 files and 5052 tests passed. Edge cases map to clientKeys.test.ts, useKeyProfiles.lifecycle.test.tsx, clientKeysModal/routingProfilesModal lifecycle tests, KeyProfileEditor.test.tsx, routingProfiles.test.ts and quotaSettingsHooks.test.ts (invalidTTL); raw-key checks: clientKeys.test.ts "never puts a raw key in a request URL" and the masking tests, plus the "never renders a raw key" tests in both modal suites and keyProfiles.lifecycle.test.tsx
### Blocked
- none
### Skipped
- none

## Backlog
- none

## External review
### codex:gpt-6-astra:xhigh
- label: codex
- iterations: 2
- duration_ms: 895514
- ended by: done
- had findings: true
#### Iteration 1
- truncated: false
Reviewer output:
```
1. **[P1] Reject stale confirmation callbacks before writing** — [useKeyProfiles.ts:137](/Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/routing-profiles-keys-modals/apps/web/src/features/quota/hooks/useKeyProfiles.ts:137)  
   The global delete confirmation retains `removeKey` across unmounts and connection changes. `beginWrite()` checks neither mounted state nor the captured connection revision, so confirming afterward can delete the matching key on the new connection. The service captures that new connection; the later `isCurrent()` check only discards the result. Reproduced a stale callback issuing GET and PATCH on the new revision before returning `{ok:false}`. Check mounted state and revision before starting any request.

2. **[P2] Retry alias loading through Refresh** — [useKeyProfiles.ts:72](/Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/routing-profiles-keys-modals/apps/web/src/features/quota/hooks/useKeyProfiles.ts:72)  
   The hook consumes `stateKnown` but never invokes `useApiKeyAliases().reload()`. After one transient alias-load failure, key deletion remains blocked and alias entry stays disabled even after the service recovers. Refresh and reopening either modal reload only config and profiles. Reproduced recovery followed by Refresh still making no additional alias request and deletion returning `alias_state_unknown`. Include alias loading in the refresh/retry path.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex findings with technical rigor.Confirmed both findings in code; now checking how the modals gate buttons on loading before writing the fixes.Now the tests: I'll make the mocked alias reload countable and add tests for stale callbacks and alias retry.Quota suite passes (401 tests). Next I'll check that the new tests fail without the fix: revert the hook temporarily, run them, then restore it.All 4 new tests fail without the fix, and the fix is back in place. Now the full suite, lint and type-check, plus a docs check for the Refresh behavior.Fixes, tests and docs are done. One last formatting check on the changed files.Both findings are real and I fixed both. The changes are uncommitted, as the loop requires.

Finding 1 (P1, stale confirmation callbacks): fixed.
- What was wrong: the confirmation dialog lives in a global store and keeps the removeKey or saveKeyProfile function from the render that opened it. beginWrite only checked that function's own copies of disabled, loading and savingRef. The services call guardConfigConnection() when they start, so a callback left over from the old connection read the new connection's revision and went on to GET and PATCH the new connection. The later isCurrent() check only dropped the result after the write had already landed.
- Fix (useKeyProfiles.ts, beginWrite): it now refuses with !isCurrent() before claiming the write slot. isCurrent() checks that the hook is still mounted and that the revision the callback captured is still the current one. All four writers go through beginWrite (saveKeyProfile, saveShared, addKey, removeKey), so this also covers the "Reset to default" confirmation in both modals.

Finding 2 (P2, alias load never retried): fixed.
- What was wrong: useKeyProfiles never called useApiKeyAliases().reload(). After one failed alias load the state stayed unknown until a remount or a connection change. Delete kept failing with "Try again later", and no retry ever reloaded the alias list.
- Fix: reload(), which runs on Refresh and when either modal opens, now also reloads aliases when aliasStateKnown is false. A failed write with AliasStateUnknownError also starts an alias reload, so the next attempt passes once the Manager Server answers.
- A list that already loaded is not reloaded. Reloading it would briefly mark the state unknown, so the alias input would switch off and show the "alias unavailable" hint every time a modal opens. Not picking up alias edits made elsewhere is existing documented behavior (plan, "Alias refresh" fact), so nothing gets worse.

Tests (useKeyProfiles.lifecycle.test.tsx): the alias mock's reload now counts calls, and 4 tests are new:
- a removeKey or saveKeyProfile callback kept past a connection change sends no request;
- an addKey or removeKey callback kept past an unmount sends no request;
- a reload retries an alias list that is not known, and leaves a known one alone;
- a delete refused with AliasStateUnknownError reloads aliases without reloading profiles.

With the hook change reverted, all 4 fail; with it restored, they pass.

Docs (docs/personal-quota.md): I added a sentence on how a refused delete, Refresh and opening a modal retry the alias list. I also added a sentence that a confirmation opened before a connection change or an unmount sends nothing.

Checks:
- Full web suite: 306 files, 5066 tests passed.
- Type-check passes, and prettier --check is clean on the changed files.
- Lint has 0 errors. Its 7 warnings are all in files this branch does not touch: AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx and UsageMaintenanceCapabilityViews.tsx. The lint script does not fail on warnings, so I left them alone.
```
#### Iteration 2
- truncated: false
Reviewer output:
```
NO ISSUES FOUND.

Both previous findings are correctly fixed: stale callbacks are rejected before requests begin, and failed alias loads are retried through Refresh, modal opening, and alias-state errors.

```
Evaluator response:
```
Tests (306 files, 5066 passed), type-check and lint (0 errors) all pass. The 7 lint warnings are in files this branch does not touch. Staging the three files this loop changed and committing.Codex found no issues this round. It confirmed both earlier fixes in useKeyProfiles.ts work:
- A write callback kept past an unmount or a connection change, such as a delete confirmation's onConfirm, is now refused before it sends any request.
- An alias list that failed to load is loaded again on Refresh, when either modal opens, and after a delete is refused because the alias state is unknown.

Before committing I ran the checks:
- Web tests: 306 files, 5066 tests, all passed.
- Type-check: no errors.
- Lint: 0 errors and 7 warnings, all in files this branch doesn't touch (AccountsPage.test.tsx, AccountHealthBadge.tsx, DashboardPage.tsx, UsageMaintenanceCapabilityViews.tsx).

I committed only the three files this review loop changed (useKeyProfiles.ts, useKeyProfiles.lifecycle.test.tsx and docs/personal-quota.md) as 2612a3a3 "fix: address codex review findings". Nothing went to the backlog, and the working tree is now clean.

<<<RALPHEX:EXTERNAL_REVIEW_DONE>>>
```

## Validation
- `npm run type-check`
- `npm run lint`
- `npm run test:web`
- duration_ms: 496158
- runs: 18