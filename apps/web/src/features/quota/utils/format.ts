import { parseTimestamp } from './timestamp';

/** Formatting helpers inherited from the source management UI. */

/** Mask the middle of an API key, preserving two characters at each end. */
export function maskApiKey(key: string): string {
  const trimmed = String(key || '').trim();
  if (!trimmed) {
    return '';
  }

  const MASKED_LENGTH = 10;
  const visibleChars = trimmed.length < 4 ? 1 : 2;
  const start = trimmed.slice(0, visibleChars);
  const end = trimmed.slice(-visibleChars);
  const maskedLength = Math.max(MASKED_LENGTH - visibleChars * 2, 1);
  const masked = '*'.repeat(maskedLength);

  return `${start}${masked}${end}`;
}

/** Format a file size. */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

const COMPACT_SUFFIXES = ['', 'K', 'M', 'B', 'T'] as const;

/** Compact large counts for cards and charts, such as 1284 to 1.3K. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';

  const sign = value < 0 ? '-' : '';
  let scaled = Math.abs(value);
  let tier = 0;

  while (scaled >= 1000 && tier < COMPACT_SUFFIXES.length - 1) {
    scaled /= 1000;
    tier += 1;
  }

  // Keep one decimal below three significant digits; Number removes unnecessary trailing zeroes.
  let rendered = tier === 0 ? Math.round(scaled) : Number(scaled.toFixed(scaled < 100 ? 1 : 0));

  // Advance the unit if rounding reaches 1000, such as 999,999 becoming 1000K.
  if (rendered >= 1000 && tier < COMPACT_SUFFIXES.length - 1) {
    rendered = 1;
    tier += 1;
  }

  return `${sign}${rendered}${COMPACT_SUFFIXES[tier]}`;
}

/** Format a percentage without an unnecessary .0 suffix. */
export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';

  const rendered = value.toFixed(fractionDigits);
  return `${rendered.replace(/\.0+$/, '')}%`;
}

/** Format Unix timestamps in seconds, milliseconds, microseconds or nanoseconds in local time. */
export function formatUnixTimestamp(value: unknown, locale?: string): string {
  if (value === null || value === undefined || value === '') return '';

  const asNumber = typeof value === 'number' ? value : Number(value);
  const date = (() => {
    if (!Number.isFinite(asNumber) || Number.isNaN(asNumber)) {
      return parseTimestamp(value) ?? new Date(String(value));
    }

    const abs = Math.abs(asNumber);

    // Seconds usually have ten digits.
    if (abs < 1e11) return new Date(asNumber * 1000);

    // Milliseconds usually have thirteen digits.
    if (abs < 1e14) return new Date(asNumber);

    // Microseconds usually have sixteen digits.
    if (abs < 1e17) return new Date(Math.round(asNumber / 1000));

    // Nanoseconds usually have nineteen digits.
    return new Date(Math.round(asNumber / 1e6));
  })();

  if (Number.isNaN(date.getTime())) return '';
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
}

export function parseDateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const date =
    typeof value === 'number'
      ? new Date(value < 1e12 ? value * 1000 : value)
      : (parseTimestamp(value) ?? new Date(String(value)));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateValue(value: unknown, locale?: string): string {
  const date = parseDateValue(value);
  if (!date) return '';
  return locale ? date.toLocaleDateString(locale) : date.toLocaleDateString();
}

export function formatDateTimeValue(value: unknown, locale?: string): string {
  const date = parseDateValue(value);
  if (!date) return '';
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
}
