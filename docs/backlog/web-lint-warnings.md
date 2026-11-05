# Pre-existing web lint warnings

- found: 2026-11-05, plan: cpa-logs-storage-card, phase: task
- severity: minor
- area: apps/web/src

`npm run lint` exits 0 but reports 7 warnings, all in files outside the cpa-logs-storage-card branch:

- `apps/web/src/features/accounts/AccountsPage.test.tsx:13326`, `:13496`, `:17794` — `@typescript-eslint/no-explicit-any`; type the casts (e.g. `as unknown as <Props>`).
- `apps/web/src/features/accounts/components/AccountHealthBadge.tsx:73` — `react-refresh/only-export-components`; move the non-component export to a sibling `*.ts` helper.
- `apps/web/src/features/usage-maintenance/UsageMaintenanceCapabilityViews.tsx:15`, `:23` — same rule; move the exported constants/functions to a helper module.
- `apps/web/src/features/dashboard/DashboardPage.tsx:394` — `react-hooks/exhaustive-deps` says `apiBase` is an unnecessary `useCallback` dependency. Check whether `apiBase` is used to force a reload when the connection changes before you drop it. If it is, make that explicit instead.

Fix direction: clean these up in one small PR so the lint output has no warnings and new warnings stand out.
