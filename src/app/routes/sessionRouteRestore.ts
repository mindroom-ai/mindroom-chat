import { isInAppPath } from './afterLoginRedirectPath';
import { getHomePath } from './pathUtils';

/**
 * The saved route, when its path (before `?` and `#`) stays inside the app; else Home. A
 * backslash in the search or the hash, as a search for `C:\work` has, is data.
 */
export const resolveSessionRestorePath = (lastKnownPath?: string): string =>
  typeof lastKnownPath === 'string' && isInAppPath(lastKnownPath.split(/[?#]/, 1)[0])
    ? lastKnownPath
    : getHomePath();
