# Choose which Claude reset grant to spend

## Overview
- Claude subscriptions now hold several reset grants at once, for example "One full limit reset (November…)" ending 12/11 and several "New model launch: one Fable reset" grants ending 03/09.
- Today "Use a reset…" always spends the grant `selectResetGrant` picks (upstream `next_grant_id`, else the lowest id). The user cannot keep the full reset and spend a Fable one instead.
- This plan adds a radio list to the existing confirm step of the Claude "Use a reset…" flow. The upstream-recommended grant stays preselected, so the default behaviour does not change. Unusable grants are shown disabled with a reason. With one option, with no usable option, or while a pending claim is being retried, the step looks exactly as it does today.
- Panel only (`apps/web`). The claim request already carries `grant_id`, so CLIProxyAPI needs no change.

## Decisions
- **Context**: several reset grants with different scopes (full reset vs Fable-only) now coexist on one Claude account, and the panel picks one silently.
- **Direction chosen by the user**: the picker lives in the confirm step of the existing "Use a reset…" flow: a radio list, recommended grant preselected, unusable grants disabled with a reason, no picker for a single option. Not per-row "Use" buttons in the "Resets expire" list, and not both.
- **Chosen approach**:
  1. `providers/claude/selectResetGrant.ts`: a pure `resetGrantChoices(status, now)` returns `{ grant, usable, reason?, recommended }[]` for grants with `resetsLeft > 0` whose `endsAt` has not passed and is readable, ordered with the same comparator as the "Resets expire" list (soonest first, open-ended last, ties by id). A shared per-grant predicate gives the reason with a fixed precedence: `cooldown` (account-wide) → `anthropicResetGrantBlocker` result → `not_started`. `selectResetGrant` keeps its selection rule (recommended usable grant, else the usable grant with the lowest id) and only switches to that shared predicate. A pure `resolveSelectedGrantId({ status, pendingGrantId, chosenGrantId, now })` holds the selection rule.
  2. `providers/claude/ClaudeResetGrants.tsx` `useClaudeResetGrants`: `chosenGrantId` state plus `choose(id | undefined)`; `selected = resolveSelectedGrantId(...)`; exposes `choices` (omitted while a pending operation exists).
  3. `features/quota/resetActions.ts`: `ResetAction` gains optional `choices`, `onChoose(id)` and `onClearChoice()`; `claudeResetAction` fills `choices` only when there are at least two choices and at least one is usable, and not for a retry. Label and detail come from helpers shared with the "Resets expire" list. The consequence names the selected grant. The "N left" note stays account-wide (it sums all grants) and does not change with the choice; per-grant left/total appears in each option's detail.
  4. `features/quota/components/QuotaLedgerResets.tsx` `QuotaLedgerResetsConfirm`: when `choices` is present, renders a `fieldset` radio group above the consequence. Both the Ledger drawer and the compact card get it through the shared `ResetActionFooter`. Closing the confirm step clears the choice, so reopening starts from the default.
  5. Short i18n keys under `quota_management.resets.choice.*` in all four locales, added before the tasks that use them.
- **Rejected alternatives** (not judged by the user; open to critique): a backend endpoint in CLIProxyAPI; Codex support; a global store or persisting the choice across opens; defaulting to the soonest-expiring grant instead of the upstream recommendation; hiding unusable grants; always showing the radio list for a single grant; letting a retry switch grants; a custom dropdown; separate picker components per location.
- **Verified facts**:
  - The claim already sends `grant_id`: `apps/web/src/features/personal-quota-support/services/api/claudeResetGrants.ts` `claimClaudeResetGrant(authIndex, organization, grantId, requestId)`, through the management api-call proxy.
  - `apps/web/src/features/quota/providers/claude/resetGrantOperations.ts:59` `run(key, authIndex, grantId)` re-reads fresh status and re-validates the given grant before dispatch (around lines 79-89). A pending operation with a different `grantId` throws `expired` (around line 70), so a retry must stay on the same grant. `run` records the operation as soon as validation passes (around lines 92-93), so the hook sees it as pending while the claim is still in flight.
  - `selectResetGrant.ts:6`: "Prefer the upstream recommendation; otherwise use stable ID ordering." Cooldown short-circuits before any per-grant check (`selectResetGrant.ts:8`).
  - `anthropicResetGrantBlocker` (`claudeResetGrants.ts` ~226-238) checks ineligible → unknown_grant → paused → not_usable → exhausted → not_limited.
  - `resetActions.ts` `codexResetAction`: OpenAI picks which credit is spent, so Codex has no per-credit choice.
  - `resetActions.ts` ~120 hard-codes `unnamed` with `index: 1` for the consequence, while the list numbers unnamed grants by position (`QuotaLedgerResets.tsx` `itemLabel` ~33-41).
  - The note `remainingNote(t, handle.count - 1)` uses `count`, which sums `resetsLeft` over all grants (`ClaudeResetGrants.tsx` ~118, `resetActions.ts` ~139).
  - The Ledger drawer (`QuotaLedger.tsx` → `ClaudeLedgerResetsDrawer`) and the compact card (`QuotaCompactCardItem.tsx` → `ClaudeResetActionMount` + `ResetActionFooter variant="card" initialConfirming`) share `ResetActionFooter` and `QuotaLedgerResetsConfirm`. The compact card unmounts the hook when the confirm closes; the Ledger drawer keeps it mounted while the drawer is open (`QuotaLedgerResets.tsx` ~217-220, ~402).
  - `resetInventory.ts` `compareItems` (module-private, ~51) defines the soonest-first order of the "Resets expire" list; `claudeItems` (~78-99) drops grants with `resetsLeft <= 0` and expired or unreadable `endsAt`.
  - Tests: static markup via `renderToStaticMarkup` (`quotaCompactCardItem.test.ts`); hooks and handlers via `react-test-renderer` `create`/`act` (`claudeFallback.lifecycle.test.tsx`, `useKeyProfiles.lifecycle.test.tsx`, `profilesKeysFlow.lifecycle.test.tsx`; dependency in `apps/web/package.json`). `ClaudeResetActionMount` loads status in `useEffect`, so a static render of the card or drawer never shows choices. Locale parity pattern: `keyProfiles.locale.test.ts` (checks selected `quota_management` subtrees).

## Context (from discovery)
- Files/components involved:
  - `apps/web/src/features/quota/providers/claude/selectResetGrant.ts`
  - `apps/web/src/features/quota/providers/claude/ClaudeResetGrants.tsx`
  - `apps/web/src/features/quota/resetInventory.ts` (export the comparator)
  - `apps/web/src/features/quota/resetActions.ts`
  - `apps/web/src/features/quota/components/QuotaLedgerResets.tsx` (+ `QuotaLedgerResets.module.scss`)
  - `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json` (`quota_management.resets.*`)
- Related patterns found: `anthropicResetGrantBlocker` for per-grant blockers; `resetGrantBlockReason` for the account-level reason; `itemLabel` and the `claude_left` detail in `QuotaLedgerResets.tsx`; `maskQuotaText`; `formatMonthDay` / `buildResetDisplay`; `quota_management.resets.windows.*` for window names.
- Dependencies identified: `resetGrantOperations` journal (unchanged); `ClaudeResetActionMount` and `ClaudeLedgerResetsDrawer` pass the hook result through `claudeResetAction`.
- Existing tests: `quotaCompactCardItem.test.ts`, `claudeClaimCooldown.test.ts`, `resetInventory.test.ts`, `keyProfiles.locale.test.ts`, the `*.lifecycle.test.tsx` files.

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
  - write unit tests for new functions/methods
  - write unit tests for modified functions/methods
  - add new test cases for new code paths
  - update existing test cases if behavior changes
  - tests cover both success and error scenarios
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- Run tests after each change (from `apps/web`: `npm test`, `npm run lint`, `npx tsc --noEmit`)
- Maintain backward compatibility: with one grant, no usable grant, or a pending retry the UI and behaviour stay as they are

## Testing Strategy
- **Unit tests**: vitest, required for every task.
- Pure logic: plain vitest. Markup: `renderToStaticMarkup` on components rendered with hand-built props. Hook state and handlers: `react-test-renderer` `create`/`act`, following the existing `*.lifecycle.test.tsx` files.
- No e2e suite covers this flow.

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code changes, tests, documentation updates in this repo
- **Post-Completion** (no checkboxes): manual checks against a live account, deployment

## Decision Log
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Scope: panel only; the claim already sends `grant_id` (`claudeResetGrants.ts` `claimClaudeResetGrant`, `resetGrantOperations.ts:59`).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Providers: Claude only; OpenAI picks the Codex credit (`resetActions.ts` `codexResetAction` comment).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Choice state: `chosenGrantId` + `choose()` inside `useClaudeResetGrants`; the hook already derives `selected` (`ClaudeResetGrants.tsx`).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Default: the upstream `next_grant_id` via `selectResetGrant`, marked "recommended" (`selectResetGrant.ts:6`).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Option source: the fresh status the hook reads on open; `run()` re-validates against fresh status anyway (`resetGrantOperations.ts` ~79-89).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Visibility: every grant with `resetsLeft > 0`, unusable ones disabled with a reason from a shared pure helper (`anthropicResetGrantBlocker`).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Order: soonest expiry first, open-ended last, ties by id (`resetInventory.ts` `compareItems`).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Single option: no picker (YAGNI).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Pending retry: no picker, pinned to the pending grant (`resetGrantOperations.ts` ~70 throws `expired` on a different grant).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Render location: optional `choices` on `ResetAction`, rendered in the shared `QuotaLedgerResetsConfirm` (both flows use `ResetActionFooter`).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Copy: the consequence follows the chosen grant; labels masked with `maskQuotaText`; keys in all 4 locales (`claudeResetAction` already uses `selectedGrant`).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Control: native radio `fieldset`, existing Cancel focus and Esc handling (accessibility, existing confirm).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - A chosen grant that disappears or turns unusable after a refresh falls back to the default selection.
- 2026-11-17 grill: **accepted** - Testing Strategy, Verified facts, Tasks 3-5: hook and handler behaviour is tested with `react-test-renderer` lifecycle tests (chosen id reaches `run`, default, refresh fallback, pending pinning) instead of only through pure helpers - decided by grill: `react-test-renderer` is a dependency (`apps/web/package.json`) and is used by `claudeFallback.lifecycle.test.tsx`, `useKeyProfiles.lifecycle.test.tsx`, `profilesKeysFlow.lifecycle.test.tsx`.
- 2026-11-17 grill: **accepted** - Task 5: markup tests render `ResetActionFooter` directly with a hand-built `ResetAction` (`initialConfirming`, both variants) instead of rendering the card or drawer - decided by grill: `ClaudeResetActionMount` loads status in `useEffect`, which never runs under `renderToStaticMarkup`.
- 2026-11-17 grill: **accepted** - Task 1: picker order reuses an exported comparator from `resetInventory.ts`, with a test that it matches `buildResetInventory` order - decided by grill: `compareItems` is module-private (`resetInventory.ts` ~51) and a copy could drift from the "Resets expire" list.
- 2026-11-17 grill: **accepted** - Task 1 and Decisions 1: fixed reason precedence `cooldown` → `anthropicResetGrantBlocker` → `not_started`; `selectResetGrant` keeps its recommended-else-lowest-id rule and only shares the usability predicate (no full rewrite); added a test where the soonest usable grant is not the lowest id - decided by grill: `selectResetGrant.ts:8,17`, `claudeResetGrants.ts` ~226-238.
- 2026-11-17 grill: **accepted** - Decisions 1 and Task 1: expired or unreadable `endsAt` is filtered in both places; `resolveSelectedGrantId` returns the pending id even without a status - decided by grill: `ClaudeResetGrants.tsx:73` returns `pending.grantId` before the status loads; `resetInventory.ts` `claudeItems` drops expired grants.
- 2026-11-17 grill: **accepted** - Decisions 3, Task 4: picker shown only for at least two choices with at least one usable; account-wide blockers (cooldown, ineligible) keep the existing account-level message and never render per-row - decided by grill: the hook already shows `claude_reset.cooldown`/`ineligible` through `blockReason` (`ClaudeResetGrants.tsx` ~74, ~129).
- 2026-11-17 grill: **accepted** - Task 4: unnamed choices are numbered by their position and the same label is used in the radio and the consequence; label/detail helpers move from `QuotaLedgerResets.tsx` into `resetActions.ts` and are shared with `ResetLine` - decided by grill: `resetActions.ts` ~120 hard-codes `index: 1`; `itemLabel` and the `claude_left` detail already exist in `QuotaLedgerResets.tsx`.
- 2026-11-17 grill: **accepted** - Overview/Decisions 3, Task 4: the "N left" note stays account-wide and does not follow the choice; per-grant left/total lives in each option's detail - decided by grill: `count` sums all grants (`ClaudeResetGrants.tsx` ~118, `resetActions.ts` ~139).
- 2026-11-17 grill: **accepted** - Task 3, Task 5: closing the confirm step (Cancel, Esc, finished claim) clears the choice, so reopening in the Ledger drawer starts from the default - decided by grill: the drawer keeps the hook mounted (`QuotaLedgerResets.tsx` ~217-220, ~402) and persisting the choice across opens is a rejected alternative.
- 2026-11-17 grill: **accepted** - Task 5: dropped "all radios disabled while busy" and "confirm disabled when the selected grant is blocked"; the list disappears once the claim is journaled, as the pending/retry branch already does, and the existing `blocked` flag already disables Confirm - decided by grill: `resetGrantOperations.ts` ~92-93 records the operation before dispatch, the hook reads it every render (`ClaudeResetGrants.tsx` ~70-71), `QuotaLedgerResets.tsx` ~183.
- 2026-11-17 grill: **accepted** - Task order: i18n keys moved to Task 2, before the tasks that use them, as short keys under `quota_management.resets.choice.*` with a parity test following `keyProfiles.locale.test.ts` - decided by grill: the existing `claude_reset.*` reasons are full sentences (`en.json` ~5843-5846) and `paused`/`not_usable`/`not_started` keys do not exist.

## Implementation Steps

### Task 1: Pure grant choices and selection rule
- [x] export a comparator from `apps/web/src/features/quota/resetInventory.ts` (e.g. `compareResetExpiry(aMs | null, aId, bMs | null, bId)`) and use it in `compareItems`, so the picker and the "Resets expire" list share one order
- [x] in `apps/web/src/features/quota/providers/claude/selectResetGrant.ts`, add a shared per-grant predicate returning `undefined` (usable) or a reason with precedence `cooldown` (account-wide) → `anthropicResetGrantBlocker` result → `not_started`
- [x] add `resetGrantChoices(status, now)`: grants with `resetsLeft > 0` and an `endsAt` that is absent or readable and in the future, each with `usable`, `reason`, `recommended` (`id === status.nextGrantId`), sorted with the shared comparator
- [x] switch `selectResetGrant` to the shared predicate while keeping its rule (recommended usable grant, else the usable grant with the lowest id); `resetGrantBlockReason` unchanged
- [x] add pure `resolveSelectedGrantId({ status, pendingGrantId, chosenGrantId, now })`: a pending id wins even without a status; a chosen id is used only when it is a usable choice in `status`; otherwise `selectResetGrant`
- [x] write tests in a new `apps/web/src/features/quota/selectResetGrant.test.ts`: ordering equals `buildResetInventory` order on the same grants; recommended flag; each reason and the precedence (cooldown marks every choice unusable; paused + not started reports `paused`); `resetsLeft = 0`, expired and unreadable `endsAt` filtered out
- [x] write tests for `selectResetGrant`: recommended usable grant wins; fallback is the lowest usable id even when another usable grant expires sooner; cooldown → undefined
- [x] write tests for `resolveSelectedGrantId`: pending pins the grant with and without a status; a usable chosen id wins; a missing or unusable chosen id falls back; no status and no pending → undefined
- [x] run tests - must pass before next task

### Task 2: i18n keys for the picker
- [x] add `quota_management.resets.choice.legend`, `quota_management.resets.choice.recommended` and short per-grant reasons `quota_management.resets.choice.reason.{paused,not_usable,not_limited,not_started}` to `apps/web/src/i18n/locales/en.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`
- [x] write a new `apps/web/src/features/quota/resetChoices.locale.test.ts` following `keyProfiles.locale.test.ts`: the `quota_management.resets.choice` subtree has identical key sets and non-empty strings in all four locales
- [x] run tests - must pass before next task

### Task 3: Choice state in `useClaudeResetGrants`
- [ ] add `chosenGrantId` state and `choose(id | undefined)` to `apps/web/src/features/quota/providers/claude/ClaudeResetGrants.tsx`
- [ ] compute `selected` through `resolveSelectedGrantId`; `execute()` keeps passing `selected` to `resetGrantOperations.run`
- [ ] return `choices` (from `resetGrantChoices`) only when there is no pending operation; keep every existing return field unchanged
- [ ] write `apps/web/src/features/quota/claudeResetChoice.lifecycle.test.tsx` with `react-test-renderer` `create`/`act`: mock `readClaudeResetGrants` to return two usable grants with `nextGrantId` = B and spy on `resetGrantOperations.run`; success: `choose('A')` then `execute()` calls `run` with `'A'`; default: without `choose`, `run` gets `'B'`
- [ ] write error/edge cases in the same file: refresh fallback (choose A, bump `refreshToken`, status now has A at `resetsLeft: 0` → `selectedGrant.id` is B); pending pinning (`inspect` returns a pending C → `choices` undefined and `choose('A')` does not change the id sent to `run`); `choose(undefined)` restores the default
- [ ] run tests - must pass before next task

### Task 4: Choices in `ResetAction` / `claudeResetAction`
- [ ] move `itemLabel` and the `claude_left` detail builder from `components/QuotaLedgerResets.tsx` into `apps/web/src/features/quota/resetActions.ts` (React-free) and use them from `ResetLine`, so the list and the picker share one label and detail
- [ ] extend `ClaudeResetHandle` with `choices`, `choose`; add optional `choices?: { id, label, detail, usable, reason?, recommended, selected }[]`, `onChoose?(id)` and `onClearChoice?()` to `ResetAction`
- [ ] in `claudeResetAction`, fill them only when there are at least two choices, at least one is usable, and this is not a retry; unnamed choices are numbered by position; the consequence uses the same label as the selected radio; `reason` translated from `quota_management.resets.choice.reason.*`; the note stays account-wide
- [ ] keep `codexResetAction` unchanged
- [ ] write tests in a new `apps/web/src/features/quota/resetActions.test.ts`: no `choices` for one grant, for no usable grant, or for a retry; one usable + one paused grant gives two choices; `selected`/`recommended` set correctly; consequence names the selected grant; two unnamed grants with the second selected show "… 2" in both radio and consequence; labels masked when `showEmails` is false; the note does not change when the choice changes
- [ ] update `ResetLine` expectations in existing tests if the moved helpers change any markup (they should not)
- [ ] run tests - must pass before next task

### Task 5: Radio list in `QuotaLedgerResetsConfirm`
- [ ] in `apps/web/src/features/quota/components/QuotaLedgerResets.tsx`, pass `choices`/`onChoose` from `ResetActionFooter` into `QuotaLedgerResetsConfirm`, and call `action.onClearChoice?.()` from the footer's `close()` (Cancel, Esc, finished claim)
- [ ] render a `fieldset` with a `legend` and one radio per choice (label, detail, "recommended" badge); unusable radios are `disabled` and show their reason; keep initial focus on Cancel and Esc-to-cancel
- [ ] wire `ClaudeResetActionMount` so `onChoose` → `choose(id)` and `onClearChoice` → `choose(undefined)`
- [ ] add styles in `QuotaLedgerResets.module.scss` for both the drawer and `card` variants (narrow card width, long labels truncate with a title)
- [ ] write `renderToStaticMarkup` tests rendering `ResetActionFooter` directly with a hand-built `ResetAction` and `initialConfirming`, for `variant="card"` and `variant="drawer"`: fieldset and legend present, exactly one `checked` radio on the selected choice, the unusable choice `disabled` with its reason, no `<fieldset` without `choices`
- [ ] write a `react-test-renderer` case: firing `onChange` on radio A calls `onChoose('A')`; Cancel calls `onClearChoice`
- [ ] run tests - must pass before next task

### Task 6: Verify acceptance criteria
- [ ] verify: with two or more grants and at least one usable, the confirm step shows the radio list with the recommended grant preselected; picking another grant changes the consequence and the id sent to `run`
- [ ] verify: one grant, no usable grant, and a pending retry render as before
- [ ] verify: unusable grants are visible, disabled and carry a reason
- [ ] verify: works in the Ledger drawer and the compact card; reopening the confirm step in the drawer starts from the default
- [ ] run full test suite from `apps/web` (`npm test`)
- [ ] run `npm run lint` and `npx tsc --noEmit` - all issues fixed

### Task 7: [Final] Update documentation
- [ ] update the user-facing docs or README section on resets if one describes "Use a reset…" (none found during planning)
- [ ] update project knowledge docs if new patterns were discovered

## Technical Details
- `ResetGrantChoice = { grant: AnthropicResetGrant; usable: boolean; reason?: ResetGrantChoiceReason; recommended: boolean }`
- `ResetGrantChoiceReason = 'cooldown' | 'ineligible' | 'paused' | 'not_usable' | 'not_limited' | 'not_started'`. `cooldown` and `ineligible` make every choice unusable, so the picker is hidden and the existing account-level message shows; only the four per-grant reasons have UI keys. `exhausted`/`unknown_grant` cannot occur after the `resetsLeft > 0` filter.
- `ResetAction.choices[i] = { id, label, detail, usable, reason?, recommended, selected }`; `onChoose(id)`; `onClearChoice()`.
- Flow: "Use a reset…" → hook mounts → fresh `readClaudeResetGrants` → `choices` → radio → `choose(id)` → consequence recomputed → Confirm → `resetGrantOperations.run(key, authIndex, selected)` → `run` journals the operation (the picker disappears, as the pending branch does today) and re-validates against fresh status → close clears the choice.
- A refresh that removes or blocks the chosen grant silently returns to the default selection.

## Post-Completion
**Manual verification**:
- On a live Claude account with several grants, open "Use a reset…" in the compact card and in the Ledger drawer, pick a non-recommended grant, confirm, and check that the right grant's `resets_left` drops.
- Check the card layout at narrow width with long grant labels and with masking on and off.

**Deployment**:
- Panel-only deploy per the local CPAMP deploy notes (`PANEL_PATH` swap).
