import React, { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box } from 'folds';
import { generatePath, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useActiveSession } from '../../hooks/useSessionStore';
import { getLastOpenThread } from '../../state/lastOpenThread';
import { updateSessionLastPath } from '../../state/sessions';
import {
  HOME_PATH,
  HOME_ROOM_PATH,
  DIRECT_ROOM_PATH,
  SPACE_PATH,
  SPACE_LOBBY_PATH,
  SPACE_SEARCH_PATH,
  SPACE_ROOM_PATH,
} from '../paths';
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

const decodeRouteParam = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const canonicalizeRouteParam = (
  mx: ReturnType<typeof useMatrixClient>,
  value: string | undefined
): string | undefined => {
  const decodedValue = decodeRouteParam(value);
  if (!decodedValue) return decodedValue;
  if (!isRoomAlias(decodedValue)) return decodedValue;
  return getCanonicalAliasRoomId(mx, decodedValue) ?? decodedValue;
};

const hasAliasRouteParam = (value: string | undefined): boolean => {
  const decodedValue = decodeRouteParam(value);
  return !!decodedValue && isRoomAlias(decodedValue);
};

const pathnameContainsAliasRoute = (pathname: string): boolean => {
  const homeRoomMatch = matchPath({ path: HOME_ROOM_PATH, caseSensitive: true, end: true }, pathname);
  if (homeRoomMatch) {
    return hasAliasRouteParam(homeRoomMatch.params.roomIdOrAlias);
  }

  const directRoomMatch = matchPath(
    { path: DIRECT_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (directRoomMatch) {
    return hasAliasRouteParam(directRoomMatch.params.roomIdOrAlias);
  }

  const spaceRoomMatch = matchPath({ path: SPACE_ROOM_PATH, caseSensitive: true, end: true }, pathname);
  if (spaceRoomMatch) {
    return (
      hasAliasRouteParam(spaceRoomMatch.params.spaceIdOrAlias) ||
      hasAliasRouteParam(spaceRoomMatch.params.roomIdOrAlias)
    );
  }

  const spaceOnlyMatch = matchPath({ path: SPACE_PATH, caseSensitive: true, end: true }, pathname);
  if (spaceOnlyMatch) {
    return hasAliasRouteParam(spaceOnlyMatch.params.spaceIdOrAlias);
  }

  const spaceLobbyMatch = matchPath(
    { path: SPACE_LOBBY_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceLobbyMatch) {
    return hasAliasRouteParam(spaceLobbyMatch.params.spaceIdOrAlias);
  }

  const spaceSearchMatch = matchPath(
    { path: SPACE_SEARCH_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceSearchMatch) {
    return hasAliasRouteParam(spaceSearchMatch.params.spaceIdOrAlias);
  }

  return false;
};

const resolveCanonicalRouteParam = async (
  mx: ReturnType<typeof useMatrixClient>,
  value: string | undefined
): Promise<string | undefined> => {
  const decodedValue = decodeRouteParam(value);
  if (!decodedValue) return decodedValue;
  if (!isRoomAlias(decodedValue)) return decodedValue;

  const knownRoomId = getCanonicalAliasRoomId(mx, decodedValue);
  if (knownRoomId) return knownRoomId;

  try {
    const response = await mx.getRoomIdForAlias(decodedValue);
    return response.room_id ?? decodedValue;
  } catch {
    return decodedValue;
  }
};

const canonicalizeSessionPathname = (
  mx: ReturnType<typeof useMatrixClient>,
  pathname: string
): string => {
  const homeRoomMatch = matchPath({ path: HOME_ROOM_PATH, caseSensitive: true, end: true }, pathname);
  if (homeRoomMatch) {
    return generatePath(HOME_ROOM_PATH, {
      roomIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, homeRoomMatch.params.roomIdOrAlias) ?? homeRoomMatch.params.roomIdOrAlias!
      ),
      eventId: homeRoomMatch.params.eventId
        ? encodeURIComponent(decodeRouteParam(homeRoomMatch.params.eventId) ?? homeRoomMatch.params.eventId)
        : null,
    });
  }

  const directRoomMatch = matchPath(
    { path: DIRECT_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (directRoomMatch) {
    return generatePath(DIRECT_ROOM_PATH, {
      roomIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, directRoomMatch.params.roomIdOrAlias) ??
          directRoomMatch.params.roomIdOrAlias!
      ),
      eventId: directRoomMatch.params.eventId
        ? encodeURIComponent(decodeRouteParam(directRoomMatch.params.eventId) ?? directRoomMatch.params.eventId)
        : null,
    });
  }

  const spaceRoomMatch = matchPath({ path: SPACE_ROOM_PATH, caseSensitive: true, end: true }, pathname);
  if (spaceRoomMatch) {
    return generatePath(SPACE_ROOM_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceRoomMatch.params.spaceIdOrAlias) ??
          spaceRoomMatch.params.spaceIdOrAlias!
      ),
      roomIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceRoomMatch.params.roomIdOrAlias) ??
          spaceRoomMatch.params.roomIdOrAlias!
      ),
      eventId: spaceRoomMatch.params.eventId
        ? encodeURIComponent(decodeRouteParam(spaceRoomMatch.params.eventId) ?? spaceRoomMatch.params.eventId)
        : null,
    });
  }

  const spaceOnlyMatch = matchPath({ path: SPACE_PATH, caseSensitive: true, end: true }, pathname);
  if (spaceOnlyMatch) {
    return generatePath(SPACE_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceOnlyMatch.params.spaceIdOrAlias) ??
          spaceOnlyMatch.params.spaceIdOrAlias!
      ),
    });
  }

  const spaceLobbyMatch = matchPath(
    { path: SPACE_LOBBY_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceLobbyMatch) {
    return generatePath(SPACE_LOBBY_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceLobbyMatch.params.spaceIdOrAlias) ??
          spaceLobbyMatch.params.spaceIdOrAlias!
      ),
    });
  }

  const spaceSearchMatch = matchPath(
    { path: SPACE_SEARCH_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceSearchMatch) {
    return generatePath(SPACE_SEARCH_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        canonicalizeRouteParam(mx, spaceSearchMatch.params.spaceIdOrAlias) ??
          spaceSearchMatch.params.spaceIdOrAlias!
      ),
    });
  }

  return pathname;
};

const resolveCanonicalizedPathname = async (
  mx: ReturnType<typeof useMatrixClient>,
  pathname: string
): Promise<string> => {
  const homeRoomMatch = matchPath({ path: HOME_ROOM_PATH, caseSensitive: true, end: true }, pathname);
  if (homeRoomMatch) {
    return generatePath(HOME_ROOM_PATH, {
      roomIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, homeRoomMatch.params.roomIdOrAlias)) ??
          homeRoomMatch.params.roomIdOrAlias!
      ),
      eventId: homeRoomMatch.params.eventId
        ? encodeURIComponent(decodeRouteParam(homeRoomMatch.params.eventId) ?? homeRoomMatch.params.eventId)
        : null,
    });
  }

  const directRoomMatch = matchPath(
    { path: DIRECT_ROOM_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (directRoomMatch) {
    return generatePath(DIRECT_ROOM_PATH, {
      roomIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, directRoomMatch.params.roomIdOrAlias)) ??
          directRoomMatch.params.roomIdOrAlias!
      ),
      eventId: directRoomMatch.params.eventId
        ? encodeURIComponent(decodeRouteParam(directRoomMatch.params.eventId) ?? directRoomMatch.params.eventId)
        : null,
    });
  }

  const spaceRoomMatch = matchPath({ path: SPACE_ROOM_PATH, caseSensitive: true, end: true }, pathname);
  if (spaceRoomMatch) {
    const [spaceIdOrAlias, roomIdOrAlias] = await Promise.all([
      resolveCanonicalRouteParam(mx, spaceRoomMatch.params.spaceIdOrAlias),
      resolveCanonicalRouteParam(mx, spaceRoomMatch.params.roomIdOrAlias),
    ]);

    return generatePath(SPACE_ROOM_PATH, {
      spaceIdOrAlias: encodeURIComponent(spaceIdOrAlias ?? spaceRoomMatch.params.spaceIdOrAlias!),
      roomIdOrAlias: encodeURIComponent(roomIdOrAlias ?? spaceRoomMatch.params.roomIdOrAlias!),
      eventId: spaceRoomMatch.params.eventId
        ? encodeURIComponent(decodeRouteParam(spaceRoomMatch.params.eventId) ?? spaceRoomMatch.params.eventId)
        : null,
    });
  }

  const spaceOnlyMatch = matchPath({ path: SPACE_PATH, caseSensitive: true, end: true }, pathname);
  if (spaceOnlyMatch) {
    return generatePath(SPACE_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, spaceOnlyMatch.params.spaceIdOrAlias)) ??
          spaceOnlyMatch.params.spaceIdOrAlias!
      ),
    });
  }

  const spaceLobbyMatch = matchPath(
    { path: SPACE_LOBBY_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceLobbyMatch) {
    return generatePath(SPACE_LOBBY_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, spaceLobbyMatch.params.spaceIdOrAlias)) ??
          spaceLobbyMatch.params.spaceIdOrAlias!
      ),
    });
  }

  const spaceSearchMatch = matchPath(
    { path: SPACE_SEARCH_PATH, caseSensitive: true, end: true },
    pathname
  );
  if (spaceSearchMatch) {
    return generatePath(SPACE_SEARCH_PATH, {
      spaceIdOrAlias: encodeURIComponent(
        (await resolveCanonicalRouteParam(mx, spaceSearchMatch.params.spaceIdOrAlias)) ??
          spaceSearchMatch.params.spaceIdOrAlias!
      ),
    });
  }

  return pathname;
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
  const [isCanonicalizingCurrentRoute, setIsCanonicalizingCurrentRoute] = useState(
    pathnameHasAliasRoute
  );

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
