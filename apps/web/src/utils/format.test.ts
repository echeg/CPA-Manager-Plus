import { describe, expect, it } from 'vitest';
import { formatFileSize, maskSensitiveText } from './format';

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

describe('maskSensitiveText', () => {
  const key = 'sk-abcdef123456';
  const masked = 'sk******56';

  it.each(['task-runner', 'kiosk-berlin', 'risk-engine', 'assess-candidates'])(
    'leaves the ordinary word %s unchanged',
    (word) => {
      expect(maskSensitiveText(word)).toBe(word);
      expect(maskSensitiveText(`run ${word} now`)).toBe(`run ${word} now`);
    }
  );

  it('does not mask the longer key prefixes inside words', () => {
    expect(maskSensitiveText('mask-proj-dashboard')).toBe('mask-proj-dashboard');
    expect(maskSensitiveText('desk-ant-colony')).toBe('desk-ant-colony');
  });

  it.each([
    ['at the start of the text', key, masked],
    ['after a space', `key ${key} used`, `key ${masked} used`],
    ['after =', `value=${key}`, `value=${masked}`],
    ['after :', `secret:${key}`, `secret:${masked}`],
    ['after a double quote', `"${key}"`, `"${masked}"`],
    ['after a single quote', `'${key}'`, `'${masked}'`],
    ['after /', `/v1/${key}`, `/v1/${masked}`],
    ['after _', `api_key_${key}`, `api_key_${masked}`],
    ['inside a JSON string', `{"secret":"${key}"}`, `{"secret":"${masked}"}`],
    ['after a JSON-escaped newline', JSON.stringify(`bad:\n${key}`), `"bad:\\n${masked}"`],
    ['after a JSON-escaped tab', JSON.stringify(`bad:\t${key}`), `"bad:\\t${masked}"`],
    ['after a JSON \\u escape', JSON.stringify(`bad:\u001b${key}`), `"bad:\\u001b${masked}"`],
    ['after %20', `q=a%20${key}`, `q=a%20${masked}`],
    ['after %3D', `next=%2Fv1%3Fkey%3D${key}`, `next=%2Fv1%3Fkey%3D${masked}`],
    [
      'after a terminal color code',
      `bad: \u001b[31m${key}\u001b[0m`,
      `bad: \u001b[31m${masked}\u001b[0m`,
    ],
    [
      'after a JSON-escaped terminal color code',
      JSON.stringify(`bad: \u001b[1;31m${key}\u001b[0m`),
      `"bad: \\u001b[1;31m${masked}\\u001b[0m"`,
    ],
    [
      'after a grep match color and erase-line code',
      `env:\u001b[01;31m\u001b[K${key}\u001b[m\u001b[K`,
      `env:\u001b[01;31m\u001b[K${masked}\u001b[m\u001b[K`,
    ],
    ['after a color code whose ESC was stripped', `bad: [31m${key}[0m`, `bad: [31m${masked}[0m`],
    [
      'after a grep color and erase-line code whose ESCs were stripped',
      `env:[01;31m[K${key}[m[K`,
      `env:[01;31m[K${masked}[m[K`,
    ],
    [
      'after a JSON-escaped erase-line code',
      JSON.stringify(`env:\u001b[01;31m\u001b[K${key}`),
      `"env:\\u001b[01;31m\\u001b[K${masked}"`,
    ],
    ['after a reset code with its ESC', `bad: \u001b[m${key}`, `bad: \u001b[m${masked}`],
    [
      'after a stripped color code with a trailing separator',
      `bad: [31;m${key}`,
      `bad: [31;m${masked}`,
    ],
    [
      'after a stripped color code with a trailing separator and an erase-line code',
      `env:[1;m[K${key}`,
      `env:[1;m[K${masked}`,
    ],
    [
      'after a stripped color code with a leading separator',
      `bad: [;1m${key}`,
      `bad: [;1m${masked}`,
    ],
    [
      'after a stripped reset code that follows a numbered one',
      `bad: [0m[31m[m${key}`,
      `bad: [0m[31m[m${masked}`,
    ],
  ])('still masks a key %s', (_case, input, expected) => {
    expect(maskSensitiveText(input)).toBe(expected);
  });

  it('masks a key after a newline inside pretty-printed JSON evidence', () => {
    const evidence = JSON.stringify({ upstream: `rejected:\n${key}` }, null, 2);
    expect(maskSensitiveText(evidence)).not.toContain(key);
  });

  it('masks every key when keys follow each other with one separator', () => {
    expect(maskSensitiveText(`${key},${key} ${key}`)).toBe(`${masked},${masked} ${masked}`);
  });

  it('still masks the other key prefixes', () => {
    expect(maskSensitiveText('hf_abcdef123456')).toBe('hf******56');
    expect(maskSensitiveText(`ghp_abcdef123456 and ${key}`)).toBe(`gh******56 and ${masked}`);
  });

  it('still masks the sk-proj-, sk-ant- and sess- prefixes after a boundary', () => {
    expect(maskSensitiveText('sk-proj-abcdef123456')).toBe('sk******56');
    expect(maskSensitiveText('use sk-ant-abcdef123456')).toBe('use sk******56');
    expect(maskSensitiveText('cookie_sess-abcdef123456')).toBe('cookie_se******56');
  });

  it('masks a Cerebras csk- key, whose sk- follows a letter', () => {
    const cerebras = 'csk-abcdef123456';
    expect(maskSensitiveText(cerebras)).toBe('cs******56');
    expect(maskSensitiveText(`upstream rejected ${cerebras}`)).toBe('upstream rejected cs******56');
    expect(maskSensitiveText(JSON.stringify({ key: cerebras }))).toBe('{"key":"cs******56"}');
    expect(maskSensitiveText(`api_key_${cerebras}`)).toBe('api_key_cs******56');
  });

  it('does not mask csk- inside a word', () => {
    expect(maskSensitiveText('xcsk-abcdef123456')).toBe('xcsk-abcdef123456');
  });

  it('does not take a bracketed word before sk- as a color code', () => {
    expect(maskSensitiveText('[ask-questions]')).toBe('[ask-questions]');
    expect(maskSensitiveText('[task-runner]')).toBe('[task-runner]');
  });

  it.each(['[msk-cluster]', '[Ksk-cluster]', 'retry [msk-cluster] failed'])(
    'does not take a bare [m or [K without an ESC as a color code: %s',
    (label) => {
      expect(maskSensitiveText(label)).toBe(label);
    }
  );

  // A rescan from every code of a run took seconds at this size (40000 codes
  // took about 8 s); a single pass takes milliseconds, so the bound is loose.
  it.each([
    ['numbered codes', '[1m'.repeat(40000)],
    ['one numbered code and reset codes', `[1m${'[m'.repeat(40000)}`],
    ['groups of numbered and reset codes', '[1m[m[K[m'.repeat(10000)],
  ])('reads a long run of stripped %s in linear time', (_case, run) => {
    const key = 'sk-abcdef123456';
    const startedAt = performance.now();
    expect(maskSensitiveText(`${run} tail`)).toBe(`${run} tail`);
    expect(maskSensitiveText(`${run}${key}`)).toBe(`${run}sk******56`);
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });
});
