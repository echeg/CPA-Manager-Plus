import type { ApiKeyAlias } from '@/services/api/usageService';
import { sha256Hex } from '@/utils/apiKeyHash';
import { cpInstanceNameFromKey } from '@/utils/apiKeyName';
import { maskApiKey, maskSensitiveText } from '@/utils/format';
import { formatApiKeyHashLabel, readString } from './base';

export type ApiKeyDisplayInfo = {
  label: string;
  masked: string;
  copyValue?: string;
};

export const sanitizeApiKeyDisplayText = (value: string, fallback = '') => {
  const trimmed = readString(value);
  if (!trimmed) return fallback;
  return maskSensitiveText(trimmed) || fallback;
};

const maskSuffix = (masked: string) => ` (${masked})`;

export const buildApiKeyDisplayMap = (
  apiKeys: string[] = [],
  apiKeyAliases: ApiKeyAlias[] = []
): Map<string, ApiKeyDisplayInfo> => {
  const map = new Map<string, ApiKeyDisplayInfo>();
  // Hashes labelled with a CP instance name (no alias).
  const named = new Set<string>();
  apiKeys.forEach((apiKey) => {
    const hash = sha256Hex(apiKey).toLowerCase();
    if (!hash || map.has(hash)) return;
    const masked = maskApiKey(apiKey) || formatApiKeyHashLabel(hash);
    // A bridex CP key carries its instance name; stored aliases below still win.
    const name = sanitizeApiKeyDisplayText(cpInstanceNameFromKey(apiKey) ?? '');
    if (name) named.add(hash);
    map.set(hash, { label: name || masked, masked, copyValue: apiKey });
  });
  apiKeyAliases.forEach((entry) => {
    const hash = readString(entry.apiKeyHash).toLowerCase();
    const alias = sanitizeApiKeyDisplayText(readString(entry.alias));
    if (!hash || !alias) return;
    const existing = map.get(hash);
    named.delete(hash);
    map.set(hash, {
      label: alias,
      masked: existing?.masked || existing?.label || formatApiKeyHashLabel(hash),
      copyValue: existing?.copyValue,
    });
  });
  // Every key of one CP instance has the same name (a failed rotation leaves the old key
  // on the proxy), and aliases are unique only among themselves. A name that another
  // label also uses gets the mask, so selects and charts still tell the keys apart.
  const labelCounts = new Map<string, number>();
  map.forEach(({ label }) => labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1));
  named.forEach((hash) => {
    const info = map.get(hash);
    if (info && (labelCounts.get(info.label) ?? 0) > 1) {
      map.set(hash, { ...info, label: `${info.label}${maskSuffix(info.masked)}` });
    }
  });
  return map;
};

/**
 * The label already shows the mask: it is the mask, or a shared name with the mask
 * appended by `buildApiKeyDisplayMap`. Screens that put the mask beside a name skip it then.
 */
export const labelShowsMask = (label: string, masked: string) =>
  label === masked || (Boolean(masked) && label.endsWith(maskSuffix(masked)));

export const shouldPreferApiKeyAlias = (label: string, masked: string) =>
  Boolean(label) && label !== masked && !label.startsWith('sha256:');
