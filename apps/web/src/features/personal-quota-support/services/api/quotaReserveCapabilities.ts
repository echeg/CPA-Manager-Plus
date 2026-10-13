import { apiClient, onQuotaConnectionChange } from './client';

let maxLevels: 1 | 3 = 1;
let observedRevision: number | null = null;
const listeners = new Set<() => void>();
const setMaxLevels = (next: 1 | 3) => {
  if (next === maxLevels) return;
  maxLevels = next;
  listeners.forEach((listener) => listener());
};

/** A capability from another connection must never authorize staged writes. */
onQuotaConnectionChange(() => {
  observedRevision = null;
  setMaxLevels(1);
});

export const getQuotaReserveMaxLevels = () =>
  observedRevision === apiClient.getConnectionRevision() ? maxLevels : 1;
export const subscribeQuotaReserveCapabilities = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function observeQuotaReserveCapabilities(value: unknown, connectionRevision: number) {
  if (connectionRevision !== apiClient.getConnectionRevision()) return;
  observedRevision = connectionRevision;
  setMaxLevels(typeof value === 'number' && Number.isSafeInteger(value) && value >= 3 ? 3 : 1);
}
