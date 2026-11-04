import type { LocaleTree } from './englishResources';

// Translations of the Lane C keys (locales/additions/en.json) for the other app languages,
// one overlay per language in locales/additions/<code>.json. Each is its own chunk, loaded
// only when its language is, and merged into the catalog fetched from public/locales/ the way
// the English overlay merges into en.json: a key the fetched catalog already has keeps its text.
const overlays = import.meta.glob<LocaleTree>(
  ['./locales/additions/*.json', '!./locales/additions/en.json'],
  { import: 'default' }
);

const overlayModule = (language: string): string => `./locales/additions/${language}.json`;

/** The overlay for `language`, or undefined when it has none or its chunk fails to load. */
export const loadLocaleAdditions = async (language: string): Promise<LocaleTree | undefined> => {
  const load = overlays[overlayModule(language)];
  if (!load) return undefined;
  try {
    return await load();
  } catch {
    // The fetched catalog still applies; the overlay's keys then fall back to English.
    return undefined;
  }
};
