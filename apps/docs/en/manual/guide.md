# Guide

Guide explains how CPA routes a request today. Open it from the last block of the left navigation, next to [System](./system.md).

## Diagrams

The page has three tabs. Each tab starts with a short summary and then shows an interactive diagram:

- **Request routing by client key**: routing profile of the client key, sticky session binding, preferred account, pool selection, and the provider's fallback after a failed subscription round (for example 429, 5xx, or cooldown). Claude can fall back to a Codex subscription or to the profile's Claude API key; Codex can fall back only to its API key. API keys are never picked on their own.
- **Credential selection inside the pool**: availability filter, preferred account, primary slot, tiebreak slot, picker, and the selected credential. If the provider has no credential for the model, or all of them are turned off, the request gets a not-found error without `Retry-After`. If credentials exist but none is usable, it gets a cooldown error with `Retry-After` when every one is cooling down or held by a hard reserve; otherwise it gets an unavailable error (for example, for expired or rejected tokens), which carries `Retry-After` only if a recovery time is known. In Subscription mode the pool holds only OAuth credentials; API key mode skips the pool and uses the profile's one API key.
- **Routing with API keys**: when a request reaches an upstream API key. A routing profile sets a mode per provider: Subscription (OAuth credentials only) or API key (subscriptions are skipped and the profile's key serves every request). In Subscription mode an API-key fallback is tried only after the subscription round fails; that leg does not bind the session, so the next request tries subscriptions again. Requests sent to an API key are billed to that key.

Click a stage to focus it, zoom and pan the canvas, or export the picture with the diagram's own controls. The diagram follows the panel's Light, Dark, or Auto theme. The diagram's Copy link buttons do not produce shareable links inside the panel.

The diagrams describe the routing of the custom CPA backend used by this fork ([echeg/CLIProxyAPI](https://github.com/echeg/CLIProxyAPI)): per-key routing profiles, per-provider Subscription or API key mode, selection slots, and the per-provider fallback to a Codex subscription or an API key. Stock CPA has none of these stages. The diagrams do not read or change your configuration.

## How The Diagrams Are Made

The diagrams are self-contained pages generated with archify from the `*.workflow.json` sources in `apps/web/src/features/guide/diagrams/`. They are bundled into the single-file panel build, so the Guide works in both the CPAMP Lightweight Panel and Full Mode without extra files. To change a diagram, edit its JSON source, regenerate the HTML with archify, and replace the HTML file; do not edit the HTML by hand.
