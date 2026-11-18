import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock('./client', () => ({ apiClient: mocks }));

import { configApi, normalizeConfigResponse } from './config';
import { readSubscriptionRouting, subscriptionRoutingApi } from './subscriptionRouting';

beforeEach(() => vi.clearAllMocks());

describe('personal quota v8 configuration', () => {
  it('reads nested v8 subscription routing settings', async () => {
    const raw = {
      routing: {
        strategy: 'earliest-reset',
        'session-affinity': true,
        'session-affinity-ttl': '2h',
        'preferred-accounts': { codex: 'credential-1', claude: '', invalid: 42 },
      },
    };
    mocks.get.mockResolvedValue(raw);
    const config = await configApi.getConfig();
    expect(config.raw).toBe(raw);
    expect(readSubscriptionRouting(config)).toEqual({
      strategy: 'earliest-reset',
      sessionAffinity: true,
      sessionAffinityTTL: '2h',
      preferredAccounts: { codex: 'credential-1' },
    });
  });

  it('does not reinterpret a legacy config document as v8 settings', () => {
    expect(
      normalizeConfigResponse({ 'routing-strategy': 'fill-first', 'session-affinity': true })
    ).toMatchObject({ routingStrategy: undefined, routingSessionAffinity: undefined });
  });

  it('patches only changed routing fields and deletes a cleared preference with null', async () => {
    const before = {
      strategy: 'round-robin',
      sessionAffinity: true,
      sessionAffinityTTL: '1h',
      preferredAccounts: { codex: 'old-account', claude: 'keep-account' },
    };
    await subscriptionRoutingApi.update(before, {
      ...before,
      strategy: 'weighted-round-robin',
      preferredAccounts: { claude: 'keep-account' },
    });
    expect(mocks.patch).toHaveBeenCalledWith('/config', {
      routing: { strategy: 'weighted-round-robin', 'preferred-accounts': { codex: null } },
    });
  });
});
