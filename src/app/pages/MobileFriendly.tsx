import { ReactNode } from 'react';
import { useMatch } from 'react-router-dom';
import { ScreenSize, useScreenSizeContext } from '../hooks/useScreenSize';
import {
  CANVASES_PATH,
  DIRECT_PATH,
  EXPLORE_PATH,
  HOME_PATH,
  INBOX_PATH,
  SPACE_PATH,
  THREADS_PATH,
} from './paths';

type MobileFriendlyProps = {
  children: ReactNode;
};

/** Whether the current location is exactly `path` (no deeper route), matched case-sensitively. */
const useOnExactPath = (path: string): boolean =>
  useMatch({ path, end: true, caseSensitive: true }) !== null;

/**
 * On phones the icon rail shows only on a section's own page (Home, Direct
 * Messages, a space, Threads, Canvases, Explore, Inbox); inside a room the
 * room takes the whole screen.
 */
export function MobileFriendlyClientNav({ children }: MobileFriendlyProps) {
  const onPhone = useScreenSizeContext() === ScreenSize.Mobile;
  const homeMatch = useOnExactPath(HOME_PATH);
  const directMatch = useOnExactPath(DIRECT_PATH);
  const threadsMatch = useOnExactPath(THREADS_PATH);
  const canvasesMatch = useOnExactPath(CANVASES_PATH);
  const inboxMatch = useOnExactPath(INBOX_PATH);
  const exploreMatch = useOnExactPath(EXPLORE_PATH);
  const spaceMatch = useOnExactPath(SPACE_PATH);

  const onSectionRoot = [
    homeMatch,
    directMatch,
    threadsMatch,
    canvasesMatch,
    inboxMatch,
    exploreMatch,
    spaceMatch,
  ].includes(true);

  return onPhone && !onSectionRoot ? null : <>{children}</>;
}

type MobileFriendlyPageNavProps = MobileFriendlyProps & {
  /** The section root where the navigation list shows on phones. */
  path: string;
};

/** On phones a section's navigation list shows only on its root page, not over its content. */
export function MobileFriendlyPageNav({ path, children }: MobileFriendlyPageNavProps) {
  const onPhone = useScreenSizeContext() === ScreenSize.Mobile;
  const onRoot = useOnExactPath(path);

  return onPhone && !onRoot ? null : <>{children}</>;
}
