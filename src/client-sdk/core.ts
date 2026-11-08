// `@mindroom/client-sdk/core`, the client SDK's subpath for every plugin (docs/architecture.md
// "Client plugins"): the plugin types, the hook that reads a plugin's config.json section, the one
// that keeps its values for the signed-in account, the one that translates its strings, the one
// that opens its side panels in the open room, the one that gives a side panel its layout, the URL
// of its public/ files, and a reload into a newly deployed version. Plugins import the app only
// through the SDK; the app never imports it.
// The SDK only grows: each addition (an export, or a contribution kind in ClientPlugin) raises
// CLIENT_PLUGIN_API_VERSION in scripts/client-plugins.mjs, so a plugin written for an older SDK
// still builds.
import {
  checkForNewVersion,
  reloadForNewVersion as reloadAppForNewVersion,
} from '../app/config/appUpdate';
import { appUrl } from '../app/lib/basePath';

export type { ClientPlugin } from '../app/plugins/registry';
export type { MessageRenderer, PluginEvent } from '../app/plugins/messageRenderers';
export { usePluginConfig } from '../app/plugins/pluginConfig';
export {
  pluginRoutePath,
  usePluginRouteHref,
  type PluginPage,
  type PluginPageProps,
} from '../app/plugins/pluginPages';
export { usePluginStorage, type PluginStorage } from '../app/plugins/pluginStorage';
export { useRoomSidePanel, type RoomSidePanelControl } from '../app/plugins/sidePanels';
export { usePanelFrame, type PanelFrame } from '../app/ui/panels/panelFrameContext';
export { usePluginTranslation } from '../app/plugins/pluginTranslations';

/**
 * The URL of the files the plugin `id` ships in its public/ directory, which the build puts under
 * public/plugins/<id>/ (scripts/client-plugins.mjs), under the app's base path: its
 * public/logo.svg is at `${pluginPublicUrl(id)}logo.svg`.
 */
export const pluginPublicUrl = (id: string): string => appUrl(`public/plugins/${id}/`);

/**
 * Reloads the page into the newest version the server has, as the app's own update notice does,
 * also when the page has not noticed that version yet.
 */
export const reloadForNewVersion = async (): Promise<void> => {
  // A version the page has not noticed stages no new worker, and the old one would answer the reload.
  await checkForNewVersion();
  await reloadAppForNewVersion();
};
