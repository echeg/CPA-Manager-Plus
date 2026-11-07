/**
 * Client keys issued by the bridex control plane (`bridex-cp`,
 * `src/provisioning/proxyKeys.ts`) have the form
 * `sk-bx-<instance name>-<32 base62 chars>`. Instance names follow the CP rule
 * `^[a-z0-9][a-z0-9-]{1,30}$` (`bridex-cp/src/api/admin.ts`); when the CP
 * revokes the last key it leaves the placeholder `sk-bx-_placeholder-<32>`.
 *
 * The format is owned by `bridex-cp`. If it changes there, this parser stops
 * matching and the panel falls back to the masked key.
 */
const CP_CLIENT_KEY_PATTERN = /^sk-bx-(_placeholder|[a-z0-9][a-z0-9-]{1,30})-[A-Za-z0-9]{32}$/;

/** Returns the bridex instance name embedded in a CP-issued key, or `null`. */
export const cpInstanceNameFromKey = (key: string): string | null => {
  const match = CP_CLIENT_KEY_PATTERN.exec(String(key ?? '').trim());
  return match ? match[1] : null;
};
