import { beforeAll, describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type { SubscriptionRoutingSettings } from '@/features/personal-quota-support/services/api/subscriptionRouting';
import { QuotaSettingsToolbar } from '@/features/quota/components/QuotaSettingsToolbar';
import { routingStrategyOptions } from '@/features/quota/routingModel';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const values: SubscriptionRoutingSettings = {
  strategy: 'earliest-reset',
  sessionAffinity: true,
  sessionAffinityTTL: '24h',
  preferredAccounts: { codex: '', claude: 'claude-a' },
};

const files = [
  {
    name: 'codex-alice@example.com.json',
    email: 'alice@example.com',
    provider: 'codex',
    authIndex: 'codex-a',
  },
  {
    name: 'claude-bob@example.com.json',
    email: 'bob@example.com',
    provider: 'claude',
    authIndex: 'claude-a',
  },
];

const routing = (patch: Record<string, unknown> = {}) => ({
  values,
  saving: false,
  error: '',
  saved: false,
  dirty: false,
  invalidTTL: false,
  blocked: false,
  options: routingStrategyOptions(i18n.t.bind(i18n) as never, values.strategy),
  change: () => {},
  save: async () => {},
  reload: () => {},
  ...patch,
});

const saveButton = (markup: string) =>
  markup.match(/<button[^>]*data-routing-save[^>]*>/)?.[0] ?? '';

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(QuotaSettingsToolbar, {
      routing: routing(),
      fastMode: { enabled: false, saving: false, error: '', toggle: async () => {} },
      activity: [
        { authIndex: 'codex-a', provider: 'codex', lastSelectedAt: '2026-10-08T13:02:37Z' },
      ],
      activityState: 'ready',
      files,
      showEmails: false,
      disabled: false,
      resolvedTheme: 'dark',
      ...props,
    } as never)
  );

describe('quota settings toolbar', () => {
  test('renders every routing and fast mode control in one labelled region', () => {
    const markup = render();
    expect(markup).toContain('data-quota-settings');
    expect(markup).toContain(`aria-label="${i18n.t('quota_management.routing.title')}"`);
    expect(markup).toContain(i18n.t('quota_management.toolbar.switching'));
    expect(markup).toContain(
      i18n.t('config_management.visual.sections.network.strategy_earliest_reset')
    );
    expect(markup).toContain(i18n.t('config_management.visual.sections.network.session_affinity'));
    expect(markup).toContain('value="24h"');
    expect(markup).toContain(i18n.t('quota_management.codex_fast.title'));
    expect(markup).toContain('Codex');
    expect(markup).toContain('Claude');
  });

  test('moves long explanations into title tooltips', () => {
    const markup = render();
    for (const key of [
      'quota_management.routing.description',
      'quota_management.routing.ttl_hint',
      'quota_management.routing.manual_hint',
      'quota_management.codex_fast.description',
    ]) {
      expect(markup).toContain(`title="${i18n.t(key)}"`);
    }
  });

  test('masks account names unless emails are shown', () => {
    const masked = render();
    expect(masked).not.toContain('alice@example.com');
    expect(masked).toContain('data-last-selected="codex"');
    expect(render({ showEmails: true })).toContain('alice@example.com');
  });

  test('reports missing activity per provider', () => {
    const markup = render();
    expect(markup).toContain(i18n.t('quota_management.routing.no_activity'));
    expect(render({ activityState: 'error' })).toContain(
      i18n.t('quota_management.routing.activity_unavailable')
    );
  });

  test('enables Save only for valid, dirty edits and shows TTL errors inline', () => {
    expect(saveButton(render())).toContain('disabled');
    expect(saveButton(render({ routing: routing({ dirty: true }) }))).not.toContain('disabled');
    const invalid = render({ routing: routing({ dirty: true, invalidTTL: true }) });
    expect(invalid).toContain(i18n.t('quota_management.routing.invalid_ttl'));
    expect(invalid).toContain('aria-invalid="true"');
    expect(saveButton(invalid)).toContain('disabled');
  });

  test('disables controls while unavailable and surfaces masked errors', () => {
    const markup = render({
      disabled: true,
      routing: routing({ blocked: true, values: null, error: 'failed for alice@example.com' }),
      fastMode: { enabled: null, saving: false, error: '', toggle: async () => {} },
    });
    expect(markup).toContain('disabled');
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('alice@example.com');
    expect(markup).toContain(i18n.t('common.refresh'));
  });

  test('confirms a saved change', () => {
    expect(render({ routing: routing({ saved: true }) })).toContain(
      i18n.t('quota_management.routing.saved')
    );
  });

  test('marks each switch on or off for the colored state', () => {
    const markup = render();
    expect(markup).toContain('data-switch="affinity" data-state="on"');
    expect(markup).toContain('data-switch="fast-mode" data-state="off"');
    expect(
      render({ fastMode: { enabled: true, saving: false, error: '', toggle: async () => {} } })
    ).toContain('data-switch="fast-mode" data-state="on"');
  });
});
