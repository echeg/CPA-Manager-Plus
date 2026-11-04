import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import type {
  RoutingSelectionOptions,
  SelectionSlots,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import {
  readSubscriptionRouting,
  subscriptionRoutingApi,
  type SubscriptionRoutingSettings,
} from '@/features/personal-quota-support/services/api/subscriptionRouting';
import { useConfigStore } from '@/features/personal-quota-support/stores';
import {
  errorText,
  routingFormState,
  routingStrategyOptions,
  selectionSlotOptions,
  withPickerRule,
} from '../routingModel';

/** The shared selection from `/routing/profiles`, owned by `useKeyProfiles`. */
export interface RoutingProfilesSource {
  /** The backend serves `/routing/profiles`; the slots replace the legacy strategy. */
  supported: boolean;
  selection?: SelectionSlots;
  selectionOptions?: RoutingSelectionOptions;
  loading: boolean;
  /**
   * The profiles failed to load for a reason other than a 404, so it is unknown
   * whether the backend routes by `routing.selection` or by the legacy strategy.
   */
  failed?: boolean;
  reload: () => void;
}

interface LoadedSelection {
  selection: SelectionSlots;
  options: RoutingSelectionOptions;
}

const slotsKey = (selection: SelectionSlots | undefined) =>
  selection ? `${selection.primary}\u0000${selection.tiebreak ?? ''}` : '';

/**
 * Loads and saves routing settings; saving is explicit and guarded by the connection revision.
 * With `profiles`, the shared selection slots join the form once both the config and the
 * profiles have loaded, and a save reloads the profiles too.
 */
export function useSubscriptionRouting(disabled: boolean, profiles?: RoutingProfilesSource) {
  const { t } = useTranslation();
  const [configValues, setConfigValues] = useState<SubscriptionRoutingSettings | null>(null);
  const [configBaseline, setConfigBaseline] = useState<SubscriptionRoutingSettings | null>(null);
  // The last loaded shared selection. It stays while the profiles reload, so the
  // slots keep their value instead of flickering back to the legacy select.
  const [shared, setShared] = useState<LoadedSelection | null>(null);
  // The edited slots; null while they match the shared selection.
  const [selectionDraft, setSelectionDraft] = useState<SelectionSlots | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const mounted = useRef(false);
  const savingRef = useRef(false);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (disabled) return;
    let active = true;
    const revision = apiClient.getConnectionRevision();
    setLoading(true);
    setError('');
    void fetchConfig()
      .then((config) => {
        if (!active || revision !== apiClient.getConnectionRevision()) return;
        const next = readSubscriptionRouting(config);
        setConfigValues(next);
        setConfigBaseline(next);
      })
      .catch((err: unknown) => {
        if (active && revision === apiClient.getConnectionRevision()) setError(errorText(err, t));
      })
      .finally(() => {
        if (active && revision === apiClient.getConnectionRevision()) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [disabled, fetchConfig, loadRevision, t]);

  const profilesLoading = profiles?.loading ?? false;
  const loadedSelection =
    profiles?.supported && profiles.selection && profiles.selectionOptions
      ? { selection: profiles.selection, options: profiles.selectionOptions }
      : null;
  const loadedKey = loadedSelection
    ? `${slotsKey(loadedSelection.selection)}\u0001${loadedSelection.options.narrowing.join()}\u0001${loadedSelection.options.pickers.join()}`
    : '';
  const appliedKey = useRef<string | null>(null);
  useEffect(() => {
    if (profilesLoading || appliedKey.current === loadedKey) return;
    appliedKey.current = loadedKey;
    setShared(loadedSelection);
    // A new stored selection (after a save or an outside change) replaces the
    // draft; a reload that returns the same selection keeps an unsaved edit.
    setSelectionDraft(null);
    // loadedSelection is rebuilt every render; loadedKey is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, profilesLoading]);

  const selection = shared ? (selectionDraft ?? shared.selection) : undefined;
  const values = configValues && (shared ? { ...configValues, selection } : configValues);
  const baseline =
    configBaseline &&
    (shared ? { ...configBaseline, selection: shared.selection } : configBaseline);

  // A backend with an explicit routing.selection ignores routing.strategy, so the
  // legacy select stays locked until the profiles confirm it is in use.
  const strategyLocked = !shared && !!profiles?.failed;

  const change = (patch: Partial<SubscriptionRoutingSettings>) => {
    const { selection: nextSelection, ...rest } = patch;
    if (nextSelection && shared) setSelectionDraft(withPickerRule(nextSelection, shared.options));
    if (strategyLocked) delete rest.strategy;
    if (Object.keys(rest).length)
      setConfigValues((current) => (current ? { ...current, ...rest } : current));
    setSaved(false);
  };
  const { dirty, invalidTTL } = routingFormState(values, baseline);
  const blocked = disabled || loading || saving || profilesLoading || !values;
  const save = async () => {
    if (blocked || invalidTTL || !values || !baseline || !dirty || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setSaved(false);
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () => mounted.current && revision === apiClient.getConnectionRevision();
    try {
      await subscriptionRoutingApi.update(baseline, values);
      if (!isCurrent()) return;
      useConfigStore.getState().clearCache('routing/strategy');
      // The draft stays until the reloaded profiles report the stored selection.
      profiles?.reload();
      const config = await fetchConfig(true);
      if (!isCurrent()) return;
      const next = readSubscriptionRouting(config);
      setConfigValues(next);
      setConfigBaseline(next);
      setSaved(true);
    } catch (err: unknown) {
      if (isCurrent()) setError(errorText(err, t));
    } finally {
      savingRef.current = false;
      if (isCurrent()) setSaving(false);
    }
  };

  const options = routingStrategyOptions(t, values?.strategy);
  return {
    values,
    loading,
    saving,
    error,
    saved,
    dirty,
    invalidTTL,
    blocked,
    options,
    /** Slot choices when the shared selection replaces the legacy strategy, otherwise null. */
    slots: shared ? selectionSlotOptions(t, shared.options, selection) : null,
    strategyLocked,
    strategyLabel: values ? options.find((option) => option.value === values.strategy)?.label : '',
    change,
    save,
    reload: () => setLoadRevision((current) => current + 1),
  };
}

export type SubscriptionRoutingState = ReturnType<typeof useSubscriptionRouting>;
