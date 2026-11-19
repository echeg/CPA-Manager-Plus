# Usage source ids still treat `sk-` and `sess-` inside words as raw keys

- found: 2026-11-19, plan: panel-small-cleanup, phase: internal review
- severity: minor
- area: apps/web/src/utils/usage.ts

The plan `20261119-panel-small-cleanup` gave the `sk-` and `sess-` alternatives of `API_KEY_MASK_REGEX` (`apps/web/src/utils/format.ts:43`) a left boundary, so display masking leaves `task-runner` alone. `KEY_LIKE_TOKEN_REGEX` (`apps/web/src/utils/usage.ts:294-295`) is a separate copy of the old regex and has no boundary. It feeds `looksLikeRawSecret` (`usage.ts:697`) and `extractRawSecretFromText` (`usage.ts:710`), so `normalizeUsageSourceId` (`usage.ts:752`) treats a plain source name as a raw key: `task-runner`, `t:task-runner` and `kiosk-berlin` come back as `k:<fnv fingerprint>` instead of `t:<name>`. A usage source with such a name is grouped and shown as a hashed key, not by its name. `docs/personal-quota.md:465` says the panel uses the bounded rule wherever it masks text, which this path does not do.

Fix direction: give the `sk-proj-`, `sk-ant-`, `sk-` and `sess-` alternatives of `KEY_LIKE_TOKEN_REGEX` the same boundary group as `API_KEY_MASK_REGEX`, or share one regex source between the two files. Keep in mind that `k:` ids may already be stored or cached for such names, so changing the rule can split one source's history. Add cases to the `usage.ts` tests for `task-runner`, `t:task-runner` and a real `sk-...` key after `_` and `\n`.
