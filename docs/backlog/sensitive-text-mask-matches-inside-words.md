# Key masking also hits `sk-` inside ordinary words

- found: 2026-11-08, plan: 20261107-show-cp-instance-name-for-client-keys, phase: internal review
- severity: minor
- area: apps/web/src/utils/format.ts

`API_KEY_MASK_REGEX` (`apps/web/src/utils/format.ts:35-36`) has no left boundary, so
`sk-[A-Za-z0-9-_]{6,}` and `sess-…` match inside a word. `maskSensitiveText` then turns
`task-runner` into `task******er`, `kiosk-berlin` into `kiosk******in` and
`risk-engine` into `risk******ne`.

This hits every label that goes through `sanitizeApiKeyDisplayText`
(`apps/web/src/features/monitoring/model/apiKeys.ts:13`): stored aliases, and since
the CP instance name branch also bridex CP instance names, which are valid
`[a-z0-9][a-z0-9-]{1,30}` names. Monitoring and usage analytics sanitize the label a
second time (`eventRows.ts:111`, `analyticsAdapters.ts:753`, `:876`,
`usageAnalyticsModel.ts:1431`), so a fix only in `buildApiKeyDisplayMap` would not be
enough. `docs/personal-quota.md` ("How keys are shown") now documents the current
behaviour.

Fix direction: add a left boundary that still catches keys after `=`, `:`, spaces,
quotes, `/` and `_`. For example, use `(?<![A-Za-z0-9])` before the `sk-`/`sess-`
alternatives instead of `\b`, because `\b` would let `api_key_sk-…` through. This
regex also masks log and error text, so add tests for the embedded-key cases before
you loosen it.
