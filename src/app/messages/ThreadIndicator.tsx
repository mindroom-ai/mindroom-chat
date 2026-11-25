import type { EventTimelineSet, Room } from 'matrix-js-sdk';
import { useOptionalMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { getMemberDisplayName } from '../matrix/room';
import { getThreadRootReplyCount } from './threadIndicatorViewModel';
import {
  ThreadIndicatorChip,
  type ThreadIndicatorChipProps,
  type ThreadIndicatorParticipant,
  type ThreadIndicatorUnread,
} from './ThreadIndicatorChip';

export type { ThreadIndicatorUnread };

const MAX_THREAD_INDICATOR_PARTICIPANTS = 3;

type ThreadIndicatorProps = Omit<ThreadIndicatorChipProps, 'replyCount' | 'participants'> & {
  room: Room;
  /** Root of the thread; without one the indicator only labels the composer as replying in a thread. */
  threadRootId?: string;
  /** Timeline set the root event lives in, for its reply-count metadata. */
  timelineSet?: EventTimelineSet;
  /** Known reply count; read from the thread model or root metadata when omitted. */
  threadReplyCount?: number;
  threadParticipantIds?: string[];
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
  ...rest
}: ThreadIndicatorProps) {
  const mx = useOptionalMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const replyCount =
    threadReplyCount ??
    (threadRootId ? resolveReplyCount(room, threadRootId, timelineSet) : undefined);

  const participants: ThreadIndicatorParticipant[] | undefined = threadParticipantIds
    ?.slice(0, MAX_THREAD_INDICATOR_PARTICIPANTS)
    .map((userId) => {
      const member = room.getMember?.(userId);
      const mxc = member?.getMxcAvatarUrl();
      return {
        userId,
        displayName: (member && getMemberDisplayName(room, userId)) || userId,
        avatarUrl:
          mx && mxc
            ? (mxcUrlToHttp(mx, mxc, useAuthentication, 36, 36, 'crop') ?? undefined)
            : undefined,
      };
    });

  return <ThreadIndicatorChip {...rest} replyCount={replyCount} participants={participants} />;
}
