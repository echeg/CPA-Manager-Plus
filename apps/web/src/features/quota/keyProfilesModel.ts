import { normalizeFallbackSettings } from '@/features/personal-quota-support/services/api/claudeFallback';
import type {
  RoutingProfile,
  RoutingSelectionOptions,
} from '@/features/personal-quota-support/services/api/routingProfiles';

const isPicker = (slot: string, options: RoutingSelectionOptions) => options.pickers.includes(slot);

/**
 * Canonical form of a profile: the shape the backend keeps. A picker as primary
 * makes the tiebreak inactive, mappings are trimmed, and empty preferences are
 * dropped. Keys are built in a fixed order so JSON comparison is stable.
 */
export function normalizeProfile(
  profile: RoutingProfile,
  selectionOptions: RoutingSelectionOptions
): RoutingProfile {
  const preferredAccounts: RoutingProfile['preferredAccounts'] = {};
  for (const provider of ['claude', 'codex'] as const) {
    const value = profile.preferredAccounts[provider]?.trim();
    if (value) preferredAccounts[provider] = value;
  }
  const primary = profile.selection.primary.trim();
  const tiebreak = profile.selection.tiebreak?.trim();
  const fallback = normalizeFallbackSettings(profile.claudeFallback);
  return {
    sessionAffinity: profile.sessionAffinity,
    preferredAccounts,
    selection:
      primary && tiebreak && !isPicker(primary, selectionOptions)
        ? { primary, tiebreak }
        : { primary },
    claudeFallback: { enabled: fallback.enabled, mode: fallback.mode, mappings: fallback.mappings },
  };
}
