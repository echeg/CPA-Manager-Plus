import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import layoutSource from '@/components/layout/MainLayout.tsx?raw';
import routesSource from '@/router/MainRoutes.tsx?raw';

const getPath = (value: unknown, keyPath: string) =>
  keyPath.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);

const guideKeys = [
  'nav.guide',
  'guide.title',
  'guide.subtitle',
  'guide.tabs_label',
  'guide.tab_key_routing',
  'guide.tab_pool_selection',
  'guide.tab_api_key_routing',
  'guide.intro_key_routing',
  'guide.intro_pool_selection',
  'guide.intro_api_key_routing',
];

// Built from parts so this file does not itself contain the asserted import line.
const guidePageImport = `import { GuidePage } from '${['@', 'pages', 'GuidePage'].join('/')}';`;

describe('guide app wiring', () => {
  it('registers the /guide route with GuidePage', () => {
    expect(routesSource).toContain(guidePageImport);
    expect(routesSource).toContain("{ path: '/guide', element: <GuidePage /> }");
  });

  it('places Guide in the last sidebar block directly after System Info', () => {
    expect(layoutSource).toContain('guide: <IconSidebarGuide size={SIDEBAR_ICON_SIZE} />');

    const systemIndex = layoutSource.indexOf("path: '/system',");
    const guideIndex = layoutSource.indexOf("path: '/guide',");
    const sectionsEndIndex = layoutSource.indexOf('].filter((section) => section.length > 0);');

    expect(systemIndex).toBeGreaterThanOrEqual(0);
    expect(guideIndex).toBeGreaterThan(systemIndex);
    expect(sectionsEndIndex).toBeGreaterThan(guideIndex);

    const guideItemSource = layoutSource.slice(guideIndex, sectionsEndIndex);
    expect(guideItemSource).toContain("label: t('nav.guide')");
    expect(guideItemSource).toContain("shortLabel: navShortLabel('nav.guide', t('nav.guide'))");
    expect(guideItemSource).toContain('icon: sidebarIcons.guide');
    // Only Guide's own block closes before the sections end: no block follows it.
    expect(guideItemSource.match(/\],/g)).toHaveLength(1);
    expect(guideItemSource.match(/path: '/g)).toHaveLength(1);

    // Nothing else sits between System Info and Guide: they share the closing block.
    const betweenSystemAndGuide = layoutSource.slice(systemIndex, guideIndex);
    expect(betweenSystemAndGuide.match(/path: '/g)).toHaveLength(1);
    expect(betweenSystemAndGuide).not.toContain('],');
  });

  it('keeps Guide i18n keys present in every locale', () => {
    const locales = { en, ru, zhCN, zhTW };

    for (const [localeName, locale] of Object.entries(locales)) {
      for (const key of guideKeys) {
        const value = getPath(locale, key);
        expect(value, `${localeName}:${key}`).toBeTypeOf('string');
        expect((value as string).trim(), `${localeName}:${key}`).not.toBe('');
      }
    }
  });

  it('names the third Guide tab after its diagram', () => {
    expect(en.guide.tab_api_key_routing).toBe('Routing with API keys');
  });

  it('describes per-provider fallback in the routing intros, not a Codex-only fallback', () => {
    expect(en.guide.intro_key_routing).toContain('API key');
    expect(en.guide.intro_key_routing).toContain('Codex subscription');
    expect(en.guide.intro_pool_selection).toContain('OAuth credentials');
    // The error semantics of the pool intro stay in place.
    expect(en.guide.intro_pool_selection).toContain('without Retry-After');
    expect(en.guide.intro_pool_selection).toContain('unavailable error');
  });

  it('uses the agreed sidebar labels', () => {
    expect(en.nav.guide).toBe('Guide');
    expect(ru.nav.guide).toBe('Гайд');
    expect(zhCN.nav.guide).toBe('指南');
    expect(zhTW.nav.guide).toBe('指南');
  });
});
