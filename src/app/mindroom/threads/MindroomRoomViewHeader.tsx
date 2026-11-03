import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Badge, Box, Icon, IconButton, Icons, PopOut, Text, type RectCords } from 'folds';
import { PageHeader } from '../../components/page';
import { RoomAvatar } from '../../components/room-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { getRoomAvatarUrl, getStateEvent } from '../../utils/room';
import { RoomPinMenu } from '../messages/MindroomRoomPinMenu';
import { useMembersDrawer } from '../sidebar/useMembersDrawer';
import { useRoomViewMode } from './useRoomViewMode';
import * as css from './MindroomRoomViewHeader.css';

export type RoomViewHeaderProps = {
  room: Room;
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  /** Shown beside a running call; hides room-level actions that do not apply there. */
  callView?: boolean;
  computerAvailable?: boolean;
  computerOpen?: boolean;
  onComputerToggle?: () => void;
};

/**
 * The room header: avatar, name and topic, the Compact and Full switch (remembered per room),
 * pinned messages, the computer, and the members panel.
 */
export function RoomViewHeader({
  room,
  joinRequestCount = 0,
  callView,
  computerAvailable,
  computerOpen,
  onComputerToggle,
}: RoomViewHeaderProps) {



  const { viewMode, setViewMode } = useRoomViewMode(room.roomId);
  const [membersOpen, setMembersOpen] = useMembersDrawer();
  const [pinAnchor, setPinAnchor] = useState<RectCords>();

  const topic = getStateEvent(room, 'm.room.topic')?.getContent()?.topic;
  const avatarUrl = getRoomAvatarUrl(mx, room, 96, useAuthentication);
  const compact = viewMode === 'compact';

  return (
    <PageHeader className={css.Header} balance>
      <Box grow="Yes" alignItems="Center" gap="300" style={{ minWidth: 0 }}>
        <Avatar size="300">
          <RoomAvatar



            renderFallback={() => <Text size="H6">{room.name.slice(0, 1)}</Text>}
          />
        </Avatar>
        <Box direction="Column" style={{ minWidth: 0 }}>
          <Text size="H4" truncate>
            {room.name}
          </Text>
          {typeof topic === 'string' && topic && (
            <Text size="T200" priority="300" truncate>
              {topic}
            </Text>
          )}
        </Box>
      </Box>
      <Box shrink="No" alignItems="Center" gap="100">
        {!callView && (
          <IconButton
            size="300"
            radii="300"
            aria-label={compact ? t('room.header.showFull') : t('room.header.showCompact')}
            title={compact ? t('room.header.showFull') : t('room.header.showCompact')}
            aria-pressed={compact}
            onClick={() => setViewMode(compact ? 'threaded' : 'compact')}
          >
            <Icon size="200" src={compact ? Icons.Message : Icons.Category} />
          </IconButton>
        )}
        {computerAvailable && onComputerToggle && (
          <IconButton
            size="300"
            radii="300"
            aria-label={t('room.header.computer')}
            aria-pressed={!!computerOpen}
            onClick={onComputerToggle}
          >
            <Icon size="200" src={Icons.Monitor} />
          </IconButton>
        )}
        <PopOut
          anchor={pinAnchor}
          position="Bottom"
          align="End"
          offset={4}
          content={
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                returnFocusOnDeactivate: false,
                clickOutsideDeactivates: () => {
                  setPinAnchor(undefined);
                  return true;
                },
                escapeDeactivates: () => {
                  setPinAnchor(undefined);
                  return true;
                },
              }}
            >
              <RoomPinMenu room={room} requestClose={() => setPinAnchor(undefined)} />
            </FocusTrap>
          }
        >
          <IconButton
            size="300"
            radii="300"
            aria-label={t('room.header.pinnedMessages')}
            aria-pressed={!!pinAnchor}
            onClick={(evt: React.MouseEvent<HTMLButtonElement>) => {
              const rect = evt.currentTarget.getBoundingClientRect();
              setPinAnchor({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            }}
          >
            <Icon size="200" src={Icons.Pin} />
          </IconButton>
        </PopOut>
        <Box style={{ position: 'relative' }}>
          <IconButton
            size="300"
            radii="300"
            aria-label={t('room.header.members')}
            aria-pressed={membersOpen}
            onClick={() => setMembersOpen(!membersOpen)}
          >
            <Icon size="200" src={Icons.User} />
          </IconButton>
          {joinRequestCount > 0 && (
            <Badge
              size="200"
              variant="Primary"
              fill="Solid"
              radii="Pill"
              style={{ position: 'absolute', top: 0, right: 0, pointerEvents: 'none' }}
              aria-label={t('room.header.joinRequests', { count: joinRequestCount })}
            >
              <Text size="L400">{joinRequestCount}</Text>
            </Badge>
          )}
        </Box>
      </Box>
    </PageHeader>
  );
}
