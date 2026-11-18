# A routing write drops an enabled legacy claude-fallback next to an empty providers.claude.fallback

- found: 2026-11-19, plan: 20261118-codex-speed-panel-ui, phase: evaluation
- severity: minor
- area: CLIProxyAPI-migration internal/api/handlers/management/routing_providers_write.go (backend)

CPA reads a zero `providers.claude.fallback` (an empty mapping `{}`, `null`, or all
fields empty) as unset: `effectiveProviders` converts the legacy `claude-fallback` block
when `out.Claude.Fallback.IsZero()` (CPA `internal/config/provider_routing.go:182`), and
`normalizeProfileProviders` keeps the legacy block without a warning in that case. So a
profile that holds both

```yaml
providers:
  claude:
    fallback: {}
claude-fallback:
  enabled: true
  mappings: [...]
```

falls back from Claude to Codex. The write path decides by the node alone:
`mergeLegacyClaudeFallbackProfile` deletes the legacy node whenever a
`providers.claude.fallback` node exists in the merged profile
(`internal/api/handlers/management/routing_providers_write.go:91-93`). It runs for the
shared profile on every `PATCH` whose body has `routing`, and for each key profile the
body names. So any such write, also one that only changes the Codex speed, stores a
config whose effective Claude fallback is `off`.

The speed table's one-field writes (`saveSharedCodexSpeed`, `saveKeyCodexSpeed` in
`apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts`) would
trigger it for the profile they change, and every speed table write for the shared
profile. Since 2026-11-19 the table reads the raw profiles of `GET /config`, detects the
shape (`dropsLegacyClaudeFallback`) and refuses the write (`LegacyClaudeFallbackError`),
asking to save the profile once in the editor, whose full body keeps the fallback.

Still affected: every key profile write of the editors (Profiles and Keys modals), which
existed before the speed table, drops the shared profile's legacy block, since the body
carries `routing`. The editors send the complete effective fallback (`profileBody`), so
they keep the profile they write. No panel or CPA write produces an empty fallback node;
the shape comes from a hand edit.

Suggested fix (backend): in `mergeLegacyClaudeFallbackProfile`, decode the merged
`providers.claude.fallback` and delete the legacy node only when it is not `IsZero()`;
or, when it is zero and a non-zero legacy block exists, convert that block into
`providers.claude.fallback` before deleting it, as a write that carries the legacy
block does. Add a handler test with the shape above and a speed-only `PATCH`.
