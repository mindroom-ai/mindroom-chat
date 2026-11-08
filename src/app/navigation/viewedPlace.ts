import { matchPath } from 'react-router-dom';
import type { MatrixClient } from 'matrix-js-sdk';
import { getCanonicalAliasRoomId, isRoomAlias } from '../matrix/matrix';
import { decodeRouteParam } from '../routes/pathUtils';
import { DIRECT_ROOM_PATH, HOME_ROOM_PATH, SPACE_ROOM_PATH } from '../routes/paths';

/** The room and thread the window shows, read from the app's address. */
export type ViewedPlace = { roomId?: string; threadId?: string };

const ROOM_ROUTES = [HOME_ROOM_PATH, DIRECT_ROOM_PATH, SPACE_ROOM_PATH];

/** The room (by ID) and thread a location shows; aliases resolve through the joined rooms. */
export const getViewedPlace = (
  client: MatrixClient,
  location: Pick<Location, 'pathname' | 'search'>
): ViewedPlace => {
  const threadId = new URLSearchParams(location.search).get('threadId') ?? undefined;
  for (const route of ROOM_ROUTES) {
    const encoded = matchPath(route, location.pathname)?.params.roomIdOrAlias;
    if (encoded) {
      const roomIdOrAlias = decodeRouteParam(encoded);
      const roomId = isRoomAlias(roomIdOrAlias)
        ? getCanonicalAliasRoomId(client, roomIdOrAlias)
        : roomIdOrAlias;
      return { roomId, threadId };
    }
  }
  return {};
};
