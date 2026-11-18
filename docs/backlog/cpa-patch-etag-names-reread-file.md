# CPA's config write answers with the ETag of a file it read again, not the one it wrote

- found: 2026-11-19, plan: 20261118-codex-speed-panel-ui, phase: evaluation
- severity: minor
- area: CLIProxyAPI-migration internal/api/handlers/management/config_v8.go (backend)

A management write of the config (`ConfigV8`, CPA `internal/api/handlers/management/config_v8.go:212-229`)
writes the file with `WriteConfig`, then reads it again with `os.ReadFile` to compute
the `ETag` of its answer, while it sets the loaded config to `next`, parsed from the
bytes it wrote. `WriteConfig` normalizes the bytes itself
(`internal/api/handlers/management/config_basic.go:101-127`), which is why the handler
reads the file again. The handler lock (`h.mu`) keeps other management writes out of
that gap, but not an edit of the file by hand or by another tool. An edit that lands
between `WriteConfig` and `os.ReadFile` makes the answer name the other writer's file,
while CPA has loaded the version the handler wrote.

The panel chains these tags, as CPA's own test does ("reuse the PUT response ETag
without re-reading", `config_v8_etag_test.go:176`):

- The speed table's copy of the Default profile for a key
  (`apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts`,
  `saveKeyDefaultCopy`) sends an empty conditional `PATCH`, reads the Default CPA
  loaded, and writes the copy conditional on the empty write's `ETag`. In the race the
  tag names the other writer's file, so the copy passes `If-Match` and lands next to a
  Default it did not copy. The panel sees that only afterwards, when the read-back shows
  another Default, and reports the copy as unconfirmed (`DefaultCopyUnconfirmedError`);
  it cannot prevent it.
- The panel used to delete a copy it could not confirm, conditional on the copy
  write's `ETag`; in the race that delete could remove a profile the other writer gave
  the key. Since 2026-11-19 it deletes nothing and reports the copy instead, so the
  user resets the key in the Keys modal when needed. With the fix below the panel could
  take an unconfirmed copy back safely again.

The panel cannot tie a tag to the bytes CPA wrote: it does not know CPA's normalized
output, and the file and the loaded config are both consistent with the tag it got.

Suggested fix (backend): have `WriteConfig` return the bytes it wrote and answer with
their hash, not the hash of a new read. In the race the next `If-Match` then fails
with 412 against the other writer's file, which every conditional panel write already
turns into `ConfigChangedError`. If the bytes must be read back, compare their hash with
the hash of the bytes written and omit the `ETag` when they differ; the panel treats a
missing tag as no version and writes nothing.
