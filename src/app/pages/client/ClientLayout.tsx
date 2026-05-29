import React, { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box } from 'folds';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useActiveSession } from '../../hooks/useSessionStore';
import { updateSessionLastPath } from '../../state/sessions';
import { HOME_PATH } from '../paths';
import { buildSessionLastKnownPath } from './sessionRouteRestore';
import {
  canonicalizeSessionPathname,
  getLastOpenThreadRestoreTarget,
  pathnameContainsAliasRoute,
  resolveCanonicalizedPathname,
} from '../../mindroom/routing/clientRouteRestore';

type ClientLayoutProps = {
  nav: ReactNode;
  children: ReactNode;
};

export function ClientLayout({ nav, children }: ClientLayoutProps) {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { hash, pathname, search } = location;
  const activeSession = useActiveSession();
  const { navigateRoomThread } = useRoomNavigate();
  const startupRestorePathRef = useRef(activeSession?.lastKnownPath);
  const attemptedStartupRestoreRef = useRef(false);
  const pathnameHasAliasRoute = useMemo(() => pathnameContainsAliasRoute(pathname), [pathname]);
  const [isCanonicalizingCurrentRoute, setIsCanonicalizingCurrentRoute] =
    useState(pathnameHasAliasRoute);

  if (!startupRestorePathRef.current && activeSession?.lastKnownPath) {
    startupRestorePathRef.current = activeSession.lastKnownPath;
  }

  useLayoutEffect(() => {
    if (attemptedStartupRestoreRef.current || !activeSession) return;
    if (!matchPath({ path: HOME_PATH, caseSensitive: true, end: true }, pathname)) return;
    if (search || hash) return;

    attemptedStartupRestoreRef.current = true;

    const restoreTarget = getLastOpenThreadRestoreTarget(mx, startupRestorePathRef.current);
    if (!restoreTarget) return;

    if (restoreTarget.type === 'path') {
      navigate(restoreTarget.path, { replace: true });
      return;
    }

    navigateRoomThread(restoreTarget.roomId, restoreTarget.threadId, undefined, { replace: true });
  }, [activeSession, hash, mx, navigate, navigateRoomThread, pathname, search]);

  useLayoutEffect(() => {
    if (!activeSession) {
      setIsCanonicalizingCurrentRoute(false);
      return;
    }

    if (!pathnameHasAliasRoute) {
      setIsCanonicalizingCurrentRoute(false);
      return;
    }

    let disposed = false;
    setIsCanonicalizingCurrentRoute(true);

    resolveCanonicalizedPathname(mx, pathname)
      .then((canonicalizedPathname) => {
        if (disposed) return;

        const canonicalizedLocation = buildSessionLastKnownPath({
          pathname: canonicalizedPathname,
          search,
          hash,
        });
        const currentLocation = buildSessionLastKnownPath({ pathname, search, hash });

        if (canonicalizedLocation !== currentLocation) {
          navigate(canonicalizedLocation, { replace: true });
          return;
        }

        setIsCanonicalizingCurrentRoute(false);
      })
      .catch(() => {
        if (disposed) return;
        setIsCanonicalizingCurrentRoute(false);
      });

    return () => {
      disposed = true;
    };
  }, [activeSession, hash, mx, navigate, pathname, pathnameHasAliasRoute, search]);

  useEffect(() => {
    if (!activeSession) return;

    updateSessionLastPath(
      activeSession.sessionId,
      buildSessionLastKnownPath({
        pathname: canonicalizeSessionPathname(mx, pathname),
        search,
        hash,
      })
    );
  }, [activeSession, hash, mx, pathname, search]);

  return (
    <Box grow="Yes">
      <Box shrink="No">{nav}</Box>
      <Box grow="Yes">{isCanonicalizingCurrentRoute ? null : children}</Box>
    </Box>
  );
}
