import type { TFunction } from 'i18next';
import { normalizeFallbackSettings } from '@/features/personal-quota-support/services/api/claudeFallback';
import {
  effectiveFallbackTarget,
  type ApiCredentials,
  type ApiProvider,
  type KeyProfileRow,
  type ProviderRouting,
  type RoutingProfile,
  type RoutingSelectionOptions,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { buildApiKeyDisplayMap, labelShowsMask } from '@/features/monitoring/model/apiKeys';
import { getQuotaDisplayName } from '@/features/quota/utils/quota/identity';
import type { ApiKeyAlias } from '@/services/api/usageService';
import { sha256Hex } from '@/utils/apiKeyHash';
import { maskApiKey } from '@/utils/format';
import { maskQuotaName } from './ledgerModel';
import { chosenApiKeyLabel, type ApiKeyConfigSummaries } from './providerRoutingModel';
import { preferredAccountOptions, withPickerRule } from './routingModel';

/**
 * Canonical form of one provider block: the credential is trimmed, API key mode
 * carries `target: off` (the save body does too), and the Codex fallback keeps only
 * its target because CPA stores no Codex mode or mappings. Claude's mode and
 * mappings are kept under every target: they survive as hidden values.
 */
function normalizeProviderRouting(
  provider: ApiProvider,
  routing: ProviderRouting
): ProviderRouting {
  const target = effectiveFallbackTarget(provider, routing);
  if (provider === 'codex')
    return {
      mode: routing.mode,
      apiCredential: routing.apiCredential.trim(),
      fallback: { target, mode: 'auto', mappings: [] },
    };
  const fallback = normalizeFallbackSettings({
    enabled: false,
    mode: routing.fallback.mode,
    mappings: routing.fallback.mappings,
  });
  return {
    mode: routing.mode,
    apiCredential: routing.apiCredential.trim(),
    fallback: { target, mode: fallback.mode, mappings: fallback.mappings },
  };
}

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
  return {
    sessionAffinity: profile.sessionAffinity,
    preferredAccounts,
    selection,
    providers: {
      claude: normalizeProviderRouting('claude', profile.providers.claude),
      codex: normalizeProviderRouting('codex', profile.providers.codex),
    },
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

const copyOfProviderRouting = (routing: ProviderRouting): ProviderRouting => ({
  mode: routing.mode,
  apiCredential: routing.apiCredential,
  fallback: {
    target: routing.fallback.target,
    mode: routing.fallback.mode,
    mappings: routing.fallback.mappings.map((mapping) => ({ ...mapping })),
  },
});

/** A new key profile starts as an independent copy of the shared profile, hidden values included. */
export function copyOfShared(shared: RoutingProfile): RoutingProfile {
  return {
    sessionAffinity: shared.sessionAffinity,
    preferredAccounts: { ...shared.preferredAccounts },
    selection: { ...shared.selection },
    providers: {
      claude: copyOfProviderRouting(shared.providers.claude),
      codex: copyOfProviderRouting(shared.providers.codex),
    },
  };
}

/** A key row ready for display. `key` is raw and only for saving; never render it. */
export interface KeyDisplayRow extends KeyProfileRow {
  /** The stored alias, else the CP instance name (`utils/apiKeyName.ts`), else the masked key. */
  label: string;
  masked: string;
  /**
   * `label` is a name (a stored alias or a CP instance name), so the mask is shown beside it.
   * `false` when the label already holds the mask (a shared name, `labelShowsMask`).
   */
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
    return {
      key: row.key,
      profile: row.profile,
      label,
      masked,
      hasAlias: !labelShowsMask(label, masked),
    };
  });
}

const PROVIDER_LABELS = { claude: 'Claude', codex: 'Codex' } as const;

/** What a summary needs to name a chosen API key; without it the key shows by index. */
export interface ApiKeyLabelSource {
  apiCredentials: ApiCredentials;
  providerConfigs: ApiKeyConfigSummaries;
}

// A literal, not `emptyApiKeyConfigs()`: this module sits in an import cycle with
// routingProfiles.ts and providerRoutingModel.ts, so nothing runs at load time.
const noApiKeyLabels: ApiKeyLabelSource = {
  apiCredentials: { claude: [], codex: [] },
  providerConfigs: { claude: [], codex: [] },
};

const SUMMARY = 'quota_management.key_profiles.summary';

/** One provider's leg of the chain: preferred account and fallback, or its API key. */
function providerSummary(
  provider: ApiProvider,
  profile: RoutingProfile,
  account: string,
  apiKeys: ApiKeyLabelSource,
  t: TFunction
): string {
  const routing = profile.providers[provider];
  const name = PROVIDER_LABELS[provider];
  if (routing.mode === 'api') {
    const key = chosenApiKeyLabel(
      provider,
      routing.apiCredential,
      apiKeys.apiCredentials,
      apiKeys.providerConfigs
    );
    return key
      ? t(`${SUMMARY}.api_key`, { provider: name, key })
      : t(`${SUMMARY}.api_key_unset`, { provider: name });
  }
  switch (effectiveFallbackTarget(provider, routing)) {
    case 'codex':
      return routing.fallback.mode === 'always'
        ? t(`${SUMMARY}.codex_forced`, { provider: name })
        : t(`${SUMMARY}.to_codex`, { provider: name, account });
    case 'api':
      return t(`${SUMMARY}.to_api_key`, { provider: name, account });
    default:
      return t(`${SUMMARY}.account`, { provider: name, account });
  }
}

/**
 * One-line chain of a profile: sticky session, one leg per provider (preferred
 * account, then Codex or its API key; or its API key alone in API key mode), and
 * pool selection. Account names are masked unless emails are shown.
 */
export function chainSummary(
  profile: RoutingProfile,
  files: AuthFileItem[],
  showEmails: boolean,
  t: TFunction,
  apiKeys: ApiKeyLabelSource = noApiKeyLabels
): string {
  const displayName = (file: AuthFileItem) => {
    const name = getQuotaDisplayName(file);
    return showEmails ? name : maskQuotaName(name);
  };
  const parts = [t(profile.sessionAffinity ? `${SUMMARY}.sticky_on` : `${SUMMARY}.sticky_off`)];
  for (const provider of ['claude', 'codex'] as const) {
    const selected = profile.preferredAccounts[provider]?.trim() ?? '';
    const options = preferredAccountOptions(provider, files, selected, displayName, t);
    const account = options.find((option) => option.value === selected)?.label ?? '';
    parts.push(providerSummary(provider, profile, account, apiKeys, t));
  }
  const { primary, tiebreak } = profile.selection;
  parts.push(tiebreak ? `${primary} → ${tiebreak}` : primary);
  return parts.join(' · ');
}
