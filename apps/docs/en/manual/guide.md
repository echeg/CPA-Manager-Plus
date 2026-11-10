# Guide

Guide explains how CPA routes a request today. Open it from the last block of the left navigation, next to [System](./system.md).

## Diagrams

The page has two tabs. Each tab starts with a short summary and then shows an interactive diagram:

- **Request routing by client key**: routing profile of the client key, sticky session binding, preferred account, pool selection, and the Claude → Codex fallback after 429, 5xx, or cooldown.
- **Credential selection inside the pool**: availability filter, preferred account, primary slot, tiebreak slot, picker, and the selected credential (or a cooldown error with `Retry-After` when nothing is left).

Click a stage to focus it, zoom and pan the canvas, or export the picture with the diagram's own controls. The diagram follows the panel's Light, Dark, or Auto theme.

The diagrams describe the routing stages that Routing profiles configure; they do not read or change your configuration.

## How The Diagrams Are Made

The diagrams are self-contained pages generated with archify from the `*.workflow.json` sources in `apps/web/src/features/guide/diagrams/`. They are bundled into the single-file panel build, so the Guide works in both the CPAMP Lightweight Panel and Full Mode without extra files. To change a diagram, edit its JSON source, regenerate the HTML with archify, and replace the HTML file; do not edit the HTML by hand.
