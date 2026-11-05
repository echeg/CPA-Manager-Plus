# Unused SubscriptionRouting and SubscriptionAccounts components

- found: 2026-11-04, plan: per-key-routing-profiles-ui, phase: planning
- severity: minor
- area: apps/web/src/features/quota/components/SubscriptionRouting.tsx

`SubscriptionRouting.tsx` (116 lines) and `SubscriptionAccounts.tsx` (92 lines) in
`apps/web/src/features/quota/components/` are not rendered anywhere. The routing controls
moved into `QuotaSettingsToolbar.tsx`, where they now render only in the legacy toolbar
of a backend without `/routing/profiles` (strategy select, affinity toggle, TTL, and the
per-provider preferred-account selects at lines 236-320). Only `SubscriptionRouting.tsx`
imports `SubscriptionAccounts`, and tests import only the hook `useSubscriptionRouting`
(`settingsHooks.lifecycle.test.tsx`). `SubscriptionRouting.module.scss` may be partly dead
as well.

Suggested fix: delete both components, drop the styles only they use, and run the quota
test suite to confirm nothing else depends on them.
