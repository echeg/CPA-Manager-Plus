# Personal quota workbench

This fork combines CPA-Manager-Plus v1.14.6 with the quota workbench from
[echeg/Cli-Proxy-API-Management-Center](https://github.com/echeg/Cli-Proxy-API-Management-Center)
at `4f9ee96`. The ported MIT components retain their attribution in `LICENSE`.

## Features

The **Quota** navigation item (`#/quota`) includes compact cards, Ledger and timeline
views; provider totals; subscription account preferences; routing strategy and
sticky-session TTL; Codex Fast Mode; per-account soft/hard quota reserves; Codex
reset credits and Claude reset grants with expiry dates; inline reset confirmation;
CPA cooldown clearing after a confirmed reset; refresh on entry; and privacy masking.
Reserve editing is available directly on the quota cards.

The existing Accounts, Analytics, Monitoring, Usage Maintenance, OAuth, configuration,
plugin and account automation screens remain available. This is one CPAMP panel with
one CPAMP database connected to the existing CPA inference server.

## Connection and compatibility

Use the normal CPAMP setup flow to save the CPA endpoint and CPA management key.
Log into the panel with the **CPAMP admin key**. The Manager Server forwards
`/v8/management/*` to the saved CPA endpoint and substitutes the CPA management key
server-side. The browser never needs that upstream key.

The quota workbench requires the custom v8 API implemented by
[echeg/CLIProxyAPI](https://github.com/echeg/CLIProxyAPI), including nested config,
credential fields, subscription routing, quota API calls and cooldown clearing.
Stock CPA installations without these endpoints cannot provide the custom workbench.
CPAMP's existing v0 client and screens remain unchanged.

Credential mutations through v8 reuse CPAMP's mutation locks and manual-action
ownership handling. A quota reserve, a CPA runtime cooldown, and an account disabled
by CPAMP automation are separate states; a reserve edit does not enable a disabled
account. Connection changes invalidate in-flight workbench reads and cached quotas.

## Staged soft reserves

Each Codex or Claude account can have up to three descending reserve thresholds.
For example, `soft1 = 30%`, `soft2 = 15%`, and `soft3 = 5%` produce these levels:

| Remaining quota | Level |
| --- | --- |
| At least 30% | Normal (0) |
| At least 15%, below 30% | soft1 |
| At least 5%, below 15% | soft2 |
| Below 5% | soft3 |

CPA selects the lowest available level among eligible accounts before applying
manual preference, credential priority, and the selected routing strategy. The
level reflects the most constrained usable subscription window. Window expiry or
new observations recalculate it; soft3 remains an available fallback. Existing
session bindings retain their account and cache. Disabled accounts and actual
provider cooldowns still take precedence.

Configure these thresholds in the inline reserve editor on the Quota page. The
backend advertises `quota_reserve_max_levels: 3` in its v8 credential response;
extra thresholds stay unavailable against older backends that would discard them.
The account badge displays the server's current level and configured thresholds.

The persisted policy is `{ "percent": 30, "mode": "soft", "steps": [15, 5] }`.
`percent` is soft1; `steps` contains zero to two additional thresholds, each an
integer from 1 to 99 and strictly lower than the previous one. An existing single
soft reserve remains a one-level policy; it never becomes soft2 or soft3 by itself.
Hard reserves keep their existing behavior and cannot have additional steps.

An explicit `steps: []` removes extra thresholds; `quota_reserve: null` removes
the whole reserve. A v8 client cannot silently replace a staged policy with a
legacy payload that omits its steps. This feature is maintained in CPAMP; the old
standalone management panel has no staged-reserve editor.

## Claude to Codex fallback

The Quota toolbar includes **Claude → Codex fallback** beside Codex Fast mode.
The switch applies immediately and preserves the mappings and selected mode when
turned off. The settings button opens the model mapping editor. Initial suggestions
are `claude-opus-* → gpt-6-astra`, `claude-sonnet-* → gpt-6-sol`, and
`claude-fable-* → gpt-6-astra`; they are editable and are saved only on user action.

- **Automatic** tries the available Claude credentials first. After an unsuccessful
  credential round, respecting CPA's `max-retry-credentials` limit, CPA tries the
  configured Codex model instead of waiting for a Claude cooldown. Quota exhaustion,
  unavailable credentials, upstream 401/403/408/429/5xx errors, and transient transport
  failures qualify. Subsequent requests try Claude again; normal cooldowns still apply.
- **Force Codex now** sends matching requests directly to Codex, even when Claude
  is available. Unmapped requests keep their existing routing.

Source rules accept exact model IDs or a trailing `*`. Exact matches take precedence,
then the longest matching prefix. A target can include a reasoning suffix such as
`gpt-6-astra(high)`; an explicit target suffix overrides the source suffix. Account
suggestions are loaded from CPA, and fallback selects only Codex subscription credentials.
Conversation history, tools, session identity, and the client's protocol are preserved
by the existing CPA translators. Request monitoring retains the original requested model
and records the actual provider and model used for each upstream attempt.

Fallback is applied before a response starts. It never replays a partial response,
changes an explicitly pinned credential request, retries a malformed request, or ignores
client cancellation. It adds no response/idle timeout: a connection that stays open
without returning an error still depends on existing transport or client timeouts.
Home and scheduler plugins retain ownership of their routing.

This requires updating both this panel and the custom CPA backend. Older backends
leave the control disabled. Capability and model suggestions come from
`GET /v8/management/routing/claude-fallback`; settings are saved only under
`routing.claude-fallback` through the v8 configuration API. The default is disabled.

```yaml
routing:
  claude-fallback:
    enabled: false
    mode: auto # auto or always; retained while disabled
    mappings:
      - from: claude-opus-*
        to: gpt-6-astra
      - from: claude-sonnet-*
        to: gpt-6-sol
      - from: claude-fable-*
        to: gpt-6-astra
```

## Build and verify

```sh
npm ci
npm run type-check
npm run lint
npm test
npm run build
npm run manager-server:test
(cd apps/manager-server && go test -race ./...)
VERSION=v1.14.6-personal.2 bash bin/release/package-native.sh
```

The native packaging script embeds the freshly built panel. Use the resulting
platform archive from `dist/native`, rather than downloading an upstream binary.
The upstream updater and installation commands refer to stock CPAMP; updates to this
fork should merge upstream changes, rerun checks, and build a new fork binary.

## Existing installations

Back up `usage.sqlite` using SQLite's online backup API, and preserve its adjacent
`data.key` and the admin-key file. Stop only the Manager Server, replace its executable,
and restart it with the same data directory and settings. This feature adds no
database migration and does not require reimporting usage history or moving CPA
credentials. Keep the previous executable for rollback.

For rehearsal, use a separate data directory and HTTP port. Do not run two Manager
Servers against the same database. Use fixtures for reset tests: redeeming a real
reset spends a provider credit.

When publishing through Tailscale, keep the inference routes pointing at CPA.
Forwarding all existing API traffic to Manager Server would break model requests.
A separate private Manager port is supported; the old panel page can redirect to it
without changing inference URLs.
