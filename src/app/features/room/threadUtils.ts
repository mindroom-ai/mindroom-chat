import { RelationType } from 'matrix-js-sdk';

type ThreadEventLike = {
  getId(): string | undefined;
  threadRootId?: string;
  getSender?(): string | undefined;
  getRelation?(): { rel_type?: string } | null | undefined;
};

const isThreadRelation = (event: ThreadEventLike): boolean => {
  const relationType = event.getRelation?.()?.rel_type;
  return !relationType || relationType === RelationType.Thread;
};

export const eventBelongsToThread = (event: ThreadEventLike, threadId: string): boolean =>
  event.getId() === threadId || event.threadRootId === threadId;

export const isThreadReplyEvent = (eventId: string, threadRootId?: string): boolean =>
  !!threadRootId && threadRootId !== eventId;

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
