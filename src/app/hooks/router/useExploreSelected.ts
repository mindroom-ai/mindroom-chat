import { useMatch } from 'react-router-dom';
import { EXPLORE_PATH } from '../../pages/paths';

/** Whether the route is inside the Explore section. */
export const useExploreSelected = (): boolean =>
  !!useMatch({ path: EXPLORE_PATH, caseSensitive: true, end: false });
