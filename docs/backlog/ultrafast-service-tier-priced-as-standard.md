# Ultrafast service tier is priced as standard

- found: 2026-11-18, plan: codex-speed-in-profiles, phase: planning
- severity: minor
- area: apps/manager-server/internal/service/pricing/cost.go

OpenAI added an `ultrafast` service tier with GPT-6.2 (2026-11-17). Usage events can now carry `service_tier: "ultrafast"`, but cost estimation only knows `priority`/`fast` and `flex`/`batch`:

- `apps/manager-server/internal/service/pricing/cost.go:151-156` — `ServiceTierMultiplier` returns `1` for any tier other than `flex`, `batch`, `priority` and `fast`, so an ultrafast event without an explicit price rule is costed at the standard rate.
- `apps/manager-server/internal/service/pricing/cost.go:283` — the legacy long-context branch has the same `priority`/`fast` check.
- `apps/manager-server/internal/model/model_price_rules.go:204-215` — `SelectModelPriceServiceTier` matches a rule only by `Mode` or `ServiceTier`; the models.dev import in `apps/manager-server/internal/service/modelprice/service.go:958-975` creates a rule for `fast`/`priority` only.

Suggested direction: check whether models.dev publishes an ultrafast mode for `gpt-6.2-*` and import it as a price rule with `ServiceTier: "ultrafast"`; otherwise add an ultrafast multiplier next to the priority one. OpenAI lists Ultrafast at 3x Standard for API users during the launch promotion (6x afterwards), so confirm the current figure before hardcoding. Also check that the monitoring views label the tier instead of showing it as unknown.
