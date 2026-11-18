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
 * Whether CPA puts a profile's Codex speed on requests:
 * - `applies`: Codex runs on subscriptions, or its stored mode is locked (CPA ignores it);
 * - `claude_fallback`: Codex uses an API key, whose requests get no speed tier, but Claude
 *   falls back to Codex. CPA runs that leg on Codex subscriptions with this profile's speed,
 *   so the speed applies to it alone;
 * - `unused`: Codex uses an API key and Claude does not fall back to Codex.
 */
export type CodexSpeedUse = 'applies' | 'claude_fallback' | 'unused';

/** The one rule for the editor's Speed row and the speed table; see `CodexSpeedUse`. */
export function codexSpeedUse(
  providers: RoutingProfile['providers'],
  modeLocked: boolean
): CodexSpeedUse {
  if (modeLocked || providers.codex.mode !== 'api') return 'applies';
  return effectiveFallbackTarget(providers.claude) === 'codex' ? 'claude_fallback' : 'unused';
}

/**
 * Why a row of the speed table takes no input:
 * - `read_only`: a key row while key profiles are not used (`supported: false`);
 * - `api_mode`: CPA puts the row's Codex speed on no request (`codexSpeedUse` is `unused`).
 */
export type SpeedDisabledReason = '' | 'read_only' | 'api_mode';

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
  /** The speed applies only to Claude requests that fall back to Codex (`claude_fallback`). */
  claudeFallbackOnly: boolean;
}

export type CodexSpeedPatch = Partial<Pick<ProviderRouting, 'speed' | 'ignoreClientTier'>>;

/**
 * The Default row, then one row per client key in list order. A key without its own
 * profile shows the Default profile's values; the table never merges the two.
 */
export function buildSpeedRows(state: RoutingProfilesState, rows: KeyDisplayRow[]): SpeedRow[] {
  const toRow = (
    id: string,
    keyRow: KeyDisplayRow | null,
    { providers }: RoutingProfile
  ): SpeedRow => {
    // Under `supported: false` CPA ignores the stored provider mode, while the shared
    // speed still applies, so the Default row stays editable in API key mode there.
    // Key rows are read-only then, whatever their mode.
    const use = codexSpeedUse(providers, !state.supported);
    return {
      id,
      keyRow,
      speed: providers.codex.speed,
      ignoreClientTier: providers.codex.ignoreClientTier,
      disabledReason: keyRow && !state.supported ? 'read_only' : use === 'unused' ? 'api_mode' : '',
      claudeFallbackOnly: use === 'claude_fallback',
    };
  };
  return [
    toRow('default', null, state.shared),
    ...rows.map((row) =>
      toRow(`key-${sha256Hex(row.key).toLowerCase()}`, row, row.profile ?? state.shared)
    ),
  ];
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
