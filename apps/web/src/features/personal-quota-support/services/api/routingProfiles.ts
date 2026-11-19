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
/** Codex speed tier of a profile; Claude always holds `standard`. */
export type CodexSpeed = 'standard' | 'fast' | 'ultrafast';

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
  /** Codex only; Claude always reads as `standard` and never sends it. */
  speed: CodexSpeed;
  /** Codex only: ignore the service tier the client sends. Claude always reads `false`. */
  ignoreClientTier: boolean;
  /**
   * Both providers: CPA refuses this provider's requests for the profile. The other
   * fields are kept as they are, so switching the provider back on restores them.
   */
  disabled: boolean;
}

/** A change of the Codex speed and / or flag, as the speed table makes it. */
export type CodexSpeedPatch = Partial<Pick<ProviderRouting, 'speed' | 'ignoreClientTier'>>;

/** Whether a Codex block already holds every value the patch sets. */
export const holdsCodexSpeed = (codex: ProviderRouting, patch: CodexSpeedPatch): boolean =>
  (patch.speed === undefined || patch.speed === codex.speed) &&
  (patch.ignoreClientTier === undefined || patch.ignoreClientTier === codex.ignoreClientTier);

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
  /**
   * The backend serves the Codex `speed` and `ignore-client-tier` fields. `false` on
   * an older backend: the panel shows no speed controls and never sends the fields.
   */
  speedSupported: boolean;
  /**
   * The backend serves the per-provider `disabled` field. `false` on an older backend:
   * the panel locks the Enabled toggle and never sends the field.
   */
  providerToggleSupported: boolean;
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

/**
 * 412 `precondition_failed`: a conditional write named a config version (`If-Match`)
 * that is no longer stored, because the config changed after it was read. Also
 * raised when the profiles CPA has loaded do not match the stored config yet (an edit
 * of the file whose hot reload is still pending), before a copy of their Default
 * profile is written, and when the read before a key profile save finds key profiles
 * no longer served as the editor knew them (`saveKeyProfile`). Nothing that changes
 * the config is written.
 */
export class ConfigChangedError extends Error {
  constructor() {
    super('The configuration changed after it was read');
    this.name = 'ConfigChangedError';
  }
}

/**
 * The write landed and CPA retained it, but the read-back finds that CPA does not apply
 * it now: native routing became inactive (`supported: false`, which Home mode and a
 * scheduler plugin both report) after the read before the write. Unlike
 * `ConfigChangedError`, the config was changed; the stored value takes effect once
 * native routing is active again. Raised for a key profile write or reset
 * (`profile: 'key'`: CPA ignores the whole key profile then), and for a Default write
 * that sends a `disabled` (`profile: 'default'`: CPA ignores only the provider mode,
 * fallback and `disabled` of the Default profile then, and applies the rest, such as
 * the Codex speed, so a save that changed only those still applies).
 */
export class RoutingNotAppliedError extends Error {
  constructor(readonly profile: 'default' | 'key') {
    super('CPA stored the routing profile but does not apply it now');
    this.name = 'RoutingNotAppliedError';
  }
}

/**
 * The write landed and CPA retained it, but the read-back finds that CPA started serving
 * the per-provider `disabled` (an upgrade) after the read before the write, which still
 * found a backend without it. The profile was therefore written without the flags: one
 * the write created starts with both providers on, also where the Default profile has a
 * provider off. The profiles reload, so the editor starts over with the switch.
 */
export class ProviderToggleChangedError extends Error {
  constructor() {
    super('CPA started serving the provider switches during the save');
    this.name = 'ProviderToggleChangedError';
  }
}

/**
 * The config read carried no version a conditional write can name: no `ETag`, a weak
 * one (a proxy that compresses the response weakens it, and CPA compares `If-Match`
 * strongly), or a wildcard or list value CPA would match against a newer config.
 * Every backend that serves the Codex speed sends one strong tag, so something between
 * the panel and CPA changed it. Raised before any write that changes the config.
 */
export class ConfigVersionUnavailableError extends Error {
  constructor() {
    super('The configuration was read without a version');
    this.name = 'ConfigVersionUnavailableError';
  }
}

/**
 * A copy of the Default profile may have been saved for a key, but was not confirmed:
 * the write got no answer, or its read-back failed, showed another profile for the key
 * or another Default profile beside it. The key may keep its own profile. The panel
 * never deletes it again: CPA's answer names a version by a new read of the file
 * (`docs/backlog/cpa-patch-etag-names-reread-file.md`), so a delete conditional on it
 * could remove a profile another writer gave the key.
 */
export class DefaultCopyUnconfirmedError extends Error {
  constructor() {
    super('The key may keep an unchecked copy of the Default profile');
    this.name = 'DefaultCopyUnconfirmedError';
  }
}

/**
 * The profile a speed table write names, or the Default profile, keeps its Claude
 * fallback in the legacy `claude-fallback` block beside an empty
 * `providers.claude.fallback` (`dropsLegacyClaudeFallback`): CPA would drop that block
 * on the write and turn the fallback off. Raised before any write. `profile` names the
 * one to save once in the editor, which writes the fallback in the current form.
 */
export class LegacyClaudeFallbackError extends Error {
  constructor(readonly profile: 'default' | 'key') {
    super('A routing write would drop the legacy Claude fallback of this profile');
    this.name = 'LegacyClaudeFallbackError';
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
  speed: 'standard',
  ignoreClientTier: false,
  disabled: false,
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
export const CODEX_SPEEDS: readonly CodexSpeed[] = ['standard', 'fast', 'ultrafast'];
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
    // The reader is the one place that forces Claude's defaults: CPA rejects a speed
    // or the flag under Claude, so whatever the response holds there is not kept.
    speed: provider === 'codex' ? readEnum(raw.speed, CODEX_SPEEDS, 'standard') : 'standard',
    ignoreClientTier: provider === 'codex' && raw['ignore-client-tier'] === true,
    disabled: raw.disabled === true,
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
      speed: 'standard',
      ignoreClientTier: false,
      disabled: false,
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

/** The backend view always carries `speed` in the Codex block when it knows the field. */
const hasCodexSpeed = (shared: unknown): boolean =>
  isRecord(shared) &&
  isRecord(shared.providers) &&
  isRecord(shared.providers.codex) &&
  Object.prototype.hasOwnProperty.call(shared.providers.codex, 'speed');

/** The backend view always carries `disabled` in both provider blocks when it knows the field. */
const hasProviderToggle = (shared: unknown): boolean =>
  isRecord(shared) &&
  isRecord(shared.providers) &&
  (['claude', 'codex'] as const).every((provider) => {
    const block = (shared.providers as Record<string, unknown>)[provider];
    return isRecord(block) && Object.prototype.hasOwnProperty.call(block, 'disabled');
  });

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
    speedSupported: hasCodexSpeed(raw.shared),
    providerToggleSupported: hasProviderToggle(raw.shared),
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
  speedSupported: false,
  providerToggleSupported: false,
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
 * Which provider blocks of a profile write carry `disabled`. Only a backend that serves
 * it in `providers` gets the flag, and then only for a provider that is off, or that
 * `opened`, the profile the edit started from, had off, so switching it back on writes
 * an explicit `false` over the stored `true`. The editor also counts a provider off in
 * `opened` once one of its saves sent it off: a failed save may still have stored that
 * `true`. An enabled provider the edit did not
 * switch on is left out of the merge PATCH, so a save from an editor opened before
 * the provider was switched off elsewhere keeps it off. The merge keeps a left-out flag
 * only in a profile that exists, so `saveKeyProfile` fills it in for a key that owns none.
 */
export function sentDisabled(
  profile: RoutingProfile,
  opened: RoutingProfile | null,
  providersSupported: boolean,
  providerToggleSupported: boolean
): Record<ApiProvider, boolean> {
  const sends = (provider: ApiProvider) =>
    providersSupported &&
    providerToggleSupported &&
    (profile.providers[provider].disabled || opened?.providers[provider].disabled === true);
  return { claude: sends('claude'), codex: sends('codex') };
}

/** The `disabled` flags of a profile, or `null` without one. */
const disabledOf = (profile: RoutingProfile | null): Record<ApiProvider, boolean> | null =>
  profile && {
    claude: profile.providers.claude.disabled,
    codex: profile.providers.codex.disabled,
  };

/**
 * `profile` with every `disabled` that `sent` leaves out taken from `source`: the
 * stored profile's flags, for the value a write expects to read back, or the stored
 * Default's flags a key without a profile follows, for the value a write that creates
 * one must carry.
 */
function withUnsentDisabledOf(
  profile: RoutingProfile,
  source: Record<ApiProvider, boolean> | null,
  sent: Record<ApiProvider, boolean>
): RoutingProfile {
  if (!source) return profile;
  const kept = (provider: ApiProvider): ProviderRouting =>
    sent[provider]
      ? profile.providers[provider]
      : { ...profile.providers[provider], disabled: source[provider] };
  return { ...profile, providers: { claude: kept('claude'), codex: kept('codex') } };
}

/**
 * One complete profile body in kebab-case, normalized against the selection
 * options, so a PATCH merge leaves nothing from the old one: cleared providers,
 * a cleared API credential and an empty or picker-blocked tiebreak are `null`,
 * and mappings replace the list. A backend with `providers` gets the complete
 * `providers` block (API key mode carries `target: off`; the Codex fallback is its
 * target, with mode and mappings cleared); an older one gets the `claude-fallback`
 * block instead. The Codex block carries `speed` and `ignore-client-tier` only when
 * the backend serves them; the Claude block never does, because CPA rejects them there.
 * A block carries `disabled` as `sentDisabled` decides: `true` for a provider that is
 * off, an explicit `false` for one the edit from `opened` switched back on, and
 * nothing otherwise, so the merge keeps the stored flag.
 */
export function profileBody(
  profile: RoutingProfile,
  selectionOptions: RoutingSelectionOptions = noSelectionOptions,
  providersSupported = true,
  speedSupported = false,
  providerToggleSupported = false,
  opened: RoutingProfile | null = null
): Record<string, unknown> {
  const normalized = normalizeProfile(profile, selectionOptions);
  const sent = sentDisabled(normalized, opened, providersSupported, providerToggleSupported);
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
        ...(sent.claude ? { disabled: claude.disabled } : {}),
      },
      codex: {
        mode: codex.mode,
        'api-credential': codex.apiCredential || null,
        // CPA accepts any stored mode and mapping rows under target api but checks
        // them under off, so they are cleared rather than left to the merge.
        fallback: { target: codex.fallback.target, mode: null, mappings: null },
        ...(speedSupported
          ? { speed: codex.speed, 'ignore-client-tier': codex.ignoreClientTier }
          : {}),
        ...(sent.codex ? { disabled: codex.disabled } : {}),
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
  providersSupported = true,
  speedSupported = false,
  providerToggleSupported = false,
  opened: RoutingProfile | null = null
): Record<string, unknown> {
  const body = profile
    ? profileBody(
        profile,
        selectionOptions,
        providersSupported,
        speedSupported,
        providerToggleSupported,
        opened
      )
    : null;
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
  providersSupported = true,
  speedSupported = false,
  providerToggleSupported = false,
  opened: RoutingProfile | null = null
): Record<string, unknown> {
  const routing = profileBody(
    profile,
    selectionOptions,
    providersSupported,
    speedSupported,
    providerToggleSupported,
    opened
  );
  if (ttl !== undefined) routing['session-affinity-ttl'] = ttl.trim();
  return { routing };
}

/** The `providers` fragment that sets only the Codex fields a patch names. */
function codexSpeedProviders(patch: CodexSpeedPatch): Record<string, unknown> {
  const codex: Record<string, unknown> = {};
  if (patch.speed !== undefined) codex.speed = patch.speed;
  if (patch.ignoreClientTier !== undefined) codex['ignore-client-tier'] = patch.ignoreClientTier;
  return { codex };
}

/**
 * Only the Codex speed and / or flag of the shared profile. PATCH merges objects, so
 * the rest of the stored profile, including a change made elsewhere, stays as it is.
 */
export function sharedCodexSpeedPatch(patch: CodexSpeedPatch): Record<string, unknown> {
  return { routing: { providers: codexSpeedProviders(patch) } };
}

/**
 * Only the Codex speed and / or flag of one key profile, merged into the stored one.
 * Send it only conditional on a config version in which the key owns a profile
 * (`saveKeyCodexSpeed`): for a key without one the same body would create a profile
 * that holds only these fields.
 */
export function keyCodexSpeedPatch(key: string, patch: CodexSpeedPatch): Record<string, unknown> {
  return { routing: { 'key-profiles': { [key]: { providers: codexSpeedProviders(patch) } } } };
}

/**
 * The stored config as a conditional key write needs it: its version, the client keys
 * and the keys that own a profile in that same version. All describe the file on disk,
 * while `/routing/profiles` serves the config CPA has loaded, which follows an edit of
 * the file only after the hot reload.
 */
export interface ConfigSnapshot {
  /** The config's strong ETag, or `''` when the response carries none or a weak one. */
  version: string;
  /** The client keys (`clientApiKeys`); a key outside them was deleted. */
  clientKeys: ReadonlySet<string>;
  /** Keys with a profile under `routing.key-profiles`; a `null` entry owns none. */
  profiledKeys: ReadonlySet<string>;
  /**
   * The profiles a routing write would strip of their Claude fallback
   * (`dropsLegacyClaudeFallback`): `shared` for the Default profile, and the keys.
   */
  legacyClaudeFallback: { shared: boolean; keys: ReadonlySet<string> };
  /** The Default profile's `disabled` per provider (`sharedDisabledOf`). */
  sharedDisabled: Record<ApiProvider, boolean>;
}

/** The strings CPA's typed YAML decoder (yaml.v3) reads as a `true` bool, quoted or not. */
const YAML_TRUE_STRINGS: ReadonlySet<string> = new Set([
  'y',
  'Y',
  'yes',
  'Yes',
  'YES',
  'on',
  'On',
  'ON',
]);

/**
 * Whether CPA reads a raw `GET /config` value as a `true` bool. `GET /config` decodes
 * the file without types, so a YAML 1.1 spelling such as `yes` or `on`, which CPA's
 * typed load still reads as `true`, arrives as that string. Any other value that is not
 * a bool fails CPA's typed load, so CPA refuses a PATCH over it (422) and writes nothing.
 */
export const yamlTrue = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && YAML_TRUE_STRINGS.has(value));

/**
 * The Default profile's `disabled` per provider in a `GET /config` document:
 * `routing.providers.<provider>.disabled`, `false` when absent, as CPA reads it
 * (`yamlTrue`).
 */
export function sharedDisabledOf(rawConfig: unknown): Record<ApiProvider, boolean> {
  const routing = isRecord(rawConfig) ? rawConfig.routing : undefined;
  const providers = isRecord(routing) ? routing.providers : undefined;
  const disabled = (provider: ApiProvider) => {
    const block = isRecord(providers) ? providers[provider] : undefined;
    return isRecord(block) && yamlTrue(block.disabled);
  };
  return { claude: disabled('claude'), codex: disabled('codex') };
}

const blank = (value: unknown) =>
  value === undefined || value === null || value === '' || value === false;

/** CPA's `IsZero` of a raw fallback block: neither `flag` nor `mode` nor mappings set. */
const unsetFallback = (value: unknown, flag: 'target' | 'enabled'): boolean =>
  !isRecord(value) ||
  (blank(value[flag]) &&
    blank(value.mode) &&
    !(Array.isArray(value.mappings) && value.mappings.length > 0));

/**
 * Whether a raw profile of a `GET /config` document keeps its Claude fallback in the
 * legacy `claude-fallback` block next to a `providers.claude.fallback` that sets
 * nothing. CPA reads that fallback from the legacy block (`effectiveProviders`), but
 * every write that names the profile, the shared one on any `routing` write, deletes
 * the legacy block because the providers node exists (backend
 * `routing_providers_write.go`, `mergeLegacyClaudeFallbackProfile`), and the fallback
 * turns off. A write of the whole profile sends the effective fallback and keeps it; a
 * write of the Codex speed alone cannot, so the speed table refuses it.
 */
export function dropsLegacyClaudeFallback(profile: unknown): boolean {
  if (!isRecord(profile)) return false;
  const claude = isRecord(profile.providers) ? profile.providers.claude : undefined;
  return (
    isRecord(claude) &&
    'fallback' in claude &&
    unsetFallback(claude.fallback, 'target') &&
    !unsetFallback(profile['claude-fallback'], 'enabled')
  );
}

/** The profiles of a `GET /config` document that `dropsLegacyClaudeFallback`. */
export function legacyClaudeFallbackOf(rawConfig: unknown): ConfigSnapshot['legacyClaudeFallback'] {
  const routing = isRecord(rawConfig) ? rawConfig.routing : undefined;
  const profiles = isRecord(routing) ? routing['key-profiles'] : undefined;
  return {
    shared: dropsLegacyClaudeFallback(routing),
    keys: new Set(
      isRecord(profiles)
        ? Object.keys(profiles).filter((key) => dropsLegacyClaudeFallback(profiles[key]))
        : []
    ),
  };
}

/**
 * A version a conditional write can name: exactly one strong entity tag, as CPA sends
 * it. Anything else is no version: a missing value; a weak tag (CPA never matches
 * one); `*`, which CPA's `If-Match` matches against any version; or a list, whose
 * every tag CPA would accept.
 */
export function strongETag(value: unknown): string {
  return typeof value === 'string' && /^"[^"]+"$/.test(value) ? value : '';
}

/** Keys that own a profile in a `GET /config` document. */
export function profiledKeysOf(rawConfig: unknown): Set<string> {
  const routing = isRecord(rawConfig) ? rawConfig.routing : undefined;
  const profiles = isRecord(routing) ? routing['key-profiles'] : undefined;
  if (!isRecord(profiles)) return new Set();
  return new Set(Object.keys(profiles).filter((key) => isRecord(profiles[key])));
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
  if (error.status === 412) return new ConfigChangedError();
  if (error.status === 422 && error.apiCode === 'invalid_config') {
    const message = typeof error.message === 'string' ? error.message : '';
    return new InvalidRoutingConfigError(scrubKey(message, key));
  }
  return error;
}

/**
 * Whether a write failed in a way that does not prove CPA refused it, so CPA may have
 * saved it: no HTTP status (a timeout or a dropped connection); a gateway's 502 / 504,
 * which a proxy in front of CPA sends when CPA's answer did not reach it; or CPA's own
 * 500 `write_failed`, which CPA also sends when every byte reached the file and only the
 * sync or close failed, so the hot reload can still load it. Any other status, such as
 * 412 or 422, is CPA's refusal before it wrote.
 */
function unanswered(error: unknown): boolean {
  const status = isRecord(error) ? error.status : undefined;
  if (status === 500) return isRecord(error) && error.apiCode === 'write_failed';
  return status === undefined || status === 502 || status === 504;
}

/**
 * Errors of an editor save (`saveKeyProfile`, `saveSharedProfile`) that stored nothing:
 * raised before its PATCH was sent, or CPA's answer refused the PATCH (not
 * `unanswered`). Any other failure may follow a write that landed: the PATCH got no
 * answer, or the read after it failed or did not confirm it.
 */
const unwrittenErrors = new WeakSet<object>();

function unwritten(error: unknown): unknown {
  if (typeof error === 'object' && error !== null) unwrittenErrors.add(error);
  return error;
}

/** Whether a failed editor save stored nothing in CPA (`unwrittenErrors`). */
export const wroteNothing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && unwrittenErrors.has(error);

/** `prepare`, the part of an editor save before its PATCH: its errors stored nothing. */
async function beforeWrite<T>(prepare: () => Promise<T>): Promise<T> {
  try {
    return await prepare();
  } catch (error) {
    throw unwritten(error);
  }
}

/** A failed editor save PATCH: stored nothing only when CPA's answer refused it. */
function failedWrite(error: unknown, key: string): unknown {
  const translated = translateWriteError(error, key);
  return unanswered(error) ? translated : unwritten(translated);
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
  /**
   * The stored config's version, its client keys and the keys that own a profile in it,
   * from one read. A write that names the version in `If-Match` fails with
   * `ConfigChangedError` once anything in the config changed after this read. Only a
   * single strong ETag is a version (`strongETag`): CPA never matches a weak one, and
   * `*` or a list would let the write through over a newer config.
   */
  async configSnapshot(): Promise<ConfigSnapshot> {
    const response = await apiClient.getRaw('/config');
    return {
      version: strongETag(response.headers?.etag),
      clientKeys: new Set(clientApiKeys(response.data)),
      profiledKeys: profiledKeysOf(response.data),
      legacyClaudeFallback: legacyClaudeFallbackOf(response.data),
      sharedDisabled: sharedDisabledOf(response.data),
    };
  },
  /**
   * Write one key profile, or delete it with `null`, then verify the stored value.
   * `opened` is the profile the edit started from: only a provider it had off gets an
   * explicit `disabled: false` (`sentDisabled`); a flag left out keeps the stored one,
   * also in the read-back check. The merge keeps it only in a profile that exists, and
   * one the PATCH creates starts with the provider on, so the stored config is read
   * first (`configSnapshot`), the file the PATCH merges into: `/routing/profiles` serves
   * the config CPA has loaded, which follows an edit of the file only after the hot
   * reload. When the key owns no profile there (it never had one, or it was reset after
   * the editor opened), it follows the Default profile, and a left-out flag is sent as
   * that Default holds it. The PATCH is then conditional on that read's version, so a
   * change landing in between fails with `ConfigChangedError` instead; a stale editor
   * therefore cannot switch on a provider the Default switched off after it opened.
   * Without a version (no strong ETag) the PATCH is sent unconditionally, as every
   * other editor save is. Every save, also a reset or one that needs no snapshot, reads
   * `/routing/profiles` first and writes nothing (`ConfigChangedError`) when CPA no
   * longer uses key profiles (a backend without the route, or Home mode or a scheduler
   * plugin owning routing): a write CPA would not apply now waits unseen and takes effect later. A
   * takeover after that read is found by the read-back, which then reports the stored
   * write as not applied (`RoutingNotAppliedError`) rather than as saved. A
   * profile write also writes nothing when the backend's switch differs from the one
   * `providerToggleSupported` says the editor saw: a backend that gained `disabled`
   * after the editor opened would create a profile without the Default's flags, and one
   * that lost it would be sent flags it does not enforce. An upgrade that adds the
   * switch after that read is found by the read-back too: a profile written without the
   * flags is reported as `ProviderToggleChangedError` rather than as saved. A failure
   * that stored nothing is marked for `wroteNothing`.
   */
  async saveKeyProfile(
    key: string,
    profile: RoutingProfile | null,
    selectionOptions: RoutingSelectionOptions = noSelectionOptions,
    providersSupported = true,
    speedSupported = false,
    providerToggleSupported = false,
    opened: RoutingProfile | null = null
  ): Promise<RoutingProfilesState> {
    const assertCurrent = guardConfigConnection();
    // Whether this write carries `disabled`, as the editor's capabilities decide.
    const toggles = providersSupported && providerToggleSupported;
    const { written, ifMatch } = await beforeWrite(async () => {
      if (profile && !validClaudeMappings(profile.providers.claude, providersSupported))
        throw new Error('Invalid Claude fallback mappings');
      const sent =
        profile && sentDisabled(profile, opened, providersSupported, providerToggleSupported);
      // Only a block without the flag follows what the file holds.
      const leavesFlagOut = toggles && sent !== null && !(sent.claude && sent.codex);
      const [loaded, file] = await Promise.all([
        routingProfilesApi.get(),
        leavesFlagOut ? routingProfilesApi.configSnapshot() : null,
      ]);
      assertCurrent();
      // Key profiles must still be used, also by a reset. A profile is built for the
      // switch as the editor saw it: one built without it would start a new profile with
      // both providers on, and one built with it would store flags CPA no longer serves.
      if (
        loaded.unsupportedBackend ||
        !loaded.supported ||
        (profile !== null && loaded.providerToggleSupported !== toggles)
      )
        throw new ConfigChangedError();
      if (!profile || !sent || !file) return { written: profile, ifMatch: '' };
      return {
        written: file.profiledKeys.has(key)
          ? profile
          : withUnsentDisabledOf(profile, file.sharedDisabled, sent),
        ifMatch: file.version,
      };
    });
    const body = keyProfilePatch(
      key,
      written,
      selectionOptions,
      providersSupported,
      speedSupported,
      providerToggleSupported,
      opened
    );
    try {
      await (ifMatch
        ? apiClient.patch('/config', body, { headers: { 'If-Match': ifMatch } })
        : apiClient.patch('/config', body));
    } catch (error) {
      assertCurrent();
      throw failedWrite(error, key);
    }
    assertCurrent();
    const saved = await routingProfilesApi.get();
    assertCurrent();
    const stored = saved.keys.find((entry) => entry.key === key)?.profile ?? null;
    const expected =
      written &&
      withUnsentDisabledOf(
        written,
        disabledOf(stored),
        sentDisabled(written, opened, providersSupported, providerToggleSupported)
      );
    if (saved.unsupportedBackend || !sameProfile(stored, expected, saved.selectionOptions))
      throw new Error('CPA did not retain the routing profile');
    // Stored, but native routing became inactive after the check before the write.
    if (!saved.supported) throw new RoutingNotAppliedError('key');
    // Stored without the flags, but CPA serves them now: a profile the write created
    // starts with both providers on, whatever the Default holds.
    if (profile !== null && !toggles && saved.providerToggleSupported)
      throw new ProviderToggleChangedError();
    return saved;
  },
  /**
   * Give a key that owns no profile `profile`, a copy of the Default profile of `from`
   * with the Codex speed changed, conditional on `ifMatch`: a `configSnapshot` version in
   * which the key owns no profile.
   *
   * `from` is the `/routing/profiles` read the copy was built from. That route serves the
   * config CPA has loaded, which follows an edit of the file only after the hot reload,
   * so its Default profile can be older than the version `ifMatch` names, also when one
   * edit both adds the key and changes the Default. Written as is, such a copy would
   * route the key's requests by a Default it never had. So the copy is checked first: a
   * PATCH that changes nothing, conditional on `ifMatch`, makes CPA load that version
   * (CPA ignores a reload parsed from an older file), and the Default profile read after
   * it must be the one copied, with the key still owning no profile and key profiles
   * still used (`supported`) and carrying the speed (`speedSupported`); otherwise nothing
   * but that empty write is made (`ConfigChangedError`). The copy is then written
   * conditional on the version the empty write produced, so it lands only in a config
   * whose Default is the one it copies.
   *
   * The copy is read back like `saveKeyProfile`, and the Default profile beside it must
   * still be the one copied. CPA answers a write with the version of a new read of the
   * file, so an edit of the file made right after CPA wrote it can carry the empty
   * write's version and let the copy land beside another Default; the read-back sees
   * that Default. When the read-back fails or shows another profile for the key or
   * another Default, or the write failed without proof that CPA refused it
   * (`unanswered`: no answer, a gateway error or CPA's `write_failed`),
   * `DefaultCopyUnconfirmedError` says that the key may keep a copy. Nothing is
   * deleted: the version a delete could name comes from the same new read, so it can
   * name another writer's file and remove the profile that writer gave the key.
   */
  async saveKeyDefaultCopy(
    key: string,
    profile: RoutingProfile,
    from: RoutingProfilesState,
    ifMatch: string
  ): Promise<RoutingProfilesState> {
    if (!ifMatch) throw new Error('A key speed write needs a config version');
    const assertCurrent = guardConfigConnection();
    const { selectionOptions, providersSupported, speedSupported, providerToggleSupported } = from;
    if (!validClaudeMappings(profile.providers.claude, providersSupported))
      throw new Error('Invalid Claude fallback mappings');
    let checked = '';
    try {
      const response = await apiClient.patchRaw(
        '/config',
        {},
        { headers: { 'If-Match': ifMatch } }
      );
      checked = strongETag(response.headers?.etag);
    } catch (error) {
      assertCurrent();
      throw translateWriteError(error, key);
    }
    assertCurrent();
    if (!checked) throw new ConfigVersionUnavailableError();
    const loaded = await routingProfilesApi.get();
    assertCurrent();
    // Key profiles must still be used and carry the speed: a copy written while a
    // scheduler plugin owns routing would wait unseen and take effect once it is removed.
    if (
      loaded.unsupportedBackend ||
      !loaded.supported ||
      !loaded.speedSupported ||
      loaded.keys.some((entry) => entry.key === key) ||
      !sameProfile(loaded.shared, from.shared, loaded.selectionOptions)
    )
      throw new ConfigChangedError();
    try {
      await apiClient.patch(
        '/config',
        keyProfilePatch(
          key,
          profile,
          selectionOptions,
          providersSupported,
          speedSupported,
          providerToggleSupported
        ),
        { headers: { 'If-Match': checked } }
      );
    } catch (error) {
      assertCurrent();
      if (unanswered(error)) throw new DefaultCopyUnconfirmedError();
      throw translateWriteError(error, key);
    }
    assertCurrent();
    let saved: RoutingProfilesState;
    try {
      saved = await routingProfilesApi.get();
    } catch {
      assertCurrent();
      throw new DefaultCopyUnconfirmedError();
    }
    assertCurrent();
    const stored = saved.keys.find((entry) => entry.key === key)?.profile ?? null;
    if (
      saved.unsupportedBackend ||
      !sameProfile(stored, profile, saved.selectionOptions) ||
      !sameProfile(saved.shared, from.shared, saved.selectionOptions)
    )
      throw new DefaultCopyUnconfirmedError();
    return saved;
  },
  /**
   * Write the shared profile, and the global TTL when passed, in one PATCH, then
   * verify both by reading them back. The toolbar no longer writes these fields on
   * a backend that serves `/routing/profiles`, so this is their single writer.
   * `opened` decides which `disabled` flags are sent, as in `saveKeyProfile`. A save
   * that sends a flag reads `/routing/profiles` first and writes nothing
   * (`ConfigChangedError`) when CPA no longer enforces it: a backend without the route
   * or the field, or Home mode or a scheduler plugin owning routing. Its read-back
   * reports a flag stored after a takeover that followed that read as not applied
   * (`RoutingNotAppliedError`). A save without a flag needs no check: the merge keeps
   * the stored flags. A failure that stored nothing is marked for `wroteNothing`.
   */
  async saveSharedProfile(
    profile: RoutingProfile,
    ttl: string | undefined,
    selectionOptions: RoutingSelectionOptions = noSelectionOptions,
    providersSupported = true,
    speedSupported = false,
    providerToggleSupported = false,
    opened: RoutingProfile | null = null
  ): Promise<RoutingProfilesState> {
    const assertCurrent = guardConfigConnection();
    const sent = sentDisabled(profile, opened, providersSupported, providerToggleSupported);
    await beforeWrite(async () => {
      if (!validClaudeMappings(profile.providers.claude, providersSupported))
        throw new Error('Invalid Claude fallback mappings');
      if (ttl !== undefined && invalidTTL(ttl)) throw new Error('Invalid session affinity TTL');
      // A flag is stored only where CPA enforces it now: after a scheduler plugin took
      // over routing, or on a backend that dropped the field, nothing is written.
      if (sent.claude || sent.codex) {
        const loaded = await routingProfilesApi.get();
        assertCurrent();
        if (loaded.unsupportedBackend || !loaded.supported || !loaded.providerToggleSupported)
          throw new ConfigChangedError();
      }
    });
    try {
      await apiClient.patch(
        '/config',
        sharedProfilePatch(
          profile,
          ttl,
          selectionOptions,
          providersSupported,
          speedSupported,
          providerToggleSupported,
          opened
        )
      );
    } catch (error) {
      assertCurrent();
      throw failedWrite(error, '');
    }
    assertCurrent();
    const saved = await routingProfilesApi.get();
    assertCurrent();
    const expected = withUnsentDisabledOf(profile, disabledOf(saved.shared), sent);
    if (saved.unsupportedBackend || !sameProfile(saved.shared, expected, saved.selectionOptions))
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
    // A flag stored after native routing became inactive, once the check above passed.
    if ((sent.claude || sent.codex) && !saved.supported)
      throw new RoutingNotAppliedError('default');
    return saved;
  },
  /**
   * Write only the Codex speed and / or flag of the shared profile, then verify those
   * fields by reading them back. Call only on a backend that serves `speed`. The rest
   * of the profile is neither sent nor compared, so a change made elsewhere meanwhile
   * is kept and does not fail the check.
   */
  saveSharedCodexSpeed(patch: CodexSpeedPatch): Promise<RoutingProfilesState> {
    return saveCodexSpeedFields(
      sharedCodexSpeedPatch(patch),
      '',
      '',
      patch,
      (saved) => saved.shared.providers.codex
    );
  },
  /**
   * Write only the Codex speed and / or flag of a key's own profile, then verify those
   * fields by reading them back, like `saveSharedCodexSpeed`. `ifMatch` must be a
   * `configSnapshot` version in which the key owns a profile: the PATCH merges into that
   * profile, and once the config changed after that version CPA refuses it
   * (`ConfigChangedError`), so the write can never create a profile holding only these
   * fields. No other field is sent, so none can carry a stale value.
   */
  saveKeyCodexSpeed(
    key: string,
    patch: CodexSpeedPatch,
    ifMatch: string
  ): Promise<RoutingProfilesState> {
    if (!ifMatch) return Promise.reject(new Error('A key speed write needs a config version'));
    return saveCodexSpeedFields(
      keyCodexSpeedPatch(key, patch),
      key,
      ifMatch,
      patch,
      (saved) => saved.keys.find((entry) => entry.key === key)?.profile.providers.codex ?? null
    );
  },
};

/** One merge-PATCH of Codex speed fields and the read-back check of those fields alone. */
async function saveCodexSpeedFields(
  body: Record<string, unknown>,
  key: string,
  ifMatch: string,
  patch: CodexSpeedPatch,
  storedCodex: (saved: RoutingProfilesState) => ProviderRouting | null
): Promise<RoutingProfilesState> {
  const assertCurrent = guardConfigConnection();
  try {
    await (ifMatch
      ? apiClient.patch('/config', body, { headers: { 'If-Match': ifMatch } })
      : apiClient.patch('/config', body));
  } catch (error) {
    assertCurrent();
    throw translateWriteError(error, key);
  }
  assertCurrent();
  const saved = await routingProfilesApi.get();
  assertCurrent();
  const codex = saved.unsupportedBackend || !saved.speedSupported ? null : storedCodex(saved);
  if (!codex || !holdsCodexSpeed(codex, patch))
    throw new Error('CPA did not retain the routing profile');
  return saved;
}
