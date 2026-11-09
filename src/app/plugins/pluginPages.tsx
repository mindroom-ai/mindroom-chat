import type { ComponentType } from 'react';
import { generatePath, useHref } from 'react-router-dom';
import { PLUGIN_PAGE_PATH } from '../routes/paths';

/** What a plugin page gets: the values of its path's parameters, decoded. */
export type PluginPageProps = { params: Readonly<Record<string, string | undefined>> };

/** A page of a plugin's own, at `/p/<plugin id>/<path>`. */
export type PluginPage = {
  /** A React Router path under the plugin's root, such as `''` or `items/:itemId`. */
  path: string;
  Component: ComponentType<PluginPageProps>;
  /** Whether the page fills the window, without the app's rail; by default the rail stays. */
  fillsWindow?: boolean;
};

/**
 * The app's path of a plugin's page: `path` (concrete, its segments encoded, without a leading `/`)
 * under its root.
 */
export const pluginRoutePath = (pluginId: string, path = ''): string =>
  generatePath(PLUGIN_PAGE_PATH, { pluginId, '*': path });

/**
 * The `href` of a plugin's page, as `pluginRoutePath` gives it, with the base path the app is
 * served under, or after `#` with the hash router.
 */
export const usePluginRouteHref = (pluginId: string, path?: string): string =>
  useHref(pluginRoutePath(pluginId, path));
