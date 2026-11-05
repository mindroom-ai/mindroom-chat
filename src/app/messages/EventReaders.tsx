import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Box, Icon, Icons, Text, config } from 'folds';
import { type Room, RoomEvent } from 'matrix-js-sdk';
import { Header, IconButton, MenuItem } from '../ui/glass/GlassPrimitives';
import { PageScroll } from '../ui/page/PageScroll';
import { UserAvatar } from '../avatars/UserAvatar';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { getMemberAvatarMxc, getMemberDisplayName } from '../matrix/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../matrix/matrix';

/** Everyone whose read receipt is at or after the event, the sender excluded. */
const getEventReaders = (room: Room, eventId: string): string[] => {
  const event = room.findEventById(eventId);
  if (!event) return [];
  const sender = event.getSender();
  return room.getUsersReadUpTo(event).filter((userId) => userId !== sender);
};

/** The display name in the room, else the localpart of the user ID, else the whole ID. */
const getReaderName = (room: Room, userId: string): string =>
  getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;

/** Who has read up to the event, following new receipts. */
const useEventReaders = (room: Room, eventId: string): string[] => {
  const [readers, setReaders] = useState(() => getEventReaders(room, eventId));

  useEffect(() => {
    const refresh = () => setReaders(getEventReaders(room, eventId));
    refresh();
    room.on(RoomEvent.Receipt, refresh);
    return () => {
      room.removeListener(RoomEvent.Receipt, refresh);
    };
  }, [room, eventId]);

  return readers;
};

type EventReadersProps = {
  room: Room;
  eventId: string;
  /** Who to list instead of the receipts on the event, when the caller already knows. */
  readers?: string[];
  requestClose: () => void;
};

/** The list of people who have seen a message, for its read receipts dialog. */
export function EventReaders({ room, eventId, readers: known, requestClose }: EventReadersProps) {
  const client = useMatrixClient();
  const authenticatedMedia = useMediaAuthentication();
  const { t } = useTranslation();
  const onEvent = useEventReaders(room, eventId);
  const readers = known ?? onEvent;

  const getAvatarSrc = (userId: string): string | undefined => {
    const mxc = getMemberAvatarMxc(room, userId);
    if (!mxc) return undefined;
    return mxcUrlToHttp(client, mxc, authenticatedMedia, 96, 96, 'crop') ?? undefined;
  };

  return (
    <Box direction="Column" style={{ height: '100%', minHeight: 0 }}>
      <PageScroll
        style={{ flexGrow: 1, minHeight: 0 }}
        header={
          <Header
            size="500"
            style={{ paddingBlock: 0, paddingInline: `${config.space.S400} ${config.space.S200}` }}
          >
            <Box grow="Yes">
              <Text size="H4">{t('sharedUi.eventReaders.seenBy')}</Text>
            </Box>
            <IconButton
              size="300"
              radii="300"
              onClick={requestClose}
              aria-label={t('sharedUi.eventReaders.close')}
            >
              <Icon src={Icons.Cross} />
            </IconButton>
          </Header>
        }
      >
        <Box direction="Column" style={{ padding: config.space.S200 }}>
          {readers.map((userId) => {
            const name = getReaderName(room, userId);
            const avatar = (
              <Avatar size="200">
                <UserAvatar
                  alt={name}
                  src={getAvatarSrc(userId)}
                  userId={userId}
                  renderFallback={() => <Icon size="50" filled src={Icons.User} />}
                />
              </Avatar>
            );
            return (
              <MenuItem
                key={userId}
                as="div"
                radii="400"
                before={avatar}
                size="400"
                style={{ paddingInline: config.space.S200 }}
              >
                <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
                  <Text size="T300" truncate>
                    {name}
                  </Text>
                  {name !== userId && (
                    <Text size="T200" priority="300" truncate>
                      {userId}
                    </Text>
                  )}
                </Box>
              </MenuItem>
            );
          })}
        </Box>
      </PageScroll>
    </Box>
  );
}
