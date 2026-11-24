import type { MatrixEvent } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { isRecord } from '../../lib/isRecord';
import { getThreadSummaryReply } from '../../matrix/client/unopenedThreadEdits';
import { isKnownRedactedEventId } from '../../matrix/eventRevision';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { ORIGINAL_SENDER_KEY } from '../../matrix/protocol/originalSender';
import { isPendingLocalEchoEvent } from '../../matrix/protocol/pendingLocalEcho';
import { isThreadSummaryEvent } from '../../matrix/protocol/threadSummary';
import { getBundledThreadPreviews } from './threadBundledPreviews';
import {
  getPreferredVisibleThreadReplyEvents,
  hasLoadedEveryThreadReply,
  isVisibleThreadReplyEvent,
  getVisibleThreadMessageCount,
} from './threadUtils';
import { getThreadReplyCount } from './threadRecord';
import { roomThreadListIsListed } from './roomThreadList';

const eventDirectlyMentionsUser = (event: MatrixEvent | undefined, userId: string): boolean => {
  const replacement: unknown = event?.replacingEvent?.()?.getContent?.();
  const content: unknown = isRecord(replacement) ? replacement : event?.getContent?.();
  if (!isRecord(content)) return false;

  const edited = content['m.new_content'];
  const mentions = (isRecord(edited) ? edited : content)['m.mentions'];
  return (
    isRecord(mentions) && Array.isArray(mentions.user_ids) && mentions.user_ids.includes(userId)
  );
};

const getPendingOwnThreadReply = (
  room: Room,
  threadRootId: string,
  currentUserId: string | undefined
): MatrixEvent | undefined => {
  if (!currentUserId) return undefined;

  return (room.relations?.getAllChildEventsForEvent(threadRootId) ?? [])
    .filter((event) => {
      const relation = event.getRelation?.();
      const isDirectThreadReply =
        event.threadRootId === threadRootId ||
        (relation?.rel_type === RelationType.Thread && relation.event_id === threadRootId);
      return (
        isDirectThreadReply &&
        event.getSender?.() === currentUserId &&
        isPendingLocalEchoEvent(event)
      );
    })
    .sort((left, right) => left.getTs() - right.getTs())
    .at(-1);
};

type ThreadInvolvementInput = {
  rootEvent?: MatrixEvent;
  thread: Thread | null | undefined;
  userId: string | undefined;
  visibleReplies?: MatrixEvent[];
};

export const isUserInvolvedInThread = ({
  rootEvent,
  thread,
  userId,
  visibleReplies,
}: ThreadInvolvementInput): boolean => {
  if (!userId) return false;
  if (rootEvent?.getSender?.() === userId) return true;
  if (eventDirectlyMentionsUser(rootEvent, userId)) return true;

  return (visibleReplies ?? getPreferredVisibleThreadReplyEvents(thread)).some(
    (event) => event.getSender?.() === userId || eventDirectlyMentionsUser(event, userId)
  );
};

/**
 * Attribution uses the root and loaded visible replies, plus detached replies only when incomplete.
 * Read original content and skip title replies, plus detached roots, non-visible replies, and room-known redactions.
 */
export const hasAgentPostForUser = ({
  thread,
  rootEvent = thread?.rootEvent,
  userId,
  visibleReplies,
  room = thread?.room,
  bundledPreviews,
}: ThreadInvolvementInput & {
  room?: Room;
  bundledPreviews?: ReturnType<typeof getBundledThreadPreviews>;
}): boolean => {
  if (!userId) return false;
  const postedForUser = (event: MatrixEvent | undefined) =>
    !!event &&
    isMindroomAgentUserIdForViewer(event.getSender(), userId) &&
    event.getOriginalContent?.()?.[ORIGINAL_SENDER_KEY] === userId;

  if (
    postedForUser(rootEvent) ||
    (visibleReplies ?? getPreferredVisibleThreadReplyEvents(thread)).some(
      (event) => postedForUser(event) && !isThreadSummaryEvent(event)
    )
  )
    return true;
  if (hasLoadedEveryThreadReply(thread)) return false;

  const rootId = rootEvent?.getId() ?? thread?.id;
  const bundled = (bundledPreviews ?? (room && getBundledThreadPreviews(room, rootEvent)))?.reply;
  return [getThreadSummaryReply(thread), bundled].some((event) => {
    const id = event?.getId();
    return (
      !!event &&
      !!id &&
      id !== rootId &&
      isVisibleThreadReplyEvent(event) &&
      !isThreadSummaryEvent(event) &&
      postedForUser(event) &&
      (!room || !isKnownRedactedEventId(room, id))
    );
  });
};

/** For me is broader than involvement, which also controls Following and Activity. */
export const resolveThreadInvolvement = ({
  room,
  threadRootId,
  userId,
  thread = room.getThread(threadRootId),
  fallbackRootEvent,
  rootEvent = thread?.rootEvent ?? room.findEventById(threadRootId) ?? fallbackRootEvent,
  visibleReplies = getPreferredVisibleThreadReplyEvents(thread),
  bundledPreviews,
  replyCount,
}: Omit<ThreadInvolvementInput, 'thread'> & {
  thread?: Thread | null;
  room: Room;
  threadRootId: string;
  fallbackRootEvent?: MatrixEvent;
  bundledPreviews?: ReturnType<typeof getBundledThreadPreviews>;
  replyCount?: number;
}) => {
  const liveReplyCount =
    replyCount ??
    (thread && roomThreadListIsListed(room)
      ? getVisibleThreadMessageCount(thread, undefined, visibleReplies)
      : (rootEvent && getThreadReplyCount(room, rootEvent)) ?? 0);
  const pendingOwnFirstReplyTs =
    liveReplyCount === 0
      ? getPendingOwnThreadReply(room, threadRootId, userId)?.getTs()
      : undefined;
  const input = { room, rootEvent, thread, userId, visibleReplies, bundledPreviews };
  const isInvolved = pendingOwnFirstReplyTs !== undefined || isUserInvolvedInThread(input);
  // After redacting your only reply, the SDK may still count you until it rereads the root.
  const isForUser =
    isInvolved ||
    hasAgentPostForUser(input) ||
    (!!userId &&
      thread?.hasCurrentUserParticipated === true &&
      thread.client?.getUserId?.() === userId);
  return { isInvolved, isForUser, pendingOwnFirstReplyTs };
};

/** One read per root for a synchronous filter pass, including workflow counts. */
export const createThreadForMeMatcher = (
  room: Room,
  userId = room.myUserId,
  fallbackRootEventMap?: ReadonlyMap<string, MatrixEvent>
) => {
  const matches = new Map<string, boolean>();
  return (threadRootId: string): boolean => {
    const cached = matches.get(threadRootId);
    if (cached !== undefined) return cached;
    const { isForUser } = resolveThreadInvolvement({
      room,
      threadRootId,
      userId,
      fallbackRootEvent: fallbackRootEventMap?.get(threadRootId),
    });
    matches.set(threadRootId, isForUser);
    return isForUser;
  };
};
