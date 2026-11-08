import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { matchPath, matchRoutes, useLocation } from 'react-router-dom';
import { useOptionalClientConfig } from '../config/useClientConfig';
import { PLUGIN_PAGE_PATH } from '../routes/paths';
import { Page, PageHero, PageHeroSection, PageMain } from '../ui/page/Page';
import { isPluginEnabled } from './pluginConfig';
import type { PluginPage, PluginPageProps } from './pluginPages';
import { registeredPlugins } from './registry';

/** The page of an enabled plugin that the address shows, and its params. */
export type MatchedPluginPage = { page: PluginPage; params: PluginPageProps['params'] };

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
