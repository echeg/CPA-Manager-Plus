import {
  effectiveFallbackTarget,
  type CodexSpeed,
  type ProviderRouting,
  type RoutingProfile,
  type RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { sha256Hex } from '@/utils/apiKeyHash';
import type { KeyDisplayRow } from './keyProfilesModel';

/**
 * Why a row of the speed table takes no input:
 * - `read_only`: a key row while key profiles are not used (`supported: false`);
 * - `api_mode`: the effective Codex mode is API key, whose requests get no speed tier,
 *   and Claude does not fall back to Codex.
 */
export type SpeedDisabledReason = '' | 'read_only' | 'api_mode';

/**
 * Codex is in API key mode, but Claude falls back to Codex. CPA runs that fallback leg on
 * Codex subscriptions with this profile's Codex speed, so the speed applies to it alone.
 */
export const codexSpeedOnlyInClaudeFallback = (providers: RoutingProfile['providers']): boolean =>
  providers.codex.mode === 'api' && effectiveFallbackTarget(providers.claude) === 'codex';

/** CPA puts the profile's Codex speed on no request: Codex uses an API key, and Claude does not fall back to Codex. */
const codexSpeedUnused = (providers: RoutingProfile['providers']): boolean =>
  providers.codex.mode === 'api' && !codexSpeedOnlyInClaudeFallback(providers);

/** One row of the speed table. */
export interface SpeedRow {
  /** Stable id: `default`, or `key-` and the key's hash. Never the raw key. */
  id: string;
  /** The client key the row is for; `null` for the Default row. Its `key` is raw: never render it. */
  keyRow: KeyDisplayRow | null;
  /** Effective Codex values: the key's own profile, else the Default profile. */
  speed: CodexSpeed;
  ignoreClientTier: boolean;
  disabledReason: SpeedDisabledReason;
  /** The speed applies only to Claude requests that fall back to Codex (see `codexSpeedOnlyInClaudeFallback`). */
  claudeFallbackOnly: boolean;
}

export type CodexSpeedPatch = Partial<Pick<ProviderRouting, 'speed' | 'ignoreClientTier'>>;

/**
 * The Default row, then one row per client key in list order. A key without its own
 * profile shows the Default profile's values; the table never merges the two.
 */
export function buildSpeedRows(state: RoutingProfilesState, rows: KeyDisplayRow[]): SpeedRow[] {
  const shared = state.shared.providers.codex;
  // Under `supported: false` CPA ignores the stored provider mode, while the shared
  // speed still applies, so the Default row stays editable in API key mode there.
  const defaultRow: SpeedRow = {
    id: 'default',
    keyRow: null,
    speed: shared.speed,
    ignoreClientTier: shared.ignoreClientTier,
    disabledReason: state.supported && codexSpeedUnused(state.shared.providers) ? 'api_mode' : '',
    claudeFallbackOnly: state.supported && codexSpeedOnlyInClaudeFallback(state.shared.providers),
  };
  const keyRows = rows.map((row): SpeedRow => {
    const { providers } = row.profile ?? state.shared;
    const disabledReason: SpeedDisabledReason = !state.supported
      ? 'read_only'
      : codexSpeedUnused(providers)
        ? 'api_mode'
        : '';
    return {
      id: `key-${sha256Hex(row.key).toLowerCase()}`,
      keyRow: row,
      speed: providers.codex.speed,
      ignoreClientTier: providers.codex.ignoreClientTier,
      disabledReason,
      claudeFallbackOnly: state.supported && codexSpeedOnlyInClaudeFallback(providers),
    };
  });
  return [defaultRow, ...keyRows];
}

/** A copy of the profile with the Codex speed and / or flag replaced and nothing else changed. */
export function withCodexSpeed(profile: RoutingProfile, patch: CodexSpeedPatch): RoutingProfile {
  return {
    ...profile,
    providers: {
      ...profile.providers,
      codex: { ...profile.providers.codex, ...patch },
    },
  };
}
