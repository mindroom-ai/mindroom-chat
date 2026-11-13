/**
 * One client plugin the build lists (docs/client-plugins.md): the id and version from
 * its package.json, and the default export of its entry module, unchecked.
 */
export type PluginEntry = { id: string; version: string; plugin: unknown };

/**
 * The plugins built into this app. scripts/client-plugins.mjs replaces this module with one that
 * imports the entry of each plugin MINDROOM_CLIENT_PLUGINS lists; without any, and in unit tests,
 * it lists none and no plugin code ships.
 */
export const pluginEntries: readonly PluginEntry[] = [];
