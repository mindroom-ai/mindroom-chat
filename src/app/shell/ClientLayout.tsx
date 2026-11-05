import { ReactNode, useEffect, useState } from 'react';
import { Box } from 'folds';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useActiveSession } from '../matrix/session/useSessionStore';
import { updateSessionLastPath } from '../matrix/session/sessions';
import {
  canonicalizeSessionPathname,
  pathnameContainsAliasRoute,
  resolveCanonicalizedPathname,
} from '../navigation/clientRouteRestore';
import { RUNTIME_NAVIGATION_PATHS } from '../../boot/serviceWorkerNavigation';

type ClientLayoutProps = {
  nav: ReactNode;
  /** Classes for the row of the rail and the page (the floating cards' shell). */
  className?: string;
  // Optional so `createElement(ClientLayout, { nav }, page)` can pass the page positionally.
  children?: ReactNode;
};

/** Pages the MindRoom runtime serves at this origin; the tab only passes through them. */
const isRuntimeHandOffPath = (pathname: string): boolean =>
  RUNTIME_NAVIGATION_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/**
 * The signed-in layout: the sidebar navigation beside the routed page. It
 * remembers the route each session last showed, and replaces room alias
 * routes with room ID routes before the page renders.
 */
export function ClientLayout({ nav, className, children }: ClientLayoutProps) {
  const mx = useMatrixClient();
  const activeSession = useActiveSession();
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  const sessionId = activeSession?.sessionId;

  const hasAlias = pathnameContainsAliasRoute(pathname);
  const [resolvedAliasPath, setResolvedAliasPath] = useState<string>();
  const waitingForAlias = hasAlias && resolvedAliasPath !== pathname;

  useEffect(() => {
    if (!sessionId || isRuntimeHandOffPath(pathname)) return;
    const storedPathname = canonicalizeSessionPathname(mx, pathname);
    updateSessionLastPath(sessionId, `${storedPathname}${search}${hash}`);
  }, [mx, sessionId, pathname, search, hash]);

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

  return (
    <Box grow="Yes" className={className} style={{ height: '100%', minHeight: 0 }}>
      {nav}
      {waitingForAlias && sessionId ? null : children}
    </Box>
  );
}
