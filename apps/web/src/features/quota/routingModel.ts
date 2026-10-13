import type { TFunction } from 'i18next';
import { goDurationSeconds } from '@/features/quota/utils/goDuration';
import { configApi } from '@/features/personal-quota-support/services/api/config';
import {
  subscriptionRoutingPatch,
  type SubscriptionActivity,
  type SubscriptionRoutingSettings,
} from '@/features/personal-quota-support/services/api/subscriptionRouting';
import type { AuthFileItem, Config } from '@/features/personal-quota-support/types';

export type ActivityState = 'loading' | 'ready' | 'error';

const ROUTING_STRATEGIES = ['round-robin', 'weighted-round-robin', 'fill-first', 'earliest-reset'];

export function latestSubscriptionActivity(
  accounts: SubscriptionActivity[],
  provider: string,
  files: AuthFileItem[]
) {
  const known = new Set(files.map((file) => String(file.authIndex ?? '')));
  return accounts
    .filter((account) => account.provider === provider && known.has(account.authIndex))
    .sort((a, b) => Date.parse(b.lastSelectedAt) - Date.parse(a.lastSelectedAt))[0];
}

/** Dirty and TTL validity for the routing form; unloaded settings are clean and valid. */
export function routingFormState(
  values: SubscriptionRoutingSettings | null,
  baseline: SubscriptionRoutingSettings | null
) {
  if (!values || !baseline) return { dirty: false, invalidTTL: false };
  const ttlSeconds = goDurationSeconds(values.sessionAffinityTTL.trim());
  return {
    dirty: Object.keys(subscriptionRoutingPatch(baseline, values)).length > 0,
    invalidTTL: ttlSeconds === undefined || ttlSeconds <= 0,
  };
}

/** Known strategies, plus an unknown server value so it stays selectable. */
export function routingStrategyOptions(t: TFunction, current: string | undefined) {
  const options = ROUTING_STRATEGIES.map((strategy) => ({
    value: strategy,
    label: t(`config_management.visual.sections.network.strategy_${strategy.replace(/-/g, '_')}`),
  }));
  if (current && !ROUTING_STRATEGIES.includes(current)) {
    options.push({ value: current, label: current });
  }
  return options;
}

export function activityStatusKey(disconnected: boolean, state: ActivityState) {
  if (disconnected || state === 'error') return 'quota_management.routing.activity_unavailable';
  return state === 'loading'
    ? 'quota_management.routing.activity_loading'
    : 'quota_management.routing.no_activity';
}

export function errorText(err: unknown, t: TFunction) {
  return err instanceof Error ? err.message : t('common.unknown_error');
}

/**
 * Writes codex.fast-mode and returns the value the server reports after the write.
 * onWritten runs once the write succeeded, before the config reload.
 */
export async function saveCodexFastMode(
  next: boolean,
  fetchConfig: (force: boolean) => Promise<Pick<Config, 'codexFastMode'>>,
  onWritten?: () => boolean
) {
  await configApi.updateCodexFastMode(next);
  if (onWritten && !onWritten()) return next;
  const config = await fetchConfig(true);
  return config.codexFastMode ?? false;
}
