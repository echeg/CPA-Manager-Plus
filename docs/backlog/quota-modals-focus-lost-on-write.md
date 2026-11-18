# Keyboard focus is lost when a quota modal disables its controls for a write

- found: 2026-11-18, plan: codex-speed-panel-ui, phase: internal review
- severity: minor
- area: apps/web/src/features/quota/components

The quota modals disable their per-row controls with the native `disabled` attribute while a write or the reload after it runs. The control the user just activated is among them, so the browser drops its focus to `<body>`, and nothing puts it back once the controls are enabled again. A keyboard user must Tab back in. The Modal focus trap (`apps/web/src/components/ui/Modal.tsx:231-266`) wraps Tab only from the first or last focusable element, so from `<body>` focus can leave the modal. Screen readers get no notice that the write finished.

Where it happens:
- `ClientKeysModal.tsx:341`, `:352`, `:365`: the profile select, **Configure** and **Delete** of a key row (`disabled={readOnly || busy}`, `disabled={saving}`, `disabled={busy || lastKey}`).
- `CodexSpeedModal.tsx`: every speed button and flag switch (`disabled = busy || Boolean(row.disabledReason)`). This hurts most here, because every click is a write, so changing several rows by keyboard loses focus after each one. The plan asked for "while a write runs all controls are disabled", and the table follows the pattern above.
- `RoutingProfilesModal.tsx:207`, `:320`, `:353`: **Refresh**, **Reset to default** and the **+ Profile for a key** select, disabled with `saving || loading`.

`busy` is `saving || loading`, and `saveShared` refetches after it succeeds. So `busy` goes true, false for one render, then true again before it settles, and a simple "refocus when busy turns false" effect fires too early.

Fix direction: in one pass over the quota modals, keep the activated control focusable during a write. Use `aria-disabled` and rely on the existing busy guards in the handlers (`write()` in `CodexSpeedModal`, `beginWrite` in `useKeyProfiles`). That needs an `aria-disabled` option on `components/ui/ToggleSwitch.tsx`, which only takes `disabled` today. Also add a polite live region that announces a finished save.
