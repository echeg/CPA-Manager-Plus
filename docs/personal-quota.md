# Personal quota workbench

This fork combines CPA-Manager-Plus v1.14.6 with the quota workbench from
[echeg/Cli-Proxy-API-Management-Center](https://github.com/echeg/Cli-Proxy-API-Management-Center)
at `4f9ee96`. The ported MIT components retain their attribution in `LICENSE`.

## Features

The **Quota** navigation item (`#/quota`) includes compact cards, Ledger and timeline
views; provider totals; a default routing profile (sticky session and its TTL,
preferred subscriptions, pool selection slots and the Claude → Codex fallback, or the
legacy routing strategy on older backends); routing profiles per client API key;
adding and deleting client API keys; Codex Fast Mode;
per-account soft/hard quota reserves; Codex reset credits and Claude reset grants
with expiry dates; inline reset confirmation; CPA cooldown clearing after a
confirmed reset; refresh on entry; and privacy masking.
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
credential fields, subscription routing, per-key routing profiles and selection
slots, quota API calls and cooldown clearing. A backend without routing profiles
keeps the legacy Quota toolbar, without the Profiles and Keys buttons. Stock CPA installations
without these endpoints cannot provide the custom workbench. CPAMP's existing v0
client and screens remain unchanged.

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

Soft levels rank the pool through the `reserves` selection slot, which is the
default primary slot: it keeps the eligible accounts at the lowest available level,
and the next slot chooses among them. A usable preferred subscription is taken
before the pool, even at soft levels 1-3; manual credential priority applies only
when `priority` is one of the slots. On an older backend without selection slots,
CPA picks the lowest available level first, then applies the manual preference,
credential priority and the legacy routing strategy. The level reflects the most
constrained usable subscription window. Window expiry or new observations
recalculate it; soft3 remains an available fallback. Existing session bindings
retain their account and cache. Disabled accounts and actual provider cooldowns
still take precedence.

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

On a backend with routing profiles, the fallback is one stage of each routing
profile: the default profile and every key profile have a fallback block in the
profile editor (see [Routing profiles per API key](#routing-profiles-per-api-key)),
saved together with the rest of that profile. On a backend without routing profiles,
the legacy Quota toolbar includes **Claude → Codex fallback** beside Codex Fast mode;
its switch applies immediately and preserves the mappings and selected mode when
turned off, and its settings button opens the model mapping editor. Initial suggestions
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

## Routing profiles per API key

CPA routes each client API key through a profile of four stages: sticky session,
preferred subscription for Claude and Codex, pool selection, and the Claude → Codex
fallback. A key without its own profile uses the default profile, which is the
global routing configuration. A key profile is a full copy: nothing is inherited
from the default.

**Toolbar.** On a backend that serves `GET /v8/management/routing/profiles`, the
Quota toolbar holds only Codex Fast mode, the last-routed indicator for each
provider (the provider, the time of the latest selection, and the account in its
tooltip), and two buttons:

```text
[Codex Fast mode] [Claude ● 10:53] [Codex ● 10:52] [Profiles] [Keys · 2]
```

**Profiles** opens the routing profiles modal. **Keys · N** opens the client keys
modal, where N is the number of client keys in `access.api-keys` (or the legacy
top-level `api-keys`). The shared-profile controls (selection slots, session
affinity, TTL, preferred subscriptions, fallback switch and Save) are no longer in
the toolbar; the default profile is edited only in the Profiles modal, so it has a
single writer. Both buttons are disabled until the first profiles load finishes. If
that load fails, they are enabled anyway, so the modal can show the error and a
retry button. Opening either modal reloads the profiles, and only one modal is open
at a time.

**Profiles modal.** The modal lists:

- **Default**, the profile of every key without its own. Its editor covers all four
  stages and the sticky-session TTL, which is global: it applies to every profile and
  is shown, read-only, in the key editors. An empty or invalid TTL is rejected before
  any request. **Save** sends one `PATCH /v8/management/config` with
  `routing.selection`, `session-affinity`, `preferred-accounts` and
  `claude-fallback`, plus `session-affinity-ttl` only when it changed, then reads the
  config back and reports an error if CPA did not keep the same values.
- One row per key with its own profile: its label, a one-line chain summary such as
  `Sticky session · Claude: work@example.com · Codex: Automatic · reserves →
  round-robin · Fallback: automatic`, **Edit**, and **Reset to default**. Reset asks
  for confirmation, then deletes the key's profile with a `null` PATCH.
- **+ Profile for a key**, which picks a key that still uses the default and opens a
  new profile for it, started from a copy of the default profile. Sticky sessions and
  the fallback stay as they were until changed; an empty profile would silently turn
  them off.

Only one editor is open at a time. In every editor, pool selection has two slots,
**Primary** and **On a tie**. Each accepts a narrowing criterion (Priority,
Reserves, Earliest reset, Most remaining) or a picker (Round-robin, Weighted
round-robin, Fill-first). A picker as primary chooses one account by itself, so the
tie-break slot is disabled, and an empty tie-break is sent as `null`. A
configuration without `routing.selection` shows its derived legacy selection, for
example `strategy: round-robin` appears as Reserves → Round-robin. Preferred
subscriptions list every account, including disabled and missing ones. A key
profile's **Save** writes the complete profile for that one key in a single
`PATCH /v8/management/config` and reads the profiles back; **Cancel** discards the
edit. A closed editor cannot be opened while the profiles reload.

**Keys modal.** Each client key row shows its label, a **Default** / **Own profile**
select, the chain summary, **Configure…** for a key with its own profile, and
**Delete**.

- Choosing **Own profile** switches to the Profiles modal with a new profile for that
  key; nothing is written until it is saved there. **Configure…** opens the key's
  existing profile the same way. The Profiles modal then shows **← Back to keys**.
- Choosing **Default** asks for confirmation and resets the key, as **Reset to
  default** does.
- **Delete** asks for confirmation, reads a fresh key list, and writes the list
  without the key. CPA then drops the key's profile, and the panel deletes its
  alias. The last client key cannot be deleted. On a panel served by the Manager
  Server, a key is not deleted while its alias state cannot be confirmed.
- The **Add a key** form at the bottom has a key field (hidden by default, with a
  show toggle), **Generate**, **Copy**, an optional **Alias**, and **Add**. A key may
  contain only visible ASCII characters without spaces, and a key already in the
  configuration is rejected. An alias must be non-empty, at most 120 characters and
  unique; it is checked before the key is written. Adding reads a fresh key list and
  writes the full list with the new key, then saves the alias. If the key was saved
  but its alias was not, the form clears and shows a separate warning; adding the
  same key again would fail the duplicate check. Aliases need the Manager Server;
  without it the alias field is unavailable.

Keys are written through the v8 configuration API: `GET /v8/management/config`,
then `PATCH /v8/management/config` with `{"access": {"api-keys": [...]}}`, or with
the legacy top-level `{"api-keys": [...]}` when that is where the config keeps them.
After each key operation the panel reloads the config, the profiles and the aliases.

**Errors.** If a key was removed on the Config page in the meantime (`400
unknown_api_key`), the panel says so and reloads the list. A rejected write (`422
invalid_config`) shows the backend's message with the raw key removed. A connection
change during a save discards the result. A reload that fails keeps the last loaded
profiles and key list.

**How keys are shown.** A key is labeled by its alias from the Manager Server's
API key aliases, matched by SHA-256, when the panel is served by the Manager
Server; otherwise, and for keys without an alias, the panel shows a mask such as
`sk******yz`. Raw keys stay in memory and in request bodies; they are never
rendered (except in the add form's key field before the key is added), logged,
placed in an error message, or placed in a request URL, because CPA writes request
paths to its log. Account names in the summaries follow the email privacy toggle.

**Read-only mode and older backends.** In Home mode or with a scheduler plugin, CPA
reports `supported: false`: per-key profiles are inactive. The toolbar is still the
slim one. In the Profiles modal the key rows are read-only and **Reset to default**
and **+ Profile for a key** are hidden, but the Default row stays editable. In the
Keys modal the profile select is read-only, while adding and deleting keys stay
available. A backend without `GET /v8/management/routing/profiles` (404) keeps
today's legacy toolbar unchanged: the legacy strategy select, sticky-session
settings, preferred subscriptions, the fallback control and Save, with no
Profiles or Keys button. Keys on such a backend are managed on the Config page.

This requires the custom CPA backend with per-key routing profiles
([echeg/CLIProxyAPI](https://github.com/echeg/CLIProxyAPI) `main` at `ced98b16`
or later). The Manager Server forwards the new endpoint unchanged. Profiles are
stored under `routing.key-profiles`, keyed by the exact client key. A
`claude-fallback` block without `mode` means `auto`:

```yaml
routing:
  session-affinity: true
  selection: {primary: reserves, tiebreak: earliest-reset}
  key-profiles:
    "client-key-a":
      session-affinity: false
      preferred-accounts: {claude: "claude-account-index"}
      selection: {primary: priority, tiebreak: round-robin}
      claude-fallback: {enabled: false, mode: auto, mappings: []}
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
