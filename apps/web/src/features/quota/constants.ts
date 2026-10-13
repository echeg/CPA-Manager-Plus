import type { QuotaProviderType } from './providers/types';

/** Provider navigation and the default credential grouping order. */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/** Bound both page size and concurrent quota refreshes to 20 credentials. */
export const QUOTA_PAGE_SIZE = 20;

/** Display sorting only: provider groups or the soonest recovery instant. */
export const QUOTA_SORT_MODES = ['default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

export const QUOTA_VIEW_MODES = ['ledger', 'cards', 'timeline'] as const;
export type QuotaViewMode = (typeof QUOTA_VIEW_MODES)[number];

/** Compact Cards is the default; a stored choice in `quotaPage.uiState` wins. */
export const DEFAULT_QUOTA_VIEW_MODE: QuotaViewMode = 'cards';
