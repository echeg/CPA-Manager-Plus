---
title: Model Prices And Cost Estimation
description: Configure model prices, service tiers, long-context multipliers, and cache read/write/creation billing for local CPAMP cost estimates.
---

# Model Prices And Cost Estimation

Model Prices maintains CPAMP's local cost-estimation rules. It affects Dashboard, Monitoring, and Usage Analytics; it does not change provider billing or CPA routing.

Open the [Model Prices Demo](https://seakee.github.io/CPA-Manager-Plus/#/demo/model-prices) to inspect fictional prices and model usage.

## Price Sources

- Public metadata synchronized from models.dev first, with LiteLLM and OpenRouter used as fallbacks when the preferred source is unavailable or lacks a model.
- Local prices added or overridden by the user.
- Entries for aliases, internal names, or provider-specific variants.

Synchronization only occurs when the user triggers it and may use the current Manager Server proxy configuration.

Automatic matching runs strictly in models.dev, LiteLLM, then OpenRouter order. CPAMP uses the canonical model metadata in the models.dev catalog to prefer the first-party official entry. A source is saved automatically only when it has one clear, strong identity match; fuzzy similarities are never auto-confirmed. An ambiguous source falls through to the next source. If none of the three sources yields a unique match, the confirmation list keeps candidates from each source separately, even when they share the same original model ID.

The current sync maps models.dev `cost.input`, `cost.output`, `cost.cache_read`, and `cost.cache_write`, converts valid `cost.tiers` context tiers into CPAMP billing rules, and imports every `experimental.modes.<mode>.cost` as a service-tier rule named after the mode: `fast` matches the `fast` and `priority` tiers, any other mode, for example `ultrafast`, matches the tier of the same name. A mode without a `cost` block or without any rate is skipped. If the modes of one model conflict, for example `fast` next to `priority`, none of that model's modes is imported and its stored rules stay. The complete model object remains available in raw metadata; reasoning prices, unknown tier types, and rules that cannot be validated safely do not activate automatic billing.

### Sync failures and last-known-good prices

- When models.dev is temporarily unavailable, CPAMP continues with LiteLLM and OpenRouter.
- A transient models.dev failure cannot automatically replace a stored models.dev price with a lower-priority source; fallback sources may still fill models that have no local price.
- When models.dev responds successfully but has no official entry or remains ambiguous, fallback sources are tried in order; only a unique strong identity match may replace the model.
- If every source fails, synchronization stops before any database write and existing prices remain unchanged.
- A manually saved price remains authoritative during synchronization, even when a source returns an exact match for the same model. Delete the manual entry and sync again to use synchronized pricing.
- A synchronized price remains the last-known-good value until a later successful sync or a manual edit; `syncedAtMs` indicates its freshness.
- For a synchronized model, a sync replaces the context tiers and service-tier rules the source provides and keeps the stored ones it does not provide. A context tier is matched by its threshold; a service-tier rule is replaced when an imported rule uses the same mode or service tier. A rule the source stops providing stays. Deleting it in the editor saves the model as manual, so later syncs leave that model unchanged. To drop the rule and keep syncing, delete the model's entry and sync again, but note that this drops every stored context tier and service-tier rule of that model that the source does not provide, including hand-made ones such as an Ultrafast rule, and adding any of them back in the editor makes the model manual again. Note the model's rules before you delete it.

## Supported Billing Semantics

A price rule may include:

- Input and output tokens.
- Reasoning tokens.
- Cache read, cache write, and cache creation.
- Fixed per-request cost.
- `service_tier` differences.
- models.dev context-price tiers.
- Long-context thresholds and multipliers.
- Model alias and billing-model mapping.

Models such as GPT-5.6 may vary by context length, service tier, and cache type. CPAMP can only apply a rule when both the request event and price entry contain the required fields.

### Context-tier semantics

- A tier matches only when normalized input tokens are **strictly greater than** `tier.size`; an exact-threshold request stays in the lower band.
- When multiple tiers match, CPAMP selects the highest matching threshold.
- The selected tier's rates apply to the entire request, not only to tokens above the threshold.
- Input, output, or cache rates omitted by a tier inherit the base price; an explicit zero from models.dev remains zero.
- CPAMP currently activates only safely validated tiers with `tier.type = context` and a positive threshold. Other rules remain in raw metadata for inspection.

### Service-tier semantics

- The models.dev `fast` mode matches both `fast` usage telemetry and API `priority` telemetry; other modes such as `ultrafast` match the tier of the same name.
- Short-context requests prefer an explicit service-tier price. Missing fields inherit base rates, while explicit zeros remain zero.
- When a context tier matches and the model has a rule for the request's service tier, each rate the rule configures scales the context-tier rate by `rule rate / base rate`. A rate the rule does not configure keeps the context-tier rate; a cache rate that no price sets stays blank and is billed from the scaled input rate, just as below the threshold it is billed from the rule's input rate. A blank cache-read or cache-write rate counts as the rate it is billed at (cache read: the cache rate or a tenth of the input rate; cache write: the input rate); a rule rate over a base rate billed at zero is used as is. Example for `gpt-6.2-sol`: base 2 / 10 per 1M tokens (input / output), above 272k 4 / 15, Ultrafast rule 6 / 30, so an Ultrafast request above 272k costs 12 / 45.
- The official GPT-5.6 models (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`) are an exception to the blank cache-rate rule. Below a context threshold their blank cache rates are filled from the input rate the request is billed at, including a rule's input rate (cache read: a tenth; cache write: 1.25 times). Above a threshold they are filled from the base input rate before the context tier and the rule apply, so a positive filled-in rate stays fixed: a rule that sets no cache rates keeps it, and it does not follow the scaled input rate. Example: `gpt-5.6-sol` with base input 2, context-tier input 4, and a Fast rule that sets only input 6 bills Fast cache writes at 7.5 per 1M tokens below the threshold and 2.5 above it. A filled-in zero, from an explicit zero base input rate, stays blank and follows the blank cache-rate rule above: with base input 0 and context-tier input 4, a cache read above the threshold costs 0.4 per 1M tokens.
- A tier without a rule uses the plain context-tier price inside a context tier: the compatibility multiplier (`flex` and `batch` at 0.5, Fast/Priority for some GPT-5.x families) is not stacked on it. The legacy GPT long-context rule also uses its standard long-context price without Fast/Priority pricing.
- Outside a context tier, non-models.dev entries, older data, and models without an explicit mode price retain the existing multiplier as a compatibility fallback.
- A tier with neither a rule nor a multiplier, for example `ultrafast` on a model without an Ultrafast rule, is costed at the standard rate (the base price, or the context-tier price above a threshold) with no warning.
- Cost is computed when it is read, so a rule change also changes the cost shown for past periods.

Model Prices shows the context tiers and service-tier rules of each model. The editor manages base prices and these rules; saving a price in the editor marks the model as manual, and a later sync leaves it unchanged.

## Matching Model Names

The client model, CPA alias, provider model, and price-table name may differ. When cost is missing:

1. Inspect the event model and billing model in [Monitoring](./monitoring.md).
2. Search for matching entries in Model Prices.
3. Add a local alias or override when required.
4. Refresh [Usage Analytics](./usage-analytics.md).

## Usage Summary

The page uses a compact model-usage summary to show which prices are active. It does not download full request history just to count model calls.

## Accuracy Boundaries

- Provider billing remains authoritative.
- Missing token, service tier, long-context, or cache fields reduce estimate accuracy.
- Subscriptions, grants, non-context tiers, unsupported dynamic-mode prices, and multiple currencies may not fit a single price entry.
- Historical cost may be displayed using current prices after an update; the price table is not an immutable billing snapshot.
