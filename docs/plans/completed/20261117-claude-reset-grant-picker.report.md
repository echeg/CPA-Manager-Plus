# Report: Choose which Claude reset grant to spend

Plan `docs/plans/20261117-claude-reset-grant-picker.md` · branch `claude-reset-grant-picker` · base `main` · mode `full` · executor `claude` · task model `claude:opus:high` · review model `claude:opus:xhigh` · started 2026-11-16T23:58:30Z · finished 2026-11-17T00:36:14Z

## Summary
When a Claude account holds two or more reset grants and at least one can be used, the "Use a reset…" confirm step now shows a radio list. The user can spend a grant other than the one upstream recommends, for example keep the full limit reset and spend a Fable-only reset instead.

- **Preselection:** the grant `next_grant_id` points to is preselected and carries a "recommended" badge. If it cannot be used, the usable grant with the lowest id is preselected. Confirming without a change spends the same grant as before.
- **Unusable grants:** they stay in the list, disabled, with a short reason: paused, not usable right now, only usable at a limit, or not started yet.
- **Labels:** the confirmation text names the selected grant, using the same label and position numbering as the "Resets expire" list.
- **No list:** with one grant, with no usable grant, or while a pending claim is retried, the step looks as it did before. A retry stays on its original grant.
- **Locking and reset:** the list locks while a claim is in flight. The choice is cleared each time the step opens and each time it closes.
- **Where:** both the Ledger drawer and the compact card show the list, through the shared `ResetActionFooter`. The change is panel-only: the claim request already carries `grant_id`, so CLIProxyAPI is unchanged.

The run took 7 task iterations with 0 failed retries. Internal review ran one loop iteration and ended with `review_done`. Post-review did not run.

| phase | duration_ms | ≈ |
|---|---:|---|
| evaluation | 15243 | 15 s |
| external review | 128455 | 2 m 08 s |
| internal review | 1110995 | 18 m 31 s |
| other | 0 | 0 |
| tasks | 1009846 | 16 m 50 s |

The phases add up to 2,264,539 ms (about 37 m 45 s), which matches the 37 m 44 s between start and finish. Finalize did not run, so there was no base sync, and the diff is measured against local `main`.

## Change scope
17 files changed (5 added, 12 modified), +1458 / −94 lines, in 8 commits.

- **Selection logic**
  - `providers/claude/selectResetGrant.ts` (+118/−8):
    - adds the `ResetGrantChoice` / `ResetGrantChoiceReason` types;
    - adds a shared usability rule `resetGrantChoiceReason`, checked in this order: cooldown, then the upstream blocker, then not started;
    - adds `resetGrantChoices` and `resolveSelectedGrantId`;
    - `selectResetGrant` now uses the shared rule and keeps its old selection rule.
  - `resetInventory.ts` (+20/−8) exports `compareResetExpiry`, so the list and the picker share one order.
- **Hook:** `providers/claude/ClaudeResetGrants.tsx` (+19/−2) adds `chosenGrantId` state and `choose()`. It computes `selected` through `resolveSelectedGrantId` and returns `choices` only when no claim is pending.
- **Action model:** `resetActions.ts` (+99/−6):
  - the label and detail helpers (`resetItemLabel`, `claudeResetDetail`) move here and are shared with `ResetLine`;
  - adds the `ResetActionChoice` type;
  - adds optional `choices` / `onChoose` / `onClearChoice` to `ResetAction`;
  - `ClaudeResetHandle` gains `choices` and a required `choose`;
  - unnamed grants in the consequence are now numbered by position instead of always "1".
- **UI**
  - `components/QuotaLedgerResets.tsx` (+81/−27) adds a `ResetChoiceList` built on a native `fieldset`, disabled while `busy`. The footer clears the choice on open and on close.
  - `QuotaLedgerResets.module.scss` (+68) adds styles, with labels truncated and a `title` tooltip.
- **i18n:** adds `quota_management.resets.choice.{legend,recommended,reason.*}` to `en`, `ru`, `zh-CN` and `zh-TW` (+10 each).
- **Tests:** 5 new files with 949 lines and 49 test cases:
  - `selectResetGrant.test.ts` (14)
  - `resetActions.test.ts` (12)
  - `resetChoiceList.test.tsx` (11)
  - `claudeResetChoice.lifecycle.test.tsx` (9)
  - `resetChoices.locale.test.ts` (3)
- **Docs:** a picker paragraph in `docs/personal-quota.md` (+16), and plan progress and review notes (+48/−43).

Commits, oldest first: `4af42a22` pure choices and selection rule → `1a1d5d64` i18n keys → `e73f422c` hook choice state → `fef71f04` choices in `claudeResetAction` → `99493e9a` radio list → `2c4c9dfe` acceptance check → `31bd6a76` docs → `9c09e6f4` review fixes.

## Evidence
none

No validation commands were recorded for this run. The new tests in the diff target functions that did not exist before (`resetGrantChoices`, `resolveSelectedGrantId`, `ResetChoiceList`), but no before/after run output was captured. The plan's Task 6 says "323 files, 5400 tests passed", but that comes from the executor and is not in the run facts.

## Risk
**low**

- **Public APIs:** no HTTP or backend change; the claim already sends `grant_id`. The changed types (`ResetAction`, `ClaudeResetHandle`) are internal to the panel. `ClaudeResetHandle.choose` is a new required field, which only affects code inside the panel. `compareResetExpiry` is a new export.
- **Data schemas:** none touched.
- **Configuration:** none. The new i18n keys exist in all four locales, and `resetChoices.locale.test.ts` checks that their key sets match.
- **Concurrency:** this is the sensitive area. Spending a grant upstream cannot be undone, and a wrong selection would spend the wrong grant. Four safeguards cover it:
  - The default is unchanged: `resolveSelectedGrantId` falls back to `selectResetGrant`, and that rule is kept.
  - `resetGrantOperations.run` re-reads status and re-validates the chosen grant before it sends the claim.
  - A pending claim pins its grant.
  - Review found that the list stayed clickable during the two status reads before the claim is journaled. The `fieldset` is now disabled while `busy`.
- **Default selection on malformed dates:** dates are now read with `parseIsoToMs` instead of `Date.parse`. It accepts more than 6 fractional digits and treats blank strings as unreadable. This can change the default only for malformed timestamps.
- **Migrations:** none.
- **Not yet checked live:** the plan's Post-Completion check against a real account with several grants has not been done.

## Merge danger
**Door:** two-way
A plain revert restores the previous confirm step and selection rule. There are no data, API or config changes, and the panel stores no state across opens.

**Blast radius:** narrow
It affects only the Claude "Use a reset…" confirm step in the Ledger drawer and the compact card. Codex reset actions are unchanged.

## Migrations and operational steps
none

This is a normal panel-only deploy; CLIProxyAPI needs no change. The plan's Post-Completion lists a manual check:
- on a live account with several grants, pick a non-recommended grant in both the compact card and the drawer, confirm, and check that that grant's `resets_left` drops;
- check the narrow card layout with long labels, with masking on and off.

## Plan deviation
Tasks 1–7 are all checked off, and the implementation matches the plan.

- **Added**
  - ➕ `onClearChoice` is set on every Claude action, including when no list is shown and on a retry, so a stale pick cannot come back after a refresh restores its grant. Done in `resetActions.ts`; `onChoose` and `choices` still follow the at-least-two-choices rule.
  - ➕ (review) the radio `fieldset` locks while `busy`. This reverses an earlier grill decision ("dropped 'all radios disabled while busy'"): the claim is journaled only after two awaited reads, and the journal does not trigger a re-render. The Decision Log records the reversal.
  - ➕ (review) the choice is also cleared when "Use a reset…" opens the confirm step. A drawer refresh can unmount the footer mid-confirm without calling `close()` while the hook keeps the pick.
  - ➕ (review) end-to-end `react-test-renderer` tests mount `ClaudeLedgerResetsDrawer` with the real hook. They cover a picked radio driving the consequence and the spent id, the list locking in flight, and a refresh mid-confirm reopening on the default.
- **Blocked:** none
- **Skipped:** none
- **Other notes**
  - Task 5's wiring step needed no edit to `ClaudeResetActionMount` or the card, because both pass the action through unchanged.
  - Task 7 found no README section on resets, so the docs went into `docs/personal-quota.md`.
  - The review fix commit also removed a dead `claude_reset.*` fallback for reasons.
  - The manual Post-Completion checks are outside the plan's checkboxes and are still open.

## Backlog
There were no backlog entries.

## External review
### codex:gpt-6-astra:xhigh
- label: codex
- iterations: 1
- duration_ms: 143607
- ended by: done
- had findings: false
- Iteration 1 (truncated: false): reviewer output `NO ISSUES FOUND`

No findings. The evaluator confirmed a clean working tree, made no commit, and left no fixes or backlog entries.

## Validation
- Commands: none
- Timings: duration_ms 0, runs 0

The plan's Task 6 says `npm test` passed (323 files, 5400 tests), `npx tsc --noEmit` was clean, and `npm run lint` showed 0 errors and 7 warnings in files this branch does not touch. These results come from the executor and are not in the run's validation facts.