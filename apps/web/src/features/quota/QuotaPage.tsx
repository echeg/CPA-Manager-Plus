/**
 * Quota page with provider navigation, ledger, cards, and timeline views.
 *
 * Refresh all quotas on entry while preserving session isolation,
 * request deduplication, and pruning removed credentials from quota caches.
 * This page owns the header refresh slot and reloads credentials on refresh.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { authFilesApi } from '@/features/personal-quota-support/services/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconSearch, IconX } from '@/components/ui/icons';
import { Select } from '@/features/quota/components/Select';
import { Skeleton } from '@/features/quota/components/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/features/quota/hooks/useNow';
import { useRevealGroup } from '@/features/quota/hooks/motion';
import {
  useAuthStore,
  useQuotaStore,
  useThemeStore,
} from '@/features/personal-quota-support/stores';
import type { AuthFileItem, ResolvedTheme } from '@/features/personal-quota-support/types';
import { getQuotaCacheKey } from '@/features/quota/utils/quota/identity';
import { ProviderTabs } from '@/features/quota/components/ProviderTabs';
import { QuotaHeader } from './components/QuotaHeader';
import { QuotaCompactCardItem } from './components/QuotaCompactCardItem';
import { QuotaTimeline } from './components/QuotaTimeline';
import { QuotaLedger } from './components/QuotaLedger';
import { QuotaSettingsBar } from './components/QuotaSettingsToolbar';
import { QuotaTotalsStrip } from './components/QuotaTotalsStrip';
import { buildQuotaTotals } from './quotaTotalsModel';
import { maskQuotaName, maskQuotaText } from './ledgerModel';
import {
  DEFAULT_QUOTA_VIEW_MODE,
  QUOTA_PAGE_SIZE,
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  QUOTA_VIEW_MODES,
  type QuotaSortMode,
  type QuotaTabId,
  type QuotaViewMode,
} from './constants';
import {
  buildTabCounts,
  classifyQuotaFiles,
  filterEntriesByTab,
  filterEntriesBySearch,
  hasQuotaReserve,
  mergeQuotaReserveVerdicts,
  paginate,
  sortQuotaEntries,
  type QuotaFileEntry,
} from './logic';
import { nextRecoveryMs } from './resetSchedule';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import { readQuotaUiState, writeQuotaUiState } from './uiState';
import styles from './QuotaPage.module.scss';

const TAB_IDS: string[] = ['all', ...QUOTA_TAB_ORDER];
const SKELETON_CARD_COUNT = 6;

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QuotaTabId>(() => readQuotaUiState()?.tab ?? 'all');
  const [sortMode, setSortMode] = useState<QuotaSortMode>(
    () => readQuotaUiState()?.sortMode ?? 'default'
  );
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<QuotaViewMode>(
    () => readQuotaUiState()?.viewMode ?? DEFAULT_QUOTA_VIEW_MODE
  );
  const [showEmails, setShowEmails] = useState(false);
  const displayNameFor = useCallback(
    (name: string) => (showEmails ? name : maskQuotaName(name)),
    [showEmails]
  );
  const formatDisplayText = useCallback(
    (text: string) => (showEmails ? text : maskQuotaText(text)),
    [showEmails]
  );
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Stagger the title, metadata, actions, and tabs on initial display.
  const revealRef = useRevealGroup<HTMLDivElement>();

  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [unsupportedGeneration, setUnsupportedGeneration] = useState<number | null>(null);
  const unsupportedBackend = unsupportedGeneration === sessionGeneration;
  const disableControls = connectionStatus !== 'connected' || unsupportedBackend;

  /* Credential list. */
  const [filesGeneration, setFilesGeneration] = useState<number | null>(null);
  const listRequestRef = useRef(0);
  const loadFiles = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesGeneration(null);
      setLoading(false);
      return null;
    }
    const isCurrent = () =>
      requestId === listRequestRef.current &&
      sessionGeneration === useQuotaStore.getState().cacheGeneration;
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      if (!isCurrent()) return null;
      setUnsupportedGeneration(null);
      const loadedFiles = data?.files || [];
      setFiles(loadedFiles);
      setFilesGeneration(sessionGeneration);
      return loadedFiles;
    } catch (err: unknown) {
      if (!isCurrent()) return null;
      const requiresV8 =
        err !== null &&
        typeof err === 'object' &&
        'apiCode' in err &&
        err.apiCode === 'quota_v8_required';
      if (requiresV8) setUnsupportedGeneration(sessionGeneration);
      const message = requiresV8
        ? t('quota_management.v8_required')
        : err instanceof Error
          ? err.message
          : t('notification.refresh_failed');
      setError(message);
      return null;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connectionStatus, sessionGeneration, t]);

  // A management quota probe updates the backend's reserve verdict, so re-read it afterwards.
  // A newer list load or session wins; a failed read keeps the last verdict.
  const verdictRequestRef = useRef(0);
  const reloadReserveVerdicts = useCallback(async () => {
    if (connectionStatus !== 'connected') return;
    const requestId = ++verdictRequestRef.current;
    const listId = listRequestRef.current;
    try {
      const data = await authFilesApi.list();
      if (
        requestId !== verdictRequestRef.current ||
        listId !== listRequestRef.current ||
        sessionGeneration !== useQuotaStore.getState().cacheGeneration
      ) {
        return;
      }
      setFiles((current) => mergeQuotaReserveVerdicts(current, data?.files || []));
    } catch {
      // The badge keeps the verdict from the last list read.
    }
  }, [connectionStatus, sessionGeneration]);

  /* Quota caches provide the recovery instants used by display sorting. */

  const lastRefreshAt = useQuotaStore((state) => state.lastRefreshAt);
  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const quotaByType = useMemo<Record<QuotaProviderType, Record<string, QuotaCardState>>>(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: devinQuota,
        kimi: kimiQuota,
        meta: metaQuota,
        xai: xaiQuota,
      }) as unknown as Record<QuotaProviderType, Record<string, QuotaCardState>>,
    [antigravityQuota, claudeQuota, codexQuota, devinQuota, kimiQuota, metaQuota, xaiQuota]
  );

  const getQuota = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined =>
      quotaByType[entry.type][getQuotaCacheKey(entry.file)],
    [quotaByType]
  );

  /* Classification, filtering, display sorting, and pagination. */

  // Subscribe to the clock only when recovery sorting needs it.
  const tick = useNow(sortMode !== 'default');
  const sortNow = sortMode === 'default' ? 0 : tick;

  // Never render identities retained from an earlier connection, even when the new list fails.
  const entries = useMemo(
    () => (filesGeneration === sessionGeneration ? classifyQuotaFiles(files) : []),
    [files, filesGeneration, sessionGeneration]
  );
  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  const filteredEntries = useMemo(
    () => filterEntriesBySearch(filterEntriesByTab(entries, tab), search),
    [entries, tab, search]
  );
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const resolveNextRecovery = useCallback(
    (entry: QuotaFileEntry) => nextRecoveryMs(entry.type, getQuota(entry), sortNow),
    [getQuota, sortNow]
  );
  // Sort before pagination so recovery order applies to all matching accounts.
  const cardsNow = useNow(viewMode === 'cards');
  const totals = useMemo(
    () => (viewMode === 'cards' ? buildQuotaTotals(filteredEntries, getQuota, t, cardsNow) : null),
    [viewMode, filteredEntries, getQuota, t, cardsNow]
  );
  const sortedEntries = useMemo(
    () => sortQuotaEntries(filteredEntries, sortMode, resolveNextRecovery),
    [filteredEntries, sortMode, resolveNextRecovery]
  );

  const { pageItems, currentPage, totalPages } = useMemo(
    () => paginate(sortedEntries, page, QUOTA_PAGE_SIZE),
    [sortedEntries, page]
  );

  const handleTabChange = useCallback((next: string) => {
    setTab(next as QuotaTabId);
    setPage(1);
    writeQuotaUiState({ tab: next as QuotaTabId });
  }, []);

  const handleSortModeChange = useCallback((next: string) => {
    setSortMode(next as QuotaSortMode);
    setPage(1);
    writeQuotaUiState({ sortMode: next as QuotaSortMode });
  }, []);

  const sortOptions = useMemo(
    () =>
      QUOTA_SORT_MODES.map((mode) => ({ value: mode, label: t(`quota_management.sort_${mode}`) })),
    [t]
  );

  const { loadedCount, attentionCount } = useMemo(() => {
    let loaded = 0;
    let attention = 0;
    entries.forEach((entry) => {
      const status = quotaByType[entry.type][getQuotaCacheKey(entry.file)]?.status;
      if (status === 'success') loaded += 1;
      else if (status === 'error') attention += 1;
    });
    return { loadedCount: loaded, attentionCount: attention };
  }, [entries, quotaByType]);

  // Prune quota observations only after the current credential list has loaded.
  useEffect(() => {
    if (loading || error || filesGeneration !== sessionGeneration) return;
    const survivorsByType = new Map<QuotaProviderType, Set<string>>(
      QUOTA_TAB_ORDER.map((type) => [type, new Set<string>()])
    );
    entries.forEach((entry) => survivorsByType.get(entry.type)?.add(getQuotaCacheKey(entry.file)));

    QUOTA_TAB_ORDER.forEach((type) => {
      const survivors = survivorsByType.get(type) ?? new Set<string>();
      const setQuota = getQuotaSetter(QUOTA_ADAPTERS[type]);
      setQuota((prev) => {
        const staleKeys = Object.keys(prev).filter((name) => !survivors.has(name));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        staleKeys.forEach((name) => delete next[name]);
        return next;
      });
    });
  }, [entries, error, filesGeneration, loading, sessionGeneration]);

  /* Loading and quota actions. */

  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  // Shared by every view, so a Cards action cannot leave a stale verdict for the Ledger.
  const afterQuotaProbe = useCallback(
    (file: AuthFileItem) => {
      if (file.quotaReserve) void reloadReserveVerdicts();
    },
    [reloadReserveVerdicts]
  );
  const { resettingKeys, refreshQuota, performReset } = useQuotaActions(
    disableControls,
    formatDisplayText,
    afterQuotaProbe
  );

  const refreshRef = useRef<{ generation: number; promise: Promise<void> } | null>(null);

  // Coalesce the entire refresh so another click cannot replace its credential list.
  const handleRefreshAll = useCallback(() => {
    if (refreshRef.current?.generation === sessionGeneration) {
      return refreshRef.current.promise;
    }
    const pending = {
      generation: sessionGeneration,
      promise: (async () => {
        const loadedFiles = await loadFiles();
        if (
          loadedFiles === null ||
          sessionGeneration !== useQuotaStore.getState().cacheGeneration
        ) {
          return;
        }
        // Refresh all credentials, independent of filters and pagination.
        await loadQuota(classifyQuotaFiles(loadedFiles));
        if (hasQuotaReserve(loadedFiles)) await reloadReserveVerdicts();
      })(),
    };
    refreshRef.current = pending;
    pending.promise = pending.promise.finally(() => {
      if (refreshRef.current === pending) refreshRef.current = null;
    });
    return pending.promise;
  }, [loadFiles, loadQuota, reloadReserveVerdicts, sessionGeneration]);

  useHeaderRefresh(handleRefreshAll);

  useEffect(() => {
    void handleRefreshAll();
    return () => {
      listRequestRef.current += 1;
      refreshRef.current = null;
    };
  }, [handleRefreshAll]);

  const canUseActions = !disableControls && !loading && filesGeneration === sessionGeneration;
  // Skeletons only stand in for a session's first list; a later refresh keeps the view mounted,
  // so open Ledger drawers show their loading state instead of closing.
  const initialLoading = loading && filesGeneration !== sessionGeneration;

  /* Rendering. */

  const isEmpty = !initialLoading && filteredEntries.length === 0;

  return (
    <div className={styles.page} ref={revealRef}>
      <QuotaHeader
        totalCount={entries.length}
        loadedCount={loadedCount}
        attentionCount={attentionCount}
        refreshing={loading || batchLoading}
        lastRefreshAt={lastRefreshAt}
        disableControls={connectionStatus !== 'connected'}
        onRefreshAll={handleRefreshAll}
        showEmails={showEmails}
        onToggleEmails={() => setShowEmails((current) => !current)}
      />

      <section className={styles.workbench}>
        <QuotaSettingsBar
          key={sessionGeneration}
          disabled={disableControls}
          files={filesGeneration === sessionGeneration ? files : []}
          showEmails={showEmails}
          resolvedTheme={resolvedTheme}
        />
        {/* Keep provider navigation above the search and display sort controls. */}
        <div className={styles.tabsRow} data-reveal>
          <ProviderTabs
            types={TAB_IDS}
            counts={tabCounts}
            active={tab}
            resolvedTheme={resolvedTheme}
            onChange={handleTabChange}
          />
          <div className={styles.viewMode}>
            <Select
              value={viewMode}
              options={QUOTA_VIEW_MODES.map((mode) => ({
                value: mode,
                label: t(`quota_management.ledger.view_${mode}`),
              }))}
              ariaLabel={t('quota_management.ledger.view_label')}
              size="sm"
              onChange={(next) => {
                setViewMode(next as QuotaViewMode);
                writeQuotaUiState({ viewMode: next as QuotaViewMode });
              }}
            />
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.search}>
            <IconSearch size={16} className={styles.searchIcon} aria-hidden="true" />
            <input
              ref={searchInputRef}
              className={styles.searchInput}
              type="search"
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder={t('quota_management.search_placeholder')}
              aria-label={t('quota_management.search_label')}
            />
            {search && (
              <button
                type="button"
                className={styles.clearSearch}
                aria-label={t('quota_management.search_clear')}
                title={t('quota_management.search_clear')}
                onClick={() => {
                  handleSearchChange('');
                  searchInputRef.current?.focus();
                }}
              >
                <IconX size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className={styles.sort}>
            <Select
              value={sortMode}
              options={sortOptions}
              onChange={handleSortModeChange}
              ariaLabel={t('quota_management.sort_label')}
              size="sm"
            />
          </div>
        </div>

        {error && !unsupportedBackend && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        {unsupportedBackend ? (
          <EmptyState
            title={t('quota_management.v8_required_title')}
            description={t('quota_management.v8_required')}
            action={
              <Link className="btn btn-secondary" to="/accounts">
                {t('quota_management.open_accounts')}
              </Link>
            }
          />
        ) : initialLoading ? (
          <div className={styles.grid} aria-hidden="true">
            {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
              <Skeleton key={index} height={168} rounded={14} />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            title={
              search.trim()
                ? t('quota_management.search_empty_title')
                : tab === 'all'
                  ? t('quota_management.empty_title')
                  : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_title`)
            }
            description={
              search.trim()
                ? t('quota_management.search_empty_desc')
                : tab === 'all'
                  ? t('quota_management.empty_desc')
                  : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_desc`)
            }
            action={
              search.trim() ? (
                <Button variant="secondary" size="sm" onClick={() => handleSearchChange('')}>
                  {t('quota_management.search_clear')}
                </Button>
              ) : tab === 'all' ? undefined : (
                <Button variant="secondary" size="sm" onClick={() => handleTabChange('all')}>
                  {t('auth_files.filter_all')}
                </Button>
              )
            }
          />
        ) : viewMode === 'ledger' ? (
          <QuotaLedger
            entries={pageItems}
            summaryEntries={filteredEntries}
            quotaFor={getQuota}
            resolvedTheme={resolvedTheme}
            showEmails={showEmails}
            canRefresh={canUseActions}
            onRefresh={(entry) => void refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
            onReset={(entry) => performReset(entry.file, QUOTA_ADAPTERS[entry.type])}
            resettingKeys={resettingKeys}
          />
        ) : viewMode === 'timeline' ? (
          <QuotaTimeline
            entries={pageItems}
            quotaFor={getQuota}
            displayNameFor={displayNameFor}
            resolvedTheme={resolvedTheme}
          />
        ) : (
          <>
            {totals && <QuotaTotalsStrip totals={totals} now={cardsNow} />}
            <div className={styles.grid}>
              {pageItems.map((entry) => (
                <QuotaCompactCardItem
                  key={`${entry.type}:${getQuotaCacheKey(entry.file)}`}
                  entry={entry}
                  quota={getQuota(entry)}
                  resolvedTheme={resolvedTheme}
                  now={cardsNow}
                  showEmails={showEmails}
                  canRefresh={canUseActions}
                  codexResetting={resettingKeys.has(getQuotaCacheKey(entry.file))}
                  onRefresh={() => void refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
                  onReset={() => performReset(entry.file, QUOTA_ADAPTERS[entry.type])}
                  onReserveSaved={reloadReserveVerdicts}
                />
              ))}
            </div>
          </>
        )}

        {!initialLoading && filteredEntries.length > QUOTA_PAGE_SIZE && (
          <div className={styles.pagination}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              {t('auth_files.pagination_prev')}
            </Button>
            <div className={styles.pageInfo}>
              {t('auth_files.pagination_info', {
                current: currentPage,
                total: totalPages,
                count: filteredEntries.length,
              })}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              {t('auth_files.pagination_next')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
