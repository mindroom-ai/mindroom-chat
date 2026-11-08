import type { Room } from 'matrix-js-sdk';
import { Avatar, Box, Text, config } from 'folds';
import { RoomAvatar, RoomIcon } from '../avatars/RoomAvatar';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { useIsDirectRoom } from '../matrix/hooks/useRoom';
import { useRoomAvatar, useRoomName, useRoomTopic } from '../matrix/hooks/useRoomMeta';
import { nameInitials } from '../lib/common';
import { mxcUrlToHttp } from '../matrix/matrix';
import { getDirectPartnerId } from '../matrix/room';
import { revealDirectionControls } from '../ui/directional';

type RoomIntroProps = {
  room: Room;
};

/** The top of a room's history: who the room is, shown once the timeline reaches its start. */
export function RoomIntro({ room }: RoomIntroProps) {
  const mx = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  // Direction controls in the name and topic show as code points, so they cannot reorder them.
  const name = revealDirectionControls(useRoomName(room));
  // A direct chat starts with the other person, as its header shows them.
  const withPerson = useIsDirectRoom();
  const roomTopic = useRoomTopic(room);
  const topic = roomTopic && revealDirectionControls(roomTopic);
  const pictureMxc = useRoomAvatar(room, withPerson);
  const avatarSrc = pictureMxc
    ? mxcUrlToHttp(mx, pictureMxc, authenticatedMedia, 96, 96, 'crop') ?? undefined
    : undefined;

  return (
    <Box
      direction="Column"
      gap="300"
      style={{ padding: `${config.space.S700} ${config.space.S400} ${config.space.S400}` }}
      data-room-intro=""
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
