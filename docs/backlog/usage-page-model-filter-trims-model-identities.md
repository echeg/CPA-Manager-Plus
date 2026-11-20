# The Usage Analytics model filter trims and re-normalizes model identities

- found: 2026-11-20, plan: 20261120-exact-model-trend-timeline, phase: evaluation
- severity: minor
- area: apps/web/src/features/usage-analytics/usageAnalyticsModel.ts

The model dropdown on the Usage Analytics page lists analytics model identities: the filter selectors and the `model_stats` rows. The selected value is trimmed at every step:
- the option builder `buildOptionValues` (`apps/web/src/features/usage-analytics/usageAnalyticsModel.ts:2936`)
- `buildStableSelectOptions` (`apps/web/src/features/usage-analytics/UsageAnalyticsPage.tsx:423`)
- the UI state (`normalizeSelectValue`, `apps/web/src/features/usage-analytics/usageAnalyticsUiState.ts:114`)
- the URL (`setNonDefaultParam`, `usageAnalyticsUiState.ts:250`)
- the request (`buildUsageAnalyticsFilters`, `usageAnalyticsModel.ts:777`)

The request sends it as `filters.models` without `exact_models`, so the server also reduces it with `usageidentity.AnalyticsModel`.

Effects:
- An identity with whitespace, such as `"spaced "` from the raw name `"spaced (high)"`, is sent as `"spaced"`. The page then shows no usage, or the usage of a different model named `spaced`.
- An identity such as `custom(high)`, from the raw name `custom(high)(low)`, selects `custom`.

This predates the exact model trend branch. That branch only adds the opt-in `filters.exact_models`, which its model trend follow-up uses, and leaves the page filter's `filters.models` matching as it was.

Fix direction:
- Keep the model value verbatim through the option builder, the UI state, the URL and `buildUsageAnalyticsFilters`. Skip only blank values, and dedupe options by their exact value.
- Send the value with `exact_models: true`. Older servers ignore the flag and keep today's matching.
- Give a value with trailing whitespace a label that tells it apart from the trimmed model.
