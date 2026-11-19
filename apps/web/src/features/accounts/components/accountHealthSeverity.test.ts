import { describe, expect, it } from 'vitest';
import { severityFromQuotaStatus } from './accountHealthSeverity';

describe('severityFromQuotaStatus', () => {
  it.each([
    ['available', 'ok'],
    ['warning', 'warning'],
    ['cooldown', 'cooldown'],
    ['exhausted', 'critical'],
    [' available ', 'ok'],
    ['other', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    [0, 'unknown'],
  ] as const)('maps %j to %s', (status, severity) => {
    expect(severityFromQuotaStatus(status)).toBe(severity);
  });

  it('reports a disabled account as disabled whatever its quota status', () => {
    expect(severityFromQuotaStatus('available', true)).toBe('disabled');
  });
});
