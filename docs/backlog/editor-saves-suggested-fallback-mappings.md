# Profile editor saves suggested Claude mappings the user never adopted

- found: 2026-11-19, plan: 20261119-provider-toggle-panel-ui, phase: evaluation
- severity: minor
- area: apps/web/src/features/quota/components/KeyProfileEditor.tsx

When the profile editor opens, it fills an empty Claude fallback mapping list with the suggested rows (`withFallbackSuggestions`, `KeyProfileEditor.tsx:78`). They go into the draft at `:139` and into the dirty-check baseline at `:143`. Because the baseline gets the same suggestions, they do not count as a change. But the save writes the whole draft (`KeyProfileEditor.tsx:179`). So any save of an unrelated field replaces the stored empty list with the suggestions: session affinity, preferred account, pool selection, Codex speed or the Enabled switch. This happens even when the fallback target is off and the mapping table was never shown. Suppose the fallback is later enabled outside the panel (config file or API). It then maps `claude-opus-*`, `claude-sonnet-*` and `claude-fable-*` instead of nothing. The legacy toolbar text in `docs/personal-quota.md:250` says suggestions "are saved only on user action".

This is a deliberate decision, not a regression. `docs/plans/completed/20261110-provider-mode-profile-editor.md:170` says "a save still stores the suggested table, as before". The `KeyProfileEditor.test.tsx` test "a stored profile without mappings opens clean and saves the suggested ones" asserts it, and the `profilesKeysFlow.lifecycle.test.tsx` helper `withSuggested` depends on it. Changing it needs a product decision first. The behavior dates from 2026-11-05 (`3c2bfbaa2`, `d1c7bfa26`, `3aab6118d`); the provider toggle did not introduce it.

Fix direction, if the decision changes: at save time, write the stored empty list back unless the user edited a mapping row or turned on the Codex fallback target that uses the rows. CPA needs mappings under that target (`validFallbackSettings`). Replace the test above with one that saves an unrelated field over an empty stored list and expects `mappings: []`. Update `withSuggested` in the flow tests to match.
