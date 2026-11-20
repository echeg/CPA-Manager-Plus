import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  useRequestMonitoringAvailability,
  type RequestMonitoringUnavailableReason,
} from '@/hooks/useRequestMonitoringAvailability';
import {
  monitoringAnalyticsApi,
  type MonitoringAnalyticsEventsPageRequest,
  type MonitoringAnalyticsFilters,
  type MonitoringAnalyticsInclude,
  type MonitoringAnalyticsRequest,
  type MonitoringAnalyticsResponse,
} from '@/services/api/usageService';
import { useAuthStore } from '@/stores';

const DEFAULT_REFRESH_THROTTLE_MS = 5_000;

export interface UseMonitoringAnalyticsParams {
  fromMs?: number | null;
  toMs?: number | null;
  nowMs?: number;
  dataScopeKey?: string;
  searchQuery?: string;
  searchApiKeyHash?: string;
  filters?: MonitoringAnalyticsFilters;
  include?: MonitoringAnalyticsInclude;
  eventsPage?: MonitoringAnalyticsEventsPageRequest | null;
  throttleMs?: number;
}

export interface MonitoringAnalyticsRefreshOptions {
  force?: boolean;
  /**
   * Replace a request already in flight for the same data scope when it was sent with
   * different parameters, for example an older range end. Without it, the in-flight request
   * absorbs the refresh and its older response is kept. A manual refresh needs this.
   */
  supersedeInFlight?: boolean;
}

export interface UseMonitoringAnalyticsReturn {
  enabled: boolean;
  loading: boolean;
  error: string;
  data: MonitoringAnalyticsResponse | null;
  /**
   * The request `data` answers. After a refresh it still names the previous range end until
   * the new response arrives, so callers can tell whether two responses cover the same range.
   */
  dataRequest: MonitoringAnalyticsRequest | null;
  dataStale: boolean;
  lastRefreshedAt: Date | null;
  serviceBase: string;
  unavailableReason: RequestMonitoringUnavailableReason | '';
  refresh: (options?: MonitoringAnalyticsRefreshOptions) => Promise<void>;
}

const isFiniteTimestamp = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const stableJson = (value: unknown) => JSON.stringify(value ?? {});

const parseJson = <T>(value: string): T => JSON.parse(value) as T;

const getBrowserTimeZone = () => {
  if (typeof Intl === 'undefined') return '';
  return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
};

const buildInFlightRequestIdentityKey = (
  dataScopeKey: string | undefined,
  request: MonitoringAnalyticsRequest,
  requestKey: string
) => {
  if (!dataScopeKey) {
    return requestKey;
  }

  const eventsPage = request.include?.events_page;
  return stableJson({
    dataScopeKey,
    eventsPage: eventsPage
      ? {
          limit: eventsPage.limit ?? null,
          before_ms: eventsPage.before_ms ?? null,
          before_id: eventsPage.before_id ?? null,
        }
      : null,
  });
};

export function useMonitoringAnalytics({
  fromMs,
  toMs,
  nowMs,
  dataScopeKey,
  searchQuery,
  searchApiKeyHash,
  filters,
  include,
  eventsPage,
  throttleMs = DEFAULT_REFRESH_THROTTLE_MS,
}: UseMonitoringAnalyticsParams): UseMonitoringAnalyticsReturn {
  const managementKey = useAuthStore((state) => state.managementKey);
  const apiBase = useAuthStore((state) => state.apiBase);
  const availability = useRequestMonitoringAvailability();
  const [data, setData] = useState<MonitoringAnalyticsResponse | null>(null);
  const [dataRequest, setDataRequest] = useState<MonitoringAnalyticsRequest | null>(null);
  const [dataScopeStateKey, setDataScopeStateKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const requestIdRef = useRef(0);
  const lastStartedAtRef = useRef(0);
  const lastRequestKeyRef = useRef('');
  const inFlightRequestIdentityKeyRef = useRef('');
  const inFlightRequestKeyRef = useRef('');
  const inFlightRequestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const filtersKey = useMemo(() => stableJson(filters), [filters]);
  const includeKey = useMemo(() => stableJson(include), [include]);
  const eventsPageKey = useMemo(() => JSON.stringify(eventsPage ?? null), [eventsPage]);

  const request = useMemo<MonitoringAnalyticsRequest | null>(() => {
    if (!isFiniteTimestamp(fromMs) || !isFiniteTimestamp(toMs) || fromMs <= 0 || fromMs >= toMs) {
      return null;
    }

    const nextFilters = parseJson<MonitoringAnalyticsFilters>(filtersKey);
    const nextInclude = parseJson<MonitoringAnalyticsInclude>(includeKey);
    const nextEventsPage = parseJson<MonitoringAnalyticsEventsPageRequest | null>(eventsPageKey);
    if (nextEventsPage) {
      nextInclude.events_page = nextEventsPage;
    }

    const payload: MonitoringAnalyticsRequest = {
      from_ms: fromMs,
      to_ms: toMs,
    };
    const timeZone = getBrowserTimeZone();
    if (timeZone) {
      payload.time_zone = timeZone;
    }
    if (isFiniteTimestamp(nowMs)) {
      payload.now_ms = nowMs;
    }

    const normalizedSearchQuery = searchQuery?.trim();
    if (normalizedSearchQuery) {
      payload.search_query = normalizedSearchQuery;
    }

    const normalizedApiKeyHash = searchApiKeyHash?.trim();
    if (normalizedApiKeyHash) {
      payload.search_api_key_hash = normalizedApiKeyHash;
    }

    if (Object.keys(nextFilters).length > 0) {
      payload.filters = nextFilters;
    }
    if (Object.keys(nextInclude).length > 0) {
      payload.include = nextInclude;
    }
    return payload;
  }, [eventsPageKey, filtersKey, fromMs, includeKey, nowMs, searchApiKeyHash, searchQuery, toMs]);

  const requestKey = useMemo(() => (request ? stableJson(request) : ''), [request]);
  const inFlightRequestIdentityKey = useMemo(
    () => (request ? buildInFlightRequestIdentityKey(dataScopeKey, request, requestKey) : ''),
    [dataScopeKey, request, requestKey]
  );
  const activeDataScopeKey = dataScopeKey || requestKey;
  const serviceBase = availability.serviceBase;
  const enabled = availability.available && Boolean(serviceBase) && Boolean(request);
  const connectionScope = JSON.stringify([apiBase, serviceBase, managementKey]);
  const connectionScopeRef = useRef(connectionScope);
  connectionScopeRef.current = connectionScope;
  useLayoutEffect(() => {
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    inFlightRequestIdentityKeyRef.current = '';
    inFlightRequestKeyRef.current = '';
    inFlightRequestIdRef.current = 0;
    lastRequestKeyRef.current = '';
    lastStartedAtRef.current = 0;
    setData(null);
    setDataRequest(null);
    setDataScopeStateKey('');
    setLastRefreshedAt(null);
    setError('');
    return () => {
      requestIdRef.current += 1;
    };
  }, [connectionScope]);

  const refresh = useCallback(
    async (options: MonitoringAnalyticsRefreshOptions = {}) => {
      if (connectionScopeRef.current !== connectionScope) return;
      if (!enabled || !request || !serviceBase) {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        requestIdRef.current += 1;
        inFlightRequestIdentityKeyRef.current = '';
        inFlightRequestKeyRef.current = '';
        inFlightRequestIdRef.current = 0;
        setData(null);
        setDataRequest(null);
        setDataScopeStateKey('');
        setLastRefreshedAt(null);
        setLoading(false);
        return;
      }

      if (
        inFlightRequestIdentityKeyRef.current === inFlightRequestIdentityKey &&
        (!options.supersedeInFlight || inFlightRequestKeyRef.current === requestKey)
      ) {
        return;
      }

      const startedAt = Date.now();
      const isSameRequest = lastRequestKeyRef.current === requestKey;
      if (
        !options.force &&
        isSameRequest &&
        startedAt - lastStartedAtRef.current < Math.max(0, throttleMs)
      ) {
        return;
      }

      const requestId = requestIdRef.current + 1;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      requestIdRef.current = requestId;
      lastStartedAtRef.current = startedAt;
      lastRequestKeyRef.current = requestKey;
      inFlightRequestIdentityKeyRef.current = inFlightRequestIdentityKey;
      inFlightRequestKeyRef.current = requestKey;
      inFlightRequestIdRef.current = requestId;
      setLoading(true);
      setError('');

      try {
        const response = await monitoringAnalyticsApi.getAnalytics(
          serviceBase,
          managementKey,
          request,
          controller.signal
        );
        if (requestIdRef.current !== requestId || connectionScopeRef.current !== connectionScope)
          return;
        setData(response);
        setDataRequest(request);
        setDataScopeStateKey(activeDataScopeKey);
        setLastRefreshedAt(new Date());
      } catch (err) {
        if (controller.signal.aborted) return;
        if (requestIdRef.current !== requestId || connectionScopeRef.current !== connectionScope)
          return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (inFlightRequestIdRef.current === requestId) {
          inFlightRequestIdentityKeyRef.current = '';
          inFlightRequestKeyRef.current = '';
          inFlightRequestIdRef.current = 0;
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [
      activeDataScopeKey,
      connectionScope,
      enabled,
      inFlightRequestIdentityKey,
      managementKey,
      request,
      requestKey,
      serviceBase,
      throttleMs,
    ]
  );

  useEffect(() => {
    if (availability.checking) {
      return;
    }
    void refresh({ force: true });
  }, [availability.checking, refresh]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    },
    []
  );

  const dataStale = Boolean(dataScopeKey && data && dataScopeStateKey !== activeDataScopeKey);
  const scopedData = dataScopeKey || dataScopeStateKey === activeDataScopeKey ? data : null;
  const scopedDataRequest = scopedData ? dataRequest : null;

  return useMemo(
    () => ({
      enabled,
      loading: availability.checking || loading,
      error,
      data: scopedData,
      dataRequest: scopedDataRequest,
      dataStale,
      lastRefreshedAt,
      serviceBase,
      unavailableReason: availability.reason,
      refresh,
    }),
    [
      availability.checking,
      availability.reason,
      enabled,
      error,
      dataStale,
      lastRefreshedAt,
      loading,
      refresh,
      scopedData,
      scopedDataRequest,
      serviceBase,
    ]
  );
}
