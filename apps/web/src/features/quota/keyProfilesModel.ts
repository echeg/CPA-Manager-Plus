import type { TFunction } from 'i18next';
import { normalizeFallbackSettings } from '@/features/personal-quota-support/services/api/claudeFallback';
import type {
  KeyProfileRow,
  RoutingProfile,
  RoutingSelectionOptions,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { buildApiKeyDisplayMap } from '@/features/monitoring/model/apiKeys';
import { getQuotaDisplayName } from '@/features/quota/utils/quota/identity';
import type { ApiKeyAlias } from '@/services/api/usageService';
import { sha256Hex } from '@/utils/apiKeyHash';
import { maskApiKey } from '@/utils/format';
import { maskQuotaName } from './ledgerModel';
import { preferredAccountOptions, withPickerRule } from './routingModel';

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
  const selection = withPickerRule(
    { primary: profile.selection.primary.trim(), tiebreak: profile.selection.tiebreak?.trim() },
    selectionOptions
  );
  const fallback = normalizeFallbackSettings(profile.claudeFallback);
  return {
    sessionAffinity: profile.sessionAffinity,
    preferredAccounts,
    selection,
    claudeFallback: { enabled: fallback.enabled, mode: fallback.mode, mappings: fallback.mappings },
  };
}

/** True when the two profiles differ in anything the backend keeps. */
export function profileDirty(
  a: RoutingProfile,
  b: RoutingProfile,
  selectionOptions: RoutingSelectionOptions
): boolean {
  return (
    JSON.stringify(normalizeProfile(a, selectionOptions)) !==
    JSON.stringify(normalizeProfile(b, selectionOptions))
  );
}

/** A new key profile starts as an independent copy of the shared profile. */
export function copyOfShared(shared: RoutingProfile): RoutingProfile {
  return {
    sessionAffinity: shared.sessionAffinity,
    preferredAccounts: { ...shared.preferredAccounts },
    selection: { ...shared.selection },
    claudeFallback: {
      enabled: shared.claudeFallback.enabled,
      mode: shared.claudeFallback.mode,
      mappings: shared.claudeFallback.mappings.map((mapping) => ({ ...mapping })),
    },
  };
}

/** A key row ready for display. `key` is raw and only for saving; never render it. */
export interface KeyDisplayRow extends KeyProfileRow {
  /** The alias, or the masked key when there is none. */
  label: string;
  masked: string;
  hasAlias: boolean;
}

export function buildKeyRows(rows: KeyProfileRow[], aliases: ApiKeyAlias[] = []): KeyDisplayRow[] {
  const display = buildApiKeyDisplayMap(
    rows.map((row) => row.key),
    aliases
  );
  return rows.map((row) => {
    const info = display.get(sha256Hex(row.key).toLowerCase());
    const masked = info?.masked || maskApiKey(row.key);
    // An alias that repeats the raw key would put it on screen.
    const label = info && info.label && !info.label.includes(row.key) ? info.label : masked;
    return { key: row.key, profile: row.profile, label, masked, hasAlias: label !== masked };
  });
}

const PROVIDER_LABELS = { claude: 'Claude', codex: 'Codex' } as const;

/**
 * One-line chain of the four routing stages: sticky session, preferred accounts,
 * pool selection, and the Claude -> Codex fallback.
 */
export function chainSummary(
  profile: RoutingProfile,
  files: AuthFileItem[],
  showEmails: boolean,
  t: TFunction
): string {
  const displayName = (file: AuthFileItem) => {
    const name = getQuotaDisplayName(file);
    return showEmails ? name : maskQuotaName(name);
  };
  const parts = [
    t(
      profile.sessionAffinity
        ? 'quota_management.key_profiles.summary.sticky_on'
        : 'quota_management.key_profiles.summary.sticky_off'
    ),
  ];
  for (const provider of ['claude', 'codex'] as const) {
    const selected = profile.preferredAccounts[provider]?.trim() ?? '';
    const options = preferredAccountOptions(provider, files, selected, displayName, t);
    const account = options.find((option) => option.value === selected)?.label ?? '';
    parts.push(
      t('quota_management.key_profiles.summary.account', {
        provider: PROVIDER_LABELS[provider],
        account,
      })
    );
  }
  const { primary, tiebreak } = profile.selection;
  parts.push(tiebreak ? `${primary} → ${tiebreak}` : primary);
  const fallback = profile.claudeFallback;
  parts.push(
    t(
      !fallback.enabled
        ? 'quota_management.key_profiles.summary.fallback_off'
        : fallback.mode === 'always'
          ? 'quota_management.key_profiles.summary.fallback_always'
          : 'quota_management.key_profiles.summary.fallback_auto'
    )
  );
  return parts.join(' · ');
}
