import { useMatch } from 'react-router-dom';
import { HOME_CREATE_PATH, HOME_PATH } from './paths';

// Constant pattern objects, so useMatch's memo holds between renders.
const sectionPattern = (path: string) => ({ path, caseSensitive: true, end: false });
const HOME_PATTERN = sectionPattern(HOME_PATH);
const HOME_INDEX_PATTERN = { path: HOME_PATH, caseSensitive: true, end: true };
const HOME_CREATE_PATTERN = sectionPattern(HOME_CREATE_PATH);

/** Whether the route is inside the Home section. */
export const useHomeSelected = (): boolean => !!useMatch(HOME_PATTERN);

/** Whether the route is on the Home landing page (`/home/`). */
export const useHomeIndexSelected = (): boolean => !!useMatch(HOME_INDEX_PATTERN);

export const useHomeCreateSelected = (): boolean => !!useMatch(HOME_CREATE_PATTERN);
