import { MouseEvent, MouseEventHandler, useCallback } from 'react';
import { useOpenUserRoomProfile } from '../state/hooks/userRoomProfile';
import { getCanonicalAliasRoomId, isRoomAlias, isRoomId, isUserId } from '../utils/matrix';
import { useMatrixClient } from './useMatrixClient';
import { useRoomNavigate } from './useRoomNavigate';
import { useSpaceOptionally } from './useSpace';

/**
 * The click handler for mention pills, which carry the mentioned ID in `data-mention-id` (and an
 * event in `data-mention-event-id`): a user opens their profile in `roomId`; a room the account
 * has joined opens, at the event when one is given.
 */
export const useMentionClickHandler = (roomId: string): MouseEventHandler<HTMLElement> => {






    (event: MouseEvent<HTMLElement>) => {
      const target = event.currentTarget;
      const mentionId = target.getAttribute('data-mention-id');
      if (!mentionId) return;
      event.preventDefault();








        ? getCanonicalAliasRoomId(mx, mentionId)
        : isRoomId(mentionId)
        ? mentionId
        : undefined;
      if (!mentionedRoomId) return;
      const eventId = target.getAttribute('data-mention-event-id') ?? undefined;
      navigateRoom(mentionedRoomId, eventId);
    },
    [mx, navigateRoom, openProfile, roomId, space]
  );
};
