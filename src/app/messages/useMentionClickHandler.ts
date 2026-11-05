import { MouseEvent, MouseEventHandler, useCallback } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useOpenUserRoomProfile } from '../navigation/useUserRoomProfileState';
import { getCanonicalAliasRoomId, isRoomAlias, isRoomId, isUserId } from '../matrix/matrix';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useSpaceOptionally } from '../matrix/hooks/useSpace';

const readMention = (pill: HTMLElement) => ({
  id: pill.getAttribute('data-mention-id'),
  eventId: pill.getAttribute('data-mention-event-id') ?? undefined,
});

/** An alias resolves only through a room the account knows; an unknown one gives `undefined`. */
const resolveMentionedRoom = (client: MatrixClient, mentionId: string): string | undefined => {
  if (isRoomAlias(mentionId)) return getCanonicalAliasRoomId(client, mentionId);
  return isRoomId(mentionId) ? mentionId : undefined;
};

/**
 * The click handler for mention pills, which carry the mentioned ID in `data-mention-id` (and an
 * event in `data-mention-event-id`): a user opens their profile in `roomId`; a room the account
 * has joined opens, at the event when one is given, and a space opens on its lobby.
 */
export const useMentionClickHandler = (roomId: string): MouseEventHandler<HTMLElement> => {
  const client = useMatrixClient();
  const { navigateRoom, navigateSpace } = useRoomNavigate();
  const openProfile = useOpenUserRoomProfile();
  const spaceRoomId = useSpaceOptionally()?.roomId;

  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const pill = event.currentTarget;
      const mention = readMention(pill);
      if (!mention.id) return;
      event.preventDefault();

      if (isUserId(mention.id)) {
        // The card opens next to the pill that was clicked.
        openProfile(roomId, spaceRoomId, mention.id, pill.getBoundingClientRect());
        return;
      }

      const mentionedRoomId = resolveMentionedRoom(client, mention.id);
      if (!mentionedRoomId) return;
      // A space the account knows opens as a space, on its lobby.
      if (!mention.eventId && client.getRoom(mentionedRoomId)?.isSpaceRoom()) {
        navigateSpace(mentionedRoomId);
        return;
      }
      navigateRoom(mentionedRoomId, mention.eventId);
    },
    [client, navigateRoom, navigateSpace, openProfile, roomId, spaceRoomId]
  );
};
