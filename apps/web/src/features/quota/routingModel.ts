import type { TFunction } from 'i18next';
import { goDurationSeconds } from '@/features/quota/utils/goDuration';
import { configApi } from '@/features/personal-quota-support/services/api/config';
import type {
  RoutingSelectionOptions,
  SelectionSlots,
} from '@/features/personal-quota-support/services/api/routingProfiles';
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

/** A sticky TTL must be a positive Go duration; empty, zero, negative and garbage are invalid. */
export function invalidTTL(ttl: string): boolean {
  const trimmed = ttl.trim();
  if (!trimmed) return true;
  const ttlSeconds = goDurationSeconds(trimmed);
  return ttlSeconds === undefined || ttlSeconds <= 0;
}

/** Dirty and TTL validity for the routing form; unloaded settings are clean and valid. */
export function routingFormState(
  values: SubscriptionRoutingSettings | null,
  baseline: SubscriptionRoutingSettings | null
) {
  if (!values || !baseline) return { dirty: false, invalidTTL: false };
  return {
    dirty: Object.keys(subscriptionRoutingPatch(baseline, values)).length > 0,
    invalidTTL: invalidTTL(values.sessionAffinityTTL),
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

/** A picker chooses one credential, so a picker as primary leaves the tiebreak inactive. */
export function isPickerSlot(slot: string, options: RoutingSelectionOptions) {
  return options.pickers.includes(slot);
}

/** Applies the picker rule: a picker as primary drops the tiebreak. */
export function withPickerRule(
  selection: SelectionSlots,
  options: RoutingSelectionOptions
): SelectionSlots {
  return isPickerSlot(selection.primary, options) || !selection.tiebreak
    ? { primary: selection.primary }
    : { primary: selection.primary, tiebreak: selection.tiebreak };
}

const slotLabel = (t: TFunction, slot: string) =>
  t(`quota_management.routing.slots.${slot.replace(/-/g, '_')}`, { defaultValue: slot });

/**
 * Choices for the primary and tiebreak slots from the backend's `selection_options`,
 * plus an unknown stored value so it stays selectable. The tiebreak may be empty.
 */
export function selectionSlotOptions(
  t: TFunction,
  options: RoutingSelectionOptions,
  current: SelectionSlots | undefined
) {
  const known = [...options.narrowing, ...options.pickers];
  const withCurrent = (value: string | undefined) => {
    const slots = known.map((slot) => ({ value: slot, label: slotLabel(t, slot) }));
    if (value && !known.includes(value)) slots.push({ value, label: value });
    return slots;
  };
  return {
    primary: withCurrent(current?.primary),
    tiebreak: [
      { value: '', label: t('quota_management.routing.tiebreak_none') },
      ...withCurrent(current?.tiebreak),
    ],
    tiebreakDisabled: current ? isPickerSlot(current.primary, options) : false,
  };
}

export type RoutingProvider = 'claude' | 'codex';

/** Accounts of one provider that can be preferred (they have an auth index). */
export function providerAccountFiles(provider: RoutingProvider, files: AuthFileItem[]) {
  return files.filter(
    (file) => (file.provider ?? file.type) === provider && String(file.authIndex ?? '')
  );
}

/**
 * Preferred-account choices for one provider: automatic, every account (disabled
 * ones marked), and the selected value when its account is gone.
 */
export function preferredAccountOptions(
  provider: RoutingProvider,
  files: AuthFileItem[],
  selected: string,
  displayName: (file: AuthFileItem) => string,
  t: TFunction
) {
  const providerFiles = providerAccountFiles(provider, files);
  const options = [
    { value: '', label: t('quota_management.routing.automatic') },
    ...providerFiles.map((file) => ({
      value: String(file.authIndex),
      label:
        displayName(file) +
        (file.disabled ? ` · ${t('quota_management.routing.disabled_account')}` : ''),
    })),
  ];
  if (selected && !providerFiles.some((file) => String(file.authIndex) === selected)) {
    options.push({ value: selected, label: t('quota_management.routing.missing_account') });
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
