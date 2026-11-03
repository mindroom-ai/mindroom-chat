import React from 'react';
import { Box, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomTypingMember } from '../../hooks/useRoomTypingMembers';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';

type RoomViewTypingProps = {
  room: Room;
};

/** Names the other members who are typing in the room, below the timeline. */
export function RoomViewTyping({ room }: RoomViewTypingProps) {



  const typing = useRoomTypingMember(room.roomId).filter(
    (receipt) => receipt.userId !== myUserId && receipt.isTyping()
  );

  if (typing.length === 0) return null;

  const names = typing.map(
    ({ userId }) => getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId
  );
  let message: string;
  if (names.length === 1) {
    message = t('sharedUi.roomViewTyping.one', { name: names[0] });
  } else if (names.length === 2) {
    message = t('sharedUi.roomViewTyping.two', { first: names[0], second: names[1] });
  } else {
    message = t('sharedUi.roomViewTyping.many', { first: names[0], count: names.length - 1 });
  }

  return (
    <Box
      alignItems="Center"
      style={{ padding: `0 ${config.space.S400}`, minWidth: 0 }}
      role="status"
      aria-live="polite"
    >
      <Text size="T200" priority="300" truncate>
        {message}
      </Text>
    </Box>
  );
}
