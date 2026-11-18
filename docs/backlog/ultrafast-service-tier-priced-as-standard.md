# Speed tiers are priced wrong for Ultrafast and for long context

- found: 2026-11-18, plan: codex-speed-in-profiles, phase: planning
- updated: 2026-11-18, plan: codex-speed-panel-ui, phase: planning
- severity: major
- area: apps/manager-server/internal/service/pricing/cost.go

OpenAI added an `ultrafast` service tier with GPT-6.2 (2026-11-17). Usage events can now carry `service_tier: "ultrafast"`. Cost estimation gets four things wrong. The cost logic exists twice, in the server and in the web client, and both copies need the same fix.

## 1. A tier without a price rule is costed at the standard rate, silently

- `apps/manager-server/internal/service/pricing/cost.go:151-156`: `ServiceTierMultiplier` returns `1` for any tier other than `flex`, `batch`, `priority` and `fast`.
- `apps/web/src/utils/usage.ts:432-437`: `getServiceTierMultiplier` has the same rule.
- `apps/manager-server/internal/model/model_price_rules.go:204-215`: `SelectModelPriceServiceTier` matches a rule only by `Mode` or `ServiceTier`.

Nothing marks the model as missing a tier price, so the number looks valid.

## 2. A long-context request ignores the speed tier

- `apps/manager-server/internal/service/pricing/cost.go:277-279`: when a context tier is active, `costForPriceWithServiceTier` returns `costForPrice` and never looks at the service tier.
- `apps/manager-server/internal/model/model_price_rules.go:134-137`: `applyModelPriceContextTier` drops `ServiceTiers` from the effective price.
- `apps/web/src/utils/usage.ts:1289-1300`: `serviceTierPrice` is selected only when no context tier applies.

Example for `gpt-6.2-sol`, a request above 272k tokens on Ultrafast: OpenAI charges 12 / 45 per 1M tokens (input / output), the panel computes 4 / 15.

OpenAI's price page (https://developers.openai.com/api/docs/pricing, checked 2026-11-18) uses the same speed multiplier for short and long context: 3x for GPT-6.2 through 2027-02-28 and 6x from 2027-03-01; 6x already for `gpt-6-astra` and `gpt-6.1-sol`. So no separate "long x speed" price table is needed. Suggested direction: when a context tier is active, scale its rates by the ratio of the speed rule to the base rate, per field.

## 3. The models.dev import reads only the `fast` mode

- `apps/manager-server/internal/service/modelprice/service.go:949-975`: `readModelsDevServiceTiers` reads `experimental.modes.fast` and creates one rule `fast` / `priority`.

On 2026-11-18 models.dev listed `experimental.modes.ultrafast` for `openai/gpt-6.2-sol` and `openai/gpt-6.2-astra` without a `cost` block, so there is nothing to import yet. Suggested direction: import every mode that carries a cost, so Ultrafast arrives on its own once models.dev publishes it. LiteLLM prices carry no tier rules at all: a model priced from LiteLLM has no Fast rule either.

## 4. A price sync deletes hand-made tier rules

- `apps/manager-server/internal/repository/modelprice/repository.go:364`: a sync skips only models whose source is `manual`.
- `apps/manager-server/internal/repository/modelprice/repository.go:450-455`: for every other model it deletes the stored service-tier rules and inserts the imported ones.

A tier rule added by hand to a model with source `models.dev` or `litellm` is lost on the next sync. The local deployment has such rules since 2026-11-18: Ultrafast for `gpt-6.2-sol`, `gpt-6.2-astra`, `gpt-6.1-sol` and `gpt-6-astra`, Fast for the two GPT-6.2 models, and a 272k context tier for the two GPT-6.2 models. The GPT-6.2 Ultrafast rates there are the 3x launch rates and double on 2027-03-01.

Suggested direction: keep rules the import does not provide, or mark a rule as manual.

## Also check

- The monitoring views label the `ultrafast` tier instead of showing it as unknown.
- The price book has one cache-write rate; OpenAI lists two (30 minutes and 12 hours, the second twice the first).
