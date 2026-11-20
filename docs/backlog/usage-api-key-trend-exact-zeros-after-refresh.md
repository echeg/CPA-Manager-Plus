# The API key trend draws refreshed hours as exact zeros until its follow-up answers

- found: 2026-11-20, plan: 20261120-exact-model-trend-timeline, phase: evaluation
- severity: minor
- area: apps/web/src/features/usage-analytics/useUsageAnalytics.ts

`hasExactAPIKeyTimeline` (`apps/web/src/features/usage-analytics/useUsageAnalytics.ts:479`) only checks that the API key follow-up returned an `api_key_timeline` array. It does not check that the follow-up covers the same range as the displayed main response, and it does not check the follow-up's error. After a refresh of a rolling range, the two responses can arrive in either order. When the main response for the new range end arrives first, `apiKeyTrendSeries` (`:612`) maps the new timeline buckets over the old API key buckets. The hour after the previous range end is then drawn as an exact 0 for every key, until the follow-up answers. A failed follow-up keeps its last good response, which can predate the main response, and is also drawn as exact.

The exact model trend avoids both cases with `isSameAnalyticsRange(modelTrendAnalytics.dataRequest, analytics.dataRequest)` and `!modelTrendAnalytics.error` (`:543-547`). The API key trend predates that branch and was left unchanged.

Fix direction:
- Apply the same guard to `hasExactAPIKeyTimeline`: require `!apiKeyTrendAnalytics.error` and `isSameAnalyticsRange(apiKeyTrendAnalytics.dataRequest, analytics.dataRequest)`, and fall back to `buildEntityTrendSeries` otherwise.
- Add a hook test like "keeps the estimate until the model timeline covers the refreshed range" for the API key series.
