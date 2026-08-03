import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { MessageEvent, StateEvent } from '../../../types/matrix/room';
import { isMindroomThreadSummaryEvent } from '../messages/threadSummary';
import { getThreadMessagePreviewText } from './threadMessagePreview';

type ThreadEventLike = {
  getId(): string | undefined;
  threadRootId?: string;
  getSender?(): string | undefined;
  getRelation?(): { rel_type?: string } | null | undefined;
};

type VisibleThreadEventLike = ThreadEventLike & {
  getType?(): string | undefined;
  isRedacted?(): boolean;
  isRedaction?(): boolean;
};

export type VisibleThreadEventCollectionLike = {
  rootEvent?: MatrixEvent;
  length?: number;
  events?: MatrixEvent[];
  timeline?: MatrixEvent[];
};

const VISIBLE_THREAD_TEXT_MESSAGE_EVENT_TYPES = new Set<string>([
  MessageEvent.RoomMessage,
  MessageEvent.RoomMessageEncrypted,
]);

const VISIBLE_THREAD_REPLY_EVENT_TYPES = new Set<string>([
  ...VISIBLE_THREAD_TEXT_MESSAGE_EVENT_TYPES,
  MessageEvent.Sticker,
  StateEvent.RoomMember,
  StateEvent.RoomName,
  StateEvent.RoomTopic,
  StateEvent.RoomAvatar,
]);

const isThreadRelation = (event: ThreadEventLike): boolean => {
  const relationType = event.getRelation?.()?.rel_type;
  return !relationType || relationType === RelationType.Thread;
};

export const eventBelongsToThread = (event: ThreadEventLike, threadId: string): boolean =>
  event.getId() === threadId || event.threadRootId === threadId;

export const isThreadReplyEvent = (eventId: string, threadRootId?: string): boolean =>
  !!threadRootId && threadRootId !== eventId;

/**
 * @returns true if the Matrix event TYPE is a renderable message envelope.
 *
 * NOTE: this gates on event TYPE (`m.room.message` / `m.room.encrypted`), NOT
 * on `content.msgtype`. Voice (`m.audio` + `m.voice`), image, video, file,
 * emote, location, and custom MindRoom msgtypes all pass — they are normal
 * `m.room.message` envelopes. The "TextMessage" suffix in this function name
 * is historical and misleading; do NOT introduce a `content.msgtype` allowlist
 * here. See CINNY-088 for the regression that motivated this clarification.
 */
export const isVisibleThreadTextMessageEventType = (eventType: string | undefined): boolean =>
  !!eventType && VISIBLE_THREAD_TEXT_MESSAGE_EVENT_TYPES.has(eventType);

export const isVisibleThreadReplyEventType = (eventType: string | undefined): boolean =>
  !!eventType && VISIBLE_THREAD_REPLY_EVENT_TYPES.has(eventType);

export const isVisibleThreadReplyEvent = (event: VisibleThreadEventLike): boolean => {
  const eventId = event.getId();
  const { threadRootId } = event;
  if (!eventId || !threadRootId || eventId === threadRootId) return false;
  if (!isThreadRelation(event)) return false;
  if (event.isRedacted?.() || event.isRedaction?.()) return false;

  return isVisibleThreadReplyEventType(event.getType?.());
};

export const getVisibleThreadEventBodyPreviewText = (
  event: MatrixEvent | undefined
): string | undefined => {
  const content =
    event && typeof event.getContent === 'function'
      ? (event.getContent() as Record<string, unknown> | null | undefined)
      : undefined;
  return getThreadMessagePreviewText(content);
};

export const getLatestRenderableVisibleThreadReplyEvent = (
  replyEvents: MatrixEvent[]
): MatrixEvent | undefined => {
  let summaryFallback: MatrixEvent | undefined;

  for (let i = replyEvents.length - 1; i >= 0; i -= 1) {
    const event = replyEvents[i];
    if (!getVisibleThreadEventBodyPreviewText(event)) continue;

    if (isMindroomThreadSummaryEvent(event)) {
      summaryFallback ??= event;
      continue;
    }

    return event;
  }

  return summaryFallback;
};

export const getPreferredVisibleThreadReplyEvents = (
  thread: VisibleThreadEventCollectionLike | null | undefined
): MatrixEvent[] => {
  const replyEvents = thread?.events?.length
    ? thread.events
    : thread?.timeline?.length
    ? thread.timeline
    : thread?.events ?? thread?.timeline ?? [];
  return replyEvents.filter(isVisibleThreadReplyEvent);
};

export const hasLoadedThreadReplyEvents = (
  thread: Pick<VisibleThreadEventCollectionLike, 'events' | 'timeline'> | null | undefined
): boolean => {
  if (thread?.events && thread.events.length > 0) return true;
  return !!thread?.timeline && thread.timeline.length > 0;
};

export const getVisibleThreadMessageCount = (
  thread: VisibleThreadEventCollectionLike | null | undefined,
  fallbackMessageCount?: number
): number => {
  const replyEvents = getPreferredVisibleThreadReplyEvents(thread);
  if (replyEvents.length > 0) {
    return new Set(replyEvents.map((event) => event.getId())).size;
  }
  if (hasLoadedThreadReplyEvents(thread)) return 0;
  if (typeof thread?.length === 'number' && thread.length > 0) return thread.length;
  if (typeof fallbackMessageCount === 'number' && fallbackMessageCount > 0) {
    return fallbackMessageCount;
  }

  return 0;
};

export const getVisibleThreadParticipantIds = (
  thread: VisibleThreadEventCollectionLike | null | undefined,
  threadRootEvent: MatrixEvent | undefined,
  maxParticipants = 3
): string[] => {
  const participantIds: string[] = [];
  const seenParticipantIds = new Set<string>();
  const replyEvents = getPreferredVisibleThreadReplyEvents(thread);

  for (let i = replyEvents.length - 1; i >= 0 && participantIds.length < maxParticipants; i -= 1) {
    const senderId = replyEvents[i].getSender?.();
    if (!senderId || seenParticipantIds.has(senderId)) continue;

    seenParticipantIds.add(senderId);
    participantIds.push(senderId);
  }

  const rootSenderId = threadRootEvent?.getSender?.();
  if (
    participantIds.length < maxParticipants &&
    rootSenderId &&
    !seenParticipantIds.has(rootSenderId)
  ) {
    participantIds.push(rootSenderId);
  }

  return participantIds;
};

export const buildThreadReplyCountMap = (events: ThreadEventLike[]): Map<string, number> => {
  const seenEventIds = new Set<string>();
  const counts = new Map<string, number>();

  events.forEach((event) => {
    const eventId = event.getId();
    const { threadRootId } = event;
    if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
      return;
    }
    seenEventIds.add(eventId);

    if (!isThreadRelation(event)) return;

    counts.set(threadRootId, (counts.get(threadRootId) ?? 0) + 1);
  });

  return counts;
};

export const buildVisibleThreadReplyCountMap = (
  events: VisibleThreadEventLike[]
): Map<string, number> => {
  const seenEventIds = new Set<string>();
  const counts = new Map<string, number>();

  events.forEach((event) => {
    const eventId = event.getId();
    const { threadRootId } = event;
    if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
      return;
    }
    seenEventIds.add(eventId);

    if (!isVisibleThreadReplyEvent(event)) return;

    counts.set(threadRootId, (counts.get(threadRootId) ?? 0) + 1);
  });

  return counts;
};

export const buildThreadParticipantMap = (
  events: ThreadEventLike[],
  maxParticipants = 3
): Map<string, string[]> => {
  const seenEventIds = new Set<string>();
  const participants = new Map<string, string[]>();
  const participantSets = new Map<string, Set<string>>();

  [...events].reverse().forEach((event) => {
    const eventId = event.getId();
    const { threadRootId } = event;
    if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
      return;
    }
    seenEventIds.add(eventId);

    if (!isThreadRelation(event)) return;

    const senderId = event.getSender?.();
    if (!senderId) return;

    const threadParticipants = participants.get(threadRootId) ?? [];
    if (threadParticipants.length >= maxParticipants) return;

    const threadParticipantSet = participantSets.get(threadRootId) ?? new Set<string>();
    if (threadParticipantSet.has(senderId)) return;

    threadParticipantSet.add(senderId);
    participantSets.set(threadRootId, threadParticipantSet);
    participants.set(threadRootId, [...threadParticipants, senderId]);
  });

  return participants;
};

export const buildVisibleThreadParticipantMap = (
  events: VisibleThreadEventLike[],
  maxParticipants = 3
): Map<string, string[]> => {
  const seenEventIds = new Set<string>();
  const participants = new Map<string, string[]>();
  const participantSets = new Map<string, Set<string>>();

  [...events].reverse().forEach((event) => {
    const eventId = event.getId();
    const { threadRootId } = event;
    if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
      return;
    }
    seenEventIds.add(eventId);

    if (!isVisibleThreadReplyEvent(event)) return;

    const senderId = event.getSender?.();
    if (!senderId) return;

    const threadParticipants = participants.get(threadRootId) ?? [];
    if (threadParticipants.length >= maxParticipants) return;

    const threadParticipantSet = participantSets.get(threadRootId) ?? new Set<string>();
    if (threadParticipantSet.has(senderId)) return;

    threadParticipantSet.add(senderId);
    participantSets.set(threadRootId, threadParticipantSet);
    participants.set(threadRootId, [...threadParticipants, senderId]);
  });

  return participants;
};

export const getValidThreadRootEvent = (
  room: Pick<Room, 'findEventById' | 'getThread'>,
  threadRootId?: string
): MatrixEvent | undefined => {
  if (!threadRootId) return undefined;

  const candidateThreadRoot =
    room.getThread(threadRootId)?.rootEvent ?? room.findEventById(threadRootId);

  if (!candidateThreadRoot || candidateThreadRoot.getId() !== threadRootId) {
    return undefined;
  }

  return candidateThreadRoot.isThreadRoot ? candidateThreadRoot : undefined;
};
