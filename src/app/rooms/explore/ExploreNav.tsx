import { useMemo } from 'react';
import { Box, Icons, Text } from 'folds';
import { useMatch } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageNav, PageNavContent, PageNavHeader } from '../../ui/page/Page';
import { NavCategory } from '../../ui/nav/NavItem';
import { NavCategoryHeader } from '../../ui/nav/NavCategoryHeader';
import { NavPageLink } from '../../ui/nav/NavPageLink';
import { useClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { EXPLORE_FEATURED_PATH, EXPLORE_SERVER_PATH } from '../../routes/paths';
import { decodeRouteParam, getExploreFeaturedPath, getExploreServerPath } from '../../routes/pathUtils';

/** The servers to browse: this account's own first, then the ones the deployment features. */
const useExploreServers = (): string[] => {
  const client = useMatrixClient();
  const featured = useClientConfig().featuredCommunities?.servers;
  const own = client.getDomain();
  return useMemo(() => {
    const servers = own ? [own] : [];
    featured?.forEach((server) => {
      if (!servers.includes(server)) servers.push(server);
    });
    return servers;
  }, [featured, own]);
};

/** The Explore Community navigation: featured communities and each server's public rooms. */
export function ExploreNav() {
  const { t } = useTranslation();
  const servers = useExploreServers();
  const onFeatured = useMatch({ path: EXPLORE_FEATURED_PATH, end: false }) !== null;
  // The nav sits above the page routes, so it reads the server from the location itself.
  const encodedServer = useMatch({ path: EXPLORE_SERVER_PATH, end: false })?.params.server;
  const openServer = encodedServer ? decodeRouteParam(encodedServer) : undefined;

  return (
    <PageNav label={t('sharedUi.explore.exploreCommunity')}>
      <PageNavContent
        header={
          <PageNavHeader>
            <Box grow="Yes">
              <Text as="h2" size="H4" truncate>
                {t('sharedUi.explore.exploreCommunity')}
              </Text>
            </Box>
          </PageNavHeader>
        }
      >
        <Box direction="Column" gap="300">
          <NavCategory>
            <NavPageLink
              to={getExploreFeaturedPath()}
              icon={Icons.Bulb}
              label={t('sharedUi.explore.featured')}
              selected={onFeatured}
            />
          </NavCategory>
          {servers.length > 0 && (
            <NavCategory>
              <NavCategoryHeader>
                <Text size="O400" priority="300" truncate>
                  {t('sharedUi.explore.servers')}
                </Text>
              </NavCategoryHeader>
              {servers.map((server) => (
                <NavPageLink
                  key={server}
                  to={getExploreServerPath(server)}
                  icon={Icons.Server}
                  label={server}
                  selected={!onFeatured && openServer === server}
                />
              ))}
            </NavCategory>
          )}
        </Box>
      </PageNavContent>
    </PageNav>
  );
}
