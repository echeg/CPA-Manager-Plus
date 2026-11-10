import { normalizeProfile, profileDirty } from '@/features/quota/keyProfilesModel';
import { invalidTTL } from '@/features/quota/routingModel';
import { goDurationSeconds } from '@/features/quota/utils/goDuration';
import { apiClient } from './client';
import {
  readFallbackSettings,
  validFallbackSettings,
  type ClaudeFallbackSettings,
} from './claudeFallback';
import { configApi } from './config';
import { guardConfigConnection } from './configValue';

export interface SelectionSlots {
  primary: string;
  tiebreak?: string;
}

export type ProviderMode = 'subscription' | 'api';
export type FallbackTarget = 'off' | 'codex' | 'api';

/** One provider's routing: subscriptions or its API key, and where to go when subscriptions fail. */
export interface ProviderRouting {
  mode: ProviderMode;
  /** The `auth_index` of the provider's API key; `''` when none is chosen. */
  apiCredential: string;
  fallback: {
    /** `codex` is valid for Claude only. */
    target: FallbackTarget;
    /** Claude -> Codex mode and model mappings; kept while hidden, ignored by CPA for Codex. */
    mode: 'auto' | 'always';
    mappings: Array<{ from: string; to: string }>;
  };
}

export type ApiProvider = 'claude' | 'codex';

export interface RoutingProfile {
  sessionAffinity: boolean;
  preferredAccounts: { claude?: string; codex?: string };
  selection: SelectionSlots;
  providers: { claude: ProviderRouting; codex: ProviderRouting };
}

/** One upstream API key CPA can route to, as listed in `api_credentials`. */
export interface ApiCredential {
  authIndex: string;
  label: string;
  baseUrl: string;
  disabled: boolean;
}

export type ApiCredentials = Record<ApiProvider, ApiCredential[]>;

export interface RoutingSelectionOptions {
  narrowing: string[];
  pickers: string[];
}

/** A raw client key; it stays in memory and PATCH bodies, never in a URL or on screen. */
export interface KeyProfileEntry {
  key: string;
  profile: RoutingProfile;
}

export interface RoutingProfilesState {
  supported: boolean;
  /** The backend has no `/routing/profiles` route; the panel keeps its legacy controls. */
  unsupportedBackend: boolean;
  shared: RoutingProfile;
  /** Only keys with their own profile, in `access.api-keys` order. */
  keys: KeyProfileEntry[];
  selectionOptions: RoutingSelectionOptions;
  /**
   * The backend serves `providers` (API key mode and API-key fallback). `false` on an
   * older backend: `providers` is derived from `claude-fallback` and written back as it.
   */
  providersSupported: boolean;
  apiCredentials: ApiCredentials;
}

export interface KeyProfileRow {
  key: string;
  profile: RoutingProfile | null;
}

/** 400 `unknown_api_key`: the key is no longer in `access.api-keys`. */
export class UnknownApiKeyError extends Error {
  constructor() {
    super('The client key is no longer in the configuration');
    this.name = 'UnknownApiKeyError';
  }
}

/** 422 `invalid_config`: the backend message names the profile by a hash prefix only. */
export class InvalidRoutingConfigError extends Error {
  constructor(message: string) {
    super(message || 'Invalid routing configuration');
    this.name = 'InvalidRoutingConfigError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const stringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new Error('Invalid routing selection options');
  return value.filter((item): item is string => typeof item === 'string' && item !== '');
};

export const defaultProviderRouting = (): ProviderRouting => ({
  mode: 'subscription',
  apiCredential: '',
  fallback: { target: 'off', mode: 'auto', mappings: [] },
});

const emptyProfile = (): RoutingProfile => ({
  sessionAffinity: false,
  preferredAccounts: {},
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  providers: { claude: defaultProviderRouting(), codex: defaultProviderRouting() },
});

/** The target CPA applies: API key mode skips the fallback. */
export const effectiveFallbackTarget = (routing: ProviderRouting): FallbackTarget =>
  routing.mode === 'api' ? 'off' : routing.fallback.target;

/** The legacy `claude-fallback` view of a profile: enabled only for the Codex target. */
export function claudeFallbackOf(profile: RoutingProfile): ClaudeFallbackSettings {
  const claude = profile.providers.claude;
  return {
    enabled: effectiveFallbackTarget(claude) === 'codex',
    mode: claude.fallback.mode,
    mappings: claude.fallback.mappings.map((mapping) => ({ ...mapping })),
  };
}

/**
 * Whether CPA accepts Claude's mapping table. It checks the rows under every target
 * but API key, where it ignores them, so a hidden table under target Off or API key
 * mode (saved as Off) must be valid too; an older backend checks the `claude-fallback`
 * rows even when disabled. At least one row is required only for the Codex target.
 */
export function validClaudeMappings(routing: ProviderRouting, providersSupported = true): boolean {
  const target = effectiveFallbackTarget(routing);
  if (providersSupported && target === 'api') return true;
  return validFallbackSettings({
    enabled: target === 'codex',
    mode: routing.fallback.mode,
    mappings: routing.fallback.mappings,
  });
}

const PROVIDER_MODES: readonly ProviderMode[] = ['subscription', 'api'];
/** Fallback targets per provider, in display order. Codex cannot fall back to itself. */
export const FALLBACK_TARGETS: Record<ApiProvider, readonly FallbackTarget[]> = {
  claude: ['off', 'codex', 'api'],
  codex: ['off', 'api'],
};

/** An absent, `null` or `""` value takes the default; any other unknown value is an error. */
function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new Error('Invalid routing provider settings');
}

function readProviderRouting(provider: ApiProvider, raw: unknown): ProviderRouting {
  if (raw === undefined || raw === null) return defaultProviderRouting();
  if (!isRecord(raw)) throw new Error('Invalid routing provider settings');
  const credential = raw['api-credential'];
  if (credential !== undefined && credential !== null && typeof credential !== 'string')
    throw new Error('Invalid routing provider settings');
  const fallbackRaw = raw.fallback;
  if (fallbackRaw !== undefined && fallbackRaw !== null && !isRecord(fallbackRaw))
    throw new Error('Invalid routing provider settings');
  const mappingsRaw = fallbackRaw?.mappings;
  if (
    mappingsRaw !== undefined &&
    mappingsRaw !== null &&
    !(
      Array.isArray(mappingsRaw) &&
      mappingsRaw.every(
        (item: unknown) =>
          isRecord(item) && typeof item.from === 'string' && typeof item.to === 'string'
      )
    )
  )
    throw new Error('Invalid routing provider settings');
  const target = readEnum(fallbackRaw?.target, FALLBACK_TARGETS[provider], 'off');
  // CPA neither checks nor uses the fallback mode under target API key, so any value
  // there other than `always` reads as the default instead of failing the whole load.
  const fallbackMode =
    target === 'api' && fallbackRaw?.mode !== 'always'
      ? 'auto'
      : readEnum(fallbackRaw?.mode, ['auto', 'always'] as const, 'auto');
  return {
    mode: readEnum(raw.mode, PROVIDER_MODES, 'subscription'),
    apiCredential: typeof credential === 'string' ? credential : '',
    fallback: {
      target,
      mode: fallbackMode,
      mappings: Array.isArray(mappingsRaw)
        ? mappingsRaw.map((item) => ({ from: item.from as string, to: item.to as string }))
        : [],
    },
  };
}

/** `providers` from a legacy `claude-fallback` block: subscriptions only, Codex or no fallback. */
export function providersFromClaudeFallback(
  legacy: ClaudeFallbackSettings
): RoutingProfile['providers'] {
  return {
    claude: {
      mode: 'subscription',
      apiCredential: '',
      fallback: {
        target: legacy.enabled ? 'codex' : 'off',
        mode: legacy.mode,
        mappings: legacy.mappings.map((mapping) => ({ ...mapping })),
      },
    },
    codex: defaultProviderRouting(),
  };
}

function readProviders(raw: Record<string, unknown>): RoutingProfile['providers'] {
  const providers = raw.providers;
  if (providers === undefined || providers === null)
    return providersFromClaudeFallback(readFallbackSettings(raw['claude-fallback']));
  if (!isRecord(providers)) throw new Error('Invalid routing provider settings');
  return {
    claude: readProviderRouting('claude', providers.claude),
    codex: readProviderRouting('codex', providers.codex),
  };
}

/** `api_credentials` is informational: a missing list is empty and malformed entries are skipped. */
function readApiCredentials(raw: unknown): ApiCredentials {
  const list = (value: unknown): ApiCredential[] =>
    Array.isArray(value)
      ? value.flatMap((item: unknown) =>
          isRecord(item) && typeof item.auth_index === 'string' && item.auth_index.trim()
            ? [
                {
                  authIndex: item.auth_index.trim(),
                  label: typeof item.label === 'string' ? item.label : '',
                  baseUrl: typeof item.base_url === 'string' ? item.base_url : '',
                  disabled: item.disabled === true,
                },
              ]
            : []
        )
      : [];
  return isRecord(raw)
    ? { claude: list(raw.claude), codex: list(raw.codex) }
    : { claude: [], codex: [] };
}

function readProfile(raw: unknown): RoutingProfile {
  if (!isRecord(raw) || typeof raw['session-affinity'] !== 'boolean')
    throw new Error('Invalid routing profile');
  const selection = raw.selection;
  if (
    !isRecord(selection) ||
    typeof selection.primary !== 'string' ||
    (selection.tiebreak !== undefined &&
      selection.tiebreak !== null &&
      typeof selection.tiebreak !== 'string')
  )
    throw new Error('Invalid routing profile selection');
  const preferredRaw = raw['preferred-accounts'];
  if (preferredRaw !== undefined && preferredRaw !== null && !isRecord(preferredRaw))
    throw new Error('Invalid routing profile preferences');
  const preferredAccounts: RoutingProfile['preferredAccounts'] = {};
  for (const provider of ['claude', 'codex'] as const) {
    const value = preferredRaw?.[provider];
    if (typeof value === 'string' && value.trim()) preferredAccounts[provider] = value;
  }
  return {
    sessionAffinity: raw['session-affinity'],
    preferredAccounts,
    selection:
      typeof selection.tiebreak === 'string' && selection.tiebreak
        ? { primary: selection.primary, tiebreak: selection.tiebreak }
        : { primary: selection.primary },
    providers: readProviders(raw),
  };
}

/** Validate `GET /routing/profiles` and map its kebab-case fields to panel types. */
export function readRoutingProfiles(raw: unknown): RoutingProfilesState {
  if (
    !isRecord(raw) ||
    typeof raw.supported !== 'boolean' ||
    !Array.isArray(raw.keys) ||
    !isRecord(raw.selection_options)
  )
    throw new Error('Invalid routing profiles response');
  const keys = raw.keys.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !entry.key)
      throw new Error('Invalid routing profiles response');
    return { key: entry.key, profile: readProfile(entry.profile) };
  });
  return {
    supported: raw.supported,
    unsupportedBackend: false,
    shared: readProfile(raw.shared),
    keys,
    selectionOptions: {
      narrowing: stringList(raw.selection_options.narrowing),
      pickers: stringList(raw.selection_options.pickers),
    },
    providersSupported: isRecord(raw.shared) && isRecord(raw.shared.providers),
    apiCredentials: readApiCredentials(raw.api_credentials),
  };
}

export const unsupportedRoutingProfiles = (): RoutingProfilesState => ({
  supported: false,
  unsupportedBackend: true,
  shared: emptyProfile(),
  keys: [],
  selectionOptions: { narrowing: [], pickers: [] },
  providersSupported: false,
  apiCredentials: { claude: [], codex: [] },
});

/**
 * Client keys from the loaded config's raw document: `access.api-keys`, or the
 * legacy top-level `api-keys` list when `access.api-keys` is absent.
 */
export function clientApiKeys(rawConfig: unknown): string[] {
  if (!isRecord(rawConfig)) return [];
  const access = isRecord(rawConfig.access) ? rawConfig.access : null;
  const list =
    access && Object.prototype.hasOwnProperty.call(access, 'api-keys')
      ? access['api-keys']
      : rawConfig['api-keys'];
  if (!Array.isArray(list)) return [];
  const keys = list.filter((key): key is string => typeof key === 'string' && key.trim() !== '');
  return [...new Set(keys)];
}

/** One row per client key in list order; profiles of keys outside the list are dropped. */
export function mergeKeyRows(apiKeys: string[], keys: KeyProfileEntry[]): KeyProfileRow[] {
  const profiles = new Map(keys.map(({ key, profile }) => [key, profile]));
  return apiKeys.map((key) => ({ key, profile: profiles.get(key) ?? null }));
}

const noSelectionOptions: RoutingSelectionOptions = { narrowing: [], pickers: [] };

/**
 * One complete profile body in kebab-case, normalized against the selection
 * options, so a PATCH merge leaves nothing from the old one: cleared providers,
 * a cleared API credential and an empty or picker-blocked tiebreak are `null`,
 * and mappings replace the list. A backend with `providers` gets the complete
 * `providers` block (API key mode carries `target: off`; the Codex fallback is its
 * target only); an older one gets the `claude-fallback` block instead.
 */
export function profileBody(
  profile: RoutingProfile,
  selectionOptions: RoutingSelectionOptions = noSelectionOptions,
  providersSupported = true
): Record<string, unknown> {
  const normalized = normalizeProfile(profile, selectionOptions);
  const body: Record<string, unknown> = {
    'session-affinity': normalized.sessionAffinity,
    'preferred-accounts': {
      claude: normalized.preferredAccounts.claude ?? null,
      codex: normalized.preferredAccounts.codex ?? null,
    },
    selection: {
      primary: normalized.selection.primary,
      tiebreak: normalized.selection.tiebreak ?? null,
    },
  };
  const { claude, codex } = normalized.providers;
  if (providersSupported) {
    body.providers = {
      claude: {
        mode: claude.mode,
        'api-credential': claude.apiCredential || null,
        fallback: {
          target: claude.fallback.target,
          mode: claude.fallback.mode,
          mappings: claude.fallback.mappings,
        },
      },
      codex: {
        mode: codex.mode,
        'api-credential': codex.apiCredential || null,
        fallback: { target: codex.fallback.target },
      },
    };
  } else {
    const fallback = claudeFallbackOf(normalized);
    body['claude-fallback'] = {
      enabled: fallback.enabled,
      mode: fallback.mode,
      mappings: fallback.mappings,
    };
  }
  return body;
}

/**
 * One complete key profile. `null` deletes the profile and returns the key to
 * the shared settings.
 */
export function keyProfilePatch(
  key: string,
  profile: RoutingProfile | null,
  selectionOptions: RoutingSelectionOptions = noSelectionOptions,
  providersSupported = true
): Record<string, unknown> {
  const body = profile ? profileBody(profile, selectionOptions, providersSupported) : null;
  return { routing: { 'key-profiles': { [key]: body } } };
}

/**
 * The shared (default) profile as top-level `routing.*` fields. The global sticky
 * TTL is sent only when passed, so an unchanged TTL stays out of the PATCH.
 */
export function sharedProfilePatch(
  profile: RoutingProfile,
  ttl: string | undefined,
  selectionOptions: RoutingSelectionOptions = noSelectionOptions,
  providersSupported = true
): Record<string, unknown> {
  const routing = profileBody(profile, selectionOptions, providersSupported);
  if (ttl !== undefined) routing['session-affinity-ttl'] = ttl.trim();
  return { routing };
}

const sameProfile = (
  a: RoutingProfile | null,
  b: RoutingProfile | null,
  options: RoutingSelectionOptions
) => (a === null || b === null ? a === b : !profileDirty(a, b, options));

/** Replace every occurrence of a raw client key in a message with `***`. */
export const scrubKey = (message: string, key: string): string =>
  key ? message.split(key).join('***') : message;

export function translateWriteError(error: unknown, key: string): unknown {
  if (!isRecord(error)) return error;
  if (error.status === 400 && error.apiCode === 'unknown_api_key') return new UnknownApiKeyError();
  if (error.status === 422 && error.apiCode === 'invalid_config') {
    const message = typeof error.message === 'string' ? error.message : '';
    return new InvalidRoutingConfigError(scrubKey(message, key));
  }
  return error;
}

export const routingProfilesApi = {
  async get(): Promise<RoutingProfilesState> {
    try {
      return readRoutingProfiles(await apiClient.get('/routing/profiles'));
    } catch (error) {
      if (isRecord(error) && error.status === 404) return unsupportedRoutingProfiles();
      throw error;
    }
  },
  /** Write one key profile, or delete it with `null`, then verify the stored value. */
  async saveKeyProfile(
    key: string,
    profile: RoutingProfile | null,
    selectionOptions: RoutingSelectionOptions = noSelectionOptions,
    providersSupported = true
  ): Promise<RoutingProfilesState> {
    const assertCurrent = guardConfigConnection();
    if (profile && !validClaudeMappings(profile.providers.claude, providersSupported))
      throw new Error('Invalid Claude fallback mappings');
    try {
      await apiClient.patch(
        '/config',
        keyProfilePatch(key, profile, selectionOptions, providersSupported)
      );
    } catch (error) {
      assertCurrent();
      throw translateWriteError(error, key);
    }
    assertCurrent();
    const saved = await routingProfilesApi.get();
    assertCurrent();
    const stored = saved.keys.find((entry) => entry.key === key)?.profile ?? null;
    if (saved.unsupportedBackend || !sameProfile(stored, profile, saved.selectionOptions))
      throw new Error('CPA did not retain the routing profile');
    return saved;
  },
  /**
   * Write the shared profile, and the global TTL when passed, in one PATCH, then
   * verify both by reading them back. The toolbar no longer writes these fields on
   * a backend that serves `/routing/profiles`, so this is their single writer.
   */
  async saveSharedProfile(
    profile: RoutingProfile,
    ttl: string | undefined,
    selectionOptions: RoutingSelectionOptions = noSelectionOptions,
    providersSupported = true
  ): Promise<RoutingProfilesState> {
    const assertCurrent = guardConfigConnection();
    if (!validClaudeMappings(profile.providers.claude, providersSupported))
      throw new Error('Invalid Claude fallback mappings');
    if (ttl !== undefined && invalidTTL(ttl)) throw new Error('Invalid session affinity TTL');
    try {
      await apiClient.patch(
        '/config',
        sharedProfilePatch(profile, ttl, selectionOptions, providersSupported)
      );
    } catch (error) {
      assertCurrent();
      throw translateWriteError(error, '');
    }
    assertCurrent();
    const saved = await routingProfilesApi.get();
    assertCurrent();
    if (saved.unsupportedBackend || !sameProfile(saved.shared, profile, saved.selectionOptions))
      throw new Error('CPA did not retain the routing profile');
    if (ttl !== undefined) {
      const config = await configApi.getConfig();
      assertCurrent();
      const stored = config.routingSessionAffinityTTL;
      if (
        stored === undefined ||
        goDurationSeconds(stored.trim()) !== goDurationSeconds(ttl.trim())
      )
        throw new Error('CPA did not retain the routing profile');
    }
    return saved;
  },
};
