import type { ComponentPropsWithoutRef, Ref } from 'react';
import type { EventTimelineSet, Room } from 'matrix-js-sdk';
import { useOptionalMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { getMemberDisplayName } from '../matrix/room';
import { getThreadRootReplyCount } from './threadIndicatorViewModel';
import {
  MAX_THREAD_INDICATOR_PARTICIPANTS,
  ThreadIndicatorChip,
  type ThreadIndicatorParticipant,
  type ThreadIndicatorUnread,
} from './ThreadIndicatorChip';

export type { ThreadIndicatorUnread };

type ThreadIndicatorProps = Omit<ComponentPropsWithoutRef<'button'>, 'children'> & {
  as?: 'button' | 'div' | 'span';
  room: Room;
  /** Root of the thread; without one the indicator only labels the composer as replying in a thread. */
  threadRootId?: string;
  /** Timeline set the root event lives in, for its reply-count metadata. */
  timelineSet?: EventTimelineSet;
  /** Known reply count; read from the thread model or root metadata when omitted. */
  threadReplyCount?: number;
  threadParticipantIds?: string[];
  isResolved?: boolean;
  /** Optional leading title, allowed to wrap before the unbroken reply metadata. */
  threadTitle?: string;
  /** Set while the thread is unread: the chip takes the accent and reads "New". */
  unread?: ThreadIndicatorUnread;
  ref?: Ref<HTMLElement>;
};

const resolveReplyCount = (
  room: Room,
  threadRootId: string,
  timelineSet: EventTimelineSet | undefined
): number | undefined => {
  const thread = room.getThread?.(threadRootId);
  if (thread) return thread.length;
  const rootEvent = timelineSet?.findEventById(threadRootId) ?? room.findEventById?.(threadRootId);
  return getThreadRootReplyCount(rootEvent);
};

/**
 * A chip with a thread's reply count, its first participants and a resolved mark. With
 * `as="button"` it opens the thread; without a `threadRootId` it only reads "Thread". While
 * `unread` is set it reads "New · 11 replies" in the accent, with an @ pill for a mention.
 * With `threadTitle`, the title wraps and the metadata follows it after a dot, as a single inline
 * group.
 */
export function ThreadIndicator({
  threadReplyCount,
  threadParticipantIds,
  threadRootId,
  timelineSet,
  room,
  ref,
  ...rest
}: ThreadIndicatorProps) {
  const mx = useOptionalMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const replyCount =
    threadReplyCount !== undefined
      ? threadReplyCount
      : threadRootId
        ? resolveReplyCount(room, threadRootId, timelineSet)
        : undefined;

  const participants: ThreadIndicatorParticipant[] | undefined =
    threadParticipantIds && threadParticipantIds.length > 0
      ? threadParticipantIds.slice(0, MAX_THREAD_INDICATOR_PARTICIPANTS).map((userId) => {
          const member = room.getMember?.(userId);
          const displayName = (member && getMemberDisplayName(room, userId)) || userId;
          const mxc = member?.getMxcAvatarUrl();
          const avatarUrl =
            mx && mxc
              ? (mxcUrlToHttp(mx, mxc, useAuthentication, 36, 36, 'crop') ?? undefined)
              : undefined;
          return { userId, displayName, avatarUrl };
        })
      : undefined;

  return (
    <ThreadIndicatorChip {...rest} ref={ref} replyCount={replyCount} participants={participants} />
  );
}
