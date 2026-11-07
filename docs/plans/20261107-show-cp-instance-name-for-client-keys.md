# Show the bridex instance name for CP-issued client keys

## Overview
- The bridex control plane (CP, repo `bridex-cp`) issues every instance its own LLM-proxy client key through CLIProxyAPI's Management API, in the format `sk-bx-<instance name>-<32 base62 chars>`.
- The panel masks client keys to `sk******xx` (`apps/web/src/utils/format.ts:19-31` `maskApiKey`), so the instance name is hidden. In the Client keys modal, only a key with a manually stored alias (for example `ecwowk`) has a name; every CP key reads as an anonymous `sk******xx`.
- After this change a CP-issued key with no stored alias is labelled with its instance name automatically, and looks exactly like an alias row: `<name>  sk*******xx`. This applies wherever the panel turns a configured key into a label:
  - the Client keys and Routing profiles modals;
  - monitoring;
  - usage analytics.
- Web only. CLIProxyAPI, the Manager Server and `bridex-cp` are unchanged. A stored alias still wins, and keys that are not in the CP format look exactly as before.

## Decisions
- **Context**: the user saw anonymous `sk******xx` rows in the Client keys modal and asked for keys to carry names such as the instance name. Discovery showed that CP keys already contain the instance name and only the panel's mask hides it. CLIProxyAPI has no name field for a client key. Display names come from Manager Server aliases (`APIKeyAlias {apiKeyHash, alias, updatedAtMs}`, keyed by the sha256 hex of the key).
- **Direction chosen by the user**: the panel derives the name from the key. Nothing is written anywhere.
- **Chosen approach**:
  - New pure helper `apps/web/src/utils/apiKeyName.ts`:
    - `cpInstanceNameFromKey(key: string): string | null` trims the key and matches `^sk-bx-(_placeholder|[a-z0-9][a-z0-9-]{1,30})-[A-Za-z0-9]{32}$`. It returns the name group, otherwise `null`. The name alternative mirrors the CP's own instance-name rule exactly, plus its placeholder, so a malformed name group such as `-` (which the UI already uses for "no key", `rowBuilders.ts:593`) never becomes a label.
    - Backtracking still extracts hyphenated names correctly, because the tail is exactly 32 base62 characters with no hyphen.
  - `buildApiKeyDisplayMap` (`apps/web/src/features/monitoring/model/apiKeys.ts:18-40`):
    - when it builds the entry for a raw configured key, `label = sanitizeApiKeyDisplayText(cpInstanceNameFromKey(apiKey) ?? '') || masked`;
    - `masked` and `copyValue` are unchanged;
    - the alias loop that follows is unchanged, so a stored alias still overrides the derived name.
  - Nothing else changes:
    - `buildKeyRows` (`apps/web/src/features/quota/keyProfilesModel.ts:78-89`) already takes the label from this map. Its `hasAlias` (`label !== masked`) becomes `true` for a derived name, so `ClientKeysModal.tsx:331` and `RoutingProfilesModal.tsx:274,339` show the masked key next to the name, exactly like alias rows;
    - its guard `!info.label.includes(row.key)` keeps passing, because the name is a part of the key and never the whole key;
    - alias deletion (`apps/web/src/features/personal-quota-support/services/api/clientKeys.ts:222-230`) checks only stored aliases, so a derived name is never deleted or persisted as an alias.
  - **Data flow**: raw configured keys go through `buildApiKeyDisplayMap`, which produces the label for:
    - the Client keys and Routing profiles modals (`keyProfilesModel.ts:79`);
    - monitoring (`apps/web/src/features/monitoring/hooks/useMonitoringData.ts:495`);
    - usage analytics (`apps/web/src/features/usage-analytics/useUsageAnalytics.ts`).
  - **Errors**: a key that is not in the CP format keeps today's masked label. The derived label holds only the name segment; the 32-character tail is never part of the label (the mask keeps its existing behaviour of showing the key's last two characters, `format.ts:26-28`).
  - **Key-like names**: an instance name that itself matches a key pattern of `maskSensitiveText` (`sk-` or `sess-` followed by 6+ characters, `format.ts:36`, for example `sk-abcdef`) is shown sanitized (`sk******ef`), exactly as a key-like alias is today (`useMonitoringData.test.ts:547-558`). Monitoring and usage analytics sanitize labels again anyway (`eventRows.ts:111-114`, `usageAnalyticsModel.ts:1432`).
- **Rejected alternatives**: the user chose the panel-side option over these two and gave no further reason:
  - the CP writes an alias into the Manager Server (`PUT /v0/management/api-key-aliases`, sha256 of the key mapped to the instance name). That needs the Manager Server URL and its own admin key in the CP console, because `adminauth` `PanelUsesExternalManagementKey` is always false;
  - doing both.
- **Verified facts**:
  - CLIProxyAPI client keys are a flat string list: v0 `/v0/management/api-keys`, v8 `access.api-keys` (CLIProxyAPI `docs/management-api-v8.md:37`).
  - Instance names in `bridex-cp` are `^[a-z0-9][a-z0-9-]{1,30}$` (`bridex-cp/src/api/admin.ts:881`). The CP builds keys as `sk-bx-<name>-<32 base62>` (`bridex-cp/src/provisioning/proxyKeys.ts:81-86`). When it revokes the last key, it leaves the placeholder `sk-bx-_placeholder-<32>` (`proxyKeys.ts:88-92`).
  - `sanitizeApiKeyDisplayText` (`apiKeys.ts:12-16`) masks sensitive text, and aliases already pass through it.
  - `shouldPreferApiKeyAlias(label, masked)` (`apiKeys.ts:43-44`) prefers any label that differs from the mask and does not start with `sha256:`, so monitoring shows a derived name.
  - `DashboardPage.tsx:299` builds its own separate `apiKeyAliasMap` and is out of scope.
  - The `sk-bx-<name>-<32>` format is a cross-repo contract owned by `bridex-cp`. If the CP changes it, names silently disappear.
- **Success criteria**:
  - A CP-issued key with no alias shows `<instance name>` as its label, plus the masked key, in the Client keys and Routing profiles modals, monitoring and usage analytics.
  - A stored alias still wins.
  - Non-CP keys look exactly as before.
  - An instance name that looks like a key (`sk-…`/`sess-…`) is shown sanitized, like a key-like alias.
  - `npm test`, `npm run type-check` and `npm run lint` pass.
- **Non-goals**:
  - changes to `bridex-cp`;
  - writing aliases to the Manager Server;
  - `DashboardPage`'s own alias map;
  - changing `maskApiKey`.

## Context (from discovery)
- **Files/components involved**:
  - `apps/web/src/utils/apiKeyName.ts` (new);
  - `apps/web/src/utils/apiKeyName.test.ts` (new);
  - `apps/web/src/features/monitoring/model/apiKeys.ts`;
  - `apps/web/src/features/monitoring/hooks/useMonitoringData.test.ts` (the existing `describe('buildApiKeyDisplayMap')` at line 536);
  - `apps/web/src/features/quota/keyProfilesModel.test.ts` (the existing `describe('buildKeyRows')` at line 115);
  - `apps/web/src/features/monitoring/model/eventRows.test.ts` (`buildEventRows`, `eventRows.ts:32`, which labels events from the display map at `eventRows.ts:110-118`);
  - `apps/web/src/features/usage-analytics/usageAnalyticsModel.test.ts` (`resolveUsageApiKeyLabel`, `usageAnalyticsModel.ts:1418-1434`);
  - `docs/personal-quota.md`, the **How keys are shown** paragraph (`docs/personal-quota.md:243-249`), which today says a key without an alias shows a mask.
- **Related patterns found**:
  - pure helpers in `apps/web/src/utils/` with a sibling `*.test.ts` (`apiKeyHash.ts`, `apiKeyGenerator.ts`);
  - display labels resolved once in `buildApiKeyDisplayMap`, then read by every screen.
- **Dependencies identified**: none new. Tests use vitest and `sha256Hex` from `@/utils/apiKeyHash`.

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
- **Unit tests**: required for every task (vitest; `npm --workspace apps/web run test -- <path>` for a single file, `npm test` for the full suite).
- **E2E tests**: none in this repository for these screens.

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code changes, tests, documentation updates in this repository
- **Post-Completion** (no checkboxes): deploying the panel and checking it against the live proxy

## Decision Log
- 2026-11-07 loopai-brainstorm-v2: **accepted** - the name is derived in `buildApiKeyDisplayMap`, the single point where a key becomes a label. The Client keys and Routing profiles modals, monitoring and usage analytics all read it (`apiKeys.ts:18-40`; `keyProfilesModel.ts:79`; `useMonitoringData.ts:495`; `useUsageAnalytics.ts`).
- 2026-11-07 loopai-brainstorm-v2: **accepted** - only the CP format is parsed: `^sk-bx-([a-z0-9_-]+)-[A-Za-z0-9]{32}$`. It covers instance names `^[a-z0-9][a-z0-9-]{1,30}$` and the `_placeholder` key (`bridex-cp/src/provisioning/proxyKeys.ts:81-92`; `bridex-cp/src/api/admin.ts:881`).
- 2026-11-07 loopai-brainstorm-v2: **accepted** - a stored alias wins over the derived name, because the alias loop already overrides `label` (`apiKeys.ts:29-38`).
- 2026-11-07 loopai-brainstorm-v2: **accepted** - the mask is unchanged. `masked` stays `sk******xx` and is shown next to the name, as for alias rows (`apiKeys.ts:26`; `ClientKeysModal.tsx:331`).
- 2026-11-07 loopai-brainstorm-v2: **accepted** - the derived name goes through `sanitizeApiKeyDisplayText`, like aliases (`apiKeys.ts:12-16`).
- 2026-11-07 loopai-brainstorm-v2: **accepted** - the CP placeholder `sk-bx-_placeholder-…` shows as `_placeholder`, with no special case (`bridex-cp/src/provisioning/proxyKeys.ts:88-92`).
- 2026-11-07 loopai-brainstorm-v2: **accepted** - the cross-repo format contract is pinned by tests and a paragraph in `docs/personal-quota.md` in this repository. `bridex-cp` is untouched, because the key format is produced there and stays as it is.
- 2026-11-07 grill: **accepted** - Task 4, Context and the Decisions now rewrite the **How keys are shown** paragraph (`docs/personal-quota.md:243-249`) instead of adding a bullet to the add/delete bullets - decided by grill: that paragraph states that keys without an alias show a mask, which this change makes false.
- 2026-11-07 grill: **accepted** - the parser pattern in Decisions, Task 1 and Technical Details is narrowed from `([a-z0-9_-]+)` to `(_placeholder|[a-z0-9][a-z0-9-]{1,30})`, with Task 1 cases for `sk-bx---<32>`, `sk-bx--x-<32>`, a 1-character and a 32-character name, and `_other` - decided by grill: the CP's own instance-name rule (`bridex-cp/src/api/admin.ts:881`) and placeholder (`proxyKeys.ts:92`) define the format, and the loose group turned `sk-bx---<32>` into the label `-`, which the UI reads as "no key" (`rowBuilders.ts:593`).
- 2026-11-07 grill: **accepted** - Decisions and Success criteria now state that an instance name matching a `maskSensitiveText` key pattern (for example `sk-abcdef`) is shown sanitized, and Task 2 pins it with a test - decided by grill: `format.ts:36` masks `sk-`/`sess-` plus 6+ characters, the accepted sanitizing decision and the existing key-like alias test (`useMonitoringData.test.ts:547-558`) fix that behaviour, and monitoring and usage analytics sanitize labels again (`eventRows.ts:111-114`, `usageAnalyticsModel.ts:1432`), so skipping the sanitizer would not show the raw name there either.
- 2026-11-07 grill: **accepted** - Task 2 adds label tests for monitoring (`buildEventRows` in `eventRows.test.ts`) and usage analytics (`resolveUsageApiKeyLabel` in `usageAnalyticsModel.test.ts`) and runs `src/features/usage-analytics` too - decided by grill: both are success criteria and each builds its own label from the display map (`eventRows.ts:110-118`, `usageAnalyticsModel.ts:1418-1434`), and no planned test covered them.
- 2026-11-07 grill: **accepted** - the Errors line in Decisions now says the derived label holds only the name segment (the mask already shows the key's last two characters), and Tasks 1-2 assert an exact name and that the label never contains the 32-character tail - decided by grill: `maskApiKey` keeps the last two characters (`format.ts:26-28`), so "no part of the tail is ever displayed" was false, and no planned test caught a regex that captures the tail.

## Implementation Steps

### Task 1: Add the CP instance name parser
- [x] create `apps/web/src/utils/apiKeyName.ts` exporting `cpInstanceNameFromKey(key: string): string | null`: trim the key, match `^sk-bx-(_placeholder|[a-z0-9][a-z0-9-]{1,30})-[A-Za-z0-9]{32}$`, return the name group or `null`; a doc comment names `bridex-cp` as the format's owner and its instance-name rule `^[a-z0-9][a-z0-9-]{1,30}$`
- [x] create `apps/web/src/utils/apiKeyName.test.ts` with success cases, each asserting the exact returned name: a plain name (`sk-bx-ecwowk-<32>` gives `ecwowk`), a hyphenated name (`sk-bx-team-a-1-<32>` gives `team-a-1`), a short name that looks like base62 (`sk-bx-abc-<32>` gives exactly `abc`, not part of the tail), a 31-character name, `_placeholder`, and surrounding whitespace
- [x] add the non-matching cases to `apiKeyName.test.ts`: a foreign `sk-…` key, a tail of 31 and of 33 characters, a non-base62 character in the tail, uppercase letters in the name part, a missing name (`sk-bx--<32>`), a hyphen-only name (`sk-bx---<32>`), a name starting with a hyphen (`sk-bx--x-<32>`), a 1-character name (`sk-bx-a-<32>`), a 32-character name, another underscore name (`sk-bx-_other-<32>`), an empty string
- [x] run `npm --workspace apps/web run test -- src/utils/apiKeyName.test.ts` - must pass before task 2

### Task 2: Label CP keys with their instance name in buildApiKeyDisplayMap
- [x] in `apps/web/src/features/monitoring/model/apiKeys.ts` `buildApiKeyDisplayMap`, set the raw-key entry's `label` to `sanitizeApiKeyDisplayText(cpInstanceNameFromKey(apiKey) ?? '') || masked`; leave `masked`, `copyValue` and the alias loop unchanged
- [x] add cases to `describe('buildApiKeyDisplayMap')` in `apps/web/src/features/monitoring/hooks/useMonitoringData.test.ts`:
  - a CP key without an alias gets exactly its instance name as `label`, the label does not contain the 32-character tail, and `masked` is unchanged and does not contain the key;
  - a stored alias overrides the derived name;
  - a foreign key keeps `label === masked`;
  - a CP key whose instance name looks like a key (`sk-bx-sk-abcdef-<32>`) gets a sanitized label that contains `**` and not `sk-abcdef`
- [x] add a case to `describe('buildKeyRows')` in `apps/web/src/features/quota/keyProfilesModel.test.ts`: a CP key without an alias gives `label` = exactly the instance name (not containing the tail), `hasAlias` = `true`, and a `masked` that does not contain the key; the existing tests still pass unchanged
- [x] add a case to `apps/web/src/features/monitoring/model/eventRows.test.ts`: `buildEventRows` with an event whose `api_key_hash` is a CP key's sha256 and a display map from `buildApiKeyDisplayMap([cpKey])` labels the row with the instance name
- [x] add a case to `apps/web/src/features/usage-analytics/usageAnalyticsModel.test.ts`: `resolveUsageApiKeyLabel(sha256Hex(cpKey), buildApiKeyDisplayMap([cpKey]))` returns the instance name
- [x] run `npm --workspace apps/web run test -- src/features/monitoring src/features/quota src/features/usage-analytics` - must pass before task 3

### Task 3: Verify acceptance criteria
- [x] verify every success criterion in Decisions is covered by a test: CP key named in the modals, monitoring and usage analytics, alias wins, non-CP key unchanged, key-like name sanitized, label never contains the tail, mask never contains the key
- [x] run the full test suite: `npm test` (312 web files / 5177 tests and 16 repo files / 266 tests pass)
- [x] run `npm run type-check`
- [x] run `npm run lint` - all issues must be fixed (0 errors; the 7 remaining warnings are pre-existing, in files this branch does not touch, and already tracked in `docs/backlog/web-lint-warnings.md`)

### Task 4: [Final] Document the CP key names
- [x] in `docs/personal-quota.md`, rewrite the label order in the **How keys are shown** paragraph (`:243-249`); do not add a separate bullet elsewhere:
  - a key is labelled by its stored alias first;
  - otherwise, a key in the bridex CP format `sk-bx-<instance name>-<32 base62>` is labelled with its instance name, in the modals, monitoring and usage analytics; a name that looks like a key (`sk-…`) is shown masked;
  - otherwise the panel shows a mask such as `sk******yz`;
  - the format is produced by `bridex-cp`, and if it changes, these labels fall back to the mask;
  - keep the rest of the paragraph (raw keys never rendered, logged or placed in URLs) unchanged

*Note: loopai automatically moves completed plans to `docs/plans/completed/`*

## Technical Details
- Pattern: `^sk-bx-(_placeholder|[a-z0-9][a-z0-9-]{1,30})-[A-Za-z0-9]{32}$` on the trimmed key. Examples:
  - `sk-bx-ecwowk-AbCdEfGhIjKlMnOpQrStUvWxYz012345` gives `ecwowk`;
  - `sk-bx-team-a-1-<32>` gives `team-a-1`;
  - `sk-bx-_placeholder-<32>` gives `_placeholder`;
  - `sk-bx---<32>`, `sk-bx--x-<32>`, `sk-bx-a-<32>` give `null`;
  - `sk-proj-…` gives `null`.
- Label rule in `buildApiKeyDisplayMap`, in order:
  1. the stored alias (sanitized);
  2. the derived instance name (sanitized: a name such as `sk-abcdef` becomes `sk******ef`, like a key-like alias);
  3. the masked key, or `sha256:` hash label when masking yields nothing.
- `hasAlias` in `buildKeyRows` stays `label !== masked`, so the UI shows `<name>` with the mask beside it for derived names.

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- Deploy the panel as usual. Open Quota → Ключи on the proxy that the bridex CP issues keys on: keys from the CP show their instance names next to `sk******xx`, the manually aliased key (`ecwowk`) still shows its alias, and other keys stay masked.
- Check monitoring and usage analytics list the same CP keys by instance name.

**External system updates**:
- None. If `bridex-cp` ever changes its key format (`src/provisioning/proxyKeys.ts` `newProxyKey`), update `cpInstanceNameFromKey` here, or the labels fall back to the mask.
