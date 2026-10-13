import type { TFunction } from 'i18next';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import { authFilesApi } from '@/features/personal-quota-support/services/api/authFiles';
import type { AnthropicResetSettledCode } from '@/features/personal-quota-support/services/api/claudeResetGrants';
import type { NotificationType } from '@/features/personal-quota-support/types';

export type ClaudeClaimCooldownResult = 'cleared' | 'skipped' | 'failed';

/** Clears the proxy cooldown after a settled claim, matching Codex reset parity.
 * `skipped` means nothing to report: the claim did not spend, or the connection changed.
 */
export async function clearClaudeCooldownAfterClaim(
  authIndex: string,
  answer: { code: AnthropicResetSettledCode; unresolved: boolean },
  revision: number
): Promise<ClaudeClaimCooldownResult> {
  if (answer.unresolved || (answer.code !== 'reset' && answer.code !== 'already_used')) {
    return 'skipped';
  }
  // Never clear or report against a replacement connection.
  if (revision !== apiClient.getConnectionRevision()) return 'skipped';
  try {
    const result = await authFilesApi.resetCooldown(authIndex);
    if (revision !== apiClient.getConnectionRevision()) return 'skipped';
    return result.status === 'ok' && result.auth_index === authIndex ? 'cleared' : 'failed';
  } catch {
    return revision === apiClient.getConnectionRevision() ? 'failed' : 'skipped';
  }
}

export interface ClaudeClaimDeps {
  claim: () => Promise<{ code: AnthropicResetSettledCode; unresolved: boolean }>;
  authIndex: string;
  revision: number;
  /** False once the hook's read was replaced; only the user-facing outcome is dropped then. */
  isCurrent: () => boolean;
  /** True while the journal holds an unresolved claim for this account. */
  hasUnresolvedClaim: () => boolean;
  notify: (message: string, type: NotificationType) => void;
  t: TFunction;
}

/** Spends one claim and reports its outcome. */
export async function runClaudeClaim(deps: ClaudeClaimDeps): Promise<void> {
  const { t, notify } = deps;
  try {
    const answer = await deps.claim();
    // The claim is spent upstream, so clear the cooldown even if this read went stale
    // (e.g. a page-wide refresh); the helper itself guards the connection.
    const cooldown = await clearClaudeCooldownAfterClaim(deps.authIndex, answer, deps.revision);
    if (!deps.isCurrent()) return;
    notify(
      t(`claude_reset.${answer.unresolved ? 'unknown' : answer.code}`),
      !answer.unresolved && (answer.code === 'reset' || answer.code === 'already_used')
        ? 'success'
        : 'error'
    );
    if (cooldown === 'failed') {
      notify(t('quota_management.resets.cooldown_failed'), 'warning');
    }
  } catch {
    if (!deps.isCurrent()) return;
    notify(t(`claude_reset.${deps.hasUnresolvedClaim() ? 'unknown' : 'blocked'}`), 'error');
  }
}
