import React from 'react';
import { Box, Text, config } from 'folds';
import { Trans } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomTypingMember } from '../../hooks/useRoomTypingMembers';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';

type RoomViewTypingProps = {
  room: Room;
};

const NAME = <b />;

/** Names the other members who are typing in the room, below the timeline. */
export function RoomViewTyping({ room }: RoomViewTypingProps) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId();
  const typing = useRoomTypingMember(room.roomId).filter(
    (receipt) => receipt.userId !== myUserId && receipt.isTyping()
  );

  if (typing.length === 0) return null;

  const names = typing.map(
    ({ userId }) => getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId
  );
  const [first, second, third] = names;
  const components = { name: NAME, first: NAME, second: NAME, third: NAME, others: NAME };
  let message: React.ReactNode;
  if (names.length === 1) {
    message = (
      <Trans i18nKey="featureUi.room.typing.one" values={{ name: first }} components={components} />
    );
  } else if (names.length === 2) {
    message = (
      <Trans
        i18nKey="featureUi.room.typing.two"
        values={{ first, second }}
        components={components}
      />
    );
  } else if (names.length === 3) {
    message = (
      <Trans
        i18nKey="featureUi.room.typing.three"
        values={{ first, second, third }}
        components={components}
      />
    );
  } else {
    message = (
      <Trans
        i18nKey={names.length === 4 ? 'featureUi.room.typing.four' : 'featureUi.room.typing.many'}
        values={{ first, second, third, count: names.length - 3 }}
        components={components}
      />
    );
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
