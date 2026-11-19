import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import layoutSource from '@/components/layout/MainLayout.tsx?raw';
import routesSource from '@/router/MainRoutes.tsx?raw';
import keyRoutingSource from './diagrams/key-routing.workflow.json';
import keyRoutingHtml from './diagrams/key-routing.html?raw';

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

  it('describes a switched-off provider in the key routing intro of every locale', () => {
    expect(en.guide.intro_key_routing).toContain('403 before any selection');
    // Each locale must keep all four parts: the switch, the 403, the skipped Codex fallback
    // and that Home mode or a scheduler plugin ignores the switch.
    const phrases = {
      en: [
        'switch a provider off',
        "Claude's fallback to a switched-off Codex does not run",
        'In Home mode or under a scheduler plugin the switch is ignored',
      ],
      ru: [
        'отключить провайдера',
        'фолбэк Claude на отключённый Codex не выполняется',
        'В режиме Home или с плагином-планировщиком этот переключатель не действует',
      ],
      zhCN: [
        '关闭某个提供商',
        'Claude 回退到已关闭的 Codex 也不会执行',
        '在 Home 模式下或使用调度插件时，这个开关会被忽略',
      ],
      zhTW: [
        '關閉某個供應商',
        'Claude 退回到已關閉的 Codex 也不會執行',
        '在 Home 模式下或使用排程外掛時，這個開關會被忽略',
      ],
    };
    for (const [localeName, locale] of Object.entries({ en, ru, zhCN, zhTW })) {
      const intro = locale.guide.intro_key_routing;
      expect(intro, localeName).toContain('403');
      for (const phrase of phrases[localeName as keyof typeof phrases]) {
        expect(intro, localeName).toContain(phrase);
      }
    }
  });

  it('shows the provider-off branch in the key routing diagram and its generated page', () => {
    const disabled = keyRoutingSource.nodes.find((node) => node.id === 'disabled');
    expect(disabled?.label).toBe('Provider off');
    expect(disabled?.sublabel).toBe('403 provider_disabled');
    expect(
      keyRoutingSource.edges.some((edge) => edge.from === 'profile' && edge.to === 'disabled')
    ).toBe(true);
    // The refusal is not a fallback step, so its lane must name it.
    const disabledLane = keyRoutingSource.lanes.find((lane) => lane.id === disabled?.lane);
    expect(disabledLane?.label).toBe(
      'Provider off, or fallback to a Codex subscription or API key'
    );

    const fallbackCard = keyRoutingSource.cards.find(
      (card) => card.title === 'Fallback per provider'
    );
    expect(fallbackCard?.items).toContain('A fallback to a switched-off Codex is skipped');
    // The 403 is enforced only by CPA's native routing, so the card must say when it is not.
    const profileCard = keyRoutingSource.cards.find(
      (card) => card.title === 'Profile per client key'
    );
    expect(profileCard?.items).toContain(
      'The switch is ignored in Home mode or under a scheduler plugin'
    );

    // The committed page must be regenerated from this source, not left behind it.
    expect(keyRoutingHtml).toContain('Provider off');
    expect(keyRoutingHtml).toContain('403 provider_disabled');
    expect(keyRoutingHtml).toContain('data-edge-from="profile" data-edge-to="disabled"');
    expect(keyRoutingHtml).toContain(
      'Provider off, or fallback to a Codex subscription or API key'
    );
    expect(keyRoutingHtml).toContain('A fallback to a switched-off Codex is skipped');
    expect(keyRoutingHtml).toContain(
      'The switch is ignored in Home mode or under a scheduler plugin'
    );
  });

  it('uses the agreed sidebar labels', () => {
    expect(en.nav.guide).toBe('Guide');
    expect(ru.nav.guide).toBe('Гайд');
    expect(zhCN.nav.guide).toBe('指南');
    expect(zhTW.nav.guide).toBe('指南');
  });
});
