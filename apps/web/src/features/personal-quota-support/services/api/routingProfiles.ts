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

export interface RoutingProfile {
  sessionAffinity: boolean;
  preferredAccounts: { claude?: string; codex?: string };
  selection: SelectionSlots;
  claudeFallback: ClaudeFallbackSettings;
}

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

const emptyProfile = (): RoutingProfile => ({
  sessionAffinity: false,
  preferredAccounts: {},
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  claudeFallback: { enabled: false, mode: 'auto', mappings: [] },
});

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
    claudeFallback: readFallbackSettings(raw['claude-fallback']),
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
  };
}

export const unsupportedRoutingProfiles = (): RoutingProfilesState => ({
  supported: false,
  unsupportedBackend: true,
  shared: emptyProfile(),
  keys: [],
  selectionOptions: { narrowing: [], pickers: [] },
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
 * options, so a PATCH merge leaves nothing from the old one: cleared providers
 * and an empty or picker-blocked tiebreak are `null`, and mappings replace the list.
 */
export function profileBody(
  profile: RoutingProfile,
  selectionOptions: RoutingSelectionOptions = noSelectionOptions
): Record<string, unknown> {
  const normalized = normalizeProfile(profile, selectionOptions);
  return {
    'session-affinity': normalized.sessionAffinity,
    'preferred-accounts': {
      claude: normalized.preferredAccounts.claude ?? null,
      codex: normalized.preferredAccounts.codex ?? null,
    },
    selection: {
      primary: normalized.selection.primary,
      tiebreak: normalized.selection.tiebreak ?? null,
    },
    'claude-fallback': {
      enabled: normalized.claudeFallback.enabled,
      mode: normalized.claudeFallback.mode,
      mappings: normalized.claudeFallback.mappings,
    },
  };
}

/**
 * One complete key profile. `null` deletes the profile and returns the key to
 * the shared settings.
 */
export function keyProfilePatch(
  key: string,
  profile: RoutingProfile | null,
  selectionOptions: RoutingSelectionOptions = noSelectionOptions
): Record<string, unknown> {
  const body = profile ? profileBody(profile, selectionOptions) : null;
  return { routing: { 'key-profiles': { [key]: body } } };
}

/**
 * The shared (default) profile as top-level `routing.*` fields. The global sticky
 * TTL is sent only when passed, so an unchanged TTL stays out of the PATCH.
 */
export function sharedProfilePatch(
  profile: RoutingProfile,
  ttl: string | undefined,
  selectionOptions: RoutingSelectionOptions = noSelectionOptions
): Record<string, unknown> {
  const routing = profileBody(profile, selectionOptions);
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
    selectionOptions: RoutingSelectionOptions = noSelectionOptions
  ): Promise<RoutingProfilesState> {
    const assertCurrent = guardConfigConnection();
    if (profile && !validFallbackSettings(profile.claudeFallback))
      throw new Error('Invalid Claude fallback mappings');
    try {
      await apiClient.patch('/config', keyProfilePatch(key, profile, selectionOptions));
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
    selectionOptions: RoutingSelectionOptions = noSelectionOptions
  ): Promise<RoutingProfilesState> {
    const assertCurrent = guardConfigConnection();
    if (!validFallbackSettings(profile.claudeFallback))
      throw new Error('Invalid Claude fallback mappings');
    if (ttl !== undefined && invalidTTL(ttl)) throw new Error('Invalid session affinity TTL');
    try {
      await apiClient.patch('/config', sharedProfilePatch(profile, ttl, selectionOptions));
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
