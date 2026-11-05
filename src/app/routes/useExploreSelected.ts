import { useMatch } from 'react-router-dom';
import { EXPLORE_PATH } from './paths';

// A constant pattern object, so useMatch's memo holds between renders.
const EXPLORE_PATTERN = { path: EXPLORE_PATH, caseSensitive: true, end: false };

/** Whether the route is inside the Explore section. */
export const useExploreSelected = (): boolean => !!useMatch(EXPLORE_PATTERN);
