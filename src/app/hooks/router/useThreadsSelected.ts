import { useMatch } from 'react-router-dom';
import { getThreadsPath } from '../../pages/pathUtils';

/**
 * Whether the current route is the cross-room Threads page or a page below it, so the icon rail
 * shows its Threads button as the open section. The Threads path must lead the location (relative
 * to the router's basename) as whole segments and with the same letter case; a trailing slash is
 * optional.
 */
export const useThreadsSelected = (): boolean =>
  useMatch({ path: getThreadsPath(), caseSensitive: true, end: false }) !== null;
