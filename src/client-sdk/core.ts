// `@mindroom/client-sdk/core`, the client SDK's subpath for every plugin (docs/architecture.md
// "Client plugins"): the plugin types and the hook that reads a plugin's config.json section.
// Plugins import the app only through the SDK; the app never imports it. Exports are only ever
// added, each addition raising CLIENT_PLUGIN_API_VERSION in scripts/client-plugins.mjs, so a plugin
// written for an older SDK still builds.
export type { ClientPlugin } from '../app/plugins/registry';
export type { MessageRenderer, PluginEvent } from '../app/plugins/messageRenderers';
export { usePluginConfig } from '../app/plugins/pluginConfig';
