# Config page key list ignores CP instance names

- found: 2026-11-08, plan: 20261107-show-cp-instance-name-for-client-keys, phase: internal review
- severity: minor
- area: apps/web/src/components/config/ApiKeysCardEditor.tsx

The Config page's client key list titles each key with
`alias || t('config_management.visual.api_keys.input_label')` and shows the mask under it
(`apps/web/src/components/config/ApiKeysCardEditor.tsx:735-742`). It does not use
`buildApiKeyDisplayMap`. So a bridex CP key (`sk-bx-<instance name>-<32>`) without an
alias still gets the generic title there. The Client keys and Routing profiles modals,
monitoring and usage analytics show its instance name.

Fix direction: decide whether this list should show derived names. This list is also
where aliases are edited, so a derived name may need to look different from a stored
alias. If it should, use the sanitized `cpInstanceNameFromKey(key)`
(`apps/web/src/utils/apiKeyName.ts`) as the second fallback. Otherwise, list this
screen as an exception in `docs/personal-quota.md` ("How keys are shown").
