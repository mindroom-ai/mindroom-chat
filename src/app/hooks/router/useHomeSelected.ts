import { useMatch } from 'react-router-dom';
import { HOME_CREATE_PATH, HOME_PATH, HOME_SEARCH_PATH } from '../../pages/paths';

const useSectionMatch = (path: string): boolean =>
  !!useMatch({ path, caseSensitive: true, end: false });

/** Whether the route is inside the Home section. */
export const useHomeSelected = (): boolean => useSectionMatch(HOME_PATH);

export const useHomeCreateSelected = (): boolean => useSectionMatch(HOME_CREATE_PATH);

export const useHomeSearchSelected = (): boolean => useSectionMatch(HOME_SEARCH_PATH);
