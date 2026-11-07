// `@mindroom/client-sdk/core`, the client SDK's subpath for every plugin (docs/architecture.md
// "Client plugins"): the plugin types, the hook that reads a plugin's config.json section and the
// one that translates its strings. Plugins import the app only through the SDK; the app never
// imports it. The SDK only grows: each addition (an export, or a contribution kind in ClientPlugin)
// raises CLIENT_PLUGIN_API_VERSION in scripts/client-plugins.mjs, so a plugin written for an older
// SDK still builds.
export type { ClientPlugin } from '../app/plugins/registry';
export type { MessageRenderer, PluginEvent } from '../app/plugins/messageRenderers';
export { usePluginConfig } from '../app/plugins/pluginConfig';
export { usePluginTranslation } from '../app/plugins/pluginTranslations';
