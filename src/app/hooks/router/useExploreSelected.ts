import { useMatch } from 'react-router-dom';
import { EXPLORE_FEATURED_PATH, EXPLORE_PATH, EXPLORE_SERVER_PATH } from '../../pages/paths';

/** Whether the route is inside the Explore section. */
export const useExploreSelected = (): boolean =>
  !!useMatch({ path: EXPLORE_PATH, caseSensitive: true, end: false });

export const useExploreFeaturedSelected = (): boolean =>
  !!useMatch({ path: EXPLORE_FEATURED_PATH, caseSensitive: true, end: false });

/** The server whose public rooms the route lists, if any. */
export const useExploreServer = (): string | undefined => {
  const match = useMatch({ path: EXPLORE_SERVER_PATH, caseSensitive: true, end: false });
  const server = match?.params.server;
  return server ? decodeURIComponent(server) : undefined;
};
