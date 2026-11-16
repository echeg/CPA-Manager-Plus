# Choose which Claude reset grant to spend

## Overview
- Claude subscriptions now hold several reset grants at once, for example "One full limit reset (November…)" ending 12/11 and several "New model launch: one Fable reset" grants ending 03/09.
- Today "Use a reset…" always spends the grant `selectResetGrant` picks (upstream `next_grant_id`, else the lowest id). The user cannot keep the full reset and spend a Fable one instead.
- This plan adds a radio list to the existing confirm step of the Claude "Use a reset…" flow. The upstream-recommended grant stays preselected, so the default behaviour does not change. Unusable grants are shown disabled with a reason. With one option, or while a pending claim is being retried, the step looks exactly as it does today.
- Panel only (`apps/web`). The claim request already carries `grant_id`, so CLIProxyAPI needs no change.

## Decisions
- **Context**: several reset grants with different scopes (full reset vs Fable-only) now coexist on one Claude account, and the panel picks one silently.
- **Direction chosen by the user**: the picker lives in the confirm step of the existing "Use a reset…" flow: a radio list, recommended grant preselected, unusable grants disabled with a reason, no picker for a single option. Not per-row "Use" buttons in the "Resets expire" list, and not both.
- **Chosen approach**:
  1. `providers/claude/selectResetGrant.ts`: a new pure `resetGrantChoices(status, now)` returns `{ grant, usable, reason?, recommended }[]` for grants with `resetsLeft > 0`, soonest `endsAt` first, open-ended last, ties by id. The reason comes from `anthropicResetGrantBlocker` plus the startsAt/endsAt/cooldown checks. `selectResetGrant` is re-expressed on top of it with identical external behaviour. A pure `resolveSelectedGrantId({ status, pendingGrantId, chosenGrantId, now })` holds the selection rule so it is testable without a DOM.
  2. `providers/claude/ClaudeResetGrants.tsx` `useClaudeResetGrants`: `chosenGrantId` state plus `choose(id)`; `selected = pending?.grantId ?? (chosen if usable in the current status) ?? selectResetGrant(status, now)?.id`; exposes `choices` (omitted while a pending retry exists).
  3. `features/quota/resetActions.ts`: `ResetAction` gains optional `choices` and `onChoose(id)`; `claudeResetAction` fills them only when more than one option is visible. Labels go through `maskQuotaText` unless `showEmails`. Consequence and note already derive from `selectedGrant`, which is now the chosen grant. `ClaudeResetHandle` grows the matching fields.
  4. `features/quota/components/QuotaLedgerResets.tsx` `QuotaLedgerResetsConfirm`: when `choices` is present, renders a `fieldset` radio group above the consequence. Both the Ledger drawer and the compact card get it through the shared `ResetActionFooter`.
  5. i18n keys in all four locales.
- **Rejected alternatives** (not judged by the user; open to critique): a backend endpoint in CLIProxyAPI; Codex support; a global store or persisting the choice across opens; defaulting to the soonest-expiring grant instead of the upstream recommendation; hiding unusable grants; always showing the radio list for a single grant; letting a retry switch grants; a custom dropdown; separate picker components per location.
- **Verified facts**:
  - The claim already sends `grant_id`: `apps/web/src/features/personal-quota-support/services/api/claudeResetGrants.ts` `claimClaudeResetGrant(authIndex, organization, grantId, requestId)`, through the management api-call proxy.
  - `apps/web/src/features/quota/providers/claude/resetGrantOperations.ts:59` `run(key, authIndex, grantId)` re-reads fresh status and re-validates the given grant before dispatch (around lines 79-89). A pending operation with a different `grantId` throws `expired` (around line 70), so a retry must stay on the same grant.
  - `selectResetGrant.ts:6`: "Prefer the upstream recommendation; otherwise use stable ID ordering."
  - `resetActions.ts` `codexResetAction`: OpenAI picks which credit is spent, so Codex has no per-credit choice.
  - The Ledger drawer (`QuotaLedger.tsx` → `ClaudeLedgerResetsDrawer`) and the compact card (`QuotaCompactCardItem.tsx` → `ClaudeResetActionMount` + `ResetActionFooter variant="card" initialConfirming`) share `ResetActionFooter` and `QuotaLedgerResetsConfirm`.
  - `resetInventory.ts` `compareItems` defines the soonest-first order already used by the "Resets expire" list.
  - UI tests render with `renderToStaticMarkup` (`quotaCompactCardItem.test.ts`); there is no `@testing-library`. Interactive behaviour is therefore tested through pure functions and props, not DOM events.

## Context (from discovery)
- Files/components involved:
  - `apps/web/src/features/quota/providers/claude/selectResetGrant.ts`
  - `apps/web/src/features/quota/providers/claude/ClaudeResetGrants.tsx`
  - `apps/web/src/features/quota/resetActions.ts`
  - `apps/web/src/features/quota/components/QuotaLedgerResets.tsx` (+ `QuotaLedgerResets.module.scss`)
  - `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json` (`quota_management.resets.*`, `claude_reset.*`)
- Related patterns found: `anthropicResetGrantBlocker` for per-grant blockers; `resetGrantBlockReason` for the account-level reason; `maskQuotaText` for labels; `formatMonthDay` / `buildResetDisplay` for dates; `quota_management.resets.windows.*` for window names.
- Dependencies identified: `resetGrantOperations` journal (unchanged); `ClaudeResetActionMount` and `ClaudeLedgerResetsDrawer` pass the hook result through `claudeResetAction`.
- Existing tests: `apps/web/src/features/quota/quotaCompactCardItem.test.ts`, `claudeClaimCooldown.test.ts`, `resetInventory.test.ts`.

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
- Maintain backward compatibility: with one grant or a pending retry the UI and behaviour stay as they are

## Testing Strategy
- **Unit tests**: vitest, required for every task.
- UI is checked with `renderToStaticMarkup`, as in `quotaCompactCardItem.test.ts`.
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
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Copy: consequence and "N left" follow the chosen grant; labels masked with `maskQuotaText`; keys in all 4 locales (`claudeResetAction` already uses `selectedGrant`).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - Control: native radio `fieldset`, existing Cancel focus and Esc handling (accessibility, existing confirm).
- 2026-11-17 loopai-brainstorm-v2: **accepted** - A chosen grant that disappears or turns unusable after a refresh falls back to the default selection.

## Implementation Steps

### Task 1: Pure grant choices and selection rule
- [ ] add `resetGrantChoices(status, now)` to `apps/web/src/features/quota/providers/claude/selectResetGrant.ts`: grants with `resetsLeft > 0` whose `endsAt` has not passed, each with `usable`, `reason` (`cooldown`, `ineligible`, `paused`, `not_usable`, `not_limited`, `not_started`) and `recommended` (`id === status.nextGrantId`), sorted soonest `endsAt` first, open-ended last, ties by id
- [ ] re-express `selectResetGrant` on top of `resetGrantChoices` with identical results (recommended usable grant first, else the lowest usable id)
- [ ] add pure `resolveSelectedGrantId({ status, pendingGrantId, chosenGrantId, now })`: pending wins; a chosen id is used only when it is a usable choice in `status`; otherwise `selectResetGrant`
- [ ] write tests in a new `apps/web/src/features/quota/selectResetGrant.test.ts`: ordering, recommended flag, each reason, `resetsLeft = 0` and expired grants filtered out, `selectResetGrant` unchanged for existing cases
- [ ] write tests for `resolveSelectedGrantId`: pending pins the grant, a usable chosen id wins, a missing or unusable chosen id falls back, no status → undefined
- [ ] run tests - must pass before next task

### Task 2: Choice state in `useClaudeResetGrants`
- [ ] add `chosenGrantId` state and `choose(id)` to `apps/web/src/features/quota/providers/claude/ClaudeResetGrants.tsx`
- [ ] compute `selected` through `resolveSelectedGrantId`
- [ ] return `choices` (from `resetGrantChoices`) only when there is no pending operation; keep every existing return field unchanged
- [ ] confirm `execute()` passes the chosen id to `resetGrantOperations.run` (it already passes `selected`)
- [ ] write tests for the hook's derived values through the pure helpers from Task 1 (the hook itself stays a thin wrapper); add a case in `quotaCompactCardItem.test.ts` only if an existing render path changes
- [ ] run tests - must pass before next task

### Task 3: Choices in `ResetAction` / `claudeResetAction`
- [ ] extend `ClaudeResetHandle` in `apps/web/src/features/quota/resetActions.ts` with `choices` and `choose`
- [ ] add optional `choices?: { id, label, detail, usable, reason?, recommended, selected }[]` and `onChoose?(id)` to `ResetAction`
- [ ] fill them in `claudeResetAction` only when more than one choice is visible and this is not a retry; `label` masked unless `showEmails`; `detail` = windows + left/total + end date (reuse `joinWindows`/`formatMonthDay` and the `claude_left` copy); `reason` translated
- [ ] keep `codexResetAction` unchanged
- [ ] write tests in a new `apps/web/src/features/quota/resetActions.test.ts`: no `choices` for one grant or a retry; choices present for two or more with the right `selected` and `recommended`; consequence names the selected grant; masking applied when `showEmails` is false
- [ ] run tests - must pass before next task

### Task 4: Radio list in `QuotaLedgerResetsConfirm`
- [ ] in `apps/web/src/features/quota/components/QuotaLedgerResets.tsx`, pass `choices`/`onChoose` from `ResetActionFooter` into `QuotaLedgerResetsConfirm`
- [ ] render a `fieldset` with a `legend` and one radio per choice (label, detail, "recommended" badge); disabled radios show their reason; all radios disabled while `busy`
- [ ] keep initial focus on Cancel and Esc-to-cancel; the confirm button stays disabled when the selected grant is blocked
- [ ] add styles in `QuotaLedgerResets.module.scss` for both the drawer and `card` variants (narrow card width, long labels truncate with a title)
- [ ] write `renderToStaticMarkup` tests: radios render with the right `checked`/`disabled`, reason text appears, no fieldset without `choices`; compact-card and drawer variants both render the list
- [ ] run tests - must pass before next task

### Task 5: i18n
- [ ] add keys for the legend, the "recommended" badge and per-grant reasons (`paused`, `not_started`, `not_limited`, `not_usable`, `cooldown`, `ineligible`) to `apps/web/src/i18n/locales/en.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`
- [ ] write or extend a test asserting the new keys exist in all four locales (follow any existing locale-parity test if present)
- [ ] run tests - must pass before next task

### Task 6: Verify acceptance criteria
- [ ] verify: with two or more visible grants the confirm step shows the radio list with the recommended grant preselected; picking another grant changes the consequence and the id sent to `run`
- [ ] verify: one grant and a pending retry render as before
- [ ] verify: unusable grants are visible, disabled and carry a reason
- [ ] verify: works in the Ledger drawer and the compact card
- [ ] run full test suite from `apps/web` (`npm test`)
- [ ] run `npm run lint` and `npx tsc --noEmit` - all issues fixed

### Task 7: [Final] Update documentation
- [ ] update the user-facing docs or README section on resets if one describes "Use a reset…"
- [ ] update project knowledge docs if new patterns were discovered

## Technical Details
- `ResetGrantChoice = { grant: AnthropicResetGrant; usable: boolean; reason?: ResetGrantChoiceReason; recommended: boolean }`
- `ResetGrantChoiceReason = 'cooldown' | 'ineligible' | 'paused' | 'not_usable' | 'not_limited' | 'not_started'` (`exhausted`/`unknown_grant` cannot occur after the `resetsLeft > 0` filter)
- `ResetAction.choices[i] = { id, label, detail, usable, reason?, recommended, selected }`
- Flow: "Use a reset…" → hook mounts → fresh `readClaudeResetGrants` → `choices` → radio → `choose(id)` → consequence/note recomputed → Confirm → `resetGrantOperations.run(key, authIndex, selected)` → `run` re-validates against fresh status.
- A refresh that removes or blocks the chosen grant silently returns to the default selection.

## Post-Completion
**Manual verification**:
- On a live Claude account with several grants, open "Use a reset…" in the compact card and in the Ledger drawer, pick a non-recommended grant, confirm, and check that the right grant's `resets_left` drops.
- Check the card layout at narrow width with long grant labels and with masking on and off.

**Deployment**:
- Panel-only deploy per the local CPAMP deploy notes (`PANEL_PATH` swap).
