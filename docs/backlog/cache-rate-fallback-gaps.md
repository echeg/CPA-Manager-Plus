# GPT-5.6 long context fills blank cache rates from the base input rate

- found: 2026-11-19, plan: 20261119-speed-tier-pricing, phase: task
- updated: 2026-11-19, plan: 20261119-speed-tier-pricing, phase: internal review
- updated: 2026-11-19, plan: 20261119-speed-tier-pricing, phase: evaluation
- severity: minor
- area: apps/manager-server/internal/service/pricing/cost.go

These rules decide what a blank cache-read or cache-write rate costs. The speed-tier ratio uses them as well, so a gap here also changes how a tier rule scales above a context threshold.

Above a context threshold, both copies fill the blank cache rates of an official GPT-5.6 model before applying the context tier, so the tier inherits rates derived from the base input rate:

- Server: `enrichGPT56BasePrice`, `apps/manager-server/internal/service/pricing/cost.go:355`, called from `costForContextTierWithServiceTier` (`:296`) and `costForPriceWithLegacyLongContext` (`:52`).
- Web: `enrichGpt56BasePrice`, `apps/web/src/utils/usage.ts:1405`, used by every path of `calculateCost` (`:1306`).

Example: `gpt-5.6-sol`, base input 5, context-tier input 10. Above 272k a cache read costs 0.5 and a cache write 6.25. OpenAI doubles cache rates in long context, which would make them 1.0 and 12.5. This only matters when the stored price has no cache rates.

The same order breaks the rule that a blank cache rate follows the scaled input rate above a threshold. Below the threshold the fill runs after a speed-tier rule applies, so it uses the rule's input rate. Example: `gpt-5.6-sol`, base input 2, context-tier input 4, Fast rule with only input 6: Fast cache writes cost 7.5 below the threshold (6 x 1.25) and 2.5 above it (2 x 1.25). The manuals (`apps/docs/en/manual/model-prices.md`, `apps/docs/manual/model-prices.md`, "Service-tier semantics") describe this as an exception.

Fix direction: decide which base is right. If it is the context-tier input rate, change both copies together and update the shared 10.875 / 4.875 example in `cost_test.go` (`TestContextTierRuleRatioUsesEnrichedGPT56BaseCacheRates`) and `usage.test.ts`.

The second gap this entry used to list (the web billed a blank cache read outside GPT-5.6 at the legacy cache rate or 0, and gave every `gpt-5.6*` model the 1.25 cache-write factor) was fixed during external review: the web now uses the server's fallbacks (`billedCacheReadRate`, `billedCacheCreationRate` in `usage.ts`).
