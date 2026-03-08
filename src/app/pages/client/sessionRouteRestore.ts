import { getHomePath } from '../pathUtils';

type LocationParts = {
  pathname: string;
  search?: string;
  hash?: string;
};

export const buildSessionLastKnownPath = ({
  pathname,
  search = '',
  hash = '',
}: LocationParts): string => `${pathname}${search}${hash}`;

export const resolveSessionRestorePath = (lastKnownPath?: string): string => {
  if (typeof lastKnownPath === 'string' && lastKnownPath.startsWith('/')) {
    return lastKnownPath;
  }

  return getHomePath();
};
