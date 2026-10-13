import { create } from 'zustand';
import type { Config, RawConfigSection } from '../types';
import { apiClient, onQuotaConnectionChange } from '../services/api/client';
import { configApi } from '../services/api/config';
import { CACHE_EXPIRY_MS } from '@/utils/constants';

interface ConfigState {
  config: Config | null;
  fetchConfig: (forceRefresh?: boolean) => Promise<Config>;
  clearCache: (section?: RawConfigSection) => void;
  isCacheValid: () => boolean;
}

let requestToken = 0;
let inFlight: { id: number; promise: Promise<Config> } | null = null;
let cache: { data: Config; timestamp: number; revision: number } | null = null;

const isCacheValid = () =>
  cache !== null &&
  cache.revision === apiClient.getConnectionRevision() &&
  Date.now() - cache.timestamp < CACHE_EXPIRY_MS;

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  isCacheValid,
  fetchConfig: async (forceRefresh = false) => {
    if (!forceRefresh && cache && isCacheValid()) return cache.data;
    if (!forceRefresh && inFlight) return inFlight.promise;

    const id = ++requestToken;
    const revision = apiClient.getConnectionRevision();
    const promise = configApi.getConfig();
    inFlight = { id, promise };
    try {
      const data = await promise;
      if (revision !== apiClient.getConnectionRevision()) {
        throw new DOMException('The management connection changed.', 'AbortError');
      }
      if (id === requestToken) {
        cache = { data, timestamp: Date.now(), revision };
        set({ config: data });
      }
      return data;
    } finally {
      if (inFlight?.id === id) inFlight = null;
    }
  },
  clearCache: (section) => {
    cache = null;
    requestToken += 1;
    inFlight = null;
    if (!section) set({ config: null });
  },
}));

onQuotaConnectionChange(() => useConfigStore.getState().clearCache());
