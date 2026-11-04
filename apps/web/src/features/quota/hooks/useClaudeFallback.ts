import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  apiClient,
  onQuotaConnectionChange,
} from '@/features/personal-quota-support/services/api/client';
import {
  claudeFallbackApi,
  type ClaudeFallbackSettings,
  type ClaudeFallbackState,
} from '@/features/personal-quota-support/services/api/claudeFallback';
import { useConfigStore } from '@/features/personal-quota-support/stores';
import { errorText } from '../routingModel';

export function useClaudeFallback(disabled: boolean) {
  const { t } = useTranslation();
  const revision = useSyncExternalStore(
    onQuotaConnectionChange,
    apiClient.getConnectionRevision,
    apiClient.getConnectionRevision
  );
  const [state, setState] = useState<ClaudeFallbackState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const mounted = useRef(false);
  const savingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setState(null);
    setError('');
    setLoading(true);
    if (disabled) return;
    void claudeFallbackApi
      .get()
      .then((next) => {
        if (active && revision === apiClient.getConnectionRevision()) setState(next);
      })
      .catch((err: unknown) => {
        if (active && revision === apiClient.getConnectionRevision()) setError(errorText(err, t));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [disabled, revision, reloadToken, t]);

  const save = async (next: ClaudeFallbackSettings) => {
    if (disabled || loading || !state?.supported || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const isCurrent = () => mounted.current && revision === apiClient.getConnectionRevision();
    try {
      const saved = await claudeFallbackApi.save(next);
      if (!isCurrent()) return false;
      useConfigStore.getState().clearCache();
      setState(saved);
      return true;
    } catch (err) {
      if (isCurrent()) {
        setError(errorText(err, t));
        // A successful write followed by a failed read has unknown state. Reload
        // explicitly before allowing another toggle instead of displaying stale success.
        setState(null);
      }
      return false;
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  return {
    state,
    loading,
    saving,
    error,
    save,
    reload,
    revision,
    blocked: disabled || loading || saving || !state?.supported,
  };
}
