import { RelationType } from 'matrix-js-sdk';

type ThreadEventLike = {
  getId(): string | undefined;
  threadRootId?: string;
  getRelation?(): { rel_type?: string } | null | undefined;
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
    const threadRootId = event.threadRootId;
    if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
      return;
    }
    seenEventIds.add(eventId);

    const relationType = event.getRelation?.()?.rel_type;
    if (relationType && relationType !== RelationType.Thread) {
      return;
    }

    counts.set(threadRootId, (counts.get(threadRootId) ?? 0) + 1);
  });

  return counts;
};
