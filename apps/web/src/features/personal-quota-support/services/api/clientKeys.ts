import { usageServiceApi, type ApiKeyAlias } from '@/services/api/usageService';
import { sha256Hex } from '@/utils/apiKeyHash';
import { isValidApiKeyCharset } from '@/utils/validation';
import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import {
  clientApiKeys,
  scrubKey,
  translateWriteError,
  UnknownApiKeyError,
} from './routingProfiles';

/**
 * Alias state of the panel, as the caller's `useApiKeyAliases` instance sees it.
 * `aliasStateKnown` is false while the host check runs, while the host is
 * unconfirmed, or when the panel is manager-hosted and the alias list did not
 * load. `serviceBase` is '' when the panel has no alias service.
 */
export interface ClientKeyAliasContext {
  serviceBase: string;
  managementKey?: string;
  aliases: ApiKeyAlias[];
  aliasStateKnown: boolean;
}

export class InvalidClientKeyError extends Error {
  constructor() {
    super('The client key may contain only visible ASCII characters');
    this.name = 'InvalidClientKeyError';
  }
}

export class DuplicateClientKeyError extends Error {
  constructor() {
    super('The client key is already in the configuration');
    this.name = 'DuplicateClientKeyError';
  }
}

export class LastClientKeyError extends Error {
  constructor() {
    super('The last client key cannot be removed');
    this.name = 'LastClientKeyError';
  }
}

export class InvalidAliasError extends Error {
  constructor(readonly reason: 'empty' | 'too_long') {
    super(reason === 'empty' ? 'The alias is empty' : 'The alias is longer than 120 characters');
    this.name = 'InvalidAliasError';
  }
}

export class DuplicateAliasError extends Error {
  constructor() {
    super('Another client key already uses this alias');
    this.name = 'DuplicateAliasError';
  }
}

/** The alias service state is unknown, so a key change could orphan or lose an alias. */
export class AliasStateUnknownError extends Error {
  constructor() {
    super('The alias state is unknown');
    this.name = 'AliasStateUnknownError';
  }
}

/** The key was written; only its alias save or delete failed. */
export class AliasWriteError extends Error {
  constructor(message: string) {
    super(message || 'The alias could not be saved');
    this.name = 'AliasWriteError';
  }
}

export interface AddClientKeyResult {
  aliasError?: Error;
  /** The alias list returned by a successful alias save. */
  aliases?: ApiKeyAlias[];
}

export interface RemoveClientKeyResult {
  aliasError?: Error;
  /** The hash whose alias the service deleted. */
  removedAliasHash?: string;
}

const MAX_ALIAS_LENGTH = 120;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const keyHash = (key: string) => sha256Hex(key).toLowerCase();
const normalizeAlias = (alias: string) => alias.trim().toLowerCase();

type KeyListPath = 'access' | 'legacy';

/** The client key list of a fresh config, and where it was found. */
async function readClientKeys(): Promise<{ keys: string[]; path: KeyListPath }> {
  const raw = await apiClient.get('/config');
  const access = isRecord(raw) && isRecord(raw.access) ? raw.access : null;
  const inAccess = !!access && Object.prototype.hasOwnProperty.call(access, 'api-keys');
  const legacy = !inAccess && isRecord(raw) && Array.isArray(raw['api-keys']);
  return { keys: clientApiKeys(raw), path: legacy ? 'legacy' : 'access' };
}

const keyListPatch = (keys: string[], path: KeyListPath) =>
  path === 'legacy' ? { 'api-keys': keys } : { access: { 'api-keys': keys } };

/** Map a key-list write error and keep the raw key out of every message. */
function translateKeyWriteError(error: unknown, key: string): unknown {
  const translated = translateWriteError(error, key);
  if (translated instanceof Error && translated.message.includes(key)) {
    translated.message = scrubKey(translated.message, key);
  }
  return translated;
}

const aliasErrorFrom = (error: unknown, key: string) =>
  new AliasWriteError(scrubKey(error instanceof Error ? error.message : String(error), key));

function validateAlias(
  alias: string,
  currentHash: string,
  activeHashes: string[],
  ctx: ClientKeyAliasContext
) {
  if (!alias) throw new InvalidAliasError('empty');
  if (Array.from(alias).length > MAX_ALIAS_LENGTH) throw new InvalidAliasError('too_long');
  const active = new Set(activeHashes);
  const wanted = normalizeAlias(alias);
  const taken = ctx.aliases.some((item) => {
    const hash = String(item.apiKeyHash || '')
      .trim()
      .toLowerCase();
    return (
      hash !== currentHash &&
      active.has(hash) &&
      normalizeAlias(String(item.alias || '')) === wanted
    );
  });
  if (taken) throw new DuplicateAliasError();
}

async function patchKeyList(
  keys: string[],
  path: KeyListPath,
  key: string,
  assertCurrent: () => void
) {
  assertCurrent();
  try {
    await apiClient.patch('/config', keyListPatch(keys, path));
  } catch (error) {
    assertCurrent();
    throw translateKeyWriteError(error, key);
  }
  assertCurrent();
}

export const clientKeysApi = {
  /**
   * Add a client key to the configured list, then save its optional alias.
   * The key travels only in the PATCH body. Once the key is written an alias
   * failure is returned, never thrown, so the caller does not retry the key.
   */
  async addClientKey(
    rawKey: string,
    alias?: string,
    aliasContext?: ClientKeyAliasContext
  ): Promise<AddClientKeyResult> {
    const key = rawKey.trim();
    if (!isValidApiKeyCharset(key)) throw new InvalidClientKeyError();
    const assertCurrent = guardConfigConnection();
    const { keys, path } = await readClientKeys();
    assertCurrent();
    if (keys.some((entry) => entry.trim() === key)) throw new DuplicateClientKeyError();

    const nextKeys = [...keys, key];
    const hash = keyHash(key);
    const activeHashes = [...new Set(nextKeys.map(keyHash).filter(Boolean))];
    const trimmedAlias = alias === undefined ? undefined : alias.trim();
    if (trimmedAlias !== undefined) {
      if (!aliasContext?.serviceBase || !aliasContext.aliasStateKnown)
        throw new AliasStateUnknownError();
      validateAlias(trimmedAlias, hash, activeHashes, aliasContext);
    }

    await patchKeyList(nextKeys, path, key, assertCurrent);
    if (trimmedAlias === undefined || !aliasContext) return {};
    try {
      const response = await usageServiceApi.saveApiKeyAliases(
        aliasContext.serviceBase,
        [{ apiKeyHash: hash, alias: trimmedAlias }],
        aliasContext.managementKey,
        activeHashes
      );
      return { aliases: response.items };
    } catch (error) {
      return { aliasError: aliasErrorFrom(error, key) };
    }
  },

  /**
   * Remove every entry equal to the trimmed key, then delete its alias. The
   * backend drops the key's routing profile with it. No URL carries the key.
   */
  async removeClientKey(
    rawKey: string,
    aliasContext?: ClientKeyAliasContext
  ): Promise<RemoveClientKeyResult> {
    const key = rawKey.trim();
    const assertCurrent = guardConfigConnection();
    const { keys, path } = await readClientKeys();
    assertCurrent();
    const nextKeys = keys.filter((entry) => entry.trim() !== key);
    if (!key || nextKeys.length === keys.length) throw new UnknownApiKeyError();
    if (nextKeys.length === 0) throw new LastClientKeyError();
    if (aliasContext && !aliasContext.aliasStateKnown) throw new AliasStateUnknownError();

    await patchKeyList(nextKeys, path, key, assertCurrent);
    const hash = keyHash(key);
    const hasAlias =
      !!aliasContext?.serviceBase &&
      aliasContext.aliases.some(
        (item) =>
          String(item.apiKeyHash || '')
            .trim()
            .toLowerCase() === hash
      );
    if (!aliasContext || !hasAlias) return {};
    try {
      await usageServiceApi.deleteApiKeyAlias(
        aliasContext.serviceBase,
        hash,
        aliasContext.managementKey
      );
      return { removedAliasHash: hash };
    } catch (error) {
      return { aliasError: aliasErrorFrom(error, key) };
    }
  },
};
