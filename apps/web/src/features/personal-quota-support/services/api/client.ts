import { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { apiClient as managerApiClient, type ScopedApiRequestConfig } from '@/services/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { normalizeApiBase } from '@/utils/connection';
import { parseApiErrorResponse } from './apiError';

/** This client uses the current panel login but never reconfigures CPAMP's v0 client. */
const readConnection = () => {
  const { apiBase, managementKey, isAuthenticated, sessionMode } = useAuthStore.getState();
  return { apiBase, managementKey, isAuthenticated, sessionMode };
};

let connection = readConnection();
let connectionRevision = 0;
const connectionListeners = new Set<() => void>();

useAuthStore.subscribe(() => {
  const next = readConnection();
  if (
    next.apiBase === connection.apiBase &&
    next.managementKey === connection.managementKey &&
    next.isAuthenticated === connection.isAuthenticated &&
    next.sessionMode === connection.sessionMode
  ) {
    return;
  }
  connection = next;
  connectionRevision += 1;
  connectionListeners.forEach((listener) => listener());
});

export const onQuotaConnectionChange = (listener: () => void) => {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
};

/** Pin each request to its captured panel connection, including its administrator key. */
export const createQuotaRequestConfig = (
  path: string,
  config: AxiosRequestConfig = {}
): ScopedApiRequestConfig => {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) {
    throw new Error('Quota requests must use a relative management API path');
  }
  const { apiBase, managementKey } = readConnection();
  if (!apiBase || !managementKey) {
    throw new Error('The management connection is unavailable');
  }
  const base = normalizeApiBase(apiBase).replace(/\/v8\/management\/?$/i, '');
  const headers = new AxiosHeaders(config.headers as ConstructorParameters<typeof AxiosHeaders>[0]);
  headers.set('Authorization', `Bearer ${managementKey}`);
  return {
    ...config,
    url: path,
    baseURL: `${base}/v8/management`,
    headers,
    cpampScopedRequest: true,
  };
};

const requestRaw = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
  try {
    return await managerApiClient.requestRaw(createQuotaRequestConfig(config.url || '/', config));
  } catch (error: unknown) {
    if (error instanceof Error) {
      const apiError = error as Error & {
        details?: unknown;
        data?: unknown;
        apiCode?: string;
        status?: number;
      };
      const parsed = parseApiErrorResponse(apiError.details ?? apiError.data, error.message);
      apiError.message = parsed.message;
      apiError.apiCode = parsed.apiCode;
      if (
        apiError.status === 404 &&
        config.method === 'GET' &&
        (config.url === '/credentials' || config.url === '/config')
      ) {
        apiError.apiCode = 'quota_v8_required';
        apiError.message =
          'Personal quotas require the CLIProxyAPI v8 Management API. Update the CPA connection or use the standard Accounts page.';
      }
    }
    throw error;
  }
};

export const apiClient = {
  getConnectionRevision: () => connectionRevision,
  requestRaw,
  getRaw: (url: string, config?: AxiosRequestConfig) =>
    requestRaw({ ...config, url, method: 'GET' }),
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return (await requestRaw({ ...config, url, method: 'GET' })).data as T;
  },
  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return (await requestRaw({ ...config, url, method: 'POST', data })).data as T;
  },
  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return (await requestRaw({ ...config, url, method: 'PUT', data })).data as T;
  },
  async patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return (await requestRaw({ ...config, url, method: 'PATCH', data })).data as T;
  },
  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return (await requestRaw({ ...config, url, method: 'DELETE' })).data as T;
  },
};
