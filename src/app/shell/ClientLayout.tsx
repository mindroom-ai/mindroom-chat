import { ReactNode, useEffect, useRef, useState } from 'react';
import { Box } from 'folds';
import { useAtomValue } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useActiveSession } from '../matrix/session/useSessionStore';
import { getActiveSession, updateSessionLastPath } from '../matrix/session/sessions';
import { resolveSessionRestorePath } from '../routes/sessionRouteRestore';
import {
  canonicalizeSessionPathname,
  pathnameContainsAliasRoute,
  resolveCanonicalizedPathname,
} from '../navigation/clientRouteRestore';
import { RUNTIME_NAVIGATION_PATHS } from '../../boot/serviceWorkerNavigation';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useInert } from '../lib/hooks/useInert';
import { phoneLayerOpenAtom } from '../navigation/phoneNavDrawer';
import * as css from './ClientLayout.css';

type ClientLayoutProps = {
  nav: ReactNode;
  /** On phones, in place of `nav`: the bar above the page and the drawer the navigation is in. */
  phoneTopBar?: ReactNode;
  phoneNavDrawer?: ReactNode;
  /** Classes for the row of the rail and the page (the floating cards' shell). */
  className?: string;
  // Optional so `createElement(ClientLayout, { nav }, page)` can pass the page positionally.
  children?: ReactNode;
};

/**
 * The account that was active when the current history entry was opened, by the entry's key.
 * When the active account changes without a navigation (the active one logged out or was removed,
 * another tab switched accounts), the next one shows a route it never opened; that route is not
 * its last one, and the tab opens the next account's last route instead, as a switch in this tab
 * does.
 */
let routeOpener: { key: string; sessionId: string } | undefined;

/** Pages the MindRoom runtime serves at this origin; the tab only passes through them. */
const isRuntimeHandOffPath = (pathname: string): boolean =>
  RUNTIME_NAVIGATION_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/**
 * The signed-in layout: the sidebar navigation beside the routed page, or on phones a top bar
 * above it and a drawer that slides the navigation in over it. It remembers the route each session
 * last showed, and replaces room alias routes with room ID routes, holding the page back only until
 * an alias the client does not know is resolved.
 */
export function ClientLayout({
  nav,
  phoneTopBar,
  phoneNavDrawer,
  className,
  children,
}: ClientLayoutProps) {
  const mx = useMatrixClient();
  const activeSession = useActiveSession();
  const { hash, key, pathname, search } = useLocation();
  const navigate = useNavigate();
  const sessionId = activeSession?.sessionId;
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const layerOpen = useAtomValue(phoneLayerOpenAtom);
  const pageRef = useRef<HTMLDivElement>(null);
  useInert(pageRef, phone && layerOpen);

  const hasAlias = pathnameContainsAliasRoute(pathname);
  const [resolvedAliasPath, setResolvedAliasPath] = useState<string>();
  // The app's own links name rooms by their aliases, which the client knows: the page renders at
  // once and stays mounted while the room ID route replaces the address, so a thread a send opens
  // keeps the composer and its focus. Only an alias the homeserver must resolve holds the page.
  const waitingForAlias =
    hasAlias &&
    resolvedAliasPath !== pathname &&
    pathnameContainsAliasRoute(canonicalizeSessionPathname(mx, pathname));

  useEffect(() => {
    if (!sessionId || isRuntimeHandOffPath(pathname)) return;
    if (routeOpener && routeOpener.key === key && routeOpener.sessionId !== sessionId) {
      navigate(resolveSessionRestorePath(getActiveSession()?.lastKnownPath), { replace: true });
      return;
    }
    routeOpener = { key, sessionId };
    const storedPathname = canonicalizeSessionPathname(mx, pathname);
    updateSessionLastPath(sessionId, `${storedPathname}${search}${hash}`);
  }, [mx, sessionId, pathname, search, hash, key, navigate]);

  useEffect(() => {
    if (!sessionId || !hasAlias) return undefined;
    let cancelled = false;
    resolveCanonicalizedPathname(mx, pathname)
      .then((resolved) => {
        if (cancelled) return;
        setResolvedAliasPath(pathname);
        if (resolved !== pathname) navigate(`${resolved}${search}${hash}`, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setResolvedAliasPath(pathname);
      });
    return () => {
      cancelled = true;
    };
  }, [mx, sessionId, hasAlias, pathname, search, hash, navigate]);

  // One tree on every screen size, so a phone turned sideways keeps the page mounted: the page's
  // wrapper draws no box beside the rail, and on phones holds the page below the top bar.
  return (
    <Box
      grow="Yes"
      direction={phone ? 'Column' : 'Row'}
      className={className}
      style={{ height: '100%', minHeight: 0, position: phone ? 'relative' : undefined }}
    >
      {phone ? phoneTopBar : nav}
      <div ref={pageRef} className={phone ? css.PhonePage : css.PassThrough}>
        {waitingForAlias && sessionId ? null : children}
      </div>
      {phone && phoneNavDrawer}
    </Box>
  );
}
