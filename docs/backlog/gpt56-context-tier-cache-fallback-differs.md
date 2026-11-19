# GPT-5.6 context-tier cache fallback differs between server and web

- found: 2026-11-19, plan: 20261119-speed-tier-pricing, phase: task
- severity: minor
- area: apps/web/src/utils/usage.ts

For a GPT-5.6 model with an active context tier that sets no cache-read or cache-write rate, and no stored base cache rates, the two cost copies fill the gap differently:

- Server: `costForPriceWithLegacyLongContext` enriches the base price first (`enrichGPT56BasePrice`, `apps/manager-server/internal/service/pricing/cost.go:355`), so cache read = base prompt x 0.1 and cache write = base prompt x 1.25, and the context tier inherits those.
- Web: `calculateCost` derives the fallback after the context tier is applied (`billedCacheReadRate` and `billedCacheCreationRate` on the effective price, `apps/web/src/utils/usage.ts:1316-1317`), so cache read = context-tier prompt x 0.1 and cache write = context-tier prompt x 1.25.

Example `gpt-5.6-sol` with base 5 and context tier prompt 10: server prices cache reads at 0.5, the web at 1.0.

The case with a service-tier rule inside a context tier already uses the server's base (`ratioBasePrice` in `usage.ts`). The plain context-tier path does not.

Fix direction: decide which base is right (OpenAI doubles cache rates in long context, which favours the web side), then make both copies fill the GPT-5.6 cache rates at the same step and pin it with one shared example in `cost_test.go` and `usage.test.ts`.
