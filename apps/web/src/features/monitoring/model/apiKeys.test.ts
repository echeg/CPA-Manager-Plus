import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/utils/apiKeyHash';
import { buildApiKeyDisplayMap, sanitizeApiKeyDisplayText } from './apiKeys';

describe('sanitizeApiKeyDisplayText', () => {
  it('keeps a CP instance name that contains sk- or sess- inside a word', () => {
    expect(sanitizeApiKeyDisplayText('task-runner')).toBe('task-runner');
    expect(sanitizeApiKeyDisplayText('assess-candidates')).toBe('assess-candidates');
  });

  it('still masks a key used as a label', () => {
    expect(sanitizeApiKeyDisplayText('sk-abcdef123456')).toBe('sk******56');
  });
});

describe('buildApiKeyDisplayMap', () => {
  it('labels a CP-issued key with its unmasked instance name', () => {
    const apiKey = `sk-bx-task-runner-${'A1b2C3d4'.repeat(4)}`;
    const info = buildApiKeyDisplayMap([apiKey]).get(sha256Hex(apiKey).toLowerCase());
    expect(info?.label).toBe('task-runner');
  });
});
