import type { TOptions } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { LocaleTree } from '../i18n/englishResources';
import i18n, { registerNamespace, type NamespaceLoader } from '../i18n/i18n';
import { isRecord } from '../lib/isRecord';

/**
 * A plugin's strings: its English ones, which ship with its code, and `load`, which gives another
 * language's strings while that language is in use (none, or a failure, shows English).
 */
export type PluginTranslations = { en: LocaleTree; load?: NamespaceLoader };

/** The keys of a plugin's strings: `a.b` for `{ a: { b: '…' } }`. */
export type PluginStringKey<Strings> = {
  [Key in keyof Strings & string]: Strings[Key] extends string
    ? Key
    : `${Key}.${PluginStringKey<Strings[Key]>}`;
}[keyof Strings & string];

/** Translates one of a plugin's strings into the app's language, with i18next's options. */
export type PluginT<Strings> = (key: PluginStringKey<Strings>, options?: TOptions) => string;

const namespace = (pluginId: string): string => `plugin.${pluginId}`;

/** Registers a plugin's strings as the namespace `plugin.<id>`; anything but strings counts as none. */
export const registerPluginTranslations = (pluginId: string, translations: unknown): void => {
  if (!isRecord(translations) || !isRecord(translations.en)) return;
  const { en, load } = translations;
  const loader: NamespaceLoader =
    typeof load === 'function' ? (load as NamespaceLoader) : async () => undefined;
  void registerNamespace(namespace(pluginId), en as LocaleTree, loader);
};

/** A plugin component's `t`, in the plugin's own strings: it renders again when the language changes. */
export const usePluginTranslation = <Strings extends LocaleTree = LocaleTree>(
  pluginId: string
): PluginT<Strings> =>
  // The app's typed keys cover its own catalog only.
  useTranslation(namespace(pluginId) as never).t as unknown as PluginT<Strings>;

/** The same `t` for code outside React: each call translates into the language in use then. */
export const getPluginTranslation = <Strings extends LocaleTree = LocaleTree>(
  pluginId: string
): PluginT<Strings> =>
  i18n.getFixedT(null, namespace(pluginId) as never) as unknown as PluginT<Strings>;
