import { useMatch } from 'react-router-dom';
import { getActivityPath } from './pathUtils';

/**
 * Whether the current route is the Activity section or a page below it (a room it shows, its
 * invite list), so the icon rail shows its bell as the open section.
 */
export const useActivitySelected = (): boolean =>
  useMatch({ path: getActivityPath(), caseSensitive: true, end: false }) !== null;
