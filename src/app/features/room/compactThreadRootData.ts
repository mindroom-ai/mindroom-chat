import { IEvent, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import {
  getEditedEvent,
  getLatestEdit,
  getLatestMessageContent,
  trimReplyFromBody,
} from '../../utils/room';
import { applySerializedCachedReplaceRelations } from './eventCacheEditUtils';
import type { CachedThreadEventPage } from './threadEventCache';
import { hasLikelyIncompleteStreamingBody } from './threadEditBackfillUtils';

export type CompactThreadRootData = {
  ids: string[];
  indexMap: Map<string, number>;
  bodyMap: Map<string, string>;
};

export type CompactThreadRootPreviewInfo = {
  previewText: string;
  sourceTs: number;
};

const getEventActivityTs = (event: MatrixEvent): number => {
  const replacingEvent = event.replacingEvent();
  const replacingTs =
    replacingEvent && replacingEvent.getSender() === event.getSender()
      ? replacingEvent.getTs()
      : 0;

  return Math.max(event.getTs(), replacingTs);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getThreadRelationTargetId = (event: MatrixEvent | undefined): string | undefined => {
  if (!event) return undefined;

  const relation = typeof event.getRelation === 'function' ? event.getRelation() : undefined;
  if (relation?.rel_type === 'm.thread' && typeof relation.event_id === 'string') {
    return relation.event_id;
  }

  const content = event.getContent();
  if (!isRecord(content)) return undefined;
  const relatesTo = content['m.relates_to'];
  if (!isRecord(relatesTo)) return undefined;
  if (relatesTo.rel_type !== 'm.thread') return undefined;
  return typeof relatesTo.event_id === 'string' ? relatesTo.event_id : undefined;
};

export const isNestedThreadReplyEvent = (event: MatrixEvent | undefined): boolean => {
  const eventId = event?.getId();
  if (!eventId) return false;

  const targetId = getThreadRelationTargetId(event);
  return !!targetId && targetId !== eventId;
};

const hasCompactThreadActivity = (thread: Thread): boolean =>
  !!thread.replyToEvent ||
  ((thread.events?.length ?? 0) > 0) ||
  ((thread.timeline?.length ?? 0) > 0) ||
  (typeof thread.length === 'number' && thread.length > 0);

export const getCompactThreadRootBodyPreviewText = (
  event: MatrixEvent | undefined,
  options?: {
    eventId?: string;
    room?: Pick<Room, 'getUnfilteredTimelineSet'>;
    editedEvent?: MatrixEvent;
  }
): string | undefined => {
  if (!event) return undefined;

  const editedEvent =
    options?.editedEvent ??
    event.replacingEvent() ??
    (options?.eventId && options.room
      ? getEditedEvent(options.eventId, event, options.room.getUnfilteredTimelineSet())
      : undefined);
  const content = getLatestMessageContent(event, editedEvent) as Record<string, unknown> | null | undefined;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;

  const newContent = content['m.new_content'];
  const editedBody =
    newContent && typeof newContent === 'object' && !Array.isArray(newContent)
      ? (newContent as Record<string, unknown>).body
      : undefined;
  const body = editedBody ?? content.body;
  if (typeof body !== 'string') return undefined;

  const normalized = trimReplyFromBody(body).replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
};

export const getCompactCachedThreadRootPreviewInfo = ({
  threadId,
  cachedPage,
  mapper,
}: {
  threadId: string;
  cachedPage: Pick<CachedThreadEventPage, 'rootEvent' | 'events'>;
  mapper: (rawEvent: IEvent) => MatrixEvent;
}): CompactThreadRootPreviewInfo | undefined => {
  const mappedRootEvent = cachedPage.rootEvent
    ? mapper(cachedPage.rootEvent as IEvent)
    : undefined;
  const mappedEvents = cachedPage.events.map((rawEvent) => mapper(rawEvent as IEvent));
  const allEvents = mappedRootEvent ? [mappedRootEvent, ...mappedEvents] : mappedEvents;

  if (allEvents.length === 0) return undefined;

  applySerializedCachedReplaceRelations(allEvents);

  const targetEvent = mappedRootEvent ?? allEvents.find((event) => event.getId() === threadId);
  if (!targetEvent) return undefined;

  const relationEditEvents = mappedEvents.filter((event) => {
    const relation = event.getRelation();
    return relation?.rel_type === 'm.replace' && relation.event_id === threadId;
  });
  const latestEdit = getLatestEdit(
    targetEvent,
    [targetEvent.replacingEvent(), ...relationEditEvents].filter(
      (event): event is MatrixEvent => !!event
    )
  );

  const previewText = getCompactThreadRootBodyPreviewText(targetEvent, { editedEvent: latestEdit });
  if (!previewText) return undefined;

  return {
    previewText,
    sourceTs: latestEdit?.getTs() ?? targetEvent.getTs(),
  };
};

export const getCompactCachedThreadActivityTs = ({
  threadId,
  cachedPage,
  mapper,
}: {
  threadId: string;
  cachedPage: Pick<CachedThreadEventPage, 'rootEvent' | 'events'>;
  mapper: (rawEvent: IEvent) => MatrixEvent;
}): number | undefined => {
  const mappedRootEvent = cachedPage.rootEvent
    ? mapper(cachedPage.rootEvent as IEvent)
    : undefined;
  const mappedEvents = cachedPage.events.map((rawEvent) => mapper(rawEvent as IEvent));
  const allEvents = mappedRootEvent ? [mappedRootEvent, ...mappedEvents] : mappedEvents;

  if (allEvents.length === 0) return undefined;

  applySerializedCachedReplaceRelations(allEvents);

  return allEvents.reduce<number | undefined>((latestTs, event) => {
    const isRootEvent = event.getId() === threadId;
    const relationType = event.getRelation()?.rel_type;
    const isThreadReply = relationType === 'm.thread';
    const isEdit = relationType === 'm.replace';

    if (!isRootEvent && !isThreadReply && !isEdit) return latestTs;
    if (event.getType() !== 'm.room.message') return latestTs;

    const activityTs = getEventActivityTs(event);
    if (latestTs === undefined) return activityTs;
    return activityTs > latestTs ? activityTs : latestTs;
  }, undefined);
};

export const pickPreferredThreadRootPreviewText = ({
  preferredPreviewText,
  fallbackPreviewText,
}: {
  preferredPreviewText: string | undefined;
  fallbackPreviewText: string | undefined;
}): string | undefined => {
  if (preferredPreviewText && !hasLikelyIncompleteStreamingBody(preferredPreviewText)) {
    return preferredPreviewText;
  }

  if (fallbackPreviewText && !hasLikelyIncompleteStreamingBody(fallbackPreviewText)) {
    return fallbackPreviewText;
  }

  return preferredPreviewText ?? fallbackPreviewText;
};

export const buildCompactThreadRootData = ({
  room,
  visibleIds,
  visibleIndexMap,
  visibleBodyMap,
  threads,
}: {
  room: Pick<Room, 'findEventById' | 'getUnfilteredTimelineSet'>;
  visibleIds: string[];
  visibleIndexMap: Map<string, number>;
  visibleBodyMap: Map<string, string>;
  threads: Thread[];
}): CompactThreadRootData => {
  const ids = [...visibleIds];
  const indexMap = new Map(visibleIndexMap);
  const bodyMap = new Map(visibleBodyMap);
  const seen = new Set(ids);
  let nextIndex =
    visibleIndexMap.size > 0 ? Math.max(...Array.from(visibleIndexMap.values())) + 1 : 0;

  threads.forEach((thread) => {
    if (!thread.id || seen.has(thread.id) || !hasCompactThreadActivity(thread)) return;
    const rootEvent = room.findEventById(thread.id) ?? thread.rootEvent;
    if (isNestedThreadReplyEvent(rootEvent)) return;

    seen.add(thread.id);
    ids.push(thread.id);
    indexMap.set(thread.id, nextIndex);
    nextIndex += 1;

    const bodyPreview = getCompactThreadRootBodyPreviewText(rootEvent, {
      eventId: thread.id,
      room,
    });
    if (bodyPreview) {
      bodyMap.set(thread.id, bodyPreview);
    }
  });

  return {
    ids,
    indexMap,
    bodyMap,
  };
};
