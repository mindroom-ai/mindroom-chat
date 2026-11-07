import type { ComponentType } from 'react';
import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { generatePath, matchPath, matchRoutes, useHref, useLocation } from 'react-router-dom';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { PLUGIN_PAGE_PATH } from '../routes/paths';
import { Page, PageHero, PageHeroSection, PageMain } from '../ui/page/Page';
import { isPluginEnabled } from './pluginConfig';
import { registeredPlugins } from './registry';

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

/** The page of an enabled plugin that the address shows, and its params. */
export type MatchedPluginPage = { page: PluginPage; params: PluginPageProps['params'] };

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

/**
 * The page the address shows when it is under `/p/<plugin id>/`: the page of that plugin whose path
 * matches the rest as React Router matches routes (best ranked first), unless config.json turns the
 * plugin off.
 */
export const usePluginPage = (): MatchedPluginPage | undefined => {
  const config = useOptionalClientConfig();
  const { pathname } = useLocation();
  const root = matchPath(PLUGIN_PAGE_PATH, pathname);
  const plugin = root && registeredPlugins.find(({ id }) => id === root.params.pluginId);
  if (!plugin || !isPluginEnabled(config, plugin.id)) return undefined;
  // The rest still encoded: matchRoutes decodes it once, as for the app's own routes.
  const [found] = matchRoutes([...plugin.pages], pathname.slice(root.pathnameBase.length)) ?? [];
  return found && { page: found.route, params: found.params };
};

/**
 * `/p/<plugin id>/...`: the plugin's page there, or "Page not found" for a plugin this build or
 * page load does not have, one that config.json turns off, or a path it has no page for.
 */
export function PluginPageRoute() {
  const { t } = useTranslation();
  const found = usePluginPage();
  return (
    <PageMain>
      {found ? (
        <found.page.Component params={found.params} />
      ) : (
        <Page>
          <PageHeroSection>
            <PageHero
              icon={<Icon size="600" src={Icons.Warning} />}
              title={t('sharedUi.router.notFound')}
            />
          </PageHeroSection>
        </Page>
      )}
    </PageMain>
  );
}
