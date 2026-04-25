/* eslint-disable react/destructuring-assignment */
import React, { MouseEventHandler } from 'react';
import { JoinRule, Room } from 'matrix-js-sdk';
import { Avatar, Box, Chip, Header, Text, config } from 'folds';
import { getMxIdLocalPart } from '../../utils/matrix';
import { AvatarBase, ModernLayout, Time, Username, UsernameBold } from '../../components/message';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { getMemberDisplayName, getRoomAvatarUrl } from '../../utils/room';
import { ResultItem } from './useMessageSearch';
import { SequenceCard } from '../../components/sequence-card';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import colorMXID from '../../../util/colorMXID';
import { getSearchResultOpenTarget } from './searchResultOpenTarget';
import { MindroomSearchResultBody } from '../../mindroom/message-search/MindroomSearchResultBody';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';

type SearchResultGroupProps = {
  room: Room;
  highlights: string[];
  items: ResultItem[];
  onOpen: (roomId: string, eventId: string, threadRootId?: string) => void;
  legacyUsernameColor?: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};
export function SearchResultGroup({
  room,
  highlights,
  items,
  onOpen,
  legacyUsernameColor,
  hour24Clock,
  dateFormatString,
}: SearchResultGroupProps) {
  return (
    <Box direction="Column" gap="200">
      <SearchResultGroupHeader room={room} />
      <Box direction="Column" gap="100">
        {items.map((item) => {
          const { event } = item;

          return (
            <SearchResultItemCard
              key={event.event_id}
              room={room}
              item={item}
              onOpen={onOpen}
              highlights={highlights}
              legacyUsernameColor={legacyUsernameColor}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
            />
          );
        })}
      </Box>
    </Box>
  );
}

export function SearchResultGroupHeader({ room }: { room: Room }) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  return (
    <Header size="300">
      <Box gap="200" grow="Yes">
        <Avatar size="200" radii="300">
          <RoomAvatar
            roomId={room.roomId}
            src={getRoomAvatarUrl(mx, room, 96, useAuthentication)}
            alt={room.name}
            renderFallback={() => (
              <RoomIcon size="50" joinRule={room.getJoinRule() ?? JoinRule.Restricted} filled />
            )}
          />
        </Avatar>
        <Text size="H4" truncate>
          {room.name}
        </Text>
      </Box>
    </Header>
  );
}

type SearchResultItemCardProps = {
  room: Room;
  item: ResultItem;
  highlights: string[];
  onOpen: (roomId: string, eventId: string, threadRootId?: string) => void;
  legacyUsernameColor?: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
};

export function SearchResultItemCard({
  room,
  item,
  highlights,
  onOpen,
  legacyUsernameColor,
  hour24Clock,
  dateFormatString,
}: SearchResultItemCardProps) {
  const handleOpenClick: MouseEventHandler = (evt) => {
    const eventId = evt.currentTarget.getAttribute('data-event-id');
    if (!eventId) return;
    const threadRootId = evt.currentTarget.getAttribute('data-thread-root-id') ?? undefined;
    onOpen(room.roomId, eventId, threadRootId);
  };

  const { event } = item;
  const displayName =
    getMemberDisplayName(room, event.sender) ?? getMxIdLocalPart(event.sender) ?? event.sender;
  const relation = event.content['m.relates_to'];
  const { mainEventId, threadRootId } = getSearchResultOpenTarget(event);
  const replyEventId = relation?.['m.in_reply_to']?.event_id;
  const usernameColor = legacyUsernameColor ? colorMXID(event.sender) : undefined;

  return (
    <SequenceCard
      style={{ padding: config.space.S400 }}
      variant="SurfaceVariant"
      direction="Column"
    >
      <ModernLayout
        before={
          <AvatarBase>
            <Avatar size="300">
              <UserAvatar
                userId={event.sender}
                alt={displayName}
                renderFallback={() => (
                  <Text as="span" size="T200">
                    {displayName.charAt(0).toUpperCase()}
                  </Text>
                )}
              />
            </Avatar>
          </AvatarBase>
        }
      >
        <Box gap="300" justifyContent="SpaceBetween" alignItems="Center" grow="Yes">
          <Box gap="200" alignItems="Baseline">
            <Username style={{ color: usernameColor }}>
              <Text as="span" truncate>
                <UsernameBold>{displayName}</UsernameBold>
              </Text>
            </Username>
            <Time
              ts={event.origin_server_ts}
              hour24Clock={hour24Clock}
              dateFormatString={dateFormatString}
            />
          </Box>
          <Box shrink="No" gap="200" alignItems="Center">
            <Chip
              data-event-id={mainEventId}
              data-thread-root-id={threadRootId}
              onClick={handleOpenClick}
              variant="Secondary"
              radii="400"
            >
              <Text size="T200">Open</Text>
            </Chip>
          </Box>
        </Box>
        {replyEventId && (
          <Text size="T200" priority="300">
            Reply context hidden in search results. Open the message for full thread context.
          </Text>
        )}
        <MindroomSearchResultBody
          roomId={room.roomId}
          event={event}
          displayName={displayName}
          highlights={highlights}
        />
      </ModernLayout>
    </SequenceCard>
  );
}
