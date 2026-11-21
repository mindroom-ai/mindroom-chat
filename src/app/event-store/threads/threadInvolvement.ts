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
} from './threadUtils';

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

export const getPendingOwnThreadReply = (
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
  visibleReplies?: readonly MatrixEvent[];
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
export const resolveThreadInvolvement = (
  input: Parameters<typeof hasAgentPostForUser>[0],
  pendingOwnFirstReplyTs: number | undefined
) => {
  const { thread, userId } = input;
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
