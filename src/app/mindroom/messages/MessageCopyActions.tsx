import { Icon, Icons, MenuItem, Text, as } from 'folds';
import React from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { getEditedEvent, getLatestMessageContent } from '../../utils/room';
import * as css from '../../features/room/message/styles.css';
import { copyToClipboard } from '../../utils/dom';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { getMessageCopyTextBody } from './messageExtensions';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const getMenuMessageContent = (room: Room, mEvent: MatrixEvent): Record<string, unknown> => {
  const eventId = mEvent.getId();
  const content = mEvent.getContent();
  if (!isRecord(content)) return {};
  if (!eventId) return content;

  const evtTimeline = room.getTimelineForEvent(eventId);
  const editedEvent = evtTimeline
    ? getEditedEvent(eventId, mEvent, evtTimeline.getTimelineSet())
    : undefined;
  return getLatestMessageContent(mEvent, editedEvent);
};

export const MessageCopyTextItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose: () => void;
    resolvedLongTextContent?: Record<string, unknown>;
    loading?: boolean;
  }
>(({ room, mEvent, onClose, resolvedLongTextContent, loading, ...props }, ref) => {
  const handleCopy = () => {
    const content = getMenuMessageContent(room, mEvent);
    const originalContent = mEvent.getContent();
    const body = getMessageCopyTextBody(
      content as Record<string, unknown>,
      originalContent as Record<string, unknown>,
      resolvedLongTextContent
    );
    if (body) {
      copyToClipboard(body);
    }
    onClose();
  };

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Text} />}
      radii="300"
      aria-disabled={loading}
      disabled={loading}
      onClick={handleCopy}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        {loading ? 'Copy Text (loading…)' : 'Copy Text'}
      </Text>
    </MenuItem>
  );
});

export const MessageCopyLinkItem = as<
  'button',
  {
    room: Room;
    mEvent: MatrixEvent;
    onClose?: () => void;
  }
>(({ room, mEvent, onClose, ...props }, ref) => {
  const handleCopy = () => {
    const eventId = mEvent.getId();
    if (!eventId) return;
    copyToClipboard(getMatrixToRoomEvent(room.roomId, eventId, getViaServers(room)));
    onClose?.();
  };

  return (
    <MenuItem
      size="300"
      after={<Icon size="100" src={Icons.Link} />}
      radii="300"
      onClick={handleCopy}
      {...props}
      ref={ref}
    >
      <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
        Copy Link
      </Text>
    </MenuItem>
  );
});
