import type { TOptions } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { LocaleTree } from '../i18n/englishResources';
import i18n, { registerNamespace, type NamespaceLoader } from '../i18n/i18n';
import { isRecord } from '../lib/isRecord';

/**
 * A plugin's strings: its English ones, which ship with its code, and `load`, which gives another
 * language's strings while that language is in use (none, or a failure, shows English). A change of
 * language waits until `load` settles.
 */
export type PluginTranslations = { en: LocaleTree; load?: NamespaceLoader };

/**
 * Translates a key of a plugin's strings (`a.b` for `{ a: { b: '…' } }`) into the app's language,
 * with i18next's options (`count` for plurals, values to interpolate) other than those that return
 * objects.
 */
export type PluginT = (
  key: string,
  options?: TOptions & { returnObjects?: false; returnDetails?: false }
) => string;

/** The i18n namespace of a plugin's strings. */
export const pluginNamespace = (pluginId: string): string => `plugin.${pluginId}`;

/** Registers a plugin's strings as the namespace `plugin.<id>`; none without an `en` record. */
export const registerPluginTranslations = (pluginId: string, translations: unknown): void => {
  if (!isRecord(translations) || !isRecord(translations.en)) return;
  const { en, load } = translations;
  const loader: NamespaceLoader =
    typeof load === 'function' ? (load as NamespaceLoader) : async () => undefined;
  void registerNamespace(pluginNamespace(pluginId), en as LocaleTree, loader);
};

/** A plugin component's `t`, in the plugin's own strings: it renders again when the language changes. */
export const usePluginTranslation = (pluginId: string): PluginT =>
  // The app's typed keys cover its own catalog only.
  useTranslation(pluginNamespace(pluginId) as never).t as unknown as PluginT;

/** The same `t` for code outside React: each call translates into the language in use then. */
export const getPluginTranslation = (pluginId: string): PluginT =>
  i18n.getFixedT(null, pluginNamespace(pluginId) as never) as unknown as PluginT;
