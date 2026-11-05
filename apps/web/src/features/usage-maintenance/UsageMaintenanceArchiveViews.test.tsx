import { act } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageMaintenanceStatus } from '@/services/api/usageService';
import { formatDateTime, formatFileSize } from '@/utils/format';
import type { CpaLogStorage } from './cpaLogStorage';
import {
  CpaLogsSummaryCard,
  UsageMaintenanceOverviewView,
  type CpaLogStorageState,
} from './UsageMaintenanceArchiveViews';

vi.hoisted(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

// Render keys with their interpolation values so assertions do not depend on locale text.
vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    const params = Object.entries(options ?? {})
      .filter(([name]) => name !== 'defaultValue')
      .map(([name, value]) => `${name}=${String(value)}`);
    return params.length ? `${key}(${params.join(',')})` : key;
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

vi.mock('@/stores', () => ({
  useNotificationStore: () => ({ showNotification: vi.fn(), showConfirmation: vi.fn() }),
}));

const MB = 1024 * 1024;
const DAY = 86_400_000;

const storage = (overrides: Partial<CpaLogStorage> = {}): CpaLogStorage => ({
  totalBytes: 185_068_097,
  totalFiles: 15,
  cappedBytes: 183_686_396,
  cappedFiles: 12,
  oldestModifiedAt: new Date('2026-10-07T07:21:57Z'),
  newestModifiedAt: new Date('2026-11-05T19:17:08Z'),
  limitMb: 0,
  requestLog: false,
  loggingToFile: false,
  ...overrides,
});

let renderer: ReactTestRenderer | null = null;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

const renderCard = (state: CpaLogStorageState, onOpenConfig = vi.fn()) => {
  act(() => {
    renderer = create(<CpaLogsSummaryCard state={state} onOpenConfig={onOpenConfig} />);
  });
  return { root: renderer!.root, onOpenConfig };
};

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const value = (root: ReactTestInstance) => textOf(root.findByType('dd'));
const subLines = (root: ReactTestInstance) => root.findAllByType('small').map(textOf);
const warningText = (root: ReactTestInstance) =>
  root
    .findAll(
      (node) => typeof node.type === 'string' && /reclaimHighlight/.test(node.props.className ?? '')
    )
    .map(textOf);

describe('CpaLogsSummaryCard', () => {
  it('renders size, file count, limit and request-log state when ready', () => {
    const { root } = renderCard({
      status: 'ready',
      storage: storage({ limitMb: 512, cappedBytes: 100 * MB, requestLog: true }),
    });

    expect(textOf(root.findByType('dt'))).toBe('usage_maintenance.cpa_logs');
    expect(value(root)).toBe(formatFileSize(185_068_097));
    expect(subLines(root)[0]).toBe(
      [
        'usage_maintenance.cpa_logs_files(count=15)',
        `usage_maintenance.cpa_logs_limit(limit=${formatFileSize(512 * MB)})`,
        'usage_maintenance.cpa_logs_request_log_on',
      ].join(' · ')
    );
    expect(warningText(root)).toEqual([]);
  });

  it('shows "no limit" and request log off when limit_mb is 0', () => {
    const { root } = renderCard({ status: 'ready', storage: storage() });

    expect(subLines(root)[0]).toContain('usage_maintenance.cpa_logs_no_limit');
    expect(subLines(root)[0]).toContain('usage_maintenance.cpa_logs_request_log_off');
    expect(subLines(root)[0]).not.toContain('cpa_logs_limit(');
  });

  it('shows retention span with per-day growth for a multi-day span', () => {
    const oldest = new Date('2026-10-26T00:00:00Z');
    const { root } = renderCard({
      status: 'ready',
      storage: storage({
        totalBytes: 100 * MB,
        oldestModifiedAt: oldest,
        newestModifiedAt: new Date(oldest.getTime() + 10 * DAY),
      }),
    });

    expect(subLines(root)[1]).toBe(
      [
        `usage_maintenance.cpa_logs_retention(oldest=${formatDateTime(oldest, 'en')},days=10)`,
        `usage_maintenance.cpa_logs_per_day(size=${formatFileSize(10 * MB)})`,
      ].join(' · ')
    );
  });

  it('omits per-day growth when the span is under a day', () => {
    const oldest = new Date('2026-11-05T00:00:00Z');
    const { root } = renderCard({
      status: 'ready',
      storage: storage({
        oldestModifiedAt: oldest,
        newestModifiedAt: new Date(oldest.getTime() + DAY / 4),
      }),
    });

    expect(subLines(root)[1]).toBe(
      `usage_maintenance.cpa_logs_retention(oldest=${formatDateTime(oldest, 'en')},days=0.3)`
    );
  });

  it('renders a missing logs directory as zero without a retention line', () => {
    const { root } = renderCard({
      status: 'ready',
      storage: storage({
        totalBytes: 0,
        totalFiles: 0,
        cappedBytes: 0,
        cappedFiles: 0,
        oldestModifiedAt: null,
        newestModifiedAt: null,
      }),
    });

    expect(value(root)).toBe('0 B');
    expect(subLines(root)).toHaveLength(1);
    expect(subLines(root)[0]).toContain('usage_maintenance.cpa_logs_files(count=0)');
  });

  it('warns when request logging is on without a limit', () => {
    const { root } = renderCard({
      status: 'ready',
      storage: storage({ requestLog: true, limitMb: 0 }),
    });

    expect(warningText(root)).toEqual(['usage_maintenance.cpa_logs_warning_unbounded']);
  });

  it('warns with used vs limit when capped files reach 90% of the limit', () => {
    const { root } = renderCard({
      status: 'ready',
      storage: storage({ limitMb: 512, cappedBytes: 480 * MB }),
    });

    expect(warningText(root)).toEqual([
      `usage_maintenance.cpa_logs_warning_near_limit(used=${formatFileSize(480 * MB)},limit=${formatFileSize(512 * MB)})`,
    ]);
  });

  it.each([
    [{ status: 'loading' } as const, 'usage_maintenance.cpa_logs_loading'],
    [{ status: 'unsupported' } as const, 'usage_maintenance.cpa_logs_unsupported'],
    [
      { status: 'error', message: 'boom' } as const,
      'usage_maintenance.cpa_logs_error(message=boom)',
    ],
  ])('renders — and a hint for %o', (state, hint) => {
    const { root } = renderCard(state);

    expect(value(root)).toBe('—');
    expect(subLines(root)).toEqual([hint]);
    expect(warningText(root)).toEqual([]);
  });

  it('calls onOpenConfig from the action chip', () => {
    const { root, onOpenConfig } = renderCard({ status: 'unsupported' });
    const chip = root.findByType('button');

    expect(textOf(chip)).toBe('usage_maintenance.cpa_logs_open_config');
    act(() => chip.props.onClick());
    expect(onOpenConfig).toHaveBeenCalledTimes(1);
  });
});

describe('UsageMaintenanceOverviewView CPA logs card', () => {
  const maintenance = {
    raw_event_count: 10,
    raw_archived_event_count: 2,
    raw_deleted_event_count: 1,
    storage: { total_bytes: 1024, reclaimable_bytes: 0 },
    active_run: null,
  } as unknown as UsageMaintenanceStatus;

  const renderOverview = (props: Partial<Parameters<typeof UsageMaintenanceOverviewView>[0]>) => {
    act(() => {
      renderer = create(
        <UsageMaintenanceOverviewView
          maintenance={maintenance}
          archives={[]}
          onNavigate={vi.fn()}
          onOpenRun={vi.fn()}
          {...props}
        />
      );
    });
    return renderer!.root;
  };

  it('renders the CPA logs card as the fifth summary card', () => {
    const root = renderOverview({ logStorage: { status: 'loading' }, onOpenConfig: vi.fn() });

    const titles = root.findByType('dl').findAllByType('dt').map(textOf);
    expect(titles).toHaveLength(5);
    expect(titles[4]).toBe('usage_maintenance.cpa_logs');
  });

  it('omits the card when no log storage state is provided', () => {
    const root = renderOverview({});

    expect(root.findByType('dl').findAllByType('dt')).toHaveLength(4);
  });
});
