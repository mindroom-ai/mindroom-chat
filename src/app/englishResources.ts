import en from './locales/en.json';
import enAdditions from './locales/additions/en.json';

// The English catalog the app ships: the ported en.json plus the Lane C overlay in
// locales/additions/en.json. The overlay holds keys that the Lane C code uses and the
// ported catalog does not define. The other languages translate them in their own overlays
// (locales/additions/<code>.json), which localeAdditions.ts merges the same way.

export type LocaleTree = { [key: string]: string | LocaleTree };

const isTree = (value: string | LocaleTree | undefined): value is LocaleTree =>
  typeof value === 'object' && value !== null;

/** Deep-merges `overlay` into a copy of `base`. A leaf already present in `base` wins. */
export const mergeLocaleTrees = (base: LocaleTree, overlay: LocaleTree): LocaleTree => {
  const merged: LocaleTree = { ...base };
  Object.entries(overlay).forEach(([key, value]) => {
    const existing = merged[key];
    if (existing === undefined) {
      merged[key] = value;
    } else if (isTree(existing) && isTree(value)) {
      merged[key] = mergeLocaleTrees(existing, value);
    }
  });
  return merged;
};

/** Merged English catalog. Its type is the union of both files, so typed `t()` keys cover both. */
export const englishCatalog = mergeLocaleTrees(en, enAdditions) as typeof en & typeof enAdditions;

export default englishCatalog;
