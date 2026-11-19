# Panel cleanup: dead routing components, lint warnings, key masking inside words, Guide for a switched-off provider

## Overview
- Four small backlog items of the web panel, done in one pass. None changes how the panel talks to the backend.
- **Dead code**: `SubscriptionRouting.tsx` and `SubscriptionAccounts.tsx` are rendered nowhere; delete them with their stylesheet.
- **Lint**: `npm run lint` reports 7 warnings in old files; fix them so a new warning stands out.
- **Key masking**: the key mask also matches `sk-` and `sess-` inside ordinary words, so `task-runner` is shown as `task******er`. Add a left boundary.
- **Guide**: the Guide page, its key-routing diagram and the manual do not mention that a routing profile can switch a provider off, which the profile editor has offered since 2026-11-19.

## Decisions
- **Context**: the items come from `docs/backlog/` (`unused-subscription-routing-components`, `web-lint-warnings`, `sensitive-text-mask-matches-inside-words`, `guide-disabled-provider`). The user chose to do them together on 2026-11-19.
- **Chosen approach, masking**: the lookbehind `(?<![A-Za-z0-9])` before the `sk-` and `sess-` alternatives, as the backlog entry suggests. `\b` is not used, because it would let `api_key_sk-...` through unmasked.
- **Chosen approach, diagram**: edit `key-routing.workflow.json` and regenerate `key-routing.html` with archify, as `apps/web/src/features/guide/diagrams/README.md` requires. The HTML is never edited by hand.
- **Verified facts**:
  - `SubscriptionRouting.tsx`, `SubscriptionAccounts.tsx` and `SubscriptionRouting.module.scss` (in `apps/web/src/features/quota/components/`) reference only each other. The hook `useSubscriptionRouting` (`apps/web/src/features/quota/hooks/useSubscriptionRouting.ts`) is used by `QuotaSettingsToolbar.tsx` and two lifecycle tests and stays.
  - The 7 lint warnings on 2026-11-19: `AccountsPage.test.tsx:13326`, `:13496`, `:17794` (`no-explicit-any`); `AccountHealthBadge.tsx:73` and `UsageMaintenanceCapabilityViews.tsx:15`, `:23` (`react-refresh/only-export-components`); `DashboardPage.tsx:394` (`react-hooks/exhaustive-deps`, `apiBase` reported as an unnecessary `useCallback` dependency).
  - `API_KEY_MASK_REGEX` is in `apps/web/src/utils/format.ts:35-36`; `format.test.ts` exists next to it. The same regex masks log and error text.
  - `docs/personal-quota.md` ("How keys are shown") documents the current masking of names.
  - The Guide text is `guide.intro_key_routing` in `apps/web/src/i18n/locales/{en,ru,zh-CN,zh-TW}.json`; the manual pages are `apps/docs/en/manual/guide.md` and `apps/docs/manual/guide.md`.
  - The committed diagrams were generated with archify 2.16.0. On this machine archify is at `~/.agents/skills/archify/bin/archify.mjs`; it is not a repository dependency.
  - `GuidePage.test.tsx` checks each diagram title and the theme contract of the generated pages.

## Context (from discovery)
- Files/components involved: listed per task below
- Related patterns found: earlier Guide updates for per-provider routing are commits `51c51eea` and `88c45a64`; locale keys are checked for parity across the four locale files by the i18n tests
- Dependencies identified: archify for Task 4 only

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Make small, focused changes
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task; a task that only deletes dead code or fixes lint runs the existing suite instead
- **CRITICAL: all tests must pass before starting next task** - no exceptions
- **CRITICAL: update this plan file when scope changes during implementation**
- Commands: `npm run test:web`, `npm run type-check`, `npm run lint`

## Testing Strategy
- **Unit tests**: `vitest` in `apps/web`
- **E2E tests**: none in this project

## Progress Tracking
- Mark completed items with `[x]` immediately when done
- Add newly discovered tasks with ➕ prefix
- Document issues/blockers with ⚠️ prefix
- Update plan if implementation deviates from original scope
- Keep plan in sync with actual work done

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): code, tests and docs in this repository
- **Post-Completion** (no checkboxes): deployment

## Implementation Steps

### Task 1: Delete the unused subscription routing components
- [x] confirm with a search of `apps/web/src` that `SubscriptionRouting.tsx`, `SubscriptionAccounts.tsx` and `SubscriptionRouting.module.scss` are imported only by each other
- [x] delete the three files from `apps/web/src/features/quota/components/`
- [x] run `npm run type-check` and the quota tests (`npx vitest run src/features/quota` in `apps/web`)
- [x] run `npm run test:web` - must pass before task 2

### Task 2: Fix the seven lint warnings
- [ ] type the three `any` casts in `apps/web/src/features/accounts/AccountsPage.test.tsx` (`:13326`, `:13496`, `:17794`)
- [ ] move the non-component export of `apps/web/src/features/accounts/components/AccountHealthBadge.tsx:73` to a sibling `.ts` module and update its importers
- [ ] move the two non-component exports of `apps/web/src/features/usage-maintenance/UsageMaintenanceCapabilityViews.tsx` (`:15`, `:23`) to a sibling `.ts` module and update their importers
- [ ] in `apps/web/src/features/dashboard/DashboardPage.tsx:394`, find out whether `apiBase` is in the dependency list to reload when the connection changes; if it is, keep the reload by an explicit means, otherwise drop the dependency
- [ ] write or update a test for the `DashboardPage` reload behaviour if the dependency carried one; run the existing tests of the moved exports
- [ ] run `npm run lint` (0 warnings), `npm run type-check` and `npm run test:web` - must pass before task 3

### Task 3: Do not mask `sk-` and `sess-` inside words
- [ ] in `apps/web/src/utils/format.ts:35-36`, require that the `sk-proj-`, `sk-ant-`, `sk-` and `sess-` alternatives of `API_KEY_MASK_REGEX` are not preceded by a letter or digit
- [ ] write tests in `format.test.ts` that `task-runner`, `kiosk-berlin`, `risk-engine` and `assess-candidates` stay unchanged
- [ ] write tests that keys are still masked at the start of the text and after a space, `=`, `:`, a quote, `/` and `_` (`api_key_sk-...`), and inside a JSON string
- [ ] check the labels that go through `sanitizeApiKeyDisplayText` (`apps/web/src/features/monitoring/model/apiKeys.ts:13`) with a test for a CP instance name such as `task-runner`
- [ ] run `npm run test:web` - must pass before task 4

### Task 4: Describe a switched-off provider in the Guide
- [ ] add one sentence to `guide.intro_key_routing` in `apps/web/src/i18n/locales/en.json`, `ru.json`, `zh-CN.json` and `zh-TW.json`: a profile can switch a provider off; CPA then answers that provider's requests with 403 before any selection, and Claude's fallback to a switched-off Codex does not run
- [ ] add the same to `apps/docs/en/manual/guide.md` and `apps/docs/manual/guide.md`, with the note that the switch is ignored under a scheduler plugin
- [ ] in `apps/web/src/features/guide/diagrams/key-routing.workflow.json`, add a "provider off -> 403" branch after profile resolution and note in the "Fallback per provider" card that a fallback to a switched-off Codex is skipped; keep `meta.title`
- [ ] regenerate the page: `node ~/.agents/skills/archify/bin/archify.mjs deliver workflow <abs path>/key-routing.workflow.json <abs path>/key-routing.html --quality showcase --json`; accept it only when the command exits 0 and reports all checks passed. If archify is not available, leave the JSON change, mark this item with ⚠️ and do not edit the HTML
- [ ] run `npx vitest run src/features/guide src/i18n` in `apps/web` (diagram titles, theme contract, locale parity), updating `GuidePage.test.tsx` only if a check names text that changed
- [ ] run `npm run test:web` - must pass before task 5

### Task 5: Verify acceptance criteria
- [ ] verify the four items of the Overview
- [ ] run `npm run test:web`
- [ ] run `npm run type-check`
- [ ] run `npm run lint` - 0 errors and 0 warnings
- [ ] run `npm run build` in `apps/web` and confirm the single-file panel builds

### Task 6: [Final] Update documentation
- [ ] update "How keys are shown" in `docs/personal-quota.md` for the new masking rule
- [ ] delete the four backlog entries this plan closes: `docs/backlog/unused-subscription-routing-components.md`, `web-lint-warnings.md`, `sensitive-text-mask-matches-inside-words.md`, `guide-disabled-provider.md`; keep an entry, rewritten, for any item that was only partly done

## Technical Details
- Mask boundary: `(?<![A-Za-z0-9])` before each of `sk-proj-`, `sk-ant-`, `sk-` and `sess-`. `_`, `-`, `/`, `=`, `:`, quotes and whitespace still allow a match, so `api_key_sk-...` stays masked.
- The other alternatives of the regex (`ghp_`, `github_pat_`, `AIza`, `hf_`, `pk_`, `rk_`) are not changed.
- Behaviour for the Guide text: `providers.<provider>.disabled: true` in a routing profile; requests to that provider get `403` with `provider_disabled`; ignored when CPA reports `supported: false` (scheduler plugin).

## Post-Completion

**Deployment**: a panel-only release on the local Mac, when `apps/manager-server` is unchanged since the running binary.

**Manual check**: open the Guide page in both themes and look at the regenerated key-routing diagram.
