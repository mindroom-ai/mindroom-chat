import React, { ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { Box } from 'folds';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useActiveSession } from '../../hooks/useSessionStore';
import { getLastOpenThread } from '../../state/lastOpenThread';
import { updateSessionLastPath } from '../../state/sessions';
import { HOME_PATH, HOME_ROOM_PATH, DIRECT_ROOM_PATH, SPACE_ROOM_PATH } from '../paths';
import { getCanonicalAliasRoomId, isRoomAlias } from '../../utils/matrix';
import { buildSessionLastKnownPath } from './sessionRouteRestore';

type ClientLayoutProps = {
  nav: ReactNode;
  children: ReactNode;
};

const getRoomIdFromLastKnownPath = (
  mx: ReturnType<typeof useMatrixClient>,
  lastKnownPath?: string
): string | undefined => {
  if (!lastKnownPath) return undefined;

  let pathname: string;
  try {
    pathname = new URL(lastKnownPath, 'https://mindroom.local').pathname;
  } catch {
    return undefined;
  }

  const match =
    matchPath({ path: HOME_ROOM_PATH, caseSensitive: true, end: true }, pathname) ??
    matchPath({ path: DIRECT_ROOM_PATH, caseSensitive: true, end: true }, pathname) ??
    matchPath({ path: SPACE_ROOM_PATH, caseSensitive: true, end: true }, pathname);
  const roomIdOrAlias = match?.params.roomIdOrAlias;
  if (!roomIdOrAlias) return undefined;

  const decodedRoomIdOrAlias = (() => {
    try {
      return decodeURIComponent(roomIdOrAlias);
    } catch {
      return roomIdOrAlias;
    }
  })();

  if (isRoomAlias(decodedRoomIdOrAlias)) {
    return getCanonicalAliasRoomId(mx, decodedRoomIdOrAlias);
  }

  return decodedRoomIdOrAlias;
};

const buildThreadRestorePath = (
  lastKnownPath: string | undefined,
  threadId: string
): string | undefined => {
  if (!lastKnownPath) return undefined;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(lastKnownPath, 'https://mindroom.local');
  } catch {
    return undefined;
  }

  const pathname = parsedUrl.pathname;
  const isRoomRoute =
    !!matchPath({ path: HOME_ROOM_PATH, caseSensitive: true, end: true }, pathname) ||
    !!matchPath({ path: DIRECT_ROOM_PATH, caseSensitive: true, end: true }, pathname) ||
    !!matchPath({ path: SPACE_ROOM_PATH, caseSensitive: true, end: true }, pathname);

  if (!isRoomRoute) return undefined;

  parsedUrl.searchParams.set('threadId', threadId);
  return buildSessionLastKnownPath({
    pathname,
    search: parsedUrl.search,
    hash: parsedUrl.hash,
  });
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

  if (!startupRestorePathRef.current && activeSession?.lastKnownPath) {
    startupRestorePathRef.current = activeSession.lastKnownPath;
  }

  useLayoutEffect(() => {
    if (attemptedStartupRestoreRef.current || !activeSession) return;
    if (!matchPath({ path: HOME_PATH, caseSensitive: true, end: true }, pathname)) return;
    if (search || hash) return;

    attemptedStartupRestoreRef.current = true;

    const roomId = getRoomIdFromLastKnownPath(mx, startupRestorePathRef.current);
    if (!roomId) return;

    const threadId = getLastOpenThread(roomId);
    if (!threadId) return;

    const restorePath = buildThreadRestorePath(startupRestorePathRef.current, threadId);
    if (restorePath) {
      navigate(restorePath, { replace: true });
      return;
    }

    navigateRoomThread(roomId, threadId, undefined, { replace: true });
  }, [activeSession, hash, mx, navigate, navigateRoomThread, pathname, search]);

  useEffect(() => {
    if (!activeSession) return;

    updateSessionLastPath(
      activeSession.sessionId,
      buildSessionLastKnownPath({ pathname, search, hash })
    );
  }, [activeSession, hash, pathname, search]);

  return (
    <Box grow="Yes">
      <Box shrink="No">{nav}</Box>
      <Box grow="Yes">{children}</Box>
    </Box>
  );
}
