import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import { Avatar, Badge, Box, Icon, IconButton, Icons, PopOut, Text, type RectCords } from 'folds';
import { PageHeader } from '../../components/page';
import { RoomAvatar } from '../../components/room-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { useRoomAvatar, useRoomName } from '../../hooks/useRoomMeta';
import { useStateEvent } from '../../hooks/useStateEvent';
import { RoomPinMenu } from '../messages/MindroomRoomPinMenu';
import { useMembersDrawer } from '../sidebar/useMembersDrawer';
import { useRoomViewMode } from './useRoomViewMode';
import type { RoomViewMode } from './roomViewMode';
import * as css from './MindroomRoomViewHeader.css';

export type RoomViewHeaderProps = {
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  computerAvailable?: boolean;
  computerOpen?: boolean;
  onComputerToggle?: () => void;
};

/**
 * The room header: avatar, name and topic, the Compact and Full switch (remembered per room),
 * pinned messages, the computer, and the members panel.
 */
export function RoomViewHeader({
  joinRequestCount = 0,
  computerAvailable,
  computerOpen,
  onComputerToggle,
}: RoomViewHeaderProps) {




  const { viewMode, setViewMode, availableViewModes } = useRoomViewMode(room.roomId);
  const [membersOpen, setMembersOpen] = useMembersDrawer();
  const [pinAnchor, setPinAnchor] = useState<RectCords>();

  // Compact shows threads as cards; Full is the classic timeline. A direct chat offers neither.
  const fullMode: RoomViewMode | undefined = availableViewModes.includes('classic')
    ? 'classic'
    : availableViewModes.find((mode) => mode !== 'compact');
  const canSwitchView = availableViewModes.includes('compact') && fullMode !== undefined;
  const compact = viewMode === 'compact';
  const switchLabel = compact
    ? t('mindroomUi.threads.mindroomRoomViewHeader.classic')
    : t('mindroomUi.threads.mindroomRoomViewHeader.compact');
  const membersLabel = membersOpen
    ? t('mindroomUi.threads.mindroomRoomViewHeader.hideMembers')
    : t('mindroomUi.threads.mindroomRoomViewHeader.showMembers');

  const roomName = useRoomName(room);
  const topicContent = useStateEvent(room, 'm.room.topic')?.getContent();
  const topic = typeof topicContent?.topic === 'string' ? topicContent.topic : undefined;







      <Box grow="Yes" alignItems="Center" gap="300" style={{ minWidth: 0 }}>
        <Avatar size="300">
          <RoomAvatar



            renderFallback={() => <Text size="H6">{roomName.slice(0, 1)}</Text>}
          />
        </Avatar>
        <Box direction="Column" style={{ minWidth: 0 }}>
          <Text size="H4" truncate>
            {roomName}
          </Text>
          {topic && (
            <Text size="T200" priority="300" truncate>
              {topic}
            </Text>
          )}
        </Box>
      </Box>
      <Box shrink="No" alignItems="Center" gap="100">
        {canSwitchView && fullMode && (
          <IconButton
            size="300"
            radii="300"
            aria-label={switchLabel}
            title={switchLabel}
            aria-pressed={compact}
            data-room-view-switch=""
            onClick={() => setViewMode(compact ? fullMode : 'compact')}
          >
            <Icon size="200" src={compact ? Icons.Message : Icons.Category} />
          </IconButton>
        )}
        {computerAvailable && onComputerToggle && (
          <IconButton
            size="300"
            radii="300"
            aria-label={
              computerOpen
                ? t('mindroomUi.threads.mindroomRoomViewHeader.hideComputer')
                : t('mindroomUi.threads.mindroomRoomViewHeader.showComputer')
            }
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
            aria-label={t('mindroomUi.threads.mindroomRoomViewHeader.pinnedMessages')}
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
            aria-label={
              joinRequestCount > 0
                ? t('featureUi.room.pendingJoinRequests.accessibleLabel', {
                    baseLabel: membersLabel,
                    count: joinRequestCount,
                  })
                : membersLabel
            }
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
              aria-hidden="true"
            >
              <Text size="L400">{joinRequestCount}</Text>
            </Badge>
          )}
        </Box>
      </Box>
    </PageHeader>
  );
}
