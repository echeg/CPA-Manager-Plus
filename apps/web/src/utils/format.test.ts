import { describe, expect, it } from 'vitest';
import { formatFileSize } from './format';

describe('formatFileSize', () => {
  it('formats zero and sub-kilobyte sizes in bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512.00 B');
    expect(formatFileSize(0.4)).toBe('0.40 B');
  });

  it('picks the largest unit that keeps the value at or above one', () => {
    expect(formatFileSize(1536)).toBe('1.50 KB');
    expect(formatFileSize(512 * 1024 * 1024)).toBe('512.00 MB');
    expect(formatFileSize(2 * 1024 ** 3)).toBe('2.00 GB');
  });

  it('formats terabyte limits instead of printing an unknown unit', () => {
    expect(formatFileSize(1024 ** 4)).toBe('1.00 TB');
    expect(formatFileSize(3 * 1024 ** 5)).toBe('3.00 PB');
    expect(formatFileSize(2048 * 1024 ** 5)).toBe('2048.00 PB');
  });
});
