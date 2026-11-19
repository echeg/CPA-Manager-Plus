# Service tier pricing gaps: missing rules, multipliers in context tiers, cache-write rates

- found: 2026-11-18, plan: codex-speed-in-profiles, phase: planning
- updated: 2026-11-18, plan: codex-speed-panel-ui, phase: planning
- updated: 2026-11-19, plan: speed-tier-pricing, phase: task
- severity: major
- area: apps/manager-server/internal/service/pricing/cost.go

Plan `speed-tier-pricing` (2026-11-19) fixed three of the original defects: a service-tier rule now scales a context-tier price by ratio, the models.dev import reads every mode that carries a cost, and a price sync keeps stored rules the import does not provide. Three gaps remain. The cost logic exists twice, in the server and in the web client, and both copies need the same fix.

## 1. A tier without a price rule is costed at the base rate, silently

- `apps/manager-server/internal/service/pricing/cost.go:143-150`: `ServiceTierMultiplier` returns `1` for any tier other than `flex`, `batch`, `priority` and `fast`.
- `apps/web/src/utils/usage.ts:432`: `getServiceTierMultiplier` has the same rule.
- `apps/manager-server/internal/model/model_price_rules.go:206`: `SelectModelPriceServiceTier` matches a rule only by `Mode` or `ServiceTier`.

An `ultrafast` request on a model without an Ultrafast rule (every model priced from LiteLLM or OpenRouter, and models.dev models until models.dev publishes an Ultrafast cost) gets the standard price. Nothing marks the model as missing a tier price, so the number looks valid. The user chose on 2026-11-19 not to add built-in Ultrafast multipliers.

Suggested direction: flag aggregates whose service tier has neither a rule nor a known multiplier, and show a marker next to the cost in monitoring and usage views.

## 2. A multiplier-only tier is ignored inside a context tier

- `apps/manager-server/internal/service/pricing/cost.go:294-311`: `costForContextTierWithServiceTier` prices the aggregate with `ModelPriceForContextThresholdAndServiceTier`, which returns the plain context-tier price when the price has no rule for the tier (`apps/manager-server/internal/model/model_price_rules.go:327`).
- `apps/web/src/utils/usage.ts:1330-1333`: the multiplier is set to 1 whenever a context tier applies.

A tier priced by `ServiceTierMultiplier` (`flex` and `batch` at 0.5, Fast/Priority for some GPT-5.x families) gets no discount or surcharge above a context threshold. Suggested direction: apply the multiplier to the context-tier price when no rule matches, in both copies, and pin it with the same numbers in `cost_test.go` and `usage.test.ts`.

## 3. The price book has one cache-write rate

- `apps/manager-server/internal/model/model_price_rules.go:31`, `:50`: a price and a rule carry one `CacheCreation` rate.

OpenAI lists two cache-write rates (30 minutes and 12 hours, the second twice the first). Usage events would need to report the cache duration before a second rate can be applied.
