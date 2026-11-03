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

/**
 * On phones the icon rail shows only on a section's own page (Home, Direct
 * Messages, a space, Threads, Canvases, Explore, Inbox); inside a room the
 * room takes the whole screen.
 */

















      canvasesMatch ||
      exploreMatch ||
      inboxMatch
    )
  ) {
    return null;
  }

  return children as JSX.Element;
}

type MobileFriendlyPageNavProps = MobileFriendlyProps & {
  /** The section root where the navigation list shows on phones. */








  if (screenSize === ScreenSize.Mobile && !exactPath) return null;

  return children as JSX.Element;
}
