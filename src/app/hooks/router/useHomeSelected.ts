import { useMatch } from 'react-router-dom';
import { HOME_CREATE_PATH, HOME_PATH, HOME_SEARCH_PATH } from '../../pages/paths';

// Constant pattern objects, so useMatch's memo holds between renders.
const sectionPattern = (path: string) => ({ path, caseSensitive: true, end: false });
const HOME_PATTERN = sectionPattern(HOME_PATH);
const HOME_CREATE_PATTERN = sectionPattern(HOME_CREATE_PATH);
const HOME_SEARCH_PATTERN = sectionPattern(HOME_SEARCH_PATH);

/** Whether the route is inside the Home section. */
export const useHomeSelected = (): boolean => !!useMatch(HOME_PATTERN);

export const useHomeCreateSelected = (): boolean => !!useMatch(HOME_CREATE_PATTERN);

export const useHomeSearchSelected = (): boolean => !!useMatch(HOME_SEARCH_PATTERN);
