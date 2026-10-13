import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/features/quota/hooks/useNow';
import { useAuthStore } from '@/features/personal-quota-support/stores/useAuthStore';
import { useNotificationStore } from '@/features/personal-quota-support/stores';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import {
  readClaudeResetGrants,
  type AnthropicResetGrantStatus,
} from '@/features/personal-quota-support/services/api/claudeResetGrants';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { normalizeAuthIndex } from '@/features/quota/utils/quota';
import { runClaudeClaim } from './claimCooldown';
import {
  claudeResetOperationKey,
  resetGrantOperations,
  RETRY_WINDOW_MS,
} from './resetGrantOperations';
import { resetGrantBlockReason, selectResetGrant } from './selectResetGrant';

/** Card-owned reads; the session-scoped journal owns spending and ambiguous retries. */
export function useClaudeResetGrants(
  file: AuthFileItem,
  enabled: boolean,
  disabled: boolean,
  refreshToken: unknown,
  onRefresh: () => void,
  displayName = file.name
) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [session] = useState(() => apiClient.getConnectionRevision());
  const sessionActive =
    connectionStatus === 'connected' && session === apiClient.getConnectionRevision();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const now = useNow();
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const key = claudeResetOperationKey(file.name, authIndex);
  const [status, setStatus] = useState<AnthropicResetGrantStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    setStatus(null);
    if (!enabled || disabled || !sessionActive || !authIndex) return;
    let cancelled = false;
    const current = () =>
      !cancelled && version === generation.current && session === apiClient.getConnectionRevision();
    void readClaudeResetGrants(authIndex).then(
      (result) => {
        if (current()) {
          setStatus(result);
          setMessage('');
        }
      },
      () => {
        if (current()) setMessage('read_error');
      }
    );
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, [authIndex, key, enabled, disabled, sessionActive, session, refreshToken, reload]);

  const operation = resetGrantOperations.inspect(key);
  const pending = operation && !operation.code ? operation : undefined;
  const expired = Boolean(pending && now - pending.createdAt >= RETRY_WINDOW_MS);
  const selected = pending?.grantId ?? (status ? selectResetGrant(status, now)?.id : undefined);
  const blocked = disabled || !sessionActive || !authIndex || busy || expired || !selected;
  const confirmMessage = t(pending ? 'claude_reset.retry_confirm' : 'claude_reset.confirm_text', {
    name: displayName,
  });
  /** Spends without a dialog; callers own the confirmation step. */
  const execute = async (version = generation.current) => {
    if (blocked || !selected || !authIndex) return;
    const current = () =>
      session === apiClient.getConnectionRevision() && version === generation.current;
    if (!current() || lock.current || useAuthStore.getState().connectionStatus !== 'connected')
      return;
    lock.current = true;
    setBusy(true);
    try {
      await runClaudeClaim({
        claim: () => resetGrantOperations.run(key, authIndex, selected),
        authIndex,
        revision: session,
        isCurrent: current,
        hasUnresolvedClaim: () => resetGrantOperations.hasUnresolved(key),
        notify: showNotification,
        t,
      });
    } finally {
      lock.current = false;
      // A concurrent page-wide refresh can invalidate this read generation.
      // Release the local lock regardless, but never refresh a replacement account.
      setBusy(false);
      setReload((value) => value + 1);
      if (current()) onRefresh();
    }
  };
  const confirm = () => {
    if (blocked || lock.current || !selected || !authIndex) return;
    const version = generation.current;
    showConfirmation({
      title: t('claude_reset.title'),
      message: confirmMessage,
      confirmText: t(pending ? 'claude_reset.retry' : 'claude_reset.confirm'),
      variant: 'primary',
      onConfirm: () => execute(version),
    });
  };
  return {
    count: status?.grants.reduce((sum, grant) => sum + grant.resetsLeft, 0) ?? null,
    grants: status?.grants ?? [],
    /** The grant a fresh claim would spend; absent for retries and before the read. */
    selectedGrant: pending ? undefined : status?.grants.find((grant) => grant.id === selected),
    busy,
    blocked,
    confirm,
    execute,
    confirmMessage,
    message: pending ? (expired ? 'expired' : 'unknown') : message,
    /** Why a loaded status offers no grant to spend; a `claude_reset.*` key. */
    blockReason: !pending && status && !selected ? resetGrantBlockReason(status, now) : undefined,
    buttonLabel: pending ? 'retry' : 'use',
  };
}
