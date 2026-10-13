import type { TFunction } from 'i18next';
import { QUOTA_TAB_ORDER } from './constants';
import { ledgerWindows, summarizeLedgerWindows, type LedgerWindow } from './ledgerModel';
import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { countResets } from './resetActions';
import { buildResetInventory } from './resetInventory';

export interface QuotaTotalTile {
  provider: QuotaProviderType;
  windowId: string;
  label: string;
  credentialCount: number;
  /** Summed remaining percent; null when any account lacks this window's data. */
  remaining: number | null;
  capacity: number;
  /** Remaining percent per account, in entry order. */
  segments: (number | null)[];
  resetAtMs: number | null;
}

export interface QuotaResetsTotal {
  total: number;
  byProvider: { claude: number; codex: number };
  soonestMs: number | null;
}

export interface QuotaTotals {
  tiles: QuotaTotalTile[];
  resets: QuotaResetsTotal | null;
}

/** Claude's weekly limit is split by model; both weekly windows get their own tile. */
const CLAUDE_TOTAL_WINDOWS = ['seven-day', 'seven-day-fable'];

function tile(
  provider: QuotaProviderType,
  rows: LedgerWindow[][],
  nowMs: number
): QuotaTotalTile | null {
  const aggregate = summarizeLedgerWindows(rows, nowMs);
  if (!aggregate.primary) return null;
  return {
    provider,
    windowId: aggregate.primary.id,
    label: aggregate.primary.label,
    credentialCount: rows.length,
    remaining: aggregate.remaining,
    capacity: aggregate.capacity,
    segments: aggregate.windows.map((window) => window?.remaining ?? null),
    resetAtMs: aggregate.resetAtMs,
  };
}

/** Provider window totals and held resets for the Cards view strip. */
export function buildQuotaTotals(
  entries: QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined,
  t: TFunction,
  nowMs: number
): QuotaTotals {
  const tiles: QuotaTotalTile[] = [];
  const byProvider = { claude: 0, codex: 0 };
  let soonestMs: number | null = null;

  for (const provider of QUOTA_TAB_ORDER) {
    const group = entries.filter((entry) => entry.type === provider);
    if (group.length === 0) continue;
    const rows = group.map((entry) => ledgerWindows(provider, quotaFor(entry), t));
    const split =
      provider === 'claude'
        ? CLAUDE_TOTAL_WINDOWS.map((id) =>
            tile(
              provider,
              rows.map((windows) => windows.filter((window) => window.id === id)),
              nowMs
            )
          ).filter((value): value is QuotaTotalTile => value !== null)
        : [];
    if (split.length) tiles.push(...split);
    else {
      const aggregate = tile(provider, rows, nowMs);
      if (aggregate) tiles.push(aggregate);
    }

    if (provider !== 'claude' && provider !== 'codex') continue;
    for (const entry of group) {
      const items = buildResetInventory(provider, quotaFor(entry), nowMs)?.items ?? [];
      byProvider[provider] += countResets(items);
      const first = items[0]?.expiresAtMs;
      if (typeof first === 'number' && (soonestMs === null || first < soonestMs)) {
        soonestMs = first;
      }
    }
  }

  const total = byProvider.claude + byProvider.codex;
  return { tiles, resets: total > 0 ? { total, byProvider, soonestMs } : null };
}
