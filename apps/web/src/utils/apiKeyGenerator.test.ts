import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateClientKey } from './apiKeyGenerator';
import { isValidApiKeyCharset } from './validation';

describe('generateClientKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps secure random bytes onto an sk- prefixed alphanumeric key', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.forEach((_, index) => {
        bytes[index] = index;
      });
      return array;
    });

    const key = generateClientKey();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(key.startsWith('sk-')).toBe(true);
    expect(key).toHaveLength(3 + 64);
    expect(key.slice(3, 9)).toBe('ABCDEF');
    // byte 62 wraps around the 62-character charset back to 'A'
    expect(key[3 + 62]).toBe('A');
    expect(key.slice(3)).toMatch(/^[A-Za-z0-9]{64}$/);
    expect(isValidApiKeyCharset(key)).toBe(true);
  });

  it('produces a different key for each call with the real RNG', () => {
    const first = generateClientKey();
    const second = generateClientKey();
    expect(first).not.toBe(second);
    expect(isValidApiKeyCharset(first)).toBe(true);
  });
});
