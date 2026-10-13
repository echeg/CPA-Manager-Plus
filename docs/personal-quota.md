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

## Build and verify

```sh
npm ci
npm run type-check
npm run lint
npm test
npm run build
npm run manager-server:test
(cd apps/manager-server && go test -race ./...)
VERSION=v1.14.6-personal.1 bash bin/release/package-native.sh
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
