# Report: Panel cleanup: dead routing components, lint warnings, key masking inside words, Guide for a switched-off provider

Plan `docs/plans/20261119-panel-small-cleanup.md` · branch `panel-small-cleanup` · base `main` · mode `full` · executor `claude` · task model `claude:opus:high` · review model `claude:opus:xhigh` · started `2026-11-19T16:56:09Z` · finished `2026-11-19T18:20:27Z`

## Summary
This branch closes four web-panel backlog items. It does not touch the backend.

- **Unused code removed.** `SubscriptionRouting.tsx`, `SubscriptionAccounts.tsx` and `SubscriptionRouting.module.scss` are deleted. Internal review found that `AccountHealthBadge` (component and stylesheet) was also used nowhere, so it is deleted too, along with its barrel exports.
- **The seven lint warnings are fixed:**
  - The three `any` casts in `AccountsPage.test.tsx` are gone.
  - The usage-maintenance constants moved to the new `usageMaintenanceCommands.ts`.
  - `apiBase` was removed from the `useCallback` dependencies in `DashboardPage.tsx`. The dashboard still reloads when the connection changes, because `DashboardPage` creates `DashboardPageContent` fresh whenever the connection changes. A new test in `pageRefresh.test.tsx` covers this.
- **Key masking no longer hits ordinary words.**
  - `sk-proj-`, `sk-ant-`, `sk-`, `sess-` and the new `csk-` (Cerebras) are masked only when no letter or digit comes right before them. `task-runner` and `assess-candidates` are now shown as typed.
  - Keys are still masked after `_`, after a JSON escape (`\n`, `\u001b`), after a percent-encoding (`%3D`), and after a terminal color code (raw, JSON-escaped or with the ESC character stripped).
  - The boundary is written as a captured group, not a lookbehind, because Safari before 16.4 cannot parse a lookbehind and the panel would not load there.
  - The regex is rewritten so a long run of color codes is read once instead of once per code.
- **The Guide now covers a switched-off provider.**
  - The `intro_key_routing` text (all four languages) and both manual pages say: a profile can switch Claude or Codex off; CPA then answers that provider's requests with 403 `provider_disabled`; Claude's fallback to a switched-off Codex does not run; the switch is ignored in Home mode or under a scheduler plugin.
  - The key-routing diagram has a new "Provider off → 403" branch and was rebuilt with archify.

Run shape: 6 task iterations with 0 failed retries. Internal review ran 1 loop iteration and ended with `review_done`. Post-review ran 1 iteration. External review (Codex) ran 4 iterations and ended clean.

Phase durations:

| phase | duration_ms | ≈ |
|---|---:|---|
| tasks | 1448118 | 24m 08s |
| internal review | 1862258 | 31m 02s |
| external review | 432197 | 7m 12s |
| evaluation | 1314758 | 21m 55s |
| other | 0 | 0s |
| **total** | 5057331 | 1h 24m 17s |

Finalize did not run, so the branch was not synced with `origin/main` and the diff is against local `main` (`1e720f297`). `origin/main` currently points at `65a2f4cd4`, which is a different commit from the base used here.

## Change scope
- **Diff:** 34 files, +455 / −672. More lines were removed than added because of the deleted components and backlog entries.
- **Deleted (5 source files):** `quota/components/SubscriptionRouting.tsx`, `SubscriptionAccounts.tsx`, `SubscriptionRouting.module.scss`, `accounts/components/AccountHealthBadge.tsx`, `AccountHealthBadge.module.scss`.
- **Added:**
  - `usage-maintenance/usageMaintenanceCommands.ts` (the moved constants and type)
  - `monitoring/model/apiKeys.test.ts`
  - two backlog entries
- **Masking:** `utils/format.ts` (regex and replace callback) and `utils/format.test.ts` (+144 lines of cases, including linear-time checks).
- **Lint fixes:**
  - `AccountsPage.test.tsx`
  - `accounts/components/index.ts`
  - `DashboardPage.tsx`, plus a reload test in `pageRefresh.test.tsx`
  - `UsageMaintenanceCapabilityViews.tsx`, `UsageMaintenancePage.tsx` and `UsageMaintenancePage.test.tsx` (import moves)
- **Guide:**
  - the four locale files
  - `key-routing.workflow.json` and the regenerated `key-routing.html`
  - `diagrams/README.md`
  - `guideWiring.test.ts` (+75 lines)
  - `apps/docs/en/manual/guide.md` and `apps/docs/manual/guide.md`
- **Docs:** `docs/personal-quota.md` ("How keys are shown"), the plan file, 4 backlog entries deleted and 2 added.
- **Commits (9):**
  - `ad4705c01` delete unused subscription routing components
  - `a03522677` fix the seven web lint warnings
  - `2e2b6f208` do not mask sk- and sess- inside words
  - `d8748d48f` describe a switched-off provider in the Guide
  - `b62dad50d` verify acceptance criteria
  - `8401344c2` document the masking boundary and close the backlog entries
  - `51080e834` fix: address code review findings
  - `0f02d792e` docs: add backlog entry
  - `acdabfa9b` fix: address codex review findings

## Evidence
The loop recorded no validation runs (`runs: 0`). Every before/after result below was reported by the agent in the external-review evaluator output, or comes from main's documented behavior and the tests in the diff. None of it is a loop-recorded command run.

| Behavior | Before | After |
|---|---|---|
| Words containing `sk-` / `sess-` | On `main`, `task-runner` was shown as `task******er`, `kiosk-berlin` as `kiosk******in`, `risk-engine` as `risk******ne` (the deleted backlog entry and the old `personal-quota.md` text both document this) | `format.test.ts` "leaves the ordinary word %s unchanged" and `apiKeys.test.ts` "keeps a CP instance name…" expect them unchanged |
| Cerebras `csk-` and keys right after a color code (regressions introduced by the first boundary) | Evaluator, iteration 1: "the old regex misses all three regression cases" | New `csk-` and color-code cases in `format.test.ts`; evaluator reports 5719 tests passing |
| `[msk-cluster]` | Reproduced by the reviewer and the evaluator: `maskSensitiveText('[msk-cluster]')` → `[msk******er]` | "does not take a bare [m or [K…" cases expect it unchanged; evaluator reports 5725 tests passing |
| `[31;m` + key, `[1;m[K` + key | Key shown in full (evaluator, iteration 3) | Masked. With the old regex put back, 4 of the new tests failed: both trailing-separator cases and two timing cases |
| Long runs of stripped color codes | Old regex: 48 KB of `[1m` took 1.3 s, 96 KB took 5.2 s (40000 codes ≈ 8 s) | Evaluator: the whole test file runs in about 10 ms; each timing case is held to < 1 s |
| Lint | 7 warnings (deleted `web-lint-warnings.md`) | Evaluator, iteration 4: eslint exit 0, no warnings; `tsc --noEmit` exit 0 |
| Full suite (agent-reported, iteration 4) | — | 5732 web tests in 326 files, 266 repo tests in 16 files, all passing |

## Risk
**medium**

- **Public APIs:** no change. No backend or `manager-server` code is touched. The barrel exports removed from `accounts/components/index.ts` (`AccountHealthBadge`, `severityFromQuotaStatus`, `AccountHealthSeverity`) and the constants moved out of `UsageMaintenanceCapabilityViews.tsx` are internal to the panel, and a search of `apps/web/src` finds no remaining importers.
- **Data schemas:** none touched.
- **Configuration:** none touched.
- **Concurrency:** one change. `DashboardPage`'s refresh callback no longer depends on `apiBase`. A reload on a new connection now relies only on `DashboardPageContent` being created fresh when the connection changes (its React `key` is built from the connection). The new `pageRefresh` test checks that health data is fetched again and the old snapshot is dropped when the CPA base changes.
- **Migrations:** none.
- **Why medium — key masking.** This branch deliberately masks less than before, and masking is how the panel keeps keys out of failure summaries, evidence and labels.
  - The rule is "mask after a non-alphanumeric character, plus a fixed list of escape forms." Each review round found a real leak in it (`csk-`, color codes, `[31;m`).
  - A remaining gap I confirmed with a node probe of the committed regex while writing this report: `key\x3dsk-abcdef123456` (a Python- or C-style hex escape) is left unmasked. `main` masked it.
  - Any other escape or encoding that ends in a letter or digit has the same exposure.
  - The rewritten regex is linear-time on long runs of color codes and has timing tests. It still runs synchronously during render on fail summaries and evidence.

## Merge danger
**Door:** two-way
The change is frontend-only, with no data, schema, config-format or API change. A plain revert restores the old components, lint state, masking rule and Guide text.

**Blast radius:** panel
`maskSensitiveText` runs on every failure summary, account-action evidence, masked account name and key label in the panel. A masking gap shows a key on screen; it does not affect stored data or the backend.

## Migrations and operational steps
- No database, configuration or data steps.
- **Deployment:** a panel-only release on the local Mac, when `apps/manager-server` is unchanged since the running binary (the plan's Post-Completion).
- **Manual check:** open the Guide page in both themes and look at the regenerated key-routing diagram (the plan's Post-Completion).
- **Before merging:** sync the branch with `origin/main` (`65a2f4cd4`), because finalize did not run.

## Plan deviation
All original task items are marked done. Blocked: none. Skipped: none.

Added items, each accounted for:
1. **Masking boundary is a captured group, not a lookbehind** (internal review). Done: `format.ts` uses a group that the replace callback puts back. A lookbehind literal would stop the panel from loading on Safari < 16.4. The group also accepts JSON escapes and `%XX`.
2. **Delete `AccountHealthBadge`, its stylesheet, `accountHealthSeverity.ts` and its test, and their barrel exports** (internal review). Done in `51080e834`. Task 2 had created `accountHealthSeverity.ts` and its test in `a03522677`, so they do not appear in the net diff. This replaces the planned "move to a sibling `.ts`" for that file.
3. **Add `csk-` (Cerebras) as a bounded prefix** (external review). Done, with tests.
4. **Accept the bracket part of a terminal color or erase-line code as a boundary** (external review). Done for the raw, JSON-escaped and stripped-ESC forms, with tests.
5. **With the ESC stripped, a run of codes must start with one that has a digit** (external review). Done; `[msk-cluster]` stays readable, with tests.
6. **Accept a stripped code whose digit is anywhere in its parameters** (external review). Done (`[31;m`, `[1;m[K`, `[;1m`), with tests.
7. **Rewrite the stripped run as one numbered code followed only by codes without a digit** (external review). Done; linear-time, with timing tests.
8. **Manual names only Claude and Codex as switchable, and also mentions Home mode** (internal review). Done in both manual pages.
9. **Rename the diagram's `fallback` lane** (internal review). Done: it is now "Provider off, or fallback to a Codex subscription or API key", and the page was regenerated.
10. **Guide intro (4 languages) and the "Profile per client key" card say the switch is ignored in Home mode or under a scheduler plugin** (external review). Done; the page was regenerated, and `guideWiring.test.ts` checks the sentence in the locales, the diagram source and the HTML.

Other deviations from the plan text:
- **DashboardPage:** the plan allowed "keep the reload by an explicit means." The dependency was dropped, the existing fresh-creation of `DashboardPageContent` is that means, and a test was added for it.
- **Guide tests:** `GuidePage.test.tsx` was left unchanged. The new checks went into `guideWiring.test.ts` instead, as the plan item notes.

## Backlog
Closed by this plan (deleted in `8401344c2`):
- `unused-subscription-routing-components.md`: resolved (components deleted).
- `web-lint-warnings.md`: resolved (0 warnings, agent-reported).
- `sensitive-text-mask-matches-inside-words.md`: resolved (bounded `sk-` / `sess-` and `csk-`).
- `guide-disabled-provider.md`: resolved (Guide, diagram and manuals updated).

Filed by this plan:
- **The key mask still matches `rk_`, `pk_`, `hf_` and `ghp_` inside words** (`docs/backlog/key-mask-underscore-prefixes-inside-words.md`, filed in `51080e834`). Open; left out of scope on purpose. It also notes that `pk_` / `rk_` don't match Stripe-style `pk_live_…` keys.
- **Usage source ids still treat `sk-` and `sess-` inside words as raw keys** (`docs/backlog/usage-source-key-regex-matches-inside-words.md`, filed in `0f02d792e`). Open. `KEY_LIKE_TOKEN_REGEX` in `usage.ts` is an unbounded copy of the old regex, so `task-runner` usage sources are still shown as a hashed key. It also means the new sentence in `docs/personal-quota.md`, that the panel uses the bounded rule "wherever it masks text", currently overstates things for this path.

## External review
### codex:gpt-6.2-astra:xhigh
- label: codex
- iterations: 4
- duration_ms: 1746913
- ended by: done
- had findings: true

Findings:
- Iteration 1, P1: Cerebras `csk-` keys are no longer masked, because the boundary rejects the `sk-` after `c` -> fixed
- Iteration 1, P2: a key right after a terminal color code (`ESC[31m`) is exposed in diagnostics and JSON evidence -> fixed
- Iteration 1, P2: the in-panel Guide and the diagram promise a 403 even though the switch is ignored in Home mode or under a scheduler plugin -> fixed
- Iteration 2, P3: a bracketed label such as `[msk-cluster]` is masked as `[m` + key -> fixed
- Iteration 3, P2: a stripped color code with a trailing separator (`[31;m`) exposes the key -> fixed
- Iteration 3, P3: matching stripped color codes takes quadratic time on long runs -> fixed (by rewriting the regex rather than the reviewer's suggested callback-side check, so that text a rejected match had consumed is not left unmasked)
- Iteration 4: NO ISSUES FOUND

## Validation
- Commands: none
- Timings: duration_ms 0, runs 0

The loop recorded no validation commands. The test, lint and type-check results in Evidence are what the evaluator agent reported in its review responses.