import type { Config } from '../../types';
import { apiClient } from './client';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

/** Personal controls read the v8 document; CPAMP's existing v0 configuration stays separate. */
export const normalizeConfigResponse = (raw: unknown): Config => {
  if (!isRecord(raw)) throw new Error('Invalid management configuration response');
  const routing = isRecord(raw.routing) ? raw.routing : {};
  const oauth = isRecord(raw.oauth) ? raw.oauth : {};
  const providers = isRecord(oauth.providers) ? oauth.providers : {};
  const codex = isRecord(providers.codex) ? providers.codex : {};
  const preferred = routing['preferred-accounts'];
  return {
    raw,
    routingStrategy: typeof routing.strategy === 'string' ? routing.strategy : undefined,
    routingSessionAffinity: booleanValue(routing['session-affinity']),
    routingSessionAffinityTTL:
      typeof routing['session-affinity-ttl'] === 'string'
        ? routing['session-affinity-ttl']
        : undefined,
    routingPreferredAccounts: isRecord(preferred)
      ? Object.fromEntries(
          Object.entries(preferred).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim()
          )
        )
      : {},
    codexFastMode: booleanValue(codex['fast-mode']) ?? false,
  };
};

export const configApi = {
  getConfig: async (): Promise<Config> => normalizeConfigResponse(await apiClient.get('/config')),
  updateCodexFastMode: (enabled: boolean) =>
    apiClient.put('/config/oauth/providers/codex/fast-mode', enabled),
};
