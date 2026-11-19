# Guide does not mention a switched-off provider

- found: 2026-11-19, plan: 20261119-provider-toggle-panel-ui, phase: internal review
- severity: minor
- area: apps/web/src/features/guide

The Guide says it shows how CPA routes a request today, but nothing in it covers a routing profile that switches a provider off (`providers.<provider>.disabled`, now editable from the profile editor):

- `guide.intro_key_routing` in `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json` (en.json:5253) describes profile resolution, then sticky session, preferred account and pool, with no 403 step for a disabled provider.
- `apps/web/src/features/guide/diagrams/key-routing.workflow.json` (the "Fallback per provider" card and the profile → sticky edge) and the rendered `key-routing.html` show no refusal and no skipped Claude → Codex fallback.
- `apps/docs/en/manual/guide.md` and `apps/docs/manual/guide.md` have the same gap.

Behavior to describe: a profile can switch a provider off; CPA then answers that provider's requests with 403 before any selection, and Claude's fallback to a switched-off Codex does not run. Under a scheduler plugin (`supported: false`) the flag is ignored.

Fix direction: add one sentence to `intro_key_routing` in all four locales and to both manual pages, and add a "provider off → 403" branch after profile resolution in the key-routing diagram, regenerated with archify as `diagrams/README.md` describes. Earlier Guide updates for per-provider routing: commits `51c51eea`, `88c45a64`.
