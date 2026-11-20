import { isInAppPath } from './afterLoginRedirectPath';
import { getHomePath } from './pathUtils';

export const resolveSessionRestorePath = (lastKnownPath?: string): string =>
  isInAppPath(lastKnownPath) ? lastKnownPath : getHomePath();
