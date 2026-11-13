import { getHomePath } from './pathUtils';

const isSafeSessionRestorePath = (lastKnownPath: string): boolean =>
  lastKnownPath.startsWith('/') && !lastKnownPath.startsWith('//');

export const resolveSessionRestorePath = (lastKnownPath?: string): string => {
  if (typeof lastKnownPath === 'string' && isSafeSessionRestorePath(lastKnownPath)) {
    return lastKnownPath;
  }

  return getHomePath();
};
