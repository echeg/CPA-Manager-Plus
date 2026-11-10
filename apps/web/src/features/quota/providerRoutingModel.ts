import type { TFunction } from 'i18next';
import { validFallbackSettings } from '@/features/personal-quota-support/services/api/claudeFallback';
import {
  effectiveFallbackTarget,
  type ApiCredential,
  type ApiCredentials,
  type ApiProvider,
  type FallbackTarget,
  type ProviderRouting,
  type RoutingProfile,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { ProviderKeyConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import type { SelectOption } from './components/Select';

export const API_PROVIDERS: readonly ApiProvider[] = ['claude', 'codex'];

/**
 * What the panel keeps of one provider key config for labels: the raw key is
 * reduced to its mask as soon as the configs load, so it never reaches state.
 */
export interface ApiKeyConfigSummary {
  authIndex: string;
  /** The entry's `prefix`, the only name a Claude or Codex key entry has. */
  name: string;
  masked: string;
  baseUrl: string;
}

export type ApiKeyConfigSummaries = Record<ApiProvider, ApiKeyConfigSummary[]>;

export const emptyApiKeyConfigs = (): ApiKeyConfigSummaries => ({ claude: [], codex: [] });

/** Drop the raw key of every entry; entries without an `auth-index` cannot be matched. */
export function summarizeKeyConfigs(configs: ProviderKeyConfig[]): ApiKeyConfigSummary[] {
  return configs.flatMap((config) => {
    const authIndex = config.authIndex?.trim() ?? '';
    if (!authIndex) return [];
    const apiKey = config.apiKey.trim();
    const prefix = config.prefix?.trim() ?? '';
    return [
      {
        authIndex,
        // A prefix that repeats the raw key would put it on screen.
        name: apiKey && prefix.includes(apiKey) ? '' : prefix,
        masked: maskApiKey(apiKey),
        baseUrl: config.baseUrl?.trim() ?? '',
      },
    ];
  });
}

/** Fallback targets a provider offers, in display order. Codex cannot fall back to itself. */
export function fallbackTargets(provider: ApiProvider): FallbackTarget[] {
  return provider === 'claude' ? ['off', 'codex', 'api'] : ['off', 'api'];
}

/** The host of a custom base URL; the URL itself when it does not parse. */
function hostOf(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).host || trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * `<name> · <masked key>` (`· <host>` with a custom base URL) for a credential with
 * a matching key config; `<label> · <first 8 characters of auth_index>` without one.
 */
export function apiCredentialLabel(
  credential: ApiCredential,
  configs: ApiKeyConfigSummary[]
): string {
  const config = configs.find((item) => item.authIndex === credential.authIndex);
  const parts = config
    ? [config.name || credential.label.trim(), config.masked]
    : [credential.label.trim(), credential.authIndex.slice(0, 8)];
  parts.push(hostOf(config?.baseUrl || credential.baseUrl));
  return parts.filter(Boolean).join(' · ');
}

export type ApiKeyOptionStatus = 'ok' | 'disabled' | 'unknown';

export interface ApiKeyOption extends SelectOption {
  status: ApiKeyOptionStatus;
}

/**
 * The API-key choices of one provider: every listed credential (disabled ones
 * marked), and the selected index marked `unknown` when the list no longer has it.
 * An empty list with nothing selected means the provider has no API key configured.
 */
export function apiCredentialOptions(
  provider: ApiProvider,
  apiCredentials: ApiCredentials,
  providerConfigs: ApiKeyConfigSummaries,
  selected: string,
  t: TFunction
): ApiKeyOption[] {
  const credentials = apiCredentials[provider];
  const configs = providerConfigs[provider];
  const options: ApiKeyOption[] = credentials.map((credential) => {
    const label = apiCredentialLabel(credential, configs);
    return credential.disabled
      ? {
          value: credential.authIndex,
          label: `${label} · ${t('quota_management.provider_routing.key_disabled')}`,
          status: 'disabled',
        }
      : { value: credential.authIndex, label, status: 'ok' };
  });
  const chosen = selected.trim();
  if (chosen && !credentials.some((credential) => credential.authIndex === chosen)) {
    options.push({
      value: chosen,
      label: `${chosen.slice(0, 8)} · ${t('quota_management.provider_routing.key_unknown')}`,
      status: 'unknown',
    });
  }
  return options;
}

/** Display label of a chosen API key for summaries; `''` when none is chosen. */
export function chosenApiKeyLabel(
  provider: ApiProvider,
  authIndex: string,
  apiCredentials: ApiCredentials,
  providerConfigs: ApiKeyConfigSummaries
): string {
  const chosen = authIndex.trim();
  if (!chosen) return '';
  const credential = apiCredentials[provider].find((item) => item.authIndex === chosen);
  return credential
    ? apiCredentialLabel(credential, providerConfigs[provider])
    : chosen.slice(0, 8);
}

/** Field errors of one provider block, as i18n keys. */
export interface ProviderFieldErrors {
  /** API key mode or the API-key fallback has no key chosen. */
  apiCredential?: string;
  /** The Claude -> Codex mapping table is invalid while the target is Codex. */
  mappings?: string;
}

export type ProviderRoutingErrors = Record<ApiProvider, ProviderFieldErrors>;

const ERRORS = 'quota_management.provider_routing.errors';

/**
 * Save-blocking errors of one provider block. On an older backend API key mode and
 * the API-key fallback cannot be written, so only the mappings are checked.
 */
export function providerFieldErrors(
  provider: ApiProvider,
  routing: ProviderRouting,
  providersSupported: boolean
): ProviderFieldErrors {
  const errors: ProviderFieldErrors = {};
  const target = effectiveFallbackTarget(provider, routing);
  const needsKey = routing.mode === 'api' || target === 'api';
  if (providersSupported && needsKey && !routing.apiCredential.trim())
    errors.apiCredential = `${ERRORS}.key_required`;
  if (
    target === 'codex' &&
    !validFallbackSettings({
      enabled: true,
      mode: routing.fallback.mode,
      mappings: routing.fallback.mappings,
    })
  )
    errors.mappings = 'quota_management.fallback.invalid';
  return errors;
}

/** Save-blocking errors of both provider blocks of a profile. */
export function providerRoutingErrors(
  profile: RoutingProfile,
  providersSupported: boolean
): ProviderRoutingErrors {
  return {
    claude: providerFieldErrors('claude', profile.providers.claude, providersSupported),
    codex: providerFieldErrors('codex', profile.providers.codex, providersSupported),
  };
}

export const hasProviderRoutingErrors = (errors: ProviderRoutingErrors): boolean =>
  API_PROVIDERS.some((provider) => Object.values(errors[provider]).some(Boolean));

/**
 * The save form of the provider blocks: API key mode carries `target: off`, as CPA
 * requires. Everything else, the Claude mapping table and the chosen key included,
 * is kept, so the stored profile still holds the hidden values.
 */
export function withApiModeNormalization(
  providers: RoutingProfile['providers']
): RoutingProfile['providers'] {
  const normalize = (routing: ProviderRouting): ProviderRouting =>
    routing.mode === 'api'
      ? { ...routing, fallback: { ...routing.fallback, target: 'off' } }
      : routing;
  return { claude: normalize(providers.claude), codex: normalize(providers.codex) };
}
