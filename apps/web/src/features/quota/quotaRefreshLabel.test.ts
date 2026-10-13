import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { QuotaHeader, type QuotaHeaderProps } from '@/features/quota/components/QuotaHeader';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';

const translations = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru };
type Language = keyof typeof translations;
const completedAt = new Date(2026, 9, 5, 14, 32, 17);
const now = completedAt.getTime() + 5 * 60_000;
const baseProps: QuotaHeaderProps = {
  totalCount: 2,
  loadedCount: 2,
  attentionCount: 0,
  refreshing: false,
  disableControls: false,
  onRefreshAll: () => {},
  onToggleEmails: () => {},
  lastRefreshAt: completedAt.getTime(),
  now,
};

async function renderHeader(overrides: Partial<QuotaHeaderProps> = {}, language: Language = 'en') {
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    resources: Object.fromEntries(
      Object.entries(translations).map(([key, translation]) => [key, { translation }])
    ),
    interpolation: { escapeValue: false },
  });
  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(QuotaHeader, { ...baseProps, ...overrides })
    )
  );
  const refreshButton = [...markup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(
    ([button]) => button.includes(translations[language].quota_management.refresh_all_credentials)
  )?.[0];
  expect(refreshButton).toBeDefined();
  return { markup, refreshButton: refreshButton! };
}

describe('quota refresh timestamp', () => {
  test('shows how long ago the refresh completed inside the refresh action', async () => {
    const { refreshButton } = await renderHeader();
    expect(refreshButton).toContain(`dateTime="${completedAt.toISOString()}"`);
    expect(refreshButton).toContain('Last checked: 5 minutes ago');
    expect(refreshButton).toContain(
      `title="${completedAt.toLocaleString('en', { dateStyle: 'full', timeStyle: 'long' })}"`
    );
    expect(refreshButton).not.toContain('disabled=""');
  });

  test.each([undefined, null])(
    'does not invent an initial refresh time for %s',
    async (lastRefreshAt) => {
      const { markup, refreshButton } = await renderHeader({ lastRefreshAt });
      expect(markup).not.toContain('<time');
      expect(refreshButton).not.toContain('Last checked:');
    }
  );

  test.each([0, 30_000, -30_000])(
    'reads "just now" when the refresh is under a minute old (offset %p ms)',
    async (offset) => {
      const { refreshButton } = await renderHeader({ now: completedAt.getTime() + offset });
      expect(refreshButton).toContain('Last checked: just now');
      expect(refreshButton).not.toContain(' ago');
      expect(refreshButton).not.toContain('in 1 minute');
    }
  );

  test('switches to larger units as the refresh ages', async () => {
    const { refreshButton } = await renderHeader({ now: completedAt.getTime() + 3 * 3_600_000 });
    expect(refreshButton).toContain('Last checked: 3 hours ago');
  });

  test('keeps the previous completion time visible while the next refresh is in progress', async () => {
    const { refreshButton } = await renderHeader({ refreshing: true });
    expect(refreshButton).toContain('disabled=""');
    expect(refreshButton).toContain('aria-busy="true"');
    expect(refreshButton).toContain(`dateTime="${completedAt.toISOString()}"`);
    expect(refreshButton).toContain('Last checked:');
  });

  test.each(Object.keys(translations) as Language[])(
    'uses the selected %s language for the timestamp label and relative time',
    async (language) => {
      const { refreshButton } = await renderHeader({}, language);
      const expected = translations[language].quota_management.last_refresh.replace(
        '{{time}}',
        new Intl.RelativeTimeFormat(language, { numeric: 'always' }).format(-5, 'minute')
      );
      expect(refreshButton).toContain(expected);
      expect(refreshButton).not.toContain('quota_management.last_refresh');
      expect(refreshButton).not.toContain('{{time}}');
    }
  );

  test.each([NaN, Infinity])(
    'ignores an invalid completion timestamp (%s)',
    async (lastRefreshAt) => {
      const { markup } = await renderHeader({ lastRefreshAt });
      expect(markup).not.toContain('<time');
      expect(markup).not.toContain('Invalid Date');
    }
  );
});
