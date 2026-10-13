import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import { useConfigStore } from '@/features/personal-quota-support/stores';
import { errorText, saveCodexFastMode } from '../routingModel';

/** Reads codex.fast-mode and applies toggles immediately; the server hot-reloads it. */
export function useCodexFastMode(disabled: boolean) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
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
    setError('');
    void fetchConfig()
      .then((config) => {
        if (active && revision === apiClient.getConnectionRevision()) {
          setEnabled(config.codexFastMode ?? false);
        }
      })
      .catch((err: unknown) => {
        if (active && revision === apiClient.getConnectionRevision()) setError(errorText(err, t));
      });
    return () => {
      active = false;
    };
  }, [disabled, fetchConfig, t]);

  const toggle = async (next: boolean) => {
    if (disabled || saving || enabled === null) return;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () => mounted.current && revision === apiClient.getConnectionRevision();
    setSaving(true);
    setError('');
    try {
      const value = await saveCodexFastMode(next, fetchConfig, () => {
        if (!isCurrent()) return false;
        setEnabled(next);
        return true;
      });
      if (isCurrent()) setEnabled(value);
    } catch (err: unknown) {
      if (isCurrent()) setError(errorText(err, t));
    } finally {
      if (isCurrent()) setSaving(false);
    }
  };

  return { enabled, saving, error, toggle };
}

export type CodexFastModeState = ReturnType<typeof useCodexFastMode>;
