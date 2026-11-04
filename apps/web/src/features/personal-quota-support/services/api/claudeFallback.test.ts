import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), revision: 0 }));
vi.mock('./client', () => ({
  apiClient: { get: mocks.get, put: mocks.put, getConnectionRevision: () => mocks.revision },
}));
import {
  claudeFallbackApi,
  readClaudeFallback,
  suggestedFallbackMappings,
  validFallbackSettings,
  withSuggestions,
} from './claudeFallback';
const settings = { enabled: true, mode: 'always' as const, mappings: suggestedFallbackMappings() };
const response = () => ({
  supported: true,
  settings,
  models: { claude: ['claude-opus-5'], codex: ['gpt-6-astra'] },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.revision = 0;
});

describe('Claude fallback configuration', () => {
  it('fills an empty mapping list with suggestions and copies existing rows', () => {
    expect(withSuggestions({ ...settings, mappings: [] }).mappings).toEqual(
      suggestedFallbackMappings()
    );
    const source = { ...settings, mappings: [{ from: 'claude-*', to: 'gpt' }] };
    const copy = withSuggestions(source);
    expect(copy).toEqual(source);
    copy.mappings[0].to = 'changed';
    expect(source.mappings[0].to).toBe('gpt');
  });
  it('reads model mappings and validates family rules', () => {
    expect(readClaudeFallback(response())).toEqual(response());
    expect(validFallbackSettings(settings)).toBe(true);
    for (const mappings of [
      [],
      [{ from: 'claude-*-5', to: 'gpt' }],
      [{ from: 'claude-*', to: '*' }],
      [{ from: '', to: 'gpt' }],
      [
        { from: 'claude-*', to: 'gpt' },
        { from: 'claude-*', to: 'other' },
      ],
    ]) {
      expect(validFallbackSettings({ ...settings, mappings })).toBe(false);
    }
    expect(validFallbackSettings({ ...settings, enabled: false, mappings: [] })).toBe(true);
    expect(() =>
      readClaudeFallback({
        ...response(),
        settings: { enabled: true, mode: 'unknown', mappings: [] },
      })
    ).toThrow();
  });
  it('disables controls against an old backend, while surfacing connection errors', async () => {
    mocks.get.mockRejectedValue({ status: 404 });
    await expect(claudeFallbackApi.get()).resolves.toMatchObject({ supported: false });
    await expect(claudeFallbackApi.save(settings)).rejects.toThrow('updated CPA');
    expect(mocks.put).not.toHaveBeenCalled();
    mocks.get.mockRejectedValue(new Error('offline'));
    await expect(claudeFallbackApi.get()).rejects.toThrow('offline');
  });
  it('writes only the fallback subtree and verifies the saved state', async () => {
    mocks.get.mockResolvedValue(response());
    await expect(claudeFallbackApi.save(settings)).resolves.toEqual(response());
    expect(mocks.put).toHaveBeenCalledWith('/config/routing/claude-fallback', settings);
  });
  it('does not write after the connection changes during capability lookup', async () => {
    mocks.get.mockImplementation(async () => {
      mocks.revision++;
      return response();
    });
    await expect(claudeFallbackApi.save(settings)).rejects.toThrow('connection changed');
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('rejects silently discarded settings', async () => {
    mocks.get.mockResolvedValue({ ...response(), settings: { ...settings, enabled: false } });
    await expect(claudeFallbackApi.save(settings)).rejects.toThrow('did not retain');
  });
  it('preserves mappings and the selected mode when toggled off', async () => {
    const disabled = { ...settings, enabled: false };
    mocks.get
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce({ ...response(), settings: disabled });
    await claudeFallbackApi.save(disabled);
    expect(mocks.put).toHaveBeenCalledWith('/config/routing/claude-fallback', disabled);
  });
});
