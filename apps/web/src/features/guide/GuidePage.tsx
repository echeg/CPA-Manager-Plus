import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedTabs, type SegmentedTabItem } from '@/components/ui/SegmentedTabs';
import { DiagramFrame } from './DiagramFrame';
import keyRoutingHtml from './diagrams/key-routing.html?raw';
import poolSelectionHtml from './diagrams/pool-selection.html?raw';
import apiKeyRoutingHtml from './diagrams/api-key-routing.html?raw';
import styles from './GuidePage.module.scss';

const GUIDE_TABS = ['key-routing', 'pool-selection', 'api-key-routing'] as const;

type GuideTab = (typeof GUIDE_TABS)[number];

type GuideTabConfig = {
  labelKey: string;
  introKey: string;
  html: string;
};

/**
 * archify pages load JetBrains Mono from Google Fonts. Dropping those links keeps the Guide
 * free of third-party requests (the panel makes none elsewhere) and working offline; the
 * page's font stack falls back to the system monospace font.
 */
const withoutRemoteFonts = (html: string) =>
  html.replace(/<link\b[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '');

const GUIDE_TAB_CONFIG: Record<GuideTab, GuideTabConfig> = {
  'key-routing': {
    labelKey: 'guide.tab_key_routing',
    introKey: 'guide.intro_key_routing',
    html: withoutRemoteFonts(keyRoutingHtml),
  },
  'pool-selection': {
    labelKey: 'guide.tab_pool_selection',
    introKey: 'guide.intro_pool_selection',
    html: withoutRemoteFonts(poolSelectionHtml),
  },
  'api-key-routing': {
    labelKey: 'guide.tab_api_key_routing',
    introKey: 'guide.intro_api_key_routing',
    html: withoutRemoteFonts(apiKeyRoutingHtml),
  },
};

const TAB_ID_BASE = 'guide-tab';

export function GuidePage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<GuideTab>('key-routing');

  const tabItems = useMemo<ReadonlyArray<SegmentedTabItem<GuideTab>>>(
    () => GUIDE_TABS.map((tab) => ({ id: tab, label: t(GUIDE_TAB_CONFIG[tab].labelKey) })),
    [t]
  );

  const active = GUIDE_TAB_CONFIG[activeTab];
  const activeLabel = t(active.labelKey);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('guide.title')}</h1>
        <p className={styles.subtitle}>{t('guide.subtitle')}</p>
      </header>

      <SegmentedTabs
        items={tabItems}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel={t('guide.tabs_label')}
        idBase={TAB_ID_BASE}
        className={styles.tabs}
      />

      {/* Only the active diagram is mounted so a single archify runtime runs at a time. */}
      <section
        key={activeTab}
        className={styles.panel}
        role="tabpanel"
        aria-labelledby={`${TAB_ID_BASE}-${activeTab}`}
      >
        <p className={styles.intro}>{t(active.introKey)}</p>
        <DiagramFrame html={active.html} title={activeLabel} />
      </section>
    </div>
  );
}
