import type { Config } from '@/features/personal-quota-support/types';
import { apiClient } from './client';

export interface SubscriptionRoutingSettings {
  strategy: string;
  sessionAffinity: boolean;
  sessionAffinityTTL: string;
  preferredAccounts: Record<string, string>;
}

export function readSubscriptionRouting(config: Config): SubscriptionRoutingSettings {
  return {
    strategy: config.routingStrategy || 'round-robin',
    sessionAffinity: config.routingSessionAffinity ?? false,
    sessionAffinityTTL: config.routingSessionAffinityTTL || '1h',
    preferredAccounts: config.routingPreferredAccounts ?? {},
  };
}

/** Patch only edited fields so independent config edits are preserved. */
export function subscriptionRoutingPatch(
  before: SubscriptionRoutingSettings,
  after: SubscriptionRoutingSettings
): Record<string, unknown> {
  const routing: Record<string, unknown> = {};
  if (before.strategy !== after.strategy) routing.strategy = after.strategy;
  if (before.sessionAffinity !== after.sessionAffinity)
    routing['session-affinity'] = after.sessionAffinity;
  if (before.sessionAffinityTTL !== after.sessionAffinityTTL.trim()) {
    routing['session-affinity-ttl'] = after.sessionAffinityTTL.trim();
  }
  const preferred: Record<string, string | null> = {};
  for (const provider of new Set([
    ...Object.keys(before.preferredAccounts),
    ...Object.keys(after.preferredAccounts),
  ])) {
    const previous = before.preferredAccounts[provider] || '';
    const next = after.preferredAccounts[provider]?.trim() || '';
    if (previous !== next) preferred[provider] = next || null;
  }
  if (Object.keys(preferred).length) routing['preferred-accounts'] = preferred;
  return routing;
}

export interface SubscriptionActivity {
  authIndex: string;
  provider: string;
  lastSelectedAt: string;
}

export function readSubscriptionActivity(raw: unknown): SubscriptionActivity[] {
  if (!raw || typeof raw !== 'object' || !('accounts' in raw) || !Array.isArray(raw.accounts))
    throw new Error('Invalid routing activity response');
  return raw.accounts.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (
      typeof item.auth_index !== 'string' ||
      !item.auth_index ||
      typeof item.provider !== 'string' ||
      typeof item.last_selected_at !== 'string' ||
      !Number.isFinite(Date.parse(item.last_selected_at))
    )
      return [];
    return [
      {
        authIndex: item.auth_index,
        provider: item.provider,
        lastSelectedAt: item.last_selected_at,
      },
    ];
  });
}

export const subscriptionRoutingApi = {
  activity: async () => readSubscriptionActivity(await apiClient.get('/routing/activity')),
  update: (before: SubscriptionRoutingSettings, after: SubscriptionRoutingSettings) =>
    apiClient.patch('/config', { routing: subscriptionRoutingPatch(before, after) }),
};
