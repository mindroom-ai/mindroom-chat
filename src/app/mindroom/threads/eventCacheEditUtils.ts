import { EventTimelineSet, IEvent, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import {
  cloneRawEvent,
  getSerializedRelationEvent,
  isSameSenderEditEvent,
} from '../../utils/editEvent';
import { getLatestEdit, isEventOrderedAfter } from '../../utils/room';

export type RedactedRelationTarget = {
  eventId: string;
  eventType: string;
  parentEventId: string;
  relationType: string;
};

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
    return isEventOrderedAfter(mEvent, latest) ? mEvent : latest;
  }, undefined);

const getRedactedRelationTarget = (mEvent: MatrixEvent): RedactedRelationTarget | undefined => {
  const eventId = mEvent.getId();
  const eventType = mEvent.getType();
  const relation = mEvent.getRelation();

  if (!eventId || !eventType || !relation?.event_id || !relation.rel_type) {
    return undefined;
  }

  return {
    eventId,
    eventType,
    parentEventId: relation.event_id,
    relationType: relation.rel_type,
  };
};

export const collectRedactedRelationTargetsFromLookup = (
  events: MatrixEvent[],
  relationLookupEvents: MatrixEvent[] = []
): RedactedRelationTarget[] => {
  const relationLookupById = new Map<string, MatrixEvent>();
  relationLookupEvents.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) {
      relationLookupById.set(eventId, mEvent);
    }
  });

  return events.reduce<RedactedRelationTarget[]>((targets, mEvent) => {
    if (!mEvent.isRedacted()) return targets;

    const directTarget = getRedactedRelationTarget(mEvent);
    if (directTarget) {
      targets.push(directTarget);
      return targets;
    }

    const lookupEvent = mEvent.getId() ? relationLookupById.get(mEvent.getId()!) : undefined;
    const lookupTarget = lookupEvent ? getRedactedRelationTarget(lookupEvent) : undefined;
    if (lookupTarget) {
      targets.push(lookupTarget);
    }
    return targets;
  }, []);
};

export const applyCachedRedactions = (room: Room, events: MatrixEvent[]): RedactedRelationTarget[] => {
  const redactionEventsByTarget = new Map<string, MatrixEvent[]>();
  const eventById = new Map<string, MatrixEvent>();
  const redactedRelationTargets: RedactedRelationTarget[] = [];

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

    const relationTarget = getRedactedRelationTarget(targetEvent);
    if (relationTarget) redactedRelationTargets.push(relationTarget);

    targetEvent.makeRedacted(latestRedaction, room);
  });

  return redactedRelationTargets;
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

export const applySerializedCachedReplaceRelations = (events: MatrixEvent[]): void => {
  events.forEach((targetEvent) => {
    const serializedReplacementCandidate = getSerializedRelationEvent(targetEvent, RelationType.Replace);
    const serializedReplacement = isSameSenderEditEvent(targetEvent, serializedReplacementCandidate)
      ? serializedReplacementCandidate
      : undefined;
    if (!serializedReplacement) return;

    const existingReplacement = targetEvent.replacingEvent() ?? undefined;
    const latestEdit = getLatestEdit(
      targetEvent,
      [existingReplacement, serializedReplacement].filter(
        (mEvent): mEvent is MatrixEvent => !!mEvent
      )
    );

    if (!latestEdit || latestEdit === existingReplacement) return;
    targetEvent.makeReplaced(latestEdit);
  });
};

export const aggregateCachedRelationEvents = (
  events: MatrixEvent[],
  timelineSets: Array<EventTimelineSet | undefined>,
  seenRelationEventIds?: Set<string>,
  redactedRelationTargets?: RedactedRelationTarget[]
): void => {
  const uniqueTimelineSets = Array.from(
    new Set(timelineSets.filter((timelineSet): timelineSet is EventTimelineSet => !!timelineSet))
  );
  if (uniqueTimelineSets.length === 0) return;

  reconcileRelationEventsWithAggregation(
    events,
    uniqueTimelineSets.map((timelineSet) => ({ relations: timelineSet.relations, timelineSet })),
    seenRelationEventIds,
    redactedRelationTargets
  );
};

type RelationAggregationTarget = {
  relations: {
    getChildEventsForEvent: EventTimelineSet['relations']['getChildEventsForEvent'];
    aggregateChildEvent: (event: MatrixEvent, timelineSet?: EventTimelineSet) => void;
  };
  timelineSet?: EventTimelineSet;
};

const removeMatchingAggregatedRelationEvent = (
  relations: Relations | undefined,
  eventId: string | undefined
): void => {
  if (!relations || !eventId) return;

  const existingEvent = relations.getRelations().find((relationEvent) => relationEvent.getId() === eventId);
  if (!existingEvent) return;

  void relations.removeEvent(existingEvent);
};

export const reconcileRelationEventsWithAggregation = (
  events: MatrixEvent[],
  aggregationTargets: Array<RelationAggregationTarget | undefined>,
  seenRelationEventIds?: Set<string>,
  redactedRelationTargets: RedactedRelationTarget[] = []
): void => {
  const targets = aggregationTargets.filter(
    (target): target is RelationAggregationTarget => !!target
  );
  if (targets.length === 0) return;

  redactedRelationTargets.forEach(({ eventId, eventType, parentEventId, relationType }) => {
    targets.forEach(({ relations }) => {
      removeMatchingAggregatedRelationEvent(
        relations.getChildEventsForEvent(parentEventId, relationType, eventType),
        eventId
      );
    });
    seenRelationEventIds?.add(eventId);
  });

  events.forEach((mEvent) => {
    const relation = mEvent.getRelation();
    if (!relation) return;

    const eventId = mEvent.getId();
    if (mEvent.isRedacted()) {
      targets.forEach(({ relations }) => {
        removeMatchingAggregatedRelationEvent(
          relations.getChildEventsForEvent(relation.event_id!, relation.rel_type!, mEvent.getType()),
          eventId
        );
      });
      if (eventId) {
        seenRelationEventIds?.add(eventId);
      }
      return;
    }

    if (eventId && seenRelationEventIds?.has(eventId)) return;

    targets.forEach(({ relations, timelineSet }) => {
      relations.aggregateChildEvent(mEvent, timelineSet);
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
}): RedactedRelationTarget[] => {
  const redactedRelationTargets = applyCachedRedactions(room, events);
  applyCachedReplaceRelations(events);
  applySerializedCachedReplaceRelations(events);
  if (timelineSets) {
    aggregateCachedRelationEvents(events, timelineSets, seenRelationEventIds, redactedRelationTargets);
  }
  return redactedRelationTargets;
};

/**
 * CINNY-207 P1.4 (finding F5, decision D5): standalone same-sender `m.replace`
 * events are excluded from the serialized output. Their content is bundled
 * into the target record via `setSerializedReplacement` below, so persisting
 * them as their own cache records would just duplicate storage (a message
 * streamed with N edits used to leave ~N+1 records). Cross-sender replaces
 * are still emitted so hydration can decide what to do with them.
 */
const isStandaloneSameSenderReplace = (
  mEvent: MatrixEvent,
  eventsById: Map<string, MatrixEvent>
): boolean => {
  const relation = mEvent.getRelation();
  if (relation?.rel_type !== RelationType.Replace) return false;
  const targetEventId = relation.event_id;
  if (!targetEventId) return false;
  const targetEvent = eventsById.get(targetEventId);
  if (!targetEvent) return false;
  return targetEvent.getSender() === mEvent.getSender();
};

export const serializeEventsForCache = (room: Room, events: MatrixEvent[]): Partial<IEvent>[] => {
  hydrateCachedEvents({ room, events });

  const serializedEvents = new Map<string, Partial<IEvent>>();
  const eventById = new Map<string, MatrixEvent>();

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) {
      eventById.set(eventId, mEvent);
    }
  });

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    const rawEvent = mEvent.event as Partial<IEvent> | undefined;
    if (!eventId || !rawEvent) return;

    if (isStandaloneSameSenderReplace(mEvent, eventById)) return;

    serializedEvents.set(eventId, cloneRawEvent(rawEvent));
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
