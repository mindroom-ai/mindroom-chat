import { MouseEvent, MouseEventHandler, useCallback } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useOpenUserRoomProfile } from '../navigation/useUserRoomProfileState';
import { getCanonicalAliasRoomId, isRoomAlias, isRoomId, isUserId } from '../matrix/matrix';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { isJoinedRoom } from '../navigation/routeVisibility';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useSpaceOptionally } from '../matrix/hooks/useSpace';
import { getHomeRoomPath, withSearchParam } from '../routes/pathUtils';

const readMention = (pill: HTMLElement) => ({
  id: pill.getAttribute('data-mention-id'),
  eventId: pill.getAttribute('data-mention-event-id') ?? undefined,
  viaServers: pill.getAttribute('data-mention-via')?.split(',').filter(Boolean),
});

/** An alias resolves only through a room the account knows; an unknown one gives `undefined`. */
const resolveMentionedRoom = (client: MatrixClient, mentionId: string): string | undefined => {
  if (isRoomAlias(mentionId)) return getCanonicalAliasRoomId(client, mentionId);
  return isRoomId(mentionId) ? mentionId : undefined;
};

/**
 * The click handler for mention pills, which carry the mentioned ID in `data-mention-id` (with an
 * optional event in `data-mention-event-id` and routing servers in `data-mention-via`): a user
 * opens their profile in `roomId`; a joined room opens directly (at the event when given, or on
 * its lobby for a space without an event); and an unjoined or non-joined room navigates to its
 * room route (using the known room ID when the client already has it, else the mentioned ID or
 * alias) with `viaServers` intact so `RoomRoute` can resolve the alias and show the join preview.
 */
export const useMentionClickHandler = (roomId: string): MouseEventHandler<HTMLElement> => {
  const client = useMatrixClient();
  const { navigatePath, navigateRoom, navigateSpace } = useRoomNavigate();
  const openProfile = useOpenUserRoomProfile();
  const spaceRoomId = useSpaceOptionally()?.roomId;

  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const pill = event.currentTarget;
      const mention = readMention(pill);
      if (!mention.id) return;

      if (isUserId(mention.id)) {
        event.preventDefault();
        // The card opens next to the pill that was clicked.
        openProfile(roomId, spaceRoomId, mention.id, pill.getBoundingClientRect());
        return;
      }

      if (!isRoomId(mention.id) && !isRoomAlias(mention.id)) return;
      event.preventDefault();

      const knownRoomId = resolveMentionedRoom(client, mention.id);
      const knownRoom = knownRoomId ? client.getRoom(knownRoomId) : null;
      if (knownRoom && isJoinedRoom(knownRoom)) {
        // A joined space opens as a space, on its lobby, unless a specific event was linked.
        if (!mention.eventId && knownRoom.isSpaceRoom()) {
          navigateSpace(knownRoom.roomId);
          return;
        }
        navigateRoom(knownRoom.roomId, mention.eventId);
        return;
      }

      const targetRoom = knownRoom?.roomId ?? mention.id;
      navigatePath(
        withSearchParam(getHomeRoomPath(targetRoom, mention.eventId), {
          viaServers: mention.viaServers?.length ? mention.viaServers.join(',') : undefined,
        })
      );
    },
    [client, navigatePath, navigateRoom, navigateSpace, openProfile, roomId, spaceRoomId]
  );
};
