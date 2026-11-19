# Cache-rate fallbacks: GPT-5.6 long context uses the base rate, and server and web differ outside GPT-5.6

- found: 2026-11-19, plan: 20261119-speed-tier-pricing, phase: task
- updated: 2026-11-19, plan: 20261119-speed-tier-pricing, phase: internal review
- severity: minor
- area: apps/web/src/utils/usage.ts

These rules decide what a blank cache-read or cache-write rate costs. The speed-tier ratio uses them as well, so a gap here also changes how a tier rule scales above a context threshold.

## 1. GPT-5.6 long context fills cache rates from the base input rate

Above a context threshold, both copies fill the blank cache rates of an official GPT-5.6 model before applying the context tier, so the tier inherits rates derived from the base input rate:

- Server: `enrichGPT56BasePrice`, `apps/manager-server/internal/service/pricing/cost.go:355`, called from `costForContextTierWithServiceTier` (`:294`) and `costForPriceWithLegacyLongContext`.
- Web: `enrichGpt56BasePrice`, `apps/web/src/utils/usage.ts:1403`, used by both context-tier paths in `calculateCost` (`:1305`).

Example: `gpt-5.6-sol`, base input 5, context-tier input 10. Above 272k a cache read costs 0.5 and a cache write 6.25. OpenAI doubles cache rates in long context, which would make them 1.0 and 12.5. This only matters when the stored price has no cache rates.

Before the speed-tier review the web derived these rates from the context-tier input rate on the standard path only, so above the threshold a Fast request was billed less for cache than a standard one. Both web paths now use the server's base.

Fix direction: decide which base is right. If it is the context-tier input rate, change both copies together and update the shared 10.875 / 4.875 example in `cost_test.go` (`TestContextTierRuleRatioUsesEnrichedGPT56BaseCacheRates`) and `usage.test.ts`.

## 2. Server and web disagree on a blank cache-read rate outside GPT-5.6

- Server: `BilledCacheReadRate` (`apps/manager-server/internal/model/model_price_rules.go:254`) uses the cache-read rate, else the legacy cache rate, else a tenth of the input rate.
- Web: `billedCacheReadRate` (`apps/web/src/utils/usage.ts:1422`) uses the cache-read rate, else the legacy `cache` rate, with no input-rate fallback. A model with `cache: 0` therefore bills cache reads at 0. For GPT-5.6 models the web skips `cache` and always uses a tenth of the input rate.

This predates the speed-tier plan; that plan only moved the logic into a helper. LiteLLM, OpenRouter and models.dev imports store `Cache = 0` when the source has no cache price. Example: base 2 / 10 with no cache rates, context tier 4 / 15, Fast rule cache read 0.4. Above the threshold the server bills Fast cache reads at 0.8 (0.4 x 0.4 / 0.2) and standard at 0.4. The web bills 0.4 and 0. The documented rule in `apps/docs/en/manual/model-prices.md:61` ("the cache rate or a tenth of the input rate") describes the server.

Fix direction: give the web the server's fallback for models outside GPT-5.6 (`cache > 0 ? cache : prompt x 0.1`). Keep the GPT-5.6 branch, which mirrors the server's enrichment. Then pin the example above in `usage.test.ts` with the numbers of the Go test `TestModelPriceForContextThresholdAndServiceTierComparesUnsetCacheRatesAsBilled`.
