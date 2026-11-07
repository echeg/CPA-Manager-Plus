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
    - `cpInstanceNameFromKey(key: string): string | null` trims the key and matches `^sk-bx-([a-z0-9_-]+)-[A-Za-z0-9]{32}$`. It returns the name group, otherwise `null`.
    - The greedy group is correct for hyphenated names, because the tail is exactly 32 base62 characters with no hyphen.
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
  - **Errors**: a key that is not in the CP format keeps today's masked label. No part of the secret tail is ever displayed.
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
  - `docs/personal-quota.md` ("Routing profiles per API key", Client keys modal bullets around lines 200-230).
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

## Implementation Steps

### Task 1: Add the CP instance name parser
- [ ] create `apps/web/src/utils/apiKeyName.ts` exporting `cpInstanceNameFromKey(key: string): string | null`: trim the key, match `^sk-bx-([a-z0-9_-]+)-[A-Za-z0-9]{32}$`, return the name group or `null`; a doc comment names `bridex-cp` as the format's owner
- [ ] create `apps/web/src/utils/apiKeyName.test.ts` with success cases: a plain name (`sk-bx-ecwowk-<32>` gives `ecwowk`), a hyphenated name (`sk-bx-team-a-1-<32>` gives `team-a-1`), `_placeholder`, and surrounding whitespace
- [ ] add the non-matching cases to `apiKeyName.test.ts`: a foreign `sk-…` key, a tail of 31 and of 33 characters, a non-base62 character in the tail, uppercase letters in the name part, a missing name (`sk-bx--<32>`), an empty string
- [ ] run `npm --workspace apps/web run test -- src/utils/apiKeyName.test.ts` - must pass before task 2

### Task 2: Label CP keys with their instance name in buildApiKeyDisplayMap
- [ ] in `apps/web/src/features/monitoring/model/apiKeys.ts` `buildApiKeyDisplayMap`, set the raw-key entry's `label` to `sanitizeApiKeyDisplayText(cpInstanceNameFromKey(apiKey) ?? '') || masked`; leave `masked`, `copyValue` and the alias loop unchanged
- [ ] add cases to `describe('buildApiKeyDisplayMap')` in `apps/web/src/features/monitoring/hooks/useMonitoringData.test.ts`:
  - a CP key without an alias gets its instance name as `label`, and `masked` is unchanged and does not contain the key;
  - a stored alias overrides the derived name;
  - a foreign key keeps `label === masked`
- [ ] add a case to `describe('buildKeyRows')` in `apps/web/src/features/quota/keyProfilesModel.test.ts`: a CP key without an alias gives `label` = the instance name, `hasAlias` = `true`, and a `masked` that does not contain the key; the existing tests still pass unchanged
- [ ] run `npm --workspace apps/web run test -- src/features/monitoring src/features/quota` - must pass before task 3

### Task 3: Verify acceptance criteria
- [ ] verify every success criterion in Decisions is covered by a test: CP key named, alias wins, non-CP key unchanged, mask never contains the key
- [ ] run the full test suite: `npm test`
- [ ] run `npm run type-check`
- [ ] run `npm run lint` - all issues must be fixed

### Task 4: [Final] Document the CP key names
- [ ] in `docs/personal-quota.md`, in the Client keys modal bullets of "Routing profiles per API key", add a paragraph:
  - a key in the bridex CP format `sk-bx-<instance name>-<32 base62>` without a stored alias is labelled with its instance name, in the modals, monitoring and usage analytics;
  - a stored alias wins;
  - the format is produced by `bridex-cp`, and if it changes, these labels fall back to the mask

*Note: loopai automatically moves completed plans to `docs/plans/completed/`*

## Technical Details
- Pattern: `^sk-bx-([a-z0-9_-]+)-[A-Za-z0-9]{32}$` on the trimmed key. Examples:
  - `sk-bx-ecwowk-AbCdEfGhIjKlMnOpQrStUvWxYz012345` gives `ecwowk`;
  - `sk-bx-team-a-1-<32>` gives `team-a-1`;
  - `sk-bx-_placeholder-<32>` gives `_placeholder`;
  - `sk-proj-…` gives `null`.
- Label rule in `buildApiKeyDisplayMap`, in order:
  1. the stored alias (sanitized);
  2. the derived instance name (sanitized);
  3. the masked key, or `sha256:` hash label when masking yields nothing.
- `hasAlias` in `buildKeyRows` stays `label !== masked`, so the UI shows `<name>` with the mask beside it for derived names.

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification**:
- Deploy the panel as usual. Open Quota → Ключи on the proxy that the bridex CP issues keys on: keys from the CP show their instance names next to `sk******xx`, the manually aliased key (`ecwowk`) still shows its alias, and other keys stay masked.
- Check monitoring and usage analytics list the same CP keys by instance name.

**External system updates**:
- None. If `bridex-cp` ever changes its key format (`src/provisioning/proxyKeys.ts` `newProxyKey`), update `cpInstanceNameFromKey` here, or the labels fall back to the mask.
