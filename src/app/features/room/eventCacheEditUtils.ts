import { EventTimelineSet, IEvent, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { getLatestEdit } from '../../utils/room';

const cloneRawEvent = (rawEvent: Partial<IEvent>): Partial<IEvent> =>
  JSON.parse(JSON.stringify(rawEvent)) as Partial<IEvent>;

const setSerializedReplacement = (
  targetRawEvent: Partial<IEvent>,
  replacementRawEvent: Partial<IEvent>
): Partial<IEvent> => {
  const unsigned =
    targetRawEvent.unsigned && typeof targetRawEvent.unsigned === 'object'
      ? { ...targetRawEvent.unsigned }
      : {};
  const aggregatedRelations =
    unsigned['m.relations'] && typeof unsigned['m.relations'] === 'object'
      ? { ...(unsigned['m.relations'] as Record<string, unknown>) }
      : {};

  aggregatedRelations[RelationType.Replace] = cloneRawEvent(replacementRawEvent);
  unsigned['m.relations'] = aggregatedRelations;
  return {
    ...targetRawEvent,
    unsigned: unsigned as IEvent['unsigned'],
  };
};

const getTargetEventId = (mEvent: MatrixEvent): string | undefined => mEvent.getRelation()?.event_id;

const getLatestEvent = (events: MatrixEvent[]): MatrixEvent | undefined =>
  events.reduce<MatrixEvent | undefined>((latest, mEvent) => {
    if (!latest) return mEvent;
    if (mEvent.getTs() > latest.getTs()) return mEvent;
    if (mEvent.getTs() === latest.getTs()) return mEvent;
    return latest;
  }, undefined);

export const applyCachedRedactions = (room: Room, events: MatrixEvent[]): void => {
  const redactionEventsByTarget = new Map<string, MatrixEvent[]>();
  const eventById = new Map<string, MatrixEvent>();

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) {
      eventById.set(eventId, mEvent);
    }

    if (!mEvent.isRedaction()) return;
    const targetEventId = mEvent.getAssociatedId();
    if (!targetEventId) return;

    const currentRedactions = redactionEventsByTarget.get(targetEventId) ?? [];
    currentRedactions.push(mEvent);
    redactionEventsByTarget.set(targetEventId, currentRedactions);
  });

  redactionEventsByTarget.forEach((redactionEvents, targetEventId) => {
    const targetEvent = eventById.get(targetEventId);
    if (!targetEvent) return;

    const latestRedaction = getLatestEvent(redactionEvents);
    if (!latestRedaction) return;

    const currentRedactionEvent = targetEvent.getRedactionEvent();
    const currentRedactionId =
      currentRedactionEvent &&
      typeof currentRedactionEvent === 'object' &&
      'event_id' in currentRedactionEvent &&
      typeof currentRedactionEvent.event_id === 'string'
        ? currentRedactionEvent.event_id
        : undefined;
    if (targetEvent.isRedacted() && currentRedactionId === latestRedaction.getId()) return;

    targetEvent.makeRedacted(latestRedaction, room);
  });
};

export const applyCachedReplaceRelations = (events: MatrixEvent[]): void => {
  const editEventsByTarget = new Map<string, MatrixEvent[]>();
  const eventById = new Map<string, MatrixEvent>();

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) {
      eventById.set(eventId, mEvent);
    }

    if (mEvent.getRelation()?.rel_type !== RelationType.Replace) return;
    const targetEventId = getTargetEventId(mEvent);
    if (!targetEventId) return;

    const currentEditEvents = editEventsByTarget.get(targetEventId) ?? [];
    currentEditEvents.push(mEvent);
    editEventsByTarget.set(targetEventId, currentEditEvents);
  });

  editEventsByTarget.forEach((editEvents, targetEventId) => {
    const targetEvent = eventById.get(targetEventId);
    if (!targetEvent) return;

    const replacingEvent = targetEvent.replacingEvent();
    const candidateEvents = replacingEvent ? [replacingEvent, ...editEvents] : editEvents;
    const latestEdit = getLatestEdit(targetEvent, candidateEvents);

    if (!latestEdit || latestEdit === replacingEvent) return;
    targetEvent.makeReplaced(latestEdit);
  });
};

export const aggregateCachedRelationEvents = (
  events: MatrixEvent[],
  timelineSets: Array<EventTimelineSet | undefined>,
  seenRelationEventIds?: Set<string>
): void => {
  const uniqueTimelineSets = Array.from(
    new Set(timelineSets.filter((timelineSet): timelineSet is EventTimelineSet => !!timelineSet))
  );
  if (uniqueTimelineSets.length === 0) return;

  events.forEach((mEvent) => {
    if (!mEvent.getRelation()) return;

    const eventId = mEvent.getId();
    if (eventId && seenRelationEventIds?.has(eventId)) return;

    uniqueTimelineSets.forEach((timelineSet) => {
      timelineSet.relations.aggregateChildEvent(mEvent, timelineSet);
    });

    if (eventId) {
      seenRelationEventIds?.add(eventId);
    }
  });
};

export const hydrateCachedEvents = ({
  room,
  events,
  timelineSets,
  seenRelationEventIds,
}: {
  room: Room;
  events: MatrixEvent[];
  timelineSets?: Array<EventTimelineSet | undefined>;
  seenRelationEventIds?: Set<string>;
}): void => {
  applyCachedRedactions(room, events);
  applyCachedReplaceRelations(events);
  if (timelineSets) {
    aggregateCachedRelationEvents(events, timelineSets, seenRelationEventIds);
  }
};

export const serializeEventsForCache = (room: Room, events: MatrixEvent[]): Partial<IEvent>[] => {
  hydrateCachedEvents({ room, events });

  const serializedEvents = new Map<string, Partial<IEvent>>();
  const eventById = new Map<string, MatrixEvent>();

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    const rawEvent = mEvent.event as Partial<IEvent> | undefined;
    if (!eventId || !rawEvent) return;

    serializedEvents.set(eventId, cloneRawEvent(rawEvent));
    eventById.set(eventId, mEvent);
  });

  eventById.forEach((mEvent, eventId) => {
    const replacingEvent = mEvent.replacingEvent();
    if (!replacingEvent || replacingEvent.getSender() !== mEvent.getSender()) return;

    const targetRawEvent = serializedEvents.get(eventId);
    const replacementRawEvent = replacingEvent.event as Partial<IEvent> | undefined;
    if (!targetRawEvent || !replacementRawEvent) return;

    serializedEvents.set(eventId, setSerializedReplacement(targetRawEvent, replacementRawEvent));
  });

  return Array.from(serializedEvents.values());
};
