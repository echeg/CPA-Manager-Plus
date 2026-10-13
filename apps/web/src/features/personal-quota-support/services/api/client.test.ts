import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestRaw: vi.fn(),
  state: {
    apiBase: 'https://manager.example',
    managementKey: 'panel-admin-key',
    isAuthenticated: true,
    sessionMode: 'manager_embedded',
  },
  listeners: [] as Array<() => void>,
}));

vi.mock('@/services/api/client', () => ({
  apiClient: { requestRaw: mocks.requestRaw },
}));
vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: {
    getState: () => mocks.state,
    subscribe: (listener: () => void) => {
      mocks.listeners.push(listener);
      return () => {};
    },
  },
}));

import { apiClient, createQuotaRequestConfig, onQuotaConnectionChange } from './client';
import { guardConfigConnection } from './configValue';

const changeConnection = (patch: Partial<typeof mocks.state>) => {
  Object.assign(mocks.state, patch);
  mocks.listeners.forEach((listener) => listener());
};

beforeEach(() => {
  mocks.requestRaw.mockReset();
  mocks.requestRaw.mockResolvedValue({ data: { ok: true } });
  changeConnection({
    apiBase: 'https://manager.example',
    managementKey: 'panel-admin-key',
    isAuthenticated: true,
    sessionMode: 'manager_embedded',
  });
});

describe('personal quota management transport', () => {
  it('pins v8 requests to the panel host and administrator credential without changing the global client', async () => {
    const signal = new AbortController().signal;
    await apiClient.post(
      '/requests/api-call',
      { authIndex: 'credential-1' },
      { timeout: 12000, signal }
    );
    const config = mocks.requestRaw.mock.calls[0][0];
    expect(config).toMatchObject({
      url: '/requests/api-call',
      method: 'POST',
      baseURL: 'https://manager.example/v8/management',
      cpampScopedRequest: true,
      data: { authIndex: 'credential-1' },
      timeout: 12000,
      signal,
    });
    expect(config.headers.get('Authorization')).toBe('Bearer panel-admin-key');
  });

  it('does not let per-request settings override the captured management host or credential', () => {
    const config = createQuotaRequestConfig('/credentials', {
      baseURL: 'https://unexpected.example',
      headers: {
        Authorization: 'Bearer unexpected',
        'X-CPAMP-Auth-File-Mutation-Identity': 'identity',
      },
    });
    expect(config.baseURL).toBe('https://manager.example/v8/management');
    expect(config.headers?.Authorization).toBe('Bearer panel-admin-key');
    expect(config.headers?.['X-CPAMP-Auth-File-Mutation-Identity']).toBe('identity');
  });

  it.each(['https://other.example/config', '//other.example/config', '/\\other.example'])(
    'rejects a management request outside the relative API path: %s',
    async (url) => {
      await expect(apiClient.get(url)).rejects.toThrow('relative management API path');
      expect(mocks.requestRaw).not.toHaveBeenCalled();
    }
  );

  it.each(['https://manager.example/v0/management', 'https://manager.example/v8/management/'])(
    'normalizes an existing management suffix once: %s',
    (apiBase) => {
      changeConnection({ apiBase });
      expect(createQuotaRequestConfig('/config').baseURL).toBe(
        'https://manager.example/v8/management'
      );
    }
  );

  it('preserves machine-readable v8 errors and the human-readable explanation', async () => {
    const error = Object.assign(new Error('not_found'), {
      status: 404,
      details: { error: 'not_found', message: 'The configuration field is not set' },
    });
    mocks.requestRaw.mockRejectedValue(error);
    await expect(apiClient.get('/config/optional')).rejects.toMatchObject({
      status: 404,
      apiCode: 'not_found',
      message: 'The configuration field is not set',
    });
  });

  it('explains an unavailable v8 API instead of showing a raw route error', async () => {
    mocks.requestRaw.mockRejectedValue(
      Object.assign(new Error('404 page not found'), { status: 404 })
    );
    await expect(apiClient.get('/credentials')).rejects.toMatchObject({
      apiCode: 'quota_v8_required',
      message: expect.stringContaining('CLIProxyAPI v8 Management API'),
    });
  });

  it('invalidates pending read/write guards on an A → B → A connection switch', () => {
    const guard = guardConfigConnection();
    const listener = vi.fn();
    const unsubscribe = onQuotaConnectionChange(listener);
    changeConnection({ apiBase: 'https://other-manager.example' });
    changeConnection({ apiBase: 'https://manager.example' });
    expect(guard).toThrow('The management connection changed');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('invalidates connection guards on logout even if the remembered host and key stay present', () => {
    const guard = guardConfigConnection();
    changeConnection({ isAuthenticated: false });
    expect(guard).toThrow('The management connection changed');
  });
});
