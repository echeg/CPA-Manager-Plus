import { apiClient } from './client';
import { guardConfigConnection } from './configValue';

export interface ClaudeFallbackSettings {
  enabled: boolean;
  mode: 'auto' | 'always';
  mappings: Array<{ from: string; to: string }>;
}

export interface ClaudeFallbackState {
  supported: boolean;
  settings: ClaudeFallbackSettings;
  models: { claude: string[]; codex: string[] };
}

export const suggestedFallbackMappings = () => [
  { from: 'claude-opus-*', to: 'gpt-6-astra' },
  { from: 'claude-sonnet-*', to: 'gpt-6-sol' },
  { from: 'claude-fable-*', to: 'gpt-6-astra' },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function readClaudeFallback(raw: unknown): ClaudeFallbackState {
  if (!isRecord(raw) || typeof raw.supported !== 'boolean' || !isRecord(raw.settings))
    throw new Error('Invalid Claude fallback response');
  const settings = raw.settings;
  if (
    typeof settings.enabled !== 'boolean' ||
    !['auto', 'always'].includes(String(settings.mode)) ||
    !Array.isArray(settings.mappings) ||
    !settings.mappings.every(
      (item: unknown) =>
        isRecord(item) && typeof item.from === 'string' && typeof item.to === 'string'
    )
  )
    throw new Error('Invalid Claude fallback settings');
  const models = isRecord(raw.models) ? raw.models : {};
  const modelList = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    supported: raw.supported,
    settings: {
      enabled: settings.enabled,
      mode: settings.mode as ClaudeFallbackSettings['mode'],
      mappings: settings.mappings.map((item) => ({ from: item.from, to: item.to })),
    },
    models: { claude: modelList(models.claude), codex: modelList(models.codex) },
  };
}

export function normalizeFallbackSettings(
  settings: ClaudeFallbackSettings
): ClaudeFallbackSettings {
  return {
    ...settings,
    mappings: settings.mappings.map(({ from, to }) => ({ from: from.trim(), to: to.trim() })),
  };
}

export function validFallbackSettings(settings: ClaudeFallbackSettings): boolean {
  const { mappings } = normalizeFallbackSettings(settings);
  return (
    (!settings.enabled || mappings.length > 0) &&
    new Set(mappings.map(({ from }) => from)).size === mappings.length &&
    mappings.every(
      ({ from, to }) =>
        from.length > 0 &&
        to.length > 0 &&
        !/\s/.test(from + to) &&
        !to.includes('*') &&
        !from.replace(/\*$/, '').includes('*')
    )
  );
}

export const claudeFallbackApi = {
  async get(): Promise<ClaudeFallbackState> {
    try {
      return readClaudeFallback(await apiClient.get('/routing/claude-fallback'));
    } catch (error) {
      if (isRecord(error) && error.status === 404) {
        return {
          supported: false,
          settings: { enabled: false, mode: 'auto', mappings: [] },
          models: { claude: [], codex: [] },
        };
      }
      throw error;
    }
  },
  async save(settings: ClaudeFallbackSettings): Promise<ClaudeFallbackState> {
    const assertCurrent = guardConfigConnection();
    if (!validFallbackSettings(settings)) throw new Error('Invalid Claude fallback mappings');
    // Verify capability on this connection before writing a field older CPA versions discard.
    const current = await claudeFallbackApi.get();
    assertCurrent();
    if (!current.supported)
      throw new Error('Claude fallback requires an updated CPA with native routing');
    await apiClient.put('/config/routing/claude-fallback', normalizeFallbackSettings(settings));
    assertCurrent();
    const saved = await claudeFallbackApi.get();
    assertCurrent();
    if (
      !saved.supported ||
      JSON.stringify(saved.settings) !== JSON.stringify(normalizeFallbackSettings(settings))
    )
      throw new Error('CPA did not retain the Claude fallback settings');
    return saved;
  },
};
