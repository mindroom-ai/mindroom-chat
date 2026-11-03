import React from 'react';
import { Text } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useRoomName } from '../../hooks/useRoomMeta';

export function CallRoomName({ room }: { room: Room }) {
  const name = useRoomName(room);
  return (
    <Text size="T300" truncate>
      {name}
    </Text>
  );
}
