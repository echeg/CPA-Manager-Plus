# The key mask still matches `rk_`, `pk_`, `hf_` and `ghp_` inside words

- found: 2026-11-19, plan: panel-small-cleanup, phase: internal review
- severity: minor
- area: apps/web/src/utils/format.ts

`API_KEY_MASK_REGEX` (`apps/web/src/utils/format.ts:43`) gives only the `sk-proj-`, `sk-ant-`, `sk-` and `sess-` alternatives a left boundary. The plan `20261119-panel-small-cleanup` left the other alternatives unchanged on purpose. So `rk_`, `pk_`, `hf_` and `ghp_` still match in the middle of a word: `network_monitor` is shown as `network******or`, `work_pk_settings` as `work_pk******gs` and `chf_abcdef` as `chf******ef`. CP instance names cannot hold `_` (`apps/web/src/utils/apiKeyName.ts:11`), so this affects aliases (`sanitizeApiKeyDisplayText`, `apps/web/src/features/monitoring/model/apiKeys.ts:13`), masked account names (`components/quota/quotaDisplay.ts:35`) and failure summaries. Text gets masked too often; no key is exposed.

Also, `pk_[A-Za-z0-9]{6,}` and `rk_[A-Za-z0-9]{6,}` do not match Stripe keys such as `pk_live_...` or `rk_test_...`, because `live` and `test` have only 4 characters before the next `_`. These two alternatives may not catch the keys they were written for.

Fix direction: move `ghp_`, `hf_`, `pk_` and `rk_` into the bounded group (group 2) of `API_KEY_MASK_REGEX`. That group already requires the start of the text, a character other than a letter or digit, or an escape before the key. Decide whether `pk_`/`rk_` should allow `_` after the prefix (`pk_(?:live|test)_...`). Add cases to `apps/web/src/utils/format.test.ts` for `network_monitor` and for a key after `_`, a space and `\n`.
