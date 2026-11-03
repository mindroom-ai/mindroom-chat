import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Text, Tooltip, TooltipProvider, toRem } from 'folds';
import { Page, PageHeader } from '../../components/page';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { RoomView } from './MindroomRoomView';

export type MindroomCallChatViewProps = {
  room: Room;
  hasMindroomAgents?: boolean;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  onThreadLoadError?: (threadId: string) => void;
  /** Hides the chat beside the call. */
  onClose?: () => void;
};

/** The room's chat in a side panel beside a running call; it follows the room's thread route. */
export function MindroomCallChatView({
  room,
  hasMindroomAgents,
  eventId,
  focusEventInRoom,
  threadId,
  onThreadLoadError,
  onClose,
}: MindroomCallChatViewProps) {
  const { t } = useTranslation();
  const screenSize = useScreenSizeContext();
  const desktop = screenSize === ScreenSize.Desktop;

  return (
    <Box
      direction="Column"
      shrink="No"
      style={{ width: desktop ? toRem(400) : '100%', minWidth: 0, minHeight: 0 }}
    >
      <Page>
        <PageHeader>
          <Box grow="Yes" alignItems="Center">
            <Text size="H4">{t('room.callChat.title')}</Text>
          </Box>
          {onClose && (
            <TooltipProvider
              position="Bottom"
              tooltip={
                <Tooltip>
                  <Text>{t('room.callChat.close')}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  ref={triggerRef}
                  size="300"
                  radii="300"
                  aria-label={t('room.callChat.close')}
                  onClick={onClose}
                >
                  <Icon size="200" src={Icons.Cross} />
                </IconButton>
              )}
            </TooltipProvider>
          )}
        </PageHeader>
        <RoomView
          room={room}
          callView
          hasMindroomAgents={hasMindroomAgents}
          eventId={eventId}
          focusEventInRoom={focusEventInRoom}
          threadId={threadId}
          onThreadLoadError={onThreadLoadError}
        />
      </Page>
    </Box>
  );
}
