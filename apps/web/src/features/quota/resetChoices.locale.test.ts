import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';

type LocaleTree = { [key: string]: string | LocaleTree };

// The JSON imports carry literal types; read them as plain string trees.
const locales = { en, ru, 'zh-CN': zhCN, 'zh-TW': zhTW } as unknown as Record<
  string,
  { quota_management: { resets: Record<string, LocaleTree | string> } }
>;

const leafEntries = (tree: LocaleTree, prefix = ''): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : leafEntries(value, `${prefix}${key}.`)
  );

// Per-grant reasons the picker renders; account-wide `cooldown`/`ineligible` keep the
// existing account-level message and have no per-row key.
const expectedKeys = [
  'legend',
  'reason.not_limited',
  'reason.not_started',
  'reason.not_usable',
  'reason.paused',
  'recommended',
];

const choiceTree = (name: string): LocaleTree => {
  const tree = locales[name].quota_management.resets.choice;
  expect(tree, `${name} has no resets.choice`).toBeTypeOf('object');
  return tree as LocaleTree;
};

describe('reset choice locales', () => {
  it('has the expected resets.choice keys in English', () => {
    expect(
      leafEntries(choiceTree('en'))
        .map(([path]) => path)
        .sort()
    ).toEqual(expectedKeys);
  });

  it('has the same resets.choice keys in every locale', () => {
    const expected = leafEntries(choiceTree('en'))
      .map(([path]) => path)
      .sort();
    for (const name of Object.keys(locales)) {
      expect(
        leafEntries(choiceTree(name))
          .map(([path]) => path)
          .sort(),
        name
      ).toEqual(expected);
    }
  });

  it('has a non-empty string for every resets.choice key in every locale', () => {
    for (const name of Object.keys(locales)) {
      for (const [path, value] of leafEntries(choiceTree(name))) {
        expect(value.trim(), `${name} resets.choice.${path}`).not.toBe('');
      }
    }
  });
});
