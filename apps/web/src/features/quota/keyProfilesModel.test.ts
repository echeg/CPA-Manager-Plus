import { beforeAll, describe, expect, test } from 'vitest';
import i18n from '@/i18n';
import type {
  RoutingProfile,
  RoutingSelectionOptions,
} from '@/features/personal-quota-support/services/api/routingProfiles';
import type { AuthFileItem } from '@/features/personal-quota-support/types';
import { sha256Hex } from '@/utils/apiKeyHash';
import {
  buildKeyRows,
  chainSummary,
  copyOfShared,
  normalizeProfile,
  profileDirty,
} from './keyProfilesModel';
import { preferredAccountOptions } from './routingModel';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const t = i18n.t.bind(i18n);

const options: RoutingSelectionOptions = {
  narrowing: ['priority', 'reserves', 'earliest-reset', 'most-remaining'],
  pickers: ['round-robin', 'weighted-round-robin', 'fill-first'],
};

const profile = (patch: Partial<RoutingProfile> = {}): RoutingProfile => ({
  sessionAffinity: true,
  preferredAccounts: { claude: 'claude-a' },
  selection: { primary: 'reserves', tiebreak: 'round-robin' },
  claudeFallback: {
    enabled: true,
    mode: 'auto',
    mappings: [{ from: 'claude-opus-*', to: 'gpt-6-astra' }],
  },
  ...patch,
});

const files: AuthFileItem[] = [
  {
    name: 'claude-bob@example.com.json',
    email: 'bob@example.com',
    provider: 'claude',
    authIndex: 'claude-a',
  },
  {
    name: 'codex-alice@example.com.json',
    email: 'alice@example.com',
    provider: 'codex',
    authIndex: 'codex-a',
    disabled: true,
  },
  { name: 'codex-no-index.json', provider: 'codex' },
];

describe('normalizeProfile and profileDirty', () => {
  test('a picker primary drops the tiebreak', () => {
    const value = profile({ selection: { primary: 'fill-first', tiebreak: 'round-robin' } });
    expect(normalizeProfile(value, options).selection).toEqual({ primary: 'fill-first' });
    expect(profileDirty(value, profile({ selection: { primary: 'fill-first' } }), options)).toBe(
      false
    );
  });

  test('a narrowing primary keeps the tiebreak', () => {
    expect(normalizeProfile(profile(), options).selection).toEqual({
      primary: 'reserves',
      tiebreak: 'round-robin',
    });
    expect(profileDirty(profile(), profile({ selection: { primary: 'reserves' } }), options)).toBe(
      true
    );
  });

  test('mappings are trimmed and empty preferences dropped', () => {
    const messy = profile({
      preferredAccounts: { claude: ' claude-a ', codex: '  ' },
      claudeFallback: {
        enabled: true,
        mode: 'auto',
        mappings: [{ from: ' claude-opus-* ', to: ' gpt-6-astra ' }],
      },
    });
    const normalized = normalizeProfile(messy, options);
    expect(normalized.preferredAccounts).toEqual({ claude: 'claude-a' });
    expect(normalized.claudeFallback.mappings).toEqual([
      { from: 'claude-opus-*', to: 'gpt-6-astra' },
    ]);
    expect(profileDirty(messy, profile(), options)).toBe(false);
  });

  test('a real change is dirty', () => {
    expect(profileDirty(profile(), profile({ sessionAffinity: false }), options)).toBe(true);
    expect(
      profileDirty(profile(), profile({ preferredAccounts: { codex: 'codex-a' } }), options)
    ).toBe(true);
  });
});

describe('copyOfShared', () => {
  test('returns an equal, independent copy', () => {
    const shared = profile();
    const copy = copyOfShared(shared);
    expect(copy).toEqual(shared);
    copy.preferredAccounts.claude = 'other';
    copy.selection.primary = 'priority';
    copy.claudeFallback.mappings[0].to = 'changed';
    copy.claudeFallback.mappings.push({ from: 'x', to: 'y' });
    expect(shared).toEqual(profile());
  });
});

describe('buildKeyRows', () => {
  const rawKey = 'sk-client-secret-key-0001';
  const otherKey = 'sk-client-secret-key-0002';

  test('uses the alias when one matches the key hash', () => {
    const [row] = buildKeyRows(
      [{ key: rawKey, profile: null }],
      [{ apiKeyHash: sha256Hex(rawKey).toUpperCase(), alias: 'Laptop' }]
    );
    expect(row.label).toBe('Laptop');
    expect(row.hasAlias).toBe(true);
    expect(row.masked).not.toContain(rawKey);
    expect(row.key).toBe(rawKey);
  });

  test('falls back to the masked key without an alias', () => {
    const rows = buildKeyRows(
      [
        { key: rawKey, profile: profile() },
        { key: otherKey, profile: null },
      ],
      [{ apiKeyHash: sha256Hex('unknown-key'), alias: 'Ghost' }]
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.label).toBe(row.masked);
      expect(row.hasAlias).toBe(false);
      expect(row.label).not.toContain(row.key);
      expect(JSON.stringify({ label: row.label, masked: row.masked })).not.toContain('Ghost');
    }
    expect(rows[0].profile).toEqual(profile());
    expect(rows[1].profile).toBeNull();
  });

  test('never shows an alias that repeats the raw key', () => {
    const [row] = buildKeyRows(
      [{ key: 'plain-client-key', profile: null }],
      [{ apiKeyHash: sha256Hex('plain-client-key'), alias: 'plain-client-key' }]
    );
    expect(row.label).not.toContain('plain-client-key');
    expect(row.hasAlias).toBe(false);
  });

  test('labels a CP key without an alias with its instance name', () => {
    const cpTail = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const cpKey = `sk-bx-team-a-1-${cpTail}`;
    const [row] = buildKeyRows([{ key: cpKey, profile: null }]);
    expect(row.label).toBe('team-a-1');
    expect(row.label).not.toContain(cpTail);
    expect(row.hasAlias).toBe(true);
    expect(row.masked).not.toContain(cpKey);
    expect(row.key).toBe(cpKey);
  });
});

describe('preferredAccountOptions', () => {
  const name = (file: AuthFileItem) => String(file.email);

  test('marks disabled accounts and skips files without an auth index', () => {
    expect(preferredAccountOptions('codex', files, '', name, t)).toEqual([
      { value: '', label: 'Automatic' },
      { value: 'codex-a', label: 'alice@example.com · disabled' },
    ]);
  });

  test('keeps a selected account that no longer exists', () => {
    expect(preferredAccountOptions('claude', files, 'gone', name, t)).toEqual([
      { value: '', label: 'Automatic' },
      { value: 'claude-a', label: 'bob@example.com' },
      { value: 'gone', label: 'Subscription unavailable or removed' },
    ]);
  });
});

describe('chainSummary', () => {
  test('lists the four stages with emails shown', () => {
    expect(chainSummary(profile(), files, true, t)).toBe(
      'Sticky session · Claude: claude-bob@example.com.json · Codex: Automatic · reserves → round-robin · Fallback: automatic'
    );
  });

  test('masks account names when emails are hidden', () => {
    const summary = chainSummary(profile(), files, false, t);
    expect(summary).not.toContain('bob@example.com');
    expect(summary).toContain('Claude: ');
    expect(summary).not.toContain('Claude: Automatic');
  });

  test('shows a missing and a disabled account', () => {
    const summary = chainSummary(
      profile({ preferredAccounts: { claude: 'gone', codex: 'codex-a' } }),
      files,
      true,
      t
    );
    expect(summary).toContain('Claude: Subscription unavailable or removed');
    expect(summary).toContain('Codex: codex-alice@example.com.json · disabled');
  });

  test('covers every fallback state and a primary without a tiebreak', () => {
    const off = profile({
      sessionAffinity: false,
      selection: { primary: 'fill-first' },
      claudeFallback: { enabled: false, mode: 'auto', mappings: [] },
    });
    expect(chainSummary(off, files, true, t)).toBe(
      'No sticky session · Claude: claude-bob@example.com.json · Codex: Automatic · fill-first · Fallback off'
    );
    const always = profile({
      claudeFallback: { ...profile().claudeFallback, mode: 'always' },
    });
    expect(chainSummary(always, files, true, t)).toMatch(/Fallback: always Codex$/);
  });
});
