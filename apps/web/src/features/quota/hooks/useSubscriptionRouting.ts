import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import {
  readSubscriptionRouting,
  subscriptionRoutingApi,
  type SubscriptionRoutingSettings,
} from '@/features/personal-quota-support/services/api/subscriptionRouting';
import { useConfigStore } from '@/features/personal-quota-support/stores';
import { errorText, routingFormState, routingStrategyOptions } from '../routingModel';

/** Loads and saves routing settings; saving is explicit and guarded by the connection revision. */
export function useSubscriptionRouting(disabled: boolean) {
  const { t } = useTranslation();
  const [values, setValues] = useState<SubscriptionRoutingSettings | null>(null);
  const [baseline, setBaseline] = useState<SubscriptionRoutingSettings | null>(null);
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
        setValues(next);
        setBaseline(next);
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

  const change = (patch: Partial<SubscriptionRoutingSettings>) => {
    setValues((current) => (current ? { ...current, ...patch } : current));
    setSaved(false);
  };
  const { dirty, invalidTTL } = routingFormState(values, baseline);
  const blocked = disabled || loading || saving || !values;
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
      const config = await fetchConfig(true);
      if (!isCurrent()) return;
      const next = readSubscriptionRouting(config);
      setValues(next);
      setBaseline(next);
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
    strategyLabel: values ? options.find((option) => option.value === values.strategy)?.label : '',
    change,
    save,
    reload: () => setLoadRevision((current) => current + 1),
  };
}

export type SubscriptionRoutingState = ReturnType<typeof useSubscriptionRouting>;
