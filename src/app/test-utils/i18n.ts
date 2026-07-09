import en from '../locales/en.json';

type LocaleTree = { [key: string]: string | LocaleTree };

// Test-only stand-in for i18next's t(): resolves keys against the real
// en.json (with {{var}} interpolation) so component tests keep asserting
// user-visible English copy without booting the full i18next runtime.
export const translateFromEn = (key: string, options?: Record<string, unknown>): string => {
  const value = key
    .split('.')
    .reduce<LocaleTree | string | undefined>(
      (node, part) => (typeof node === 'object' && node !== undefined ? node[part] : undefined),
      en as LocaleTree
    );
  if (typeof value !== 'string') return key;
  return value.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    options && name in options ? String(options[name]) : match
  );
};
