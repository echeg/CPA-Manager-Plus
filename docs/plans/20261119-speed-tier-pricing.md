# Speed tier pricing: long context, models.dev modes, and a sync that keeps hand-made rules

## Overview
- Cost estimation gets three things wrong for service tiers (speed tiers such as Fast and the new Ultrafast). This plan fixes them in the server and in the web copy of the cost logic.
- **Long context ignores the tier.** When a model has a context tier (for example above 272k input tokens) and a price rule for the request's service tier, the request is costed at the long-context rate with no tier surcharge. Example for `gpt-6.2-sol` on Ultrafast above 272k: OpenAI charges 12 / 45 per 1M tokens (input / output), the panel computes 4 / 15. After the change the long-context rates are scaled by the tier rule's ratio to the base rate.
- **The models.dev import reads only the `fast` mode.** After the change it imports every mode that carries a cost, so an `ultrafast` price arrives on its own once models.dev publishes it.
- **A price sync deletes hand-made rules.** For every model whose source is not `manual`, a sync deletes the stored service-tier rules and context tiers and inserts only what the import provides. After the change a sync keeps the stored rules the import does not provide.
- The local deployment depends on the last point: since 2026-11-18 it holds hand-made Ultrafast rules for `gpt-6.2-sol`, `gpt-6.2-astra`, `gpt-6.1-sol` and `gpt-6-astra`, and Fast rules plus a 272k context tier for the two GPT-6.2 models, all on models with source `models.dev` or `litellm`.

## Decisions
- **Context**: `docs/backlog/ultrafast-service-tier-priced-as-standard.md` lists four defects. The user chose the scope and the three rules below on 2026-11-19.
- **Chosen approach, long context**: the scaling applies to every model that has both a context tier and a price rule for the request's tier, for every tier name. It changes the reported cost of Fast requests above the threshold for GPT-5.5, GPT-5.6 and GPT-6.x, including past periods, because cost is computed when it is read.
- **Chosen approach, sync**: keep stored rules the import does not provide; an imported rule replaces a stored rule with the same key. No schema change.
  - Known cost: a rule the source stops providing stays until it is deleted by hand in the price editor.
- **Chosen approach, import**: one rule per models.dev mode that has a `cost` block.
- **Non-goals** (user decision):
  - A tier without a price rule is still costed at the base rate, with no marker in the UI.
  - No built-in Ultrafast multipliers in code.
- **Not changed**:
  - A tier that has no rule and is priced by the built-in multiplier (`ServiceTierMultiplier`: flex / batch at 0.5, Fast for some GPT-5.x families) still gets no surcharge or discount inside a context tier.
  - The legacy long-context path for models without context tiers (`supportsLongContextPremium`).
  - The price book keeps one cache-write rate.
- **Verified facts**:
  - `costForPriceWithServiceTier` returns `costForPrice` when a context tier is active and never reads the service tier (`apps/manager-server/internal/service/pricing/cost.go:276-279`).
  - `applyModelPriceContextTier` and `ModelPriceForServiceTier` both clear `ServiceTiers` on the effective price (`apps/manager-server/internal/model/model_price_rules.go:134-137`, `:221-249`).
  - Two tests assert the current behaviour for a model with an explicit rule and must be inverted: `TestContextTierDoesNotStackPriorityMultiplier` (`apps/manager-server/internal/service/pricing/cost_test.go:135`) and `'does not stack priority pricing with active context-tier pricing'` (`apps/web/src/utils/usage.test.ts:1543`).
  - The web copy is `calculateCost` (`apps/web/src/utils/usage.ts:1202`); it selects `serviceTierPrice` only when no context tier applies (`:1289-1300`). Its only caller is `features/monitoring/model/eventRows.ts:167`.
  - The server gets the context band of each aggregate from SQL as `ModelTokens.ContextThresholdTokens`, together with the service tier, so both are known for one cost call. `-1` is the base band.
  - `readModelsDevServiceTiers` reads only `experimental.modes.fast.cost` and creates the rule `fast` / `priority` (`apps/manager-server/internal/service/modelprice/service.go:949-991`). LiteLLM and OpenRouter imports produce no tier rules.
  - `UpsertSynced` skips models whose stored source is `manual` (`apps/manager-server/internal/repository/modelprice/repository.go:364`) and replaces both rule sets of every other model (`:444-455`). It already loads the prices before the write (`beforePrices`) for the structure revision check (`:456-471`).
  - `NormalizeModelPriceServiceTiers` rejects two rules that share a `Mode` or a `ServiceTier` value (`model_price_rules.go:163`).
  - `ModelPriceStructureRevision` hashes model IDs and context thresholds only (`model_price_rules.go:255`).
  - The price editor saves with source `manual` (`apps/web/src/features/monitoring/model/modelPricesPageModel.ts:209`), and the `PUT` replaces all prices (`ReplaceAll`, `repository.go:221-325`). Both stay as they are.
  - Neither rule table has a source column, and no schema change is needed.

## Context (from discovery)
- Files/components involved:
  - `apps/manager-server/internal/model/model_price_rules.go` and `model_price_rules_test.go`
  - `apps/manager-server/internal/service/pricing/cost.go` and `cost_test.go`
  - `apps/web/src/utils/usage.ts` and `usage.test.ts`
  - `apps/manager-server/internal/service/modelprice/service.go` and `service_test.go`
  - `apps/manager-server/internal/repository/modelprice/repository.go` and `repository_test.go`
  - docs: `apps/docs/manual/model-prices.md`, `apps/docs/en/manual/model-prices.md`, `docs/backlog/ultrafast-service-tier-priced-as-standard.md`
- Related patterns found: the Go and TS cost logic mirror each other rule for rule; `'matches backend priority tier rules'` (`usage.test.ts:1654`) pins the TS values to the server's by hardcoded numbers.
- Dependencies identified: none new.

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- Keep the Go and TS cost rules identical: the same example numbers appear in both test suites
- Commands: `npm run manager-server:test` (Go), `npm run test:web`, `npm run type-check`, `npm run lint`

## Testing Strategy
- **Unit tests**: required for every task
- **E2E tests**: the project has none for pricing

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code, tests and docs in this repository
- **Post-Completion** (no checkboxes): deployment and checks on the live price book

## Implementation Steps

### Task 1: Scale a context-tier price by a service-tier rule (server model)
- [x] in `apps/manager-server/internal/model/model_price_rules.go`, add a function that takes the base price, the effective context-tier price and a service-tier rule, and returns the context-tier price with each rate the rule configures scaled by `rule rate / base rate` (see Technical Details for the zero and unconfigured cases)
- [x] add a function that resolves the price for a context threshold and a service tier together: no active context tier returns not found; an active tier without a matching rule returns the plain context-tier price; with a matching rule it returns the scaled price
- [x] write tests in `model_price_rules_test.go`: `gpt-6.2-sol` (base 2 / 10, context 4 / 15, Ultrafast rule 6 / 30) gives 12 / 45; a rule that configures only input and output leaves the cache rates of the context tier unchanged
- [x] write tests for the edge cases: base rate 0 with a configured rule rate, a rule matched by `Mode` and by `ServiceTier`, an unknown tier, and the base band (`-1`)
- [x] run `npm run manager-server:test` - must pass before task 2

### Task 2: Apply the scaled price in the server cost path
- [x] in `costForPriceWithServiceTier` (`apps/manager-server/internal/service/pricing/cost.go:276`), when a context tier is active and the price has a rule for the service tier, cost the tokens with the scaled price from Task 1; every other branch stays as it is
- [x] replace `TestContextTierDoesNotStackPriorityMultiplier` with a test that expects the scaled cost for its `gpt-5.6-sol` fixture (base 5 / 30, context 10 / 40, Fast rule 12.5 / 75: 25 / 100 per 1M)
- [x] write a test for the `gpt-6.2-sol` Ultrafast example through `CostForModelWithServiceTier`, with input, output and cached tokens
- [x] write tests that stay unchanged in result: a tier priced only by the built-in multiplier inside a context tier, `flex` inside a context tier, the base band with a rule, and the legacy long-context path (base band and legacy path covered by the existing TestExplicitFastPriceAppliesToBaseContextBandForFastAndPriority and TestLegacyLongContext* tests)
- [x] run `npm run manager-server:test` - must pass before task 3

### Task 3: Mirror the rule in the web cost calculation
- [x] in `calculateCost` (`apps/web/src/utils/usage.ts:1202`), when a context tier applies and the price has a rule for the service tier, use the context-tier price scaled as in Task 1, with a multiplier of 1; keep the other branches
- [x] replace `'does not stack priority pricing with active context-tier pricing'` in `usage.test.ts` with a test expecting the scaled cost for the same fixture as the Go test
- [x] write a test for the `gpt-6.2-sol` Ultrafast example with the same numbers as the Go test, and one for a rule that configures only input and output
- [x] write tests that stay unchanged in result: multiplier-only tier inside a context tier, `flex` inside a context tier, and the legacy long-context path (legacy path covered by the existing 'uses long-context pricing instead of an explicit Fast Mode price' test)
- [x] run `npm run test:web` and `npm run type-check` - must pass before task 4

### Task 4: Import every models.dev mode that carries a cost
- [x] in `readModelsDevServiceTiers` (`apps/manager-server/internal/service/modelprice/service.go:949`), read every entry of `experimental.modes` that has a `cost` block, in sorted mode order: `fast` keeps the rule `fast` / `priority`, any other mode `m` becomes the rule `m` / `m`
- [x] skip a mode without a `cost` block or without any rate, and return no rules when the set fails `NormalizeModelPriceServiceTiers`
- [x] extend `TestFetchModelsDevModelPrices` in `service_test.go` with a model that has `fast` and `ultrafast` costs and expects both rules
- [x] write tests for a mode without `cost` (today's `ultrafast` entries), a mode with an empty `cost`, and a model with no `modes`
- [x] run `npm run manager-server:test` - must pass before task 5

### Task 5: Keep stored rules a sync does not provide
- [ ] in `apps/manager-server/internal/model/model_price_rules.go`, add two pure merge functions: context tiers merge by `ThresholdTokens`; service-tier rules merge by key, where a stored rule is dropped when an imported rule has the same `Mode` or the same `ServiceTier`. The result is normalized
- [ ] in `UpsertSynced` (`apps/manager-server/internal/repository/modelprice/repository.go:444-455`), write the merge of the stored rules (from `beforePrices`) and the imported ones instead of the imported ones alone; a model stored with source `manual` is still skipped as a whole
- [ ] write tests for the merge functions: imported replaces the same key, a stored rule with another key survives, a stored rule sharing only `ServiceTier` with an imported one is dropped, empty inputs on either side
- [ ] write tests in `repository_test.go`: a model with source `models.dev` keeps a stored `ultrafast` rule and gets the imported `fast` rate; a model with source `litellm` and an import without rules keeps its stored Fast rule and 272k context tier; a new model gets exactly the imported rules
- [ ] write a test that a sync which keeps a stored context threshold does not change `ModelPriceStructureRevision`, and that the existing tests for raw deletion (`TestModelPriceUpsertSynced*`) still pass
- [ ] run `npm run manager-server:test` - must pass before task 6

### Task 6: Verify acceptance criteria
- [ ] verify the three items of the Overview against the code and tests
- [ ] verify the Go and TS tests use the same numbers for the shared examples
- [ ] run `npm run manager-server:test`
- [ ] run `cd apps/manager-server && go test -race ./internal/repository/modelprice/ ./internal/service/pricing/ ./internal/service/modelprice/`
- [ ] run `npm run test:web`, `npm run type-check` and `npm run lint` (no new warnings)

### Task 7: [Final] Update documentation
- [ ] update `apps/docs/en/manual/model-prices.md` and `apps/docs/manual/model-prices.md`: a tier rule now also applies above a context threshold, by ratio; a sync keeps rules the source does not provide; models.dev modes are imported by name
- [ ] rewrite `docs/backlog/ultrafast-service-tier-priced-as-standard.md` to hold only what remains: a tier without a rule is costed at the base rate silently; a multiplier-only tier is ignored inside a context tier; one cache-write rate. Rename the file to match if the title changes

## Technical Details
- Scaling rule, per rate (input, output, cache read, cache write):

  | rule configures the rate | base rate | result |
  |---|---|---|
  | no | any | context-tier rate unchanged |
  | yes | above 0 | context-tier rate x (rule rate / base rate) |
  | yes | 0 | the rule rate |

- A context-tier rate that the context tier does not configure is the base rate, as today, before scaling.
- Worked example, `gpt-6.2-sol`: base 2 / 10, context tier above 272k 4 / 15, Ultrafast rule 6 / 30. Ratios 3 and 3, so the long-context Ultrafast price is 12 / 45.
- Sync merge, per model with a stored source other than `manual`:
  - context tiers: `imported + stored tiers whose threshold is not imported`
  - service-tier rules: `imported + stored rules that share neither Mode nor ServiceTier with an imported rule`
- models.dev mode mapping: `fast` -> `Mode: fast, ServiceTier: priority`; any other mode `m` -> `Mode: m, ServiceTier: m`. Rates as today: `input`, `output`, `cache_read` (for both `Cache` and `CacheRead`), `cache_write`.

## Post-Completion

**Deployment**: this plan changes `apps/manager-server`, so the local deployment needs a full release (binary and panel), not a panel-only one. Back up `usage.sqlite` first.

**Checks on the live price book**:
- Save a copy of `GET /v0/management/model-prices` before the first sync with the new binary.
- Run a price sync and confirm the Ultrafast rules of `gpt-6.2-sol`, `gpt-6.2-astra`, `gpt-6.1-sol` and `gpt-6-astra`, and the Fast rules and 272k tier of the two GPT-6.2 models, are still there.
- Expect higher reported cost for Fast and Ultrafast requests above 272k input tokens, in past periods too.

**Reminder**: the GPT-6.2 Ultrafast rules hold the 3x launch rates, which double on 2027-03-01.
