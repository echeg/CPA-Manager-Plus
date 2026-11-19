# Report: 2026 11 19 speed tier pricing
plan: /Users/echeg/Projects/CPA/CPA-Manager-Plus/.loopai/worktrees/speed-tier-pricing/docs/plans/20261119-speed-tier-pricing.md | branch: speed-tier-pricing | base: main | mode: full | executor: claude | task model: claude:opus:high | review model: claude:opus:xhigh | started: 2026-11-19T16:56:03Z | finished: 2026-11-19T18:38:00Z

## Summary
- task iterations: 7
- failed retries: 0
- external reviewers: 1
- post-review iterations: 1
| phase | duration_ms |
|---|---:|
| evaluation | 1012069 |
| external review | 559992 |
| internal review | 3599818 |
| other | 0 |
| tasks | 945005 |

## Change scope
- commits: 11
- files: 21
- additions: 1711
- deletions: 197
| status | path |
|---|---|
| M | apps/docs/en/manual/model-prices.md |
| M | apps/docs/manual/model-prices.md |
| M | apps/manager-server/internal/model/model_price_rules.go |
| M | apps/manager-server/internal/model/model_price_rules_test.go |
| M | apps/manager-server/internal/repository/modelprice/repository.go |
| M | apps/manager-server/internal/repository/modelprice/repository_test.go |
| M | apps/manager-server/internal/service/modelprice/service.go |
| M | apps/manager-server/internal/service/modelprice/service_test.go |
| M | apps/manager-server/internal/service/pricing/cost.go |
| M | apps/manager-server/internal/service/pricing/cost_test.go |
| M | apps/manager-server/internal/store/store_compat_test.go |
| M | apps/web/src/i18n/locales/en.json |
| M | apps/web/src/i18n/locales/ru.json |
| M | apps/web/src/i18n/locales/zh-CN.json |
| M | apps/web/src/i18n/locales/zh-TW.json |
| M | apps/web/src/utils/usage.test.ts |
| M | apps/web/src/utils/usage.ts |
| A | docs/backlog/cache-rate-fallback-gaps.md |
| A | docs/backlog/service-tier-pricing-gaps.md |
| D | docs/backlog/ultrafast-service-tier-priced-as-standard.md |
| M | docs/plans/20261119-speed-tier-pricing.md |

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
- ➕ updated `TestStoreCompatModelPricesAndAPIKeyAliases` (`internal/store/store_compat_test.go`), which pinned the old replace-on-sync behaviour; a stored rule is dropped when any of its identifiers is used by an imported rule, which also covers a stored `Mode` equal to an imported `ServiceTier`
- ➕ Cache-read and cache-write rates are compared as billed: an unset base or context-tier cache rate counts as the rate the cost path falls back to (`BilledCacheReadRate` / `BilledCacheCreationRate` on the server, `billedCacheReadRate` / `billedCacheCreationRate` on the web), so "base rate 0" means billed at 0. Found in internal review: with the stored 0 an unset base cache-write rate gave a Fast request above the threshold a lower cache-write price than a standard one.
- ➕ Above a context threshold the web fills blank official GPT-5.6 cache rates from the base input rate on both the rule path and the standard path, as the server already does (`enrichGpt56BasePrice` in `usage.ts`). Found in internal review: only the rule path did this, so a Fast rule without cache rates billed cache below the standard tier. The remaining open questions are in `docs/backlog/cache-rate-fallback-gaps.md`.
- ➕ The web's blank cache-rate fallbacks are the server's: a blank cache read is billed at the legacy cache rate, else a tenth of the input rate, and a blank cache write at the input rate, for every model (`billedCacheReadRate` / `billedCacheCreationRate` in `usage.ts`). The 0.1 and 1.25 factors of the official GPT-5.6 models come only from `enrichGpt56BasePrice`, which, like the server, fills in values without marking them configured. Found in external review: the web billed a blank cache read outside GPT-5.6 at 0, gave every `gpt-5.6*` model the 1.25 cache-write factor, and froze a filled-in zero as configured, so the rule ratio and the standard tier differed from the server.
- ➕ A cache rate that no price sets stays blank on the scaled price, so it follows the scaled input rate, as it follows the rule's input rate below the threshold. Example: base input 2, context input 4, prompt-only Fast rule 6, no cache-write rates: cache writes cost 2 / 6 below the threshold and 4 / 12 above it (standard / Fast). Keeping the plain context rate (4) for Fast would bill long-context Fast cache writes below short-context Fast ones. The official GPT-5.6 models are the exception: above a threshold `enrichGPT56BasePrice` / `enrichGpt56BasePrice` fill their blank cache rates from the base input rate before the context tier and the rule apply, so a positive filled-in rate is no longer blank and a rule without cache rates keeps it. Example: `gpt-5.6-sol`, base input 2, context input 4, prompt-only Fast rule 6: Fast cache writes cost 7.5 below the threshold (6 x 1.25) and 2.5 above it (2 x 1.25). A filled-in zero (explicit zero base input) stays blank, because only a configured or positive rate counts as set (`configuredPriceValue` / `isConfiguredPriceValue`), so it follows the scaled input rate like any blank rate: base input 0, context input 4, no cache rates bills a long-context cache read at 0.4 (`TestContextTierBillsGPT56CacheReadFromContextPromptForExplicitZeroBasePrompt` and its `usage.test.ts` twin). Found in external review; the manuals state the exception, and the open question of the right base is in `docs/backlog/cache-rate-fallback-gaps.md`.
### Blocked
- none
### Skipped
- none

## Backlog
| status | path | title |
|---|---|---|
| A | docs/backlog/cache-rate-fallback-gaps.md | GPT-5.6 long context fills blank cache rates from the base input rate |
| A | docs/backlog/service-tier-pricing-gaps.md | Service tier pricing gaps: missing rules, multipliers in context tiers, cache-write rates |

## External review
### codex:gpt-6.2-astra:xhigh
- label: codex
- iterations: 4
- duration_ms: 1572021
- ended by: done
- had findings: true
#### Iteration 1
- truncated: false
Reviewer output:
```
- **[P2] A prompt-only rule changes cache rates it does not configure.** `apps/manager-server/internal/model/model_price_rules.go:299` and `apps/web/src/utils/usage.ts:1473` leave an omitted cache-write rate unset, so billing derives it from the **scaled** prompt. With base prompt 2, context prompt 4, and Fast prompt 6, one million long-context cache writes cost **12 instead of 4**. Preserve the context tier’s billed cache rate before scaling the prompt.
- **[P2] The web can price Fast cache reads below standard.** `apps/web/src/utils/usage.ts:1425` treats a missing non-GPT-5.6 cache-read rate as zero when the legacy cache rate is also zero. With base prompt 2, context cache read 1, and Fast cache read 0.4, the web shows **0.4 per million for Fast versus 1 for standard**. The server uses a base fallback of 0.2 and correctly computes **2** for Fast. The fallback difference predates this branch; the Fast-below-standard result is new.
- **[P2] The web uses the wrong cache-write denominator for non-official GPT-5.6 models.** `apps/web/src/utils/usage.ts:1433` applies the 1.25 multiplier to `gpt-5.6` even though the server only enriches the named official variants. With base prompt 4, no base write rate, context write 10, and Fast write 8, the web computes **16 per million** and the server computes **20**. Both previously showed 10 for that request.
- **[P2] An explicit zero base prompt can make long-context cache reads free only on the web.** `apps/web/src/utils/usage.ts:1415` marks a derived zero cache rate as explicitly configured. For `gpt-5.6-sol` with base prompt explicitly 0, no cache rates, and context prompt 4, the web now shows **0 per million cache reads even on standard**; the server and the pre-change web both show **0.4**. Keep a derived zero distinct from an explicitly configured cache zero.
- **[P3] The documented stale-rule cleanup also deletes unrelated hand-made rules.** `apps/docs/en/manual/model-prices.md:32` recommends deleting the model and syncing again to remove one stale rule. That also removes every other stored rule for that model that the source cannot restore. Both manuals should warn about that loss before recommending the procedure.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the external findings with technical rigor.Checking each finding against the server and web cost code now. So far: findings 2–4 look like real web/server mismatches; finding 1 may be intended behaviour, so I'm verifying it before deciding.Now running the web suite to see which existing expectations relied on the old web-only fallbacks.Adding the Go tests after the existing cache-write ratio test.The server already produces the values Codex gave for findings 2–4, which confirms the server is the reference. Now adding the same examples to the web tests.Confirming the new web tests actually catch the old behaviour by running them against the committed `usage.ts`:Making the finding-1 semantics explicit in the manuals as well, since the reviewer read "keeps the context-tier rate" to mean a frozen number:Now updating the backlog entry: its section 2 (server/web disagree on a blank cache read outside GPT-5.6) is fixed by this change, so only section 1 stays.Updating the plan's Technical Details and fixing a stale line reference in the other backlog file:Running the full verification: Go tests, web tests, type-check, and lint.Go: 63 packages ok, no failures. Web: 5697 tests pass, type-check clean, lint 0 errors. Checking whether the 7 lint warnings are the known pre-existing ones:Lint exits 0. The 7 warnings are the known pre-existing ones in unrelated files and are already tracked in `docs/backlog/web-lint-warnings.md`. Final look at the `usage.ts` change:Checking formatting on the changed TS files, since lint may not run Prettier:Prettier touched more lines than I edited. Checking whether that is pre-existing drift elsewhere in the file:Two of those hunks (lines 577 and 1153) are Prettier drift in code neither this branch nor I touched. I'll revert them to keep the diff focused and keep Prettier's formatting only in my own edits.Only the pre-existing Prettier drift remains, the same lines as at HEAD. Re-running web tests, type-check, and lint after the formatting pass:I fixed findings 2, 3, 4 and 5 and dismissed finding 1 as intended behaviour. Nothing is committed and I output no signal, so Codex can re-check the fixes.

Findings 2, 3 and 4 had one root cause: the web worked out a blank cache rate differently from the server. The web now uses the server's rules (apps/web/src/utils/usage.ts):
- billedCacheReadRate copies the server's BilledCacheReadRate for every model: the configured rate, else the legacy cache rate, else a tenth of the input rate.
- billedCacheCreationRate copies BilledCacheCreationRate: the configured rate, else the input rate. Only the official GPT-5.6 models get the 1.25 factor, through enrichGpt56BasePrice, as on the server.
- enrichGpt56BasePrice fills in values without marking them configured, as the server does. It now runs on every path the server runs it on, including the base band after a rule applies.

Findings:
- Finding 2 (valid, fixed): with Codex's numbers the web now bills Fast cache reads above the threshold at 2 and standard at 1, the same as the server. This also removes the older server/web difference (a blank cache read outside GPT-5.6 was billed at 0 on the web). That was section 2 of docs/backlog/cache-rate-fallback-gaps.md, so I took it out of that entry.
- Finding 3 (valid, fixed): gpt-5.6 is not an official model, so its blank cache write is now billed at the input rate. Codex's example gives 20 for Fast and 10 for standard, the same as the server.
- Finding 4 (valid, fixed): an explicit zero base input rate no longer becomes a configured zero cache rate. For gpt-5.6-sol with context input 4, a cache read costs 0.4 per 1M, the same as the server.
- Finding 5 (valid, fixed): both manuals now warn that deleting a model and syncing again also drops every hand-made rule of that model the source does not provide, and that adding one back in the editor makes the model manual again.
- Finding 1 (invalid, intended): a blank cache-write rate means "billed at the input rate" in every band, not a stored number that gets frozen.
  - In Codex's example (base input 2, context input 4, input-only Fast rule 6), the same rule below the threshold already bills Fast cache writes at 6 (ModelPriceForServiceTier leaves the rate blank).
  - Above the threshold the current code gives 12, so Fast stays 3 times standard in both bands.
  - Codex's proposed 4 would make long-context Fast cache writes (4) cheaper than short-context Fast cache writes (6). That is exactly the kind of inversion this plan exists to remove.
  - A configured cache rate is never scaled by a rule that does not set it, in either band. I pinned this with a test on each side, TestPromptOnlyRuleBillsUnsetCacheWriteAtTheTierPromptRateInEveryBand in Go and the matching web test, and spelled the rule out in the plan's Technical Details and both manuals.

Tests: I added Go tests in cost_test.go and web tests in usage.test.ts that use Codex's numbers for findings 1–4, plus a base-band check for finding 2. The web tests for findings 2–4 fail against the committed usage.ts and pass with the fix.
- Go: npm run manager-server:test passes (63 packages).
- Web: npm run test:web passes (5697 tests), and npm run type-check passes.
- Lint: npm run lint shows 0 errors. The 7 warnings are the pre-existing ones in unrelated files, already listed in docs/backlog/web-lint-warnings.md.
- Prettier also reports old formatting problems in two parts of usage.ts this branch never touched. I left those alone to keep the diff focused; my own edits pass Prettier.

Other files changed: the plan's Technical Details has two new notes, cache-rate-fallback-gaps.md now covers only the remaining GPT-5.6 long-context question, and one line reference in service-tier-pricing-gaps.md is corrected. No new backlog entry was needed.
```
#### Iteration 2
- truncated: false
Reviewer output:
```
- **[P3] Both manuals omit the official GPT‑5.6 exception.** `apps/docs/en/manual/model-prices.md:61` and `apps/docs/manual/model-prices.md:61` say an unset cache rate follows the scaled input rate. With `gpt-5.6-sol`, base input 2, context input 4, and a Fast rule setting only input to 6, I verified that Fast cache writes cost **7.5 per million below the threshold and 2.5 above it**. Above the threshold, both implementations fill the blank write rate from the base input (`2 × 1.25`) before applying the context tier. Qualify the rule in both manuals and in `docs/plans/20261119-speed-tier-pricing.md:135`; no billing-code change is needed for this finding.

Findings 2–5 are fixed. Finding 1 was correctly dismissed for its `gpt-6.2-sol` example: Fast cache writes cost 6 per million below the threshold and 12 above it, as intended.

```
Evaluator response:
```
Relevant skill: superpowers:receiving-code-review, because this task is evaluating external review feedback.Now let me trace the GPT-5.6 cache-write fill in both implementations to verify Codex's numbers.Let me confirm the below-threshold path and the scaling helper on the server before deciding.The finding holds on the server side. Next I'll check the existing GPT-5.6 tests to see whether the web gives the same numbers and whether a test already pins this case.Now the plan's Technical Details line that Codex cited, plus a note on the existing backlog entry, since it's the same open question:Only docs changed, but I'll still run the repo's checks, including any docs or markdown formatting step.The Go test output showed no failures, but `PIPESTATUS` doesn't work in zsh, so I'll confirm the exit code directly:Codex's finding is valid, and I fixed it in the docs. The billing code is unchanged, so no signal this round.

Finding (P3), manuals miss the official GPT-5.6 exception: valid, fixed.
- I checked both implementations. On the server, below the threshold the GPT-5.6 cache-rate fill runs after the Fast rule applies (cost.go:52). Above the threshold it runs on the base price before the context tier and the rule (cost.go:294-296). The fill leaves the rate set to 2.5, so it is no longer blank, and a rule with no cache rates keeps it as is. The web follows the same order (usage.ts:1306-1316).
- A throwaway Go test, since deleted, with Codex's example (gpt-5.6-sol, base input 2, context input 4, Fast rule setting only input 6) gave Fast cache writes of 7.5 below the threshold and 2.5 above it. That matches Codex's numbers.
- This order is intended: TestContextTierRuleRatioUsesEnrichedGPT56BaseCacheRates already pins it, and the plan says the web copies the server's GPT-5.6 behavior. The sentence added in an earlier pass of this loop was simply wrong for these models. It is in scope because it is this branch's own docs text.

Changes:
- apps/docs/en/manual/model-prices.md and apps/docs/manual/model-prices.md: a new "Service-tier semantics" bullet after the scaling bullet. It names gpt-5.6-sol, gpt-5.6-terra and gpt-5.6-luna as the exception. Below the threshold their blank cache rates are filled from the input rate the request is billed at, including a rule's input rate (cache read a tenth, cache write 1.25 times). Above the threshold they are filled from the base input rate before the tier and the rule. It includes the 7.5 / 2.5 example. The Chinese manual has the same text.
- docs/plans/20261119-speed-tier-pricing.md, Technical Details line 135: added the same exception with the example, pointing to the backlog entry.
- docs/backlog/cache-rate-fallback-gaps.md: this existing entry already tracks whether GPT-5.6 long context should fill from the base input rate. I added the Fast consequence, where long-context Fast cache writes cost less than short-context ones, so a later fix accounts for it. I did not create a new entry.

Checks:
- go test ./... in apps/manager-server: exit 0.
- npm run test:web: 325 files and 5697 tests pass.
- npm run type-check: clean.
- npm run lint: 0 errors and 7 warnings. These are the existing ones listed in docs/backlog/web-lint-warnings.md.
- npm run docs:build: builds.

Nothing is committed.

Insight:
- The rule that a blank cache rate follows the scaled input rate only holds if the rate is still blank when the rule applies. The GPT-5.6 fill makes it non-blank first: any value above 0 counts as set (BilledCacheCreationRate), even though it isn't marked configured. From then on, a rule that sets no cache rates keeps it unchanged.
```
#### Iteration 3
- truncated: false
Reviewer output:
```
- **[P3] Qualify the GPT-5.6 cache-rate exception for an explicit zero base input rate.** `apps/docs/en/manual/model-prices.md:62`, `apps/docs/manual/model-prices.md:62`, and `docs/plans/20261119-speed-tier-pricing.md:135` correctly document the 7.5 / 2.5 Fast cache-write example. However, both implementations treat a cache rate derived from a zero base input rate as **unset**, not as a fixed zero. With base input 0, context input 4, and no cache rates, a long-context cache read costs 0.4 per million, as covered by `apps/manager-server/internal/service/pricing/cost_test.go:381` and `apps/web/src/utils/usage.test.ts:1920`. The docs should say that only a **positive** derived cache rate stays fixed; a derived zero uses the normal billing fallback.

```
Evaluator response:
```
Using superpowers:receiving-code-review to evaluate the Codex finding with rigor.These are docs-only edits. I'll still check that the names I referenced exist, run the two cited tests, and run any docs linter.The grep for the web's `isConfiguredPriceValue` came back empty, so I'm finding where it's defined before citing it in the plan.`isConfiguredPriceValue` is at `apps/web/src/utils/usage.ts:384`. Next I'm building the docs site so the edited manuals still render.The Codex finding was valid and in scope, and I fixed it. These docs were written on this branch, so the error was in this branch's own work.

Why it was wrong: on both server and web, a cache rate only counts as set when it is configured or above zero (configuredPriceValue in cost.go:416, isConfiguredPriceValue in usage.ts:384). When the base input rate is explicitly 0, enrichGPT56BasePrice / enrichGpt56BasePrice fill in cache rates of 0 but don't mark them configured, so they stay blank. A blank rate is then billed from the context-tier input rate, or from the scaled one if a rule applies. The docs said the filled-in rates stay fixed above a threshold and don't follow the scaled input rate, which only holds when the filled-in rate is positive. The two tests Codex cited confirm this: with base input 0 and context input 4, a long-context cache read costs 0.4 per 1M tokens.

Changes:
- apps/docs/en/manual/model-prices.md: the GPT-5.6 exception now applies only to a positive filled-in rate. A new sentence says a filled-in zero from an explicit zero base input stays blank and follows the normal blank-rate rule, with the example base 0 / context 4 → long-context cache read 0.4 per 1M.
- apps/docs/manual/model-prices.md: the same change in Chinese.
- docs/plans/20261119-speed-tier-pricing.md: the Technical Details note now says the same, names the two helpers that decide "set", and points to the tests.

Verification:
- Server pricing tests: go test ./internal/service/pricing/ passed.
- Web tests: vitest src/utils/usage.test.ts passed, 125 tests.
- Docs: the VitePress build succeeded.

Nothing was committed and no backlog entry was filed.
```
#### Iteration 4
- truncated: false
Reviewer output:
```
NO ISSUES FOUND

Both manuals and the plan now correctly distinguish a cache rate derived from zero, which remains unset, from an explicitly configured zero, which stays zero. The server and web regression tests both cover the documented case: base input `0`, context-tier input `4`, and no cache rates yield `0.4` per million cache-read tokens (`apps/manager-server/internal/service/pricing/cost_test.go:381`, `apps/web/src/utils/usage.test.ts:1920`).

```
Evaluator response:
```
Prettier flags usage.ts. I'll check whether the branch's diff caused it and what it would change.Both prettier warnings are older than this branch (lines 577 and 1153, outside the diff), and they show up in HEAD too. I'll check whether CI enforces prettier before touching unrelated lines.Everything passes. Now I'll stage exactly the eight paths from this loop and commit.Codex found no issues, so nothing new needed fixing. I committed this loop's accumulated changes as 923cf3207 "fix: address codex review findings", and the working tree is now clean.

What the commit contains (all 8 files, all from this external review loop):
- apps/web/src/utils/usage.ts: a blank cache rate in the web panel is now billed the same way as on the server. Cache reads use the legacy cache rate, else a tenth of the input rate. Cache writes use the input rate. The 0.1 and 1.25 factors now apply only to the official GPT-5.6 models, and a filled-in zero is no longer saved as if it were set.
- Regression tests in cost_test.go and usage.test.ts that use the same numbers on both sides, including the case Codex checked: base input 0, context-tier input 4, no cache rates gives 0.4 per 1M cache reads.
- Both manuals (en and zh) and the plan explain the GPT-5.6 exception and the zero case.
- docs/backlog/cache-rate-fallback-gaps.md is narrowed to the one open question: which input rate GPT-5.6 cache rates should be filled from above a context threshold. docs/backlog/service-tier-pricing-gaps.md only has its line references updated.

Checks run just before the commit:
- Go: the full manager-server test suite passed, and go vet and gofmt were clean on the pricing and model packages.
- Web: the full vitest suite passed (325 files, 5697 tests). tsc --noEmit and eslint passed.
- prettier --check flags two lines in usage.ts (577 and 1153). Both are outside this branch's diff and fail the same way on HEAD. Neither CI nor eslint runs prettier, so I didn't reformat them in this commit.

<<<RALPHEX:EXTERNAL_REVIEW_DONE>>>
```

## Validation
- none
- duration_ms: 0
- runs: 0