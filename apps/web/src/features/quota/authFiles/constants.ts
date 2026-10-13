import type { TFunction } from 'i18next';
import iconAntigravity from '@/assets/icons/antigravity.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconCodex from '@/assets/icons/codex.svg';
import iconMeta from '@/assets/icons/meta.svg';
import iconDevin from '@/assets/icons/devin.svg';
import iconDevinDark from '@/assets/icons/devin-dark.svg';
import iconGemini from '@/assets/icons/gemini.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconIflow from '@/assets/icons/iflow.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconVertex from '@/assets/icons/vertex.svg';
import type { ResolvedTheme, ThemeColors } from '@/features/personal-quota-support/types';
import { normalizeOAuthProviderKey } from '@/features/quota/utils/providerKeys';
import { TYPE_COLORS } from '@/features/quota/utils/quota';

export type {
  ResolvedTheme,
  ThemeColors,
  TypeColorSet,
} from '@/features/personal-quota-support/types';
export type AuthFileIconAsset = string | { light: string; dark: string };

export const AUTH_FILE_ICONS: Record<string, AuthFileIconAsset> = {
  antigravity: iconAntigravity,
  aistudio: iconGemini,
  claude: iconClaude,
  codex: iconCodex,
  meta: iconMeta,
  devin: { light: iconDevin, dark: iconDevinDark },
  gemini: iconGemini,
  xai: { light: iconGrok, dark: iconGrokDark },
  iflow: iconIflow,
  kimi: { light: iconKimiDark, dark: iconKimiLight },
  qwen: iconQwen,
  vertex: iconVertex,
};

export const normalizeProviderKey = normalizeOAuthProviderKey;

export const getTypeLabel = (t: TFunction, type: string): string => {
  const providerKey = normalizeProviderKey(type);
  const key = `auth_files.filter_${providerKey}`;
  const translated = t(key);
  if (translated !== key) return translated;
  if (providerKey === 'iflow') return 'iFlow';
  return type.charAt(0).toUpperCase() + type.slice(1);
};

export const getTypeColor = (type: string, resolvedTheme: ResolvedTheme): ThemeColors => {
  const set = TYPE_COLORS[normalizeProviderKey(type)] || TYPE_COLORS.unknown;
  return resolvedTheme === 'dark' && set.dark ? set.dark : set.light;
};

export const getAuthFileIcon = (type: string, resolvedTheme: ResolvedTheme): string | null => {
  const iconEntry = AUTH_FILE_ICONS[normalizeProviderKey(type)];
  if (!iconEntry) return null;
  return typeof iconEntry === 'string'
    ? iconEntry
    : resolvedTheme === 'dark'
      ? iconEntry.dark
      : iconEntry.light;
};

// Match the provider workbench icon surfaces.
// Use black icon backgrounds in light mode and white in dark mode.
export const THEME_SURFACE_ICON_PROVIDERS = new Set(['kimi']);

export const isThemeSurfaceIconProvider = (type: string): boolean =>
  THEME_SURFACE_ICON_PROVIDERS.has(normalizeProviderKey(type));

export const getThemeSurfaceIconBackground = (resolvedTheme: ResolvedTheme): string =>
  resolvedTheme === 'dark' ? '#ffffff' : '#000000';
