import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useLocation } from 'react-router-dom';
import { useNavToActivePathAtom } from '../state/hooks/navToActivePath';
import { ScreenSize, useScreenSizeContext } from './useScreenSize';

/** A section's own page (`/home/`, `/<space>/`): the room list on phones. */
const isSectionRoot = (pathname: string): boolean =>
  pathname.split('/').filter((segment) => segment.length > 0).length <= 1;

/**
 * Remembers the route a navigation section (`navId`) shows, so returning to the section reopens
 * it. With `preserveMobileContent`, opening the section's list on a phone keeps the remembered
 * room instead, so the next visit returns to that room rather than the bare list.
 */
export const useNavToActivePathMapper = (navId: string, preserveMobileContent = false): void => {
  const location = useLocation();
  // On a phone a section's root page is its room list.
  const onPhone = useScreenSizeContext() === ScreenSize.Mobile;
  const setNavToActivePath = useSetAtom(useNavToActivePathAtom());

  useEffect(() => {
    const { hash, pathname, search } = location;
    if (preserveMobileContent && onPhone && isSectionRoot(pathname)) {
      return;
    }
    setNavToActivePath({ type: 'PUT', navId, path: { pathname, search, hash } });
  }, [location, navId, onPhone, preserveMobileContent, setNavToActivePath]);
};
