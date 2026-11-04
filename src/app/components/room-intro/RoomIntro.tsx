import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Box, Text, config } from 'folds';
import { RoomAvatar, RoomIcon } from '../room-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useRoomAvatar, useRoomName, useRoomTopic } from '../../hooks/useRoomMeta';
import { nameInitials } from '../../utils/common';
import { mxcUrlToHttp } from '../../utils/matrix';
import { getDirectPartnerId } from '../../utils/room';

type RoomIntroProps = {
  room: Room;
};

/** The top of a room's history: who the room is, shown once the timeline reaches its start. */
export function RoomIntro({ room }: RoomIntroProps) {
  const mx = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const name = useRoomName(room);
  // A direct chat starts with the other person, as its header shows them.
  const withPerson = useIsDirectRoom();
  const topic = useRoomTopic(room);
  const pictureMxc = useRoomAvatar(room, withPerson);
  const avatarSrc = pictureMxc
    ? mxcUrlToHttp(mx, pictureMxc, authenticatedMedia, 96, 96, 'crop') ?? undefined
    : undefined;

  return (
    <Box
      direction="Column"
      gap="300"
      style={{ padding: `${config.space.S700} ${config.space.S400} ${config.space.S400}` }}
    >
      <Avatar size="500" radii="400">
        <RoomAvatar
          alt={name}
          src={avatarSrc}
          roomId={room.roomId}
          fallbackId={withPerson ? getDirectPartnerId(room) : undefined}
          renderFallback={() =>
            withPerson ? (
              <Text as="span" size="H2">
                {nameInitials(name)}
              </Text>
            ) : (
              <RoomIcon size="400" joinRule={room.getJoinRule()} filled />
            )
          }
        />
      </Avatar>
      <Box direction="Column" gap="100">
        <Text size="H3" priority="400">
          {name}
        </Text>
        {topic && (
          <Text size="T300" priority="300" style={{ whiteSpace: 'pre-wrap' }}>
            {topic}
          </Text>
        )}
      </Box>
    </Box>
  );
}
