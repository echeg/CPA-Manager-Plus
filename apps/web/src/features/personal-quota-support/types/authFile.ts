/**
 * Credential metadata used by the personal quota page.
 */

import type { RecentRequestBucket } from '@/features/quota/utils/recentRequests';

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'devin'
  | 'meta'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileCooldown {
  scope: 'model' | 'credential';
  modelKey?: string;
  reason: string;
  retryAt: string;
  remainingSeconds: number;
  backoffLevel?: number;
  httpStatus?: number;
}

export interface AuthFileCooldownSnapshot {
  /** Server observation time, not the start of the cooldown. */
  observedAt?: string;
  /** Local receipt time anchors relative timers without relying on synchronized clocks. */
  receivedAtMs: number;
  /** null = runtime state unknown; [] = known, with no active timers. */
  records: AuthFileCooldown[] | null;
}

export type AuthFileQuotaReserveMode = 'soft' | 'hard';

/** Share of every subscription window kept for services outside the proxy. */
export interface AuthFileQuotaReserve {
  /** Integer 1..99. */
  percent: number;
  /** hard: no new sessions below it; soft: last resort only. */
  mode: AuthFileQuotaReserveMode;
}

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  /** Account email. API-key credentials may expose the key in `account`, so never use that field for display. */
  email?: string;
  /** GCP / Vertex project ID used when the account email is unavailable. */
  projectId?: string;
  size?: number;
  authIndex?: string | number | null;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  lastRefresh?: string | number;
  modified?: number;
  priority?: number;
  weight?: number;
  note?: string;
  success?: unknown;
  failed?: unknown;
  /** Cumulative counters normalized from the API success/failed fields. */
  successCount?: number;
  failureCount?: number;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  /** Absent on older servers. Never interpreted as credential health. */
  cooldownSnapshot?: AuthFileCooldownSnapshot;
  /** Absent on older servers and when no reserve is configured. */
  quotaReserve?: AuthFileQuotaReserve;
  /** The selector's verdict: a window is below the reserve right now. */
  quotaReserveActive?: boolean;
  /** RFC3339 reset of the window holding the reserve; only while active. */
  quotaReserveUntil?: string;
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
  observed_at?: unknown;
  observedAt?: string;
}
