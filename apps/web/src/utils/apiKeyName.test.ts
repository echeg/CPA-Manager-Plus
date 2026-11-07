import { describe, expect, it } from 'vitest';
import { cpInstanceNameFromKey } from './apiKeyName';

const TAIL = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('cpInstanceNameFromKey', () => {
  it('pins a 32-character base62 tail in the fixtures', () => {
    expect(TAIL).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('returns the instance name of a CP-issued key', () => {
    expect(cpInstanceNameFromKey(`sk-bx-ecwowk-${TAIL}`)).toBe('ecwowk');
  });

  it('keeps hyphens inside the instance name', () => {
    expect(cpInstanceNameFromKey(`sk-bx-team-a-1-${TAIL}`)).toBe('team-a-1');
  });

  it('does not take any part of the tail into a short base62-like name', () => {
    expect(cpInstanceNameFromKey(`sk-bx-abc-${TAIL}`)).toBe('abc');
    expect(cpInstanceNameFromKey(`sk-bx-ab-${'a'.repeat(32)}`)).toBe('ab');
  });

  it('accepts the longest instance name the CP allows (31 characters)', () => {
    const name = `a${'b'.repeat(30)}`;
    expect(name).toHaveLength(31);
    expect(cpInstanceNameFromKey(`sk-bx-${name}-${TAIL}`)).toBe(name);
  });

  it('returns the CP placeholder name', () => {
    expect(cpInstanceNameFromKey(`sk-bx-_placeholder-${TAIL}`)).toBe('_placeholder');
  });

  it('trims surrounding whitespace', () => {
    expect(cpInstanceNameFromKey(`  sk-bx-ecwowk-${TAIL}\n`)).toBe('ecwowk');
  });

  it.each([
    ['a foreign sk- key', `sk-proj-${TAIL}`],
    ['a foreign key with a name-like segment', `sk-xx-ecwowk-${TAIL}`],
    ['a 31-character tail', `sk-bx-ecwowk-${TAIL.slice(1)}`],
    ['a 33-character tail', `sk-bx-ecwowk-${TAIL}x`],
    ['a non-base62 character in the tail', `sk-bx-ecwowk-${TAIL.slice(1)}_`],
    ['uppercase letters in the name', `sk-bx-EcWowk-${TAIL}`],
    ['a missing name', `sk-bx--${TAIL}`],
    ['a hyphen-only name', `sk-bx---${TAIL}`],
    ['a name starting with a hyphen', `sk-bx--x-${TAIL}`],
    ['a 1-character name', `sk-bx-a-${TAIL}`],
    ['a 32-character name', `sk-bx-a${'b'.repeat(31)}-${TAIL}`],
    ['another underscore name', `sk-bx-_other-${TAIL}`],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('returns null for %s', (_label, key) => {
    expect(cpInstanceNameFromKey(key)).toBeNull();
  });
});
