import React, { MouseEventHandler, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Box, Text, as, toRem } from 'folds';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { EventTimelineSet } from 'matrix-js-sdk/lib/models/event-timeline-set';
import {
  MessageBadEncryptedContent,
  MessageDeletedContent,
  MessageFailedContent,
} from '../content/FallbackContent';
import { ThreadIndicator } from '../ThreadIndicator';
import { useRoomEvent } from '../../event-store/cache/useRoomEvent';
import { getReplyPreviewText } from '../../event-store/threads/threadMessagePreview';
import { getEditedEvent, getLatestMessageContent, getMemberDisplayName } from '../../matrix/room';
import { getMxIdLocalPart } from '../../matrix/matrix';
import * as css from './Reply.css';

/** Stand-in line while the replied-to event loads. */
function ReplyPlaceholder() {
  return (
    <Box
      as="span"
      grow="Yes"
      style={{
        height: toRem(12),
        maxWidth: toRem(240),
        borderRadius: toRem(4),
        background: 'currentColor',
        opacity: 0.12,
      }}
    />
  );
}

type ReplyBodyProps = {
  room: Room;
  replyEvent: MatrixEvent | null | undefined;
  timelineSet?: EventTimelineSet;
};

function ReplyBody({ room, replyEvent, timelineSet }: ReplyBodyProps) {
  const { t } = useTranslation();

  if (replyEvent === undefined) return <ReplyPlaceholder />;
  if (replyEvent === null) return <MessageFailedContent />;

  const sender = replyEvent.getSender();
  const senderName = sender
    ? getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender) ?? sender
    : undefined;

  let body: React.ReactNode;
  if (replyEvent.isRedacted()) {
    body = <MessageDeletedContent />;
  } else if (replyEvent.isDecryptionFailure()) {
    body = <MessageBadEncryptedContent />;
  } else {
    // The newest readable edit, as the message's own row shows it.
    const edit = getEditedEvent(replyEvent.getId() ?? '', replyEvent, timelineSet);
    body = getReplyPreviewText(room, getLatestMessageContent(replyEvent, edit), t) ?? '';
  }

  return (
    <>
      {senderName && (
        <Text as="span" size="T300" truncate style={{ flexShrink: 0, maxWidth: '40%' }}>
          <b>{senderName}</b>
        </Text>
      )}
      <Text as="span" size="T300" className={css.ReplyContent}>
        {body}
      </Text>
    </>
  );
}

type ReplyProps = {
  room: Room;
  replyEventId: string;
  /** The thread the replied-to event belongs to, when known. */
  threadRootId?: string;
  timelineSet?: EventTimelineSet;
  /** Hides the thread indicator, for replies shown inside that thread. */
  hideThreadIndicator?: boolean;
  onClick?: MouseEventHandler;
  onThreadClick?: MouseEventHandler;
};

/** The quoted message above a reply: sender and a one-line preview of what was replied to. */
export const Reply = as<'div', ReplyProps>(
  (
    {
      room,
      replyEventId,
      threadRootId,
      timelineSet,
      hideThreadIndicator,
      onClick,
      onThreadClick,
      className,
      ...props
    },
    ref
  ) => {
    const getFromLocalTimeline = useCallback(
      () =>
        (timelineSet?.findEventById(replyEventId) ?? room.findEventById(replyEventId)) || undefined,
      [room, timelineSet, replyEventId]
    );
    // A reply inside a thread looks the event up in that thread's cache first.
    const replyEvent = useRoomEvent(room, replyEventId, getFromLocalTimeline, {
      threadId: threadRootId,
    });

    // The quote itself carries the replied-to event's ID; the wrapper around it and the thread
    // indicator is wider than the quote, so a click on its middle would miss the quote.
    const wrapperProps: Record<string, unknown> = { ...props };
    delete wrapperProps['data-event-id'];

    return (
      <Box direction="Column" alignItems="Start" {...wrapperProps} ref={ref}>
        {threadRootId && !hideThreadIndicator ? (
          <ThreadIndicator
            as="button"
            data-thread-root-id={threadRootId}
            data-event-id={threadRootId}
            room={room}
            threadRootId={threadRootId}
            timelineSet={timelineSet}
            onClick={onThreadClick}
          />
        ) : null}
        {onClick ? (
          <Box
            as="button"
            type="button"
            data-event-id={replyEventId}
            className={classNames(css.Reply, className)}
            onClick={onClick}
          >
            <ReplyBody room={room} replyEvent={replyEvent} timelineSet={timelineSet} />
          </Box>
        ) : (
          <Box className={classNames(css.Reply, className)} data-event-id={replyEventId}>
            <ReplyBody room={room} replyEvent={replyEvent} timelineSet={timelineSet} />
          </Box>
        )}
      </Box>
    );
  }
);
