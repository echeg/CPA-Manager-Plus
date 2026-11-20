import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useMonitoringAnalytics,
  type UseMonitoringAnalyticsParams,
  type UseMonitoringAnalyticsReturn,
} from '@/features/monitoring/hooks/useMonitoringAnalytics';
import type {
  MonitoringAnalyticsApiKeyStatRow,
  MonitoringAnalyticsCoverage,
  MonitoringAnalyticsModelStat,
  MonitoringAnalyticsModelTimelinePoint,
  MonitoringAnalyticsRequest,
  MonitoringAnalyticsResponse,
} from '@/services/api/usageService';
import { useUsageAnalytics } from './useUsageAnalytics';

vi.mock('@/features/monitoring/hooks/useMonitoringAnalytics', () => ({
  useMonitoringAnalytics: vi.fn(),
}));

vi.mock('@/features/monitoring/hooks/useUsageData', () => ({
  useUsageData: () => ({ apiKeyAliases: [], loadApiKeyAliases: vi.fn() }),
}));

const monitoringMetaMocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock('@/features/monitoring/services/monitoringMetaService', () => ({
  loadMonitoringMetaPayload: monitoringMetaMocks.load,
}));

vi.mock('@/stores', () => ({
  useConfigStore: (selector: (state: { config: null }) => unknown) => selector({ config: null }),
}));

const useMonitoringAnalyticsMock = vi.mocked(useMonitoringAnalytics);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const archivedCoverage: MonitoringAnalyticsCoverage = {
  scope: 'time_range',
  mode: 'mixed',
  raw_complete: false,
  core_aggregate_used: true,
  raw_event_count: 4,
  raw_deleted_event_count: 2,
  min_deleted_timestamp_ms: 1,
  max_deleted_timestamp_ms: 2,
  fidelity_limitations: ['event_details_require_raw_events'],
};

const emptyAnalyticsResponse: MonitoringAnalyticsResponse = {
  generated_at_ms: 1,
  granularity: 'hour',
  coverage: archivedCoverage,
};
const HOUR_MS = 60 * 60 * 1000;

const createApiKeyStatRow = (
  overrides: Partial<MonitoringAnalyticsApiKeyStatRow> = {}
): MonitoringAnalyticsApiKeyStatRow => ({
  id: 'key-a',
  api_key_hash: 'key-a',
  calls: 6,
  success_calls: 6,
  failure_calls: 0,
  success_rate: 1,
  input_tokens: 600,
  output_tokens: 0,
  cached_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 600,
  cost: 0.6,
  average_latency_ms: null,
  last_seen_ms: 1,
  ...overrides,
});

const createModelStat = (
  overrides: Partial<MonitoringAnalyticsModelStat> = {}
): MonitoringAnalyticsModelStat => ({
  model: 'model-a',
  calls: 6,
  success_calls: 6,
  failure_calls: 0,
  success_rate: 1,
  input_tokens: 600,
  output_tokens: 0,
  cached_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 600,
  cost: 6,
  ...overrides,
});

const localHourStartMs = (timestampMs: number) => {
  const date = new Date(timestampMs);
  date.setMinutes(0, 0, 0);
  return date.getTime();
};

describe('useUsageAnalytics request orchestration', () => {
  let renderer: ReactTestRenderer | null = null;
  let latestResult: ReturnType<typeof useUsageAnalytics> | null = null;
  let selectorError = '';
  let credentialTimelineError = '';
  let credentialTimelineLoading = false;
  let emptyAuxiliarySnapshot = false;
  let auxiliaryScopeStale = false;
  let apiKeyTimelineAvailable = true;
  let modelTimelineAvailable = true;
  let modelTimelineError = '';
  // The request the model timeline data answers, when it predates the current one (a
  // refresh the follow-up has not answered yet). By default every response is current.
  let modelTimelineDataRequest: MonitoringAnalyticsRequest | null = null;
  let apiKeyTimelineError = '';
  // The same for the API key timeline follow-up.
  let apiKeyTimelineDataRequest: MonitoringAnalyticsRequest | null = null;
  // The same for the main response, whose timeline then starts at that request's range.
  let mainDataRequest: MonitoringAnalyticsRequest | null = null;
  let modelStats: MonitoringAnalyticsModelStat[] = [];
  let mainTimelineBucketCalls = 5;
  let apiKeyStats: MonitoringAnalyticsApiKeyStatRow[] = [createApiKeyStatRow()];
  const mainRefresh = vi.fn();
  const selectorRefresh = vi.fn();
  const auxiliaryRefresh = vi.fn();
  const modelTimelineRefresh = vi.fn();

  // model-a runs in both buckets, model-b only in the later one. Their sums match the
  // main timeline buckets (5 and 5 calls), while the estimate smears model-b into both.
  const modelTimelinePoints = (startMs: number): MonitoringAnalyticsModelTimelinePoint[] => [
    { model: 'model-a', bucket_ms: startMs, calls: 5, tokens: 500, success: 5, failure: 0 },
    {
      model: 'model-a',
      bucket_ms: startMs + 2 * HOUR_MS,
      calls: 1,
      tokens: 100,
      success: 1,
      failure: 0,
    },
    {
      model: 'model-b',
      bucket_ms: startMs + 2 * HOUR_MS,
      calls: 4,
      tokens: 400,
      success: 4,
      failure: 0,
    },
    { model: 'model-c', bucket_ms: startMs, calls: 9, tokens: 900, success: 9, failure: 0 },
  ];

  const resultFor = (params: UseMonitoringAnalyticsParams): UseMonitoringAnalyticsReturn => {
    const selectors = Boolean(params.include?.filter_selectors);
    const main = Boolean(params.include?.summary);
    const credentialTimeline = Boolean(params.include?.credential_timeline);
    const apiKeyTimeline = Boolean(params.include?.api_key_timeline);
    const modelTimeline = Boolean(params.include?.model_timeline);
    const currentRequest: MonitoringAnalyticsRequest | null =
      typeof params.fromMs === 'number' && typeof params.toMs === 'number'
        ? { from_ms: params.fromMs, to_ms: params.toMs, now_ms: params.nowMs }
        : null;
    const answeredRequest =
      (main
        ? mainDataRequest
        : modelTimeline
          ? modelTimelineDataRequest
          : apiKeyTimeline
            ? apiKeyTimelineDataRequest
            : null) ?? currentRequest;
    const mainTimelineStartMs = answeredRequest ? localHourStartMs(answeredRequest.from_ms) : 0;
    const mainData = params.include?.credential_stats
      ? {
          ...emptyAnalyticsResponse,
          credential_stats: [
            {
              id: 'credential-a.json',
              auth_file_snapshot: 'credential-a.json',
              auth_index: 'auth-a',
              calls: 10,
              success_calls: 9,
              failure_calls: 1,
              success_rate: 0.9,
              input_tokens: 100,
              output_tokens: 50,
              cached_tokens: 0,
              cache_read_tokens: 0,
              cache_creation_tokens: 0,
              total_tokens: 150,
              cost: 1,
              average_latency_ms: 100,
              last_seen_ms: 1,
            },
          ],
        }
      : params.include?.api_key_stats
        ? {
            ...emptyAnalyticsResponse,
            timeline: [
              {
                bucket_ms: mainTimelineStartMs,
                label: '00:00',
                calls: mainTimelineBucketCalls,
                tokens: mainTimelineBucketCalls * 100,
                success: mainTimelineBucketCalls,
                failure: 0,
              },
              {
                bucket_ms: mainTimelineStartMs + 2 * HOUR_MS,
                label: '01:00',
                calls: mainTimelineBucketCalls,
                tokens: mainTimelineBucketCalls * 100,
                success: mainTimelineBucketCalls,
                failure: 0,
              },
            ],
            api_key_stats: apiKeyStats,
            ...(modelStats.length > 0 ? { model_stats: modelStats } : {}),
          }
        : emptyAnalyticsResponse;
    const result: Omit<UseMonitoringAnalyticsReturn, 'dataRequest'> = {
      enabled: Boolean(params.fromMs && params.toMs),
      loading: credentialTimeline ? credentialTimelineLoading : false,
      error: selectors
        ? selectorError
        : credentialTimeline
          ? credentialTimelineError
          : modelTimeline
            ? modelTimelineError
            : apiKeyTimeline
              ? apiKeyTimelineError
              : '',
      data:
        emptyAuxiliarySnapshot && !main && !selectors
          ? emptyAnalyticsResponse
          : selectors
            ? selectorError
              ? null
              : {
                  ...emptyAnalyticsResponse,
                  filter_options: {
                    models: ['gpt-a'],
                    api_key_hashes: ['key-a'],
                    providers: ['codex'],
                    auth_files: ['account.json'],
                  },
                }
            : main
              ? mainData
              : apiKeyTimeline && apiKeyTimelineAvailable
                ? {
                    ...emptyAnalyticsResponse,
                    api_key_timeline: [
                      {
                        api_key_hash: 'key-a',
                        bucket_ms: mainTimelineStartMs,
                        calls: 2,
                        tokens: 200,
                        success: 2,
                        failure: 0,
                      },
                      {
                        api_key_hash: 'key-a',
                        bucket_ms: mainTimelineStartMs + 2 * HOUR_MS,
                        calls: 4,
                        tokens: 400,
                        success: 4,
                        failure: 0,
                      },
                    ],
                  }
                : modelTimeline
                  ? modelTimelineAvailable
                    ? {
                        ...emptyAnalyticsResponse,
                        model_timeline: modelTimelinePoints(mainTimelineStartMs).filter((point) =>
                          (params.filters?.models ?? []).includes(point.model)
                        ),
                      }
                    : // An older backend answers the request but has no model_timeline field.
                      { ...emptyAnalyticsResponse }
                  : credentialTimeline && !credentialTimelineError && !credentialTimelineLoading
                    ? {
                        ...emptyAnalyticsResponse,
                        credential_timeline: [
                          {
                            id: 'credential-a.json',
                            auth_file_snapshot: 'credential-a.json',
                            bucket_ms: 1,
                            calls: 10,
                            tokens: 150,
                            success: 9,
                            failure: 1,
                          },
                        ],
                      }
                    : null,
      dataStale: !main && !selectors && auxiliaryScopeStale,
      lastRefreshedAt: null,
      serviceBase: 'http://manager.local',
      unavailableReason: '',
      refresh: selectors
        ? selectorRefresh
        : main
          ? mainRefresh
          : modelTimeline
            ? modelTimelineRefresh
            : auxiliaryRefresh,
    };
    return {
      ...result,
      dataRequest: result.data ? answeredRequest : null,
    };
  };

  const lastParams = (predicate: (params: UseMonitoringAnalyticsParams) => boolean) => {
    const calls = useMonitoringAnalyticsMock.mock.calls.map(([params]) => params).filter(predicate);
    return calls[calls.length - 1];
  };

  function Harness() {
    const result = useUsageAnalytics();
    useEffect(() => {
      latestResult = result;
    }, [result]);
    return null;
  }

  beforeEach(() => {
    selectorError = '';
    credentialTimelineError = '';
    credentialTimelineLoading = false;
    emptyAuxiliarySnapshot = false;
    auxiliaryScopeStale = false;
    apiKeyTimelineAvailable = true;
    modelTimelineAvailable = true;
    modelTimelineError = '';
    modelTimelineDataRequest = null;
    apiKeyTimelineError = '';
    apiKeyTimelineDataRequest = null;
    mainDataRequest = null;
    modelStats = [];
    mainTimelineBucketCalls = 5;
    apiKeyStats = [createApiKeyStatRow()];
    latestResult = null;
    mainRefresh.mockReset();
    selectorRefresh.mockReset();
    auxiliaryRefresh.mockReset();
    modelTimelineRefresh.mockReset();
    monitoringMetaMocks.load.mockReset().mockResolvedValue({
      authFiles: [],
      authFilesLoaded: true,
      channels: [],
      channelsLoaded: true,
      error: '',
    });
    useMonitoringAnalyticsMock.mockReset();
    useMonitoringAnalyticsMock.mockImplementation(resultFor);
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  const renderHook = async (initialEntry = '/usage-analytics') => {
    await act(async () => {
      renderer = create(
        <MemoryRouter initialEntries={[initialEntry]}>
          <Harness />
        </MemoryRouter>
      );
      await Promise.resolve();
    });
  };

  it('uses a tab-scoped main request and a tab-independent selector request', async () => {
    await renderHook();

    const overview = lastParams((params) => Boolean(params.include?.summary));
    const selectors = lastParams((params) => Boolean(params.include?.filter_selectors));
    expect(overview?.include).toEqual({
      summary: true,
      summary_profile: 'compact',
      summary_percentiles: true,
      summary_comparison: true,
      timeline: true,
      model_stats: true,
      channel_share: true,
      api_key_stats: true,
      anomaly_points: true,
      granularity: 'hour',
    });
    expect(JSON.parse(overview?.dataScopeKey ?? '{}')).toMatchObject({ activeTab: 'overview' });
    expect(selectors?.include).toEqual({ filter_options: true, filter_selectors: true });
    expect(JSON.parse(selectors?.dataScopeKey ?? '{}')).not.toHaveProperty('activeTab');
    expect(latestResult?.filterOptions).toMatchObject({
      models: ['gpt-a'],
      api_key_hashes: ['key-a'],
    });
    expect(latestResult?.coverage).toEqual(archivedCoverage);

    const selectorScope = selectors?.dataScopeKey;
    await act(async () => {
      latestResult?.setActiveTab('heatmap');
    });

    const heatmap = lastParams((params) => Boolean(params.include?.summary));
    const selectorsAfterTab = lastParams((params) => Boolean(params.include?.filter_selectors));
    expect(heatmap?.include).toEqual({
      summary: true,
      summary_profile: 'compact',
      heatmap: true,
      granularity: 'hour',
    });
    expect(JSON.parse(heatmap?.dataScopeKey ?? '{}')).toMatchObject({ activeTab: 'heatmap' });
    expect(selectorsAfterTab?.dataScopeKey).toBe(selectorScope);
  });

  it('fills missing buckets in the main usage timeline from the active range', async () => {
    await renderHook();

    const overview = lastParams((params) => Boolean(params.include?.summary));
    expect(typeof overview?.fromMs).toBe('number');
    const firstBucketMs = localHourStartMs(overview?.fromMs as number);

    expect(latestResult?.timeline.slice(0, 3).map((point) => point.bucketMs)).toEqual([
      firstBucketMs,
      firstBucketMs + HOUR_MS,
      firstBucketMs + 2 * HOUR_MS,
    ]);
    expect(latestResult?.timeline[1]).toMatchObject({
      requestCount: 0,
      totalTokens: 0,
      successCount: 0,
      failureCount: 0,
      averageLatencyMs: null,
      p95LatencyMs: null,
      p95TtftMs: null,
    });
  });

  it('loads exact timeline buckets for the visible client keys on overview and trends', async () => {
    await renderHook();

    const apiKeyTimeline = lastParams((params) => Boolean(params.include?.api_key_timeline));
    expect(apiKeyTimeline?.include).toEqual({ granularity: 'hour', api_key_timeline: true });
    expect(apiKeyTimeline?.filters).toMatchObject({ api_key_hashes: ['key-a'] });
    expect(JSON.parse(apiKeyTimeline?.dataScopeKey ?? '{}')).toMatchObject({
      activeTab: 'overview',
      apiKeyHashes: ['key-a'],
    });
    expect(
      latestResult?.apiKeyTrendSeries[0].points.slice(0, 3).map((point) => point.value)
    ).toEqual([2, 0, 4]);

    await act(async () => {
      latestResult?.setActiveTab('trends');
      await Promise.resolve();
    });

    const trendsTimeline = lastParams((params) => Boolean(params.include?.api_key_timeline));
    expect(JSON.parse(trendsTimeline?.dataScopeKey ?? '{}')).toMatchObject({
      activeTab: 'trends',
      apiKeyHashes: ['key-a'],
    });
  });

  it('never uses fallback API key IDs for default selections or timeline requests', async () => {
    apiKeyStats = [
      createApiKeyStatRow({
        id: 'unknown-client-api-key:missing-client-key',
        api_key_hash: '',
      }),
      createApiKeyStatRow({ id: 'real-key-row', api_key_hash: ' real-key-hash ' }),
    ];
    await renderHook();

    const overviewTimeline = lastParams((params) => Boolean(params.include?.api_key_timeline));
    expect(overviewTimeline?.filters).toMatchObject({ api_key_hashes: ['real-key-hash'] });
    expect(latestResult?.selectedApiKey?.apiKeyHash).toBe('real-key-hash');

    await act(async () => {
      latestResult?.setActiveTab('apiKeys');
      await Promise.resolve();
    });

    const selectedTimeline = lastParams(
      (params) => Boolean(params.include?.timeline) && !params.include?.summary
    );
    expect(selectedTimeline?.filters).toMatchObject({ api_key_hashes: ['real-key-hash'] });

    await act(async () => {
      latestResult?.setSelectedApiKeyHash('unknown-client-api-key:missing-client-key');
      await Promise.resolve();
    });

    const fallbackSelectionTimeline = lastParams(
      (params) => Boolean(params.include?.timeline) && !params.include?.summary
    );
    expect(fallbackSelectionTimeline?.filters).toMatchObject({ api_key_hashes: ['real-key-hash'] });
    expect(latestResult?.selectedApiKey?.apiKeyHash).toBe('real-key-hash');
  });

  it('uses only real API keys for exact trend series while keeping a leading fallback rank row', async () => {
    apiKeyStats = [
      createApiKeyStatRow({
        id: 'unknown-client-api-key:missing-client-key',
        api_key_hash: '',
        calls: 100,
        cost: 100,
      }),
      ...['key-a', 'key-b', 'key-c', 'key-d'].map((apiKeyHash, index) =>
        createApiKeyStatRow({
          id: apiKeyHash,
          api_key_hash: apiKeyHash,
          calls: 10 - index,
          cost: 10 - index,
        })
      ),
    ];

    await renderHook();

    const apiKeyTimeline = lastParams((params) => Boolean(params.include?.api_key_timeline));
    expect(latestResult?.apiKeyRows[0].id).toBe('unknown-client-api-key:missing-client-key');
    expect(apiKeyTimeline?.filters).toMatchObject({
      api_key_hashes: ['key-a', 'key-b', 'key-c', 'key-d'],
    });
    expect(latestResult?.apiKeyTrendSeries.map((series) => series.id)).toEqual([
      'key-a',
      'key-b',
      'key-c',
      'key-d',
    ]);
    expect(
      latestResult?.apiKeyTrendSeries[0].points.slice(0, 3).map((point) => point.value)
    ).toEqual([2, 0, 4]);
  });

  it('does not approximate fallback-only API key rows as trend series', async () => {
    apiKeyStats = [
      createApiKeyStatRow({
        id: 'unknown-client-api-key:missing-client-key',
        api_key_hash: '',
        calls: 100,
        cost: 100,
      }),
    ];
    apiKeyTimelineAvailable = false;

    await renderHook();

    expect(latestResult?.apiKeyRows).toHaveLength(1);
    expect(latestResult?.apiKeyRows[0].id).toBe('unknown-client-api-key:missing-client-key');
    expect(latestResult?.apiKeyTrendSeries).toEqual([]);
  });

  it('uses complete API key totals for approximate trend shares while hiding fallback rows', async () => {
    apiKeyStats = [
      createApiKeyStatRow({
        id: 'unknown-client-api-key:missing-client-key',
        api_key_hash: '',
        calls: 90,
      }),
      createApiKeyStatRow({
        id: 'real-key-row',
        api_key_hash: 'real-key-hash',
        calls: 10,
      }),
    ];
    mainTimelineBucketCalls = 50;
    apiKeyTimelineAvailable = false;

    await renderHook();

    expect(latestResult?.apiKeyRows.map((row) => row.id)).toEqual([
      'unknown-client-api-key:missing-client-key',
      'real-key-hash',
    ]);
    expect(latestResult?.apiKeyTrendSeries.map((series) => series.id)).toEqual(['real-key-hash']);
    expect(
      latestResult?.apiKeyTrendSeries[0].points.slice(0, 3).map((point) => point.value)
    ).toEqual([5, 0, 5]);
  });

  it('omits an initial fallback API key filter from analytics requests', async () => {
    await renderHook('/usage-analytics?api_key_hash=unknown-client-api-key%3Alegacy-filter');

    const main = lastParams((params) => Boolean(params.include?.summary));
    expect(main?.filters).not.toHaveProperty('api_key_hashes');
  });

  it('keeps a fallback-only aggregate visible without enabling a key timeline request', async () => {
    apiKeyStats = [
      createApiKeyStatRow({
        id: 'unknown-client-api-key:missing-client-key',
        api_key_hash: '',
      }),
    ];
    await renderHook();

    const selectedTimeline = lastParams(
      (params) => Boolean(params.include?.timeline) && !params.include?.summary
    );
    expect(latestResult?.selectedApiKey?.id).toBe('unknown-client-api-key:missing-client-key');
    expect(selectedTimeline?.fromMs).toBeUndefined();
    expect(selectedTimeline?.toMs).toBeUndefined();
    expect(selectedTimeline?.filters).not.toHaveProperty('api_key_hashes');
  });

  it('does not couple selector failures to the main page error and refreshes both requests', async () => {
    selectorError = 'selector failed';
    await renderHook();

    expect(latestResult?.error).toBe('');
    expect(latestResult?.filterOptions).toBeUndefined();

    act(() => {
      latestResult?.refresh();
    });
    expect(mainRefresh).toHaveBeenCalledTimes(1);
    expect(selectorRefresh).toHaveBeenCalledTimes(1);
  });

  it('loads only the selected credential timeline after the credential ranking', async () => {
    await renderHook();

    await act(async () => {
      latestResult?.setActiveTab('credentials');
      await Promise.resolve();
    });

    const credentials = lastParams((params) => Boolean(params.include?.credential_stats));
    expect(credentials?.include).toEqual({
      summary: true,
      summary_profile: 'compact',
      credential_stats: true,
      granularity: 'hour',
    });

    const timeline = lastParams((params) => Boolean(params.include?.credential_timeline));
    expect(timeline?.include).toEqual({ granularity: 'hour', credential_timeline: true });
    expect(timeline?.filters).toMatchObject({ credential_ids: ['credential-a.json'] });
    expect(JSON.parse(timeline?.dataScopeKey ?? '{}')).toMatchObject({
      activeTab: 'credentials',
      selectedCredentialID: 'credential-a.json',
    });
    expect(latestResult?.credentialTrendSeries).toHaveLength(1);
    expect(latestResult?.timeline).toEqual([]);
  });

  it('exposes selected credential timeline loading and error states', async () => {
    credentialTimelineLoading = true;
    await renderHook();

    await act(async () => {
      latestResult?.setActiveTab('credentials');
      await Promise.resolve();
    });
    expect(latestResult?.credentialTrendLoading).toBe(true);
    expect(latestResult?.credentialTrendError).toBe('');

    credentialTimelineLoading = false;
    credentialTimelineError = 'timeline failed';
    await act(async () => {
      renderer?.update(
        <MemoryRouter initialEntries={['/usage-analytics']}>
          <Harness />
        </MemoryRouter>
      );
      await Promise.resolve();
    });
    expect(latestResult?.credentialTrendLoading).toBe(false);
    expect(latestResult?.credentialTrendError).toBe('timeline failed');
    expect(latestResult?.credentialRows).toHaveLength(1);
  });

  it('retains last-good metadata when a manual metadata refresh partially fails', async () => {
    monitoringMetaMocks.load.mockResolvedValueOnce({
      authFiles: [
        {
          name: 'credential-a.json',
          auth_index: 'auth-a',
          account: 'retained@example.com',
          provider: 'codex',
        },
      ],
      authFilesLoaded: true,
      channels: [
        {
          key: 'retained:0',
          name: 'retained-channel',
          baseUrl: 'https://retained.test',
          host: 'retained.test',
          disabled: false,
          authIndices: ['auth-a'],
          modelNames: [],
        },
      ],
      channelsLoaded: true,
      error: '',
    });

    await renderHook();
    await act(async () => {
      latestResult?.setActiveTab('credentials');
      await Promise.resolve();
    });
    expect(latestResult?.credentialRows[0]).toMatchObject({
      label: 'credential-a.json',
      account: 'retained@example.com',
      provider: 'codex',
      authIndex: 'auth-a',
    });

    monitoringMetaMocks.load.mockResolvedValueOnce({
      authFiles: [],
      authFilesLoaded: false,
      channels: [],
      channelsLoaded: false,
      error: 'meta offline',
    });
    await act(async () => {
      latestResult?.refresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestResult?.credentialRows[0]).toMatchObject({
      label: 'credential-a.json',
      account: 'retained@example.com',
      provider: 'codex',
      authIndex: 'auth-a',
    });
    expect(latestResult?.error).toBe('meta offline');
  });

  it('recognizes successful empty auxiliary snapshots but rejects them after scope invalidation', async () => {
    emptyAuxiliarySnapshot = true;
    await renderHook();
    await act(async () => {
      latestResult!.setActiveTab('credentials');
    });
    expect(latestResult!.credentialTrendSeries).toEqual([]);
    expect(latestResult!.credentialTrendLoaded).toBe(true);
    expect(latestResult!.heatmapDateLoaded).toBe(true);
    credentialTimelineLoading = true;
    await act(async () => {
      latestResult!.setSelectedCredentialId('credential-a.json');
    });
    expect(latestResult!.credentialTrendLoaded).toBe(true);
    auxiliaryScopeStale = true;
    await act(async () => {
      latestResult!.setSelectedCredentialId('credential-b.json');
    });
    expect(latestResult!.credentialTrendLoaded).toBe(false);
    expect(latestResult!.heatmapDateLoaded).toBe(false);
  });
  describe('exact API key trend guards', () => {
    const apiKeyValues = () =>
      latestResult?.apiKeyTrendSeries[0]?.points.slice(0, 3).map((point) => point.value);
    // The estimate follows the main timeline's shape (5, 0, 5); the exact buckets are 2, 0, 4.
    const expectEstimate = () => {
      const values = apiKeyValues() ?? [];
      expect(values[0]).toBeGreaterThan(0);
      expect(values[0]).toBe(values[2]);
    };
    const refreshAt = async (nowMs: number) => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
      try {
        await act(async () => {
          latestResult?.refresh();
          await Promise.resolve();
        });
      } finally {
        nowSpy.mockRestore();
      }
    };

    it('falls back to the estimate when the API key timeline request fails', async () => {
      await renderHook();
      expect(apiKeyValues()).toEqual([2, 0, 4]);

      // Like the real hook, the mock keeps the last good api_key_timeline next to the error.
      apiKeyTimelineError = 'api key timeline failed';
      await act(async () => {
        latestResult?.refresh();
        await Promise.resolve();
      });
      expectEstimate();

      apiKeyTimelineError = '';
      await act(async () => {
        latestResult?.refresh();
        await Promise.resolve();
      });
      expect(apiKeyValues()).toEqual([2, 0, 4]);
    });

    it('keeps the estimate until the API key timeline covers the refreshed range', async () => {
      await renderHook();
      expect(apiKeyValues()).toEqual([2, 0, 4]);
      const apiKeyParams = lastParams(
        (params) => Boolean(params.include?.api_key_timeline) && params.fromMs !== undefined
      );
      const previousRequest: MonitoringAnalyticsRequest = {
        from_ms: apiKeyParams?.fromMs ?? 0,
        to_ms: apiKeyParams?.toMs ?? 0,
        now_ms: apiKeyParams?.nowMs,
      };

      // The main response for the new range end arrived first; the API key buckets still
      // answer the previous one.
      apiKeyTimelineDataRequest = previousRequest;
      await refreshAt(previousRequest.to_ms + 10 * 60 * 1000);
      expectEstimate();

      apiKeyTimelineDataRequest = null;
      await refreshAt(previousRequest.to_ms + 20 * 60 * 1000);
      expect(apiKeyValues()).toEqual([2, 0, 4]);
    });
  });

  describe('exact model trend timeline', () => {
    const twoModels = () => [
      createModelStat({ model: 'model-a', calls: 6, total_tokens: 600, cost: 6 }),
      createModelStat({ model: 'model-b', calls: 4, total_tokens: 400, cost: 4 }),
    ];
    const isModelTimelineRequest = (params: UseMonitoringAnalyticsParams) =>
      Boolean(params.include?.model_timeline);
    const enabledModelTimelineScopes = () =>
      new Set(
        useMonitoringAnalyticsMock.mock.calls
          .map(([params]) => params)
          .filter((params) => isModelTimelineRequest(params) && params.fromMs !== undefined)
          .map((params) => params.dataScopeKey)
      );
    const seriesValues = (id: string) =>
      latestResult?.modelTrendSeries
        .find((series) => series.id === id)
        ?.points.slice(0, 3)
        .map((point) => point.value);

    it.each(['trends', 'models'] as const)(
      'requests exact buckets for the top models on the %s tab',
      async (tab) => {
        modelStats = twoModels();
        await renderHook();
        useMonitoringAnalyticsMock.mockClear();

        await act(async () => {
          latestResult?.setActiveTab(tab);
          await Promise.resolve();
        });

        const request = lastParams(isModelTimelineRequest);
        expect(request?.include).toEqual({ granularity: 'hour', model_timeline: true });
        expect(request?.filters).toMatchObject({
          models: ['model-a', 'model-b'],
          exact_models: true,
        });
        expect(typeof request?.fromMs).toBe('number');
        expect(typeof request?.toMs).toBe('number');
        expect(request?.throttleMs).toBe(0);
        expect(JSON.parse(request?.dataScopeKey ?? '{}')).toMatchObject({
          activeTab: tab,
          modelIds: ['model-a', 'model-b'],
          granularity: 'hour',
        });
        expect(enabledModelTimelineScopes().size).toBe(1);

        expect(latestResult?.modelTrendEstimated).toBe(false);
        expect(latestResult?.modelTrendSeries.map((series) => series.id)).toEqual([
          'model-a',
          'model-b',
        ]);
        expect(seriesValues('model-a')).toEqual([5, 0, 1]);
        expect(seriesValues('model-b')).toEqual([0, 0, 4]);
      }
    );

    it.each(['overview', 'apiKeys', 'credentials', 'heatmap'] as const)(
      'does not request the model timeline on the %s tab',
      async (tab) => {
        modelStats = twoModels();
        await renderHook();
        await act(async () => {
          latestResult?.setActiveTab('trends');
          await Promise.resolve();
        });
        useMonitoringAnalyticsMock.mockClear();

        await act(async () => {
          latestResult?.setActiveTab(tab);
          await Promise.resolve();
        });

        const request = lastParams(isModelTimelineRequest);
        expect(request?.fromMs).toBeUndefined();
        expect(request?.toMs).toBeUndefined();
        expect(enabledModelTimelineScopes().size).toBe(0);
        expect(latestResult?.modelTrendEstimated).toBe(true);
      }
    );

    it('switches the metric without a new model timeline request', async () => {
      modelStats = twoModels();
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });
      const scopeBefore = lastParams(isModelTimelineRequest)?.dataScopeKey;
      useMonitoringAnalyticsMock.mockClear();

      await act(async () => {
        latestResult?.setTrendMetric('totalTokens');
        await Promise.resolve();
      });

      expect(enabledModelTimelineScopes()).toEqual(new Set([scopeBefore]));
      expect(latestResult?.modelTrendEstimated).toBe(false);
      expect(seriesValues('model-a')).toEqual([500, 0, 100]);
      expect(seriesValues('model-b')).toEqual([0, 0, 400]);
    });

    it('keeps the estimate when the backend omits model_timeline', async () => {
      modelStats = twoModels();
      modelTimelineAvailable = false;
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });

      expect(typeof lastParams(isModelTimelineRequest)?.fromMs).toBe('number');
      // The response arrived, it just has no model_timeline field.
      expect(
        useMonitoringAnalyticsMock.mock.results.some(
          ({ value }) =>
            value?.data !== null &&
            value?.data?.model_timeline === undefined &&
            value?.refresh === modelTimelineRefresh
        )
      ).toBe(true);
      expect(latestResult?.modelTrendEstimated).toBe(true);
      expect(latestResult?.modelTrendSeries.map((series) => series.id)).toEqual([
        'model-a',
        'model-b',
      ]);
      // The estimate spreads model-b over every bucket by its share of the period.
      expect(seriesValues('model-b')?.[0]).toBeGreaterThan(0);
    });

    it('ignores a stale model timeline response', async () => {
      modelStats = twoModels();
      auxiliaryScopeStale = true;
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });

      expect(latestResult?.modelTrendEstimated).toBe(true);
      expect(seriesValues('model-b')?.[0]).toBeGreaterThan(0);
    });

    it('does not request the model timeline without model rows', async () => {
      modelStats = [];
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });
      expect(lastParams(isModelTimelineRequest)?.fromMs).toBeUndefined();
      expect(enabledModelTimelineScopes().size).toBe(0);
      expect(latestResult?.modelTrendEstimated).toBe(true);

      modelStats = [createModelStat({ model: '' })];
      await act(async () => {
        latestResult?.setActiveTab('models');
        await Promise.resolve();
      });
      expect(lastParams(isModelTimelineRequest)?.fromMs).toBeUndefined();
      expect(enabledModelTimelineScopes().size).toBe(0);
      expect(latestResult?.modelTrendEstimated).toBe(true);
    });

    it('refreshes the model timeline request with the page', async () => {
      modelStats = twoModels();
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });
      modelTimelineRefresh.mockClear();
      mainRefresh.mockClear();

      act(() => {
        latestResult?.refresh();
      });

      // A model request still in flight for the previous range end must not absorb the
      // refresh, so a manual refresh supersedes it.
      expect(modelTimelineRefresh).toHaveBeenCalledTimes(1);
      expect(modelTimelineRefresh).toHaveBeenCalledWith({ force: true, supersedeInFlight: true });
      expect(mainRefresh).toHaveBeenCalledWith({ force: true, supersedeInFlight: true });
    });

    it('refreshes with the new range end rather than the previous one', async () => {
      modelStats = twoModels();
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });
      const enabledModelRequest = (params: UseMonitoringAnalyticsParams) =>
        isModelTimelineRequest(params) && params.fromMs !== undefined;
      const mainRequest = (params: UseMonitoringAnalyticsParams) =>
        Boolean(params.include?.summary);
      const refreshedAtMs = (lastParams(enabledModelRequest)?.toMs ?? 0) + 10 * 60 * 1000;
      // Each forced fetch must start once the hook renders the new bounds. A fetch started with
      // the old ones would also make the real hook drop the new-range request as a duplicate.
      const mainToMs: Array<number | null | undefined> = [];
      const modelToMs: Array<number | null | undefined> = [];
      mainRefresh.mockImplementation(() => {
        mainToMs.push(lastParams(mainRequest)?.toMs);
      });
      modelTimelineRefresh.mockImplementation(() => {
        modelToMs.push(lastParams(enabledModelRequest)?.toMs);
      });

      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(refreshedAtMs);
      try {
        act(() => {
          latestResult?.refresh();
        });
      } finally {
        nowSpy.mockRestore();
      }

      expect(mainToMs).toEqual([refreshedAtMs]);
      expect(modelToMs).toEqual([refreshedAtMs]);
    });

    it('falls back to the estimate when the model timeline request fails', async () => {
      modelStats = twoModels();
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });
      expect(latestResult?.modelTrendEstimated).toBe(false);
      expect(seriesValues('model-b')).toEqual([0, 0, 4]);

      // Like the real hook, the mock keeps the last good model_timeline next to the error.
      modelTimelineError = 'model timeline failed';
      await act(async () => {
        latestResult?.refresh();
        await Promise.resolve();
      });

      expect(latestResult?.modelTrendEstimated).toBe(true);
      expect(seriesValues('model-b')?.[0]).toBeGreaterThan(0);

      modelTimelineError = '';
      await act(async () => {
        latestResult?.refresh();
        await Promise.resolve();
      });
      expect(latestResult?.modelTrendEstimated).toBe(false);
      expect(seriesValues('model-b')).toEqual([0, 0, 4]);
    });

    it('keeps the estimate until the model timeline covers the refreshed range', async () => {
      modelStats = twoModels();
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });
      expect(latestResult?.modelTrendEstimated).toBe(false);
      const enabledModelRequest = lastParams(
        (params) => isModelTimelineRequest(params) && params.fromMs !== undefined
      );
      const previousRequest: MonitoringAnalyticsRequest = {
        from_ms: enabledModelRequest?.fromMs ?? 0,
        to_ms: enabledModelRequest?.toMs ?? 0,
        now_ms: enabledModelRequest?.nowMs,
      };
      const refreshAt = async (nowMs: number) => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
        try {
          await act(async () => {
            latestResult?.refresh();
            await Promise.resolve();
          });
        } finally {
          nowSpy.mockRestore();
        }
      };

      // The main response for the new range end arrived first. The model buckets still end
      // at the previous one, so drawing them as exact would show the new hours as zero.
      modelTimelineDataRequest = previousRequest;
      await refreshAt(previousRequest.to_ms + 10 * 60 * 1000);
      expect(lastParams((params) => Boolean(params.include?.summary))?.nowMs).not.toBe(
        previousRequest.now_ms
      );
      expect(latestResult?.modelTrendEstimated).toBe(true);
      expect(seriesValues('model-b')?.[0]).toBeGreaterThan(0);

      // Once the follow-up answers the same range, the exact buckets are back.
      modelTimelineDataRequest = null;
      await refreshAt(previousRequest.to_ms + 20 * 60 * 1000);
      expect(latestResult?.modelTrendEstimated).toBe(false);
      expect(seriesValues('model-b')).toEqual([0, 0, 4]);
    });

    it('draws only the range the displayed responses answer while a refresh is pending', async () => {
      modelStats = twoModels();
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });
      const mainParams = lastParams((params) => Boolean(params.include?.summary));
      const previousRequest: MonitoringAnalyticsRequest = {
        from_ms: mainParams?.fromMs ?? 0,
        to_ms: mainParams?.toMs ?? 0,
        now_ms: mainParams?.nowMs,
      };
      const refreshAt = async (nowMs: number) => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
        try {
          await act(async () => {
            latestResult?.refresh();
            await Promise.resolve();
          });
        } finally {
          nowSpy.mockRestore();
        }
      };
      const bucketStarts = () => latestResult?.timeline.map((point) => point.bucketMs) ?? [];
      const refreshedAtMs = previousRequest.to_ms + HOUR_MS;

      // Neither response for the new range end has arrived, so both still answer the previous
      // one. The hour after it was never queried and must not be drawn as an exact zero.
      mainDataRequest = previousRequest;
      modelTimelineDataRequest = previousRequest;
      await refreshAt(refreshedAtMs);
      expect(lastParams((params) => Boolean(params.include?.summary))?.toMs).toBe(refreshedAtMs);
      expect(bucketStarts()[0]).toBe(localHourStartMs(previousRequest.from_ms));
      expect(Math.max(...bucketStarts())).toBe(localHourStartMs(previousRequest.to_ms - 1));
      expect(latestResult?.modelTrendEstimated).toBe(false);
      expect(seriesValues('model-b')).toEqual([0, 0, 4]);
      latestResult?.modelTrendSeries.forEach((series) => {
        expect(series.points.map((point) => point.bucketMs)).toEqual(bucketStarts());
      });

      // Once both responses answer the new range, the timeline follows it.
      mainDataRequest = null;
      modelTimelineDataRequest = null;
      await refreshAt(refreshedAtMs);
      expect(bucketStarts()[0]).toBe(localHourStartMs(previousRequest.from_ms + HOUR_MS));
      expect(Math.max(...bucketStarts())).toBe(localHourStartMs(refreshedAtMs - 1));
      expect(latestResult?.modelTrendEstimated).toBe(false);
      expect(seriesValues('model-b')).toEqual([0, 0, 4]);
    });

    it('keeps the page filters on the model timeline request', async () => {
      modelStats = twoModels();
      await renderHook('/usage-analytics?tab=trends&provider=codex&status=failed');

      const request = lastParams(
        (params) => isModelTimelineRequest(params) && params.fromMs !== undefined
      );
      expect(request?.filters).toEqual({
        providers: ['codex'],
        failed_only: true,
        models: ['model-a', 'model-b'],
        exact_models: true,
      });
    });

    it('keeps the series and colours when the exact data replaces the estimate', async () => {
      modelStats = [
        createModelStat({ model: '', calls: 9, total_tokens: 900, cost: 9 }),
        ...twoModels(),
      ];
      modelTimelineAvailable = false;
      await renderHook();
      await act(async () => {
        latestResult?.setActiveTab('trends');
        await Promise.resolve();
      });
      expect(latestResult?.modelTrendEstimated).toBe(true);
      const identity = () =>
        latestResult?.modelTrendSeries.map((series) => ({ id: series.id, color: series.color }));
      const estimated = identity();

      modelTimelineAvailable = true;
      await act(async () => {
        latestResult?.refresh();
        await Promise.resolve();
      });

      expect(latestResult?.modelTrendEstimated).toBe(false);
      expect(identity()).toEqual(estimated);
      // The row without a model cannot be drawn exactly, so neither series includes it.
      expect(estimated?.map((series) => series.id)).toEqual(['model-a', 'model-b']);
    });
  });
});
