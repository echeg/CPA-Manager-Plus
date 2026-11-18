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

/** One row of the speed table. `key` is raw and only for saving; never render it. */
export interface SpeedRow {
  /** Stable id: `default`, or `key-` and the key's hash. Never the raw key. */
  id: string;
  kind: 'default' | 'key';
  /** The raw client key of a key row; `null` for the Default row. */
  key: string | null;
  /** Display label of a key row (alias, CP name or masked key); `''` for the Default row. */
  label: string;
  masked: string;
  /** The label is a name, so the masked key is shown beside it. */
  hasAlias: boolean;
  /** The key's own profile; `null` for a key on the Default profile and for the Default row. */
  profile: RoutingProfile | null;
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
    kind: 'default',
    key: null,
    label: '',
    masked: '',
    hasAlias: false,
    profile: null,
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
      kind: 'key',
      key: row.key,
      label: row.label,
      masked: row.masked,
      hasAlias: row.hasAlias,
      profile: row.profile,
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
