import type {
  CodexSpeed,
  ProviderRouting,
  RoutingProfile,
  RoutingProfilesState,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import { sha256Hex } from '@/utils/apiKeyHash';
import type { KeyDisplayRow } from './keyProfilesModel';

/**
 * Why a row of the speed table takes no input:
 * - `read_only`: a key row while key profiles are not used (`supported: false`);
 * - `api_mode`: the effective Codex mode is API key, whose requests get no speed tier.
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
    disabledReason: state.supported && shared.mode === 'api' ? 'api_mode' : '',
  };
  const keyRows = rows.map((row): SpeedRow => {
    const codex = (row.profile ?? state.shared).providers.codex;
    const disabledReason: SpeedDisabledReason = !state.supported
      ? 'read_only'
      : codex.mode === 'api'
        ? 'api_mode'
        : '';
    return {
      id: `key-${sha256Hex(row.key).toLowerCase()}`,
      keyRow: row,
      speed: codex.speed,
      ignoreClientTier: codex.ignoreClientTier,
      disabledReason,
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
