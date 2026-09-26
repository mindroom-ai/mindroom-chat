import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons, Text, Tooltip, TooltipProvider, as } from 'folds';
import React from 'react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { getEditedEvent, getLatestMessageContent } from '../../utils/room';
import * as css from '../../features/room/message/styles.css';
import { copyToClipboard } from '../../utils/dom';
import { getMatrixToRoomEvent } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import {
  expandMindroomToolMarkerLines,
  getMessageCopyTextSource,
  hasMindroomToolMarkerLines,
  stripMindroomToolMarkerLines,
} from './messageCopyText';

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
  const { t } = useTranslation();
  const getCopySource = () =>
    getMessageCopyTextSource(
      getMenuMessageContent(room, mEvent),
      mEvent.getContent() as Record<string, unknown>,
      resolvedLongTextContent
    );
  const renderedSource = getCopySource();
  const showCopyWithToolCalls =
    !loading && !!renderedSource && hasMindroomToolMarkerLines(renderedSource.body);

  const handleCopy = () => {
    // Tool markers are display chrome; the plain copy keeps only the reply.
    // A reply made only of tool calls copies those calls instead of nothing.
    const source = getCopySource();
    const text = source
      ? stripMindroomToolMarkerLines(source.body) ||
        expandMindroomToolMarkerLines(source.body, source.toolTraceEvents)
      : undefined;
    if (text) {
      copyToClipboard(text);
    }
    onClose();
  };

  const handleCopyWithToolCalls = () => {
    const source = getCopySource();
    if (source) {
      copyToClipboard(expandMindroomToolMarkerLines(source.body, source.toolTraceEvents));
    }
    onClose();
  };

  const copyWithToolCallsLabel = t('mindroomUi.messages.messageCopyActions.copyTextWithToolCalls');

  return (
    <Box alignItems="Center" gap="100">
      <Box grow="Yes" direction="Column">
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
            {loading
              ? t('mindroomUi.messages.messageCopyActions.copyTextLoading')
              : t('mindroomUi.messages.messageCopyActions.copyText')}
          </Text>
        </MenuItem>
      </Box>
      {showCopyWithToolCalls && (
        <TooltipProvider
          position="Right"
          offset={4}
          tooltip={
            <Tooltip>
              <Text size="T300">{copyWithToolCallsLabel}</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <IconButton
              ref={triggerRef}
              size="300"
              radii="300"
              variant="Surface"
              fill="None"
              aria-label={copyWithToolCallsLabel}
              onClick={handleCopyWithToolCalls}
            >
              <Icon size="100" src={Icons.Terminal} />
            </IconButton>
          )}
        </TooltipProvider>
      )}
    </Box>
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
  const { t } = useTranslation();
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
        {t('mindroomUi.messages.messageCopyActions.copyLink')}
      </Text>
    </MenuItem>
  );
});
