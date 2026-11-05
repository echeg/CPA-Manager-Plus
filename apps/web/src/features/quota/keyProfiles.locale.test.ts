import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';

type LocaleTree = { [key: string]: string | LocaleTree };

// The JSON imports carry literal types; read them as plain string trees.
const locales = { en, ru, 'zh-CN': zhCN, 'zh-TW': zhTW } as unknown as Record<
  string,
  { quota_management: Record<string, LocaleTree> }
>;

const subtrees = ['key_profiles', 'client_keys'] as const;

// Keys of the old per-key profiles toolbar that the Profiles and Keys modals replaced.
const removedKeyProfileKeys = [
  'button',
  'button_hint',
  'title',
  'shared_title',
  'shared_hint',
  'badge_shared',
  'badge_own',
  'reset',
  'empty',
  'editor.mode',
  'editor.mode_shared',
  'editor.mode_own',
  'editor.shared_hint',
];

const leafPaths = (tree: LocaleTree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafPaths(value, `${prefix}${key}.`)
  );

describe('key profiles and client keys locales', () => {
  for (const subtree of subtrees) {
    it(`has the same ${subtree} keys in every locale`, () => {
      const expected = leafPaths(locales.en.quota_management[subtree]).sort();
      expect(expected.length).toBeGreaterThan(0);
      for (const [name, locale] of Object.entries(locales)) {
        const tree = locale.quota_management[subtree];
        expect(tree, `${name} has no ${subtree}`).toBeDefined();
        expect(leafPaths(tree).sort(), name).toEqual(expected);
      }
    });
  }

  it('has a non-empty string for every key in every locale', () => {
    for (const [name, locale] of Object.entries(locales)) {
      for (const subtree of subtrees) {
        const tree = locale.quota_management[subtree];
        for (const path of leafPaths(tree)) {
          const value = path
            .split('.')
            .reduce<string | LocaleTree>((node, key) => (node as LocaleTree)[key], tree);
          expect(
            typeof value === 'string' && value.trim() !== '',
            `${name} ${subtree}.${path}`
          ).toBe(true);
        }
      }
    }
  });

  it('drops the keys of the old per-key profiles toolbar', () => {
    for (const [name, locale] of Object.entries(locales)) {
      const paths = new Set(leafPaths(locale.quota_management.key_profiles));
      for (const removed of removedKeyProfileKeys) {
        expect(paths.has(removed), `${name} key_profiles.${removed}`).toBe(false);
      }
    }
  });
});
