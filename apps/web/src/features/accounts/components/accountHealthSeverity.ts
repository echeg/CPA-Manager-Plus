export type AccountHealthSeverity =
  | 'ok'
  | 'warning'
  | 'cooldown'
  | 'critical'
  | 'disabled'
  | 'unknown';

/**
 * 把不同来源的"健康度语义"映射到统一 severity。
 * 不直接耦合 row / listItem — 调用方提供 raw 信号即可。
 */
export const severityFromQuotaStatus = (
  status: string | number | null | undefined,
  disabled?: boolean
): AccountHealthSeverity => {
  if (disabled) return 'disabled';
  const token = String(status ?? '').trim();
  switch (token) {
    case 'available':
      return 'ok';
    case 'warning':
      return 'warning';
    case 'cooldown':
      return 'cooldown';
    case 'exhausted':
      return 'critical';
    default:
      return 'unknown';
  }
};
