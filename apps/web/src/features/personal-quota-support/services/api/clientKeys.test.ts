import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  saveAliases: vi.fn(),
  deleteAlias: vi.fn(),
  revision: 0,
}));
vi.mock('./client', () => ({
  apiClient: {
    get: mocks.get,
    patch: mocks.patch,
    getConnectionRevision: () => mocks.revision,
  },
}));
vi.mock('@/services/api/usageService', () => ({
  usageServiceApi: {
    saveApiKeyAliases: mocks.saveAliases,
    deleteApiKeyAlias: mocks.deleteAlias,
  },
}));
import { sha256Hex } from '@/utils/apiKeyHash';
import {
  AliasStateUnknownError,
  AliasWriteError,
  clientKeysApi,
  DuplicateAliasError,
  DuplicateClientKeyError,
  InvalidAliasError,
  InvalidClientKeyError,
  LastClientKeyError,
  type ClientKeyAliasContext,
} from './clientKeys';
import { InvalidRoutingConfigError, UnknownApiKeyError } from './routingProfiles';

const KEY_A = 'sk-client-secret-a';
const KEY_B = 'sk-client-secret-b';
const NEW_KEY = 'sk-client-secret-new';
const hash = (key: string) => sha256Hex(key).toLowerCase();
const BASE = 'http://manager.local';

const accessConfig = (keys: unknown[] = [KEY_A, KEY_B]) => ({ access: { 'api-keys': keys } });
const legacyConfig = (keys: unknown[] = [KEY_A, KEY_B]) => ({ 'api-keys': keys });
const ctx = (overrides: Partial<ClientKeyAliasContext> = {}): ClientKeyAliasContext => ({
  serviceBase: BASE,
  managementKey: 'mgmt',
  aliases: [],
  aliasStateKnown: true,
  ...overrides,
});

const allRequestUrls = () => [
  ...mocks.get.mock.calls.map(([url]) => String(url)),
  ...mocks.patch.mock.calls.map(([url]) => String(url)),
  ...mocks.saveAliases.mock.calls.map(([base]) => String(base)),
  ...mocks.deleteAlias.mock.calls.map(([base, aliasHash]) => `${base}/${aliasHash}`),
];

describe('clientKeysApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revision = 0;
    mocks.patch.mockResolvedValue({});
    mocks.saveAliases.mockResolvedValue({ items: [] });
  });

  describe('addClientKey', () => {
    it('writes the full list to access.api-keys', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      await expect(clientKeysApi.addClientKey(`  ${NEW_KEY} `)).resolves.toEqual({});
      expect(mocks.get).toHaveBeenCalledWith('/config');
      expect(mocks.patch).toHaveBeenCalledTimes(1);
      expect(mocks.patch).toHaveBeenCalledWith('/config', {
        access: { 'api-keys': [KEY_A, KEY_B, NEW_KEY] },
      });
      expect(mocks.saveAliases).not.toHaveBeenCalled();
    });

    it('writes the legacy top-level list where it was found', async () => {
      mocks.get.mockResolvedValue(legacyConfig());
      await clientKeysApi.addClientKey(NEW_KEY);
      expect(mocks.patch).toHaveBeenCalledWith('/config', {
        'api-keys': [KEY_A, KEY_B, NEW_KEY],
      });
    });

    it('starts access.api-keys when the config has no key list', async () => {
      mocks.get.mockResolvedValue({});
      await clientKeysApi.addClientKey(NEW_KEY);
      expect(mocks.patch).toHaveBeenCalledWith('/config', { access: { 'api-keys': [NEW_KEY] } });
    });

    it('rejects a key outside the visible ASCII charset before any request', async () => {
      await expect(clientKeysApi.addClientKey('sk bad')).rejects.toBeInstanceOf(
        InvalidClientKeyError
      );
      await expect(clientKeysApi.addClientKey('   ')).rejects.toBeInstanceOf(InvalidClientKeyError);
      await expect(clientKeysApi.addClientKey('ключ')).rejects.toBeInstanceOf(
        InvalidClientKeyError
      );
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('rejects a duplicate, including an untrimmed stored entry', async () => {
      mocks.get.mockResolvedValue(accessConfig([` ${KEY_A}  `, KEY_B]));
      await expect(clientKeysApi.addClientKey(KEY_A)).rejects.toBeInstanceOf(
        DuplicateClientKeyError
      );
      await expect(clientKeysApi.addClientKey(` ${KEY_B}`)).rejects.toBeInstanceOf(
        DuplicateClientKeyError
      );
      expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('saves the alias after the key with the active hashes', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      const items = [{ apiKeyHash: hash(NEW_KEY), alias: 'Laptop' }];
      mocks.saveAliases.mockResolvedValue({ items });
      await expect(clientKeysApi.addClientKey(NEW_KEY, '  Laptop ', ctx())).resolves.toEqual({
        aliases: items,
      });
      expect(mocks.patch.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.saveAliases.mock.invocationCallOrder[0]
      );
      expect(mocks.saveAliases).toHaveBeenCalledWith(
        BASE,
        [{ apiKeyHash: hash(NEW_KEY), alias: 'Laptop' }],
        'mgmt',
        [hash(KEY_A), hash(KEY_B), hash(NEW_KEY)]
      );
    });

    it('rejects an empty or too long alias with no PATCH', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      await expect(clientKeysApi.addClientKey(NEW_KEY, '   ', ctx())).rejects.toMatchObject({
        name: 'InvalidAliasError',
        reason: 'empty',
      });
      await expect(
        clientKeysApi.addClientKey(NEW_KEY, 'x'.repeat(121), ctx())
      ).rejects.toBeInstanceOf(InvalidAliasError);
      await expect(
        clientKeysApi.addClientKey(NEW_KEY, 'я'.repeat(120), ctx())
      ).resolves.toBeDefined();
      expect(mocks.patch).toHaveBeenCalledTimes(1);
    });

    it('rejects an alias of another active key, case-insensitively, with no PATCH', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      const aliases = [
        { apiKeyHash: hash(KEY_A).toUpperCase(), alias: 'Laptop' },
        { apiKeyHash: hash('sk-removed-key'), alias: 'Phone' },
      ];
      await expect(
        clientKeysApi.addClientKey(NEW_KEY, ' laptop ', ctx({ aliases }))
      ).rejects.toBeInstanceOf(DuplicateAliasError);
      expect(mocks.patch).not.toHaveBeenCalled();
      // An orphan alias is not a duplicate here; the service decides, and its refusal
      // comes back as aliasError once the key is written.
      mocks.saveAliases.mockRejectedValue(new Error('alias already exists'));
      const result = await clientKeysApi.addClientKey(NEW_KEY, 'Phone', ctx({ aliases }));
      expect(mocks.patch).toHaveBeenCalledTimes(1);
      expect(result.aliasError).toBeInstanceOf(AliasWriteError);
      expect(mocks.saveAliases.mock.calls[0]).toHaveLength(4);
    });

    it('refuses an alias while the alias state is unknown, with no PATCH', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      await expect(
        clientKeysApi.addClientKey(NEW_KEY, 'Laptop', ctx({ aliasStateKnown: false }))
      ).rejects.toBeInstanceOf(AliasStateUnknownError);
      await expect(
        clientKeysApi.addClientKey(NEW_KEY, 'Laptop', ctx({ serviceBase: '' }))
      ).rejects.toBeInstanceOf(AliasStateUnknownError);
      await expect(clientKeysApi.addClientKey(NEW_KEY, 'Laptop')).rejects.toBeInstanceOf(
        AliasStateUnknownError
      );
      expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('keeps the key and returns a masked aliasError when the alias save fails', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      mocks.saveAliases.mockRejectedValue(new Error(`alias for ${NEW_KEY} rejected`));
      const result = await clientKeysApi.addClientKey(NEW_KEY, 'Laptop', ctx());
      expect(mocks.patch).toHaveBeenCalledTimes(1);
      expect(result.aliases).toBeUndefined();
      expect(result.aliasError).toBeInstanceOf(AliasWriteError);
      expect(result.aliasError?.message).toBe('alias for *** rejected');
    });

    it('masks the raw key in write error messages', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      mocks.patch.mockRejectedValueOnce(
        Object.assign(new Error(`bad key ${NEW_KEY} in list`), {
          status: 422,
          apiCode: 'invalid_config',
        })
      );
      const invalid = clientKeysApi.addClientKey(NEW_KEY);
      await expect(invalid).rejects.toBeInstanceOf(InvalidRoutingConfigError);
      await expect(invalid).rejects.toThrow('bad key *** in list');

      mocks.patch.mockRejectedValueOnce(
        Object.assign(new Error(`write ${NEW_KEY} failed`), { status: 500 })
      );
      const generic = clientKeysApi.addClientKey(NEW_KEY);
      await expect(generic).rejects.toMatchObject({ status: 500, message: 'write *** failed' });

      mocks.patch.mockRejectedValueOnce(
        Object.assign(new Error('x'), { status: 400, apiCode: 'unknown_api_key' })
      );
      await expect(clientKeysApi.addClientKey(NEW_KEY)).rejects.toBeInstanceOf(UnknownApiKeyError);
    });

    it('aborts the write when the connection changes after the read', async () => {
      mocks.get.mockImplementation(async () => {
        mocks.revision += 1;
        return accessConfig();
      });
      await expect(clientKeysApi.addClientKey(NEW_KEY, 'Laptop', ctx())).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(mocks.patch).not.toHaveBeenCalled();
      expect(mocks.saveAliases).not.toHaveBeenCalled();
    });

    it('skips the alias save when the connection changes during the key write', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      mocks.patch.mockImplementation(async () => {
        mocks.revision += 1;
        return {};
      });
      await expect(clientKeysApi.addClientKey(NEW_KEY, 'Laptop', ctx())).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(mocks.saveAliases).not.toHaveBeenCalled();
    });
  });

  describe('removeClientKey', () => {
    it('writes access.api-keys without every matching entry', async () => {
      mocks.get.mockResolvedValue(accessConfig([KEY_A, ` ${KEY_B}`, KEY_B, 'sk-third']));
      await expect(clientKeysApi.removeClientKey(KEY_B, ctx())).resolves.toEqual({});
      expect(mocks.patch).toHaveBeenCalledWith('/config', {
        access: { 'api-keys': [KEY_A, 'sk-third'] },
      });
      expect(mocks.deleteAlias).not.toHaveBeenCalled();
    });

    it('writes the legacy top-level list where it was found', async () => {
      mocks.get.mockResolvedValue(legacyConfig());
      await clientKeysApi.removeClientKey(KEY_A);
      expect(mocks.patch).toHaveBeenCalledWith('/config', { 'api-keys': [KEY_B] });
    });

    it('refuses to remove the last key', async () => {
      mocks.get.mockResolvedValue(accessConfig([KEY_A, `${KEY_A} `]));
      await expect(clientKeysApi.removeClientKey(KEY_A, ctx())).rejects.toBeInstanceOf(
        LastClientKeyError
      );
      expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('rejects an unknown key', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      await expect(clientKeysApi.removeClientKey(NEW_KEY, ctx())).rejects.toBeInstanceOf(
        UnknownApiKeyError
      );
      expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('deletes the alias of the removed key', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      mocks.deleteAlias.mockResolvedValue(undefined);
      const aliases = [{ apiKeyHash: hash(KEY_A), alias: 'Laptop' }];
      await expect(clientKeysApi.removeClientKey(KEY_A, ctx({ aliases }))).resolves.toEqual({
        removedAliasHash: hash(KEY_A),
      });
      expect(mocks.deleteAlias).toHaveBeenCalledWith(BASE, hash(KEY_A), 'mgmt');
      expect(mocks.patch.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.deleteAlias.mock.invocationCallOrder[0]
      );
    });

    it('keeps the removal and returns aliasError when the alias delete fails', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      mocks.deleteAlias.mockRejectedValue(new Error(`cannot delete ${KEY_A}`));
      const aliases = [{ apiKeyHash: hash(KEY_A), alias: 'Laptop' }];
      const result = await clientKeysApi.removeClientKey(KEY_A, ctx({ aliases }));
      expect(mocks.patch).toHaveBeenCalledTimes(1);
      expect(result.aliasError).toBeInstanceOf(AliasWriteError);
      expect(result.aliasError?.message).toBe('cannot delete ***');
    });

    it('refuses removal while the alias state is unknown', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      await expect(
        clientKeysApi.removeClientKey(KEY_A, ctx({ aliasStateKnown: false }))
      ).rejects.toBeInstanceOf(AliasStateUnknownError);
      expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('masks the raw key in write error messages', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      mocks.patch.mockRejectedValueOnce(
        Object.assign(new Error(`key ${KEY_A} is bad`), { status: 422, apiCode: 'invalid_config' })
      );
      await expect(clientKeysApi.removeClientKey(KEY_A)).rejects.toThrow('key *** is bad');
    });

    it('aborts the write when the connection changes after the read', async () => {
      mocks.get.mockImplementation(async () => {
        mocks.revision += 1;
        return accessConfig();
      });
      await expect(clientKeysApi.removeClientKey(KEY_A, ctx())).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('surfaces a stale-connection abort over a failed write', async () => {
      mocks.get.mockResolvedValue(accessConfig());
      mocks.patch.mockImplementation(async () => {
        mocks.revision += 1;
        throw Object.assign(new Error('x'), { status: 500 });
      });
      await expect(clientKeysApi.removeClientKey(KEY_A)).rejects.toMatchObject({
        name: 'AbortError',
      });
    });
  });

  it('never puts a raw key in a request URL', async () => {
    mocks.get.mockResolvedValue(accessConfig());
    mocks.saveAliases.mockResolvedValue({ items: [] });
    mocks.deleteAlias.mockResolvedValue(undefined);
    await clientKeysApi.addClientKey(NEW_KEY, 'Laptop', ctx());
    await clientKeysApi.removeClientKey(
      KEY_A,
      ctx({ aliases: [{ apiKeyHash: hash(KEY_A), alias: 'A' }] })
    );
    const urls = allRequestUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      for (const key of [KEY_A, KEY_B, NEW_KEY]) expect(url).not.toContain(key);
    }
  });
});
