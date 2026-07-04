import { EventTimelineSet, IEvent, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import {
  cloneRawEvent,
  getSerializedRelationEvent,
  isSameSenderEditEvent,
} from '../../utils/editEvent';
import { getLatestEdit, isEventOrderedAfter } from '../../utils/room';
import { countCacheProbe } from './cacheProbe';

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

    // An already-redacted instance keeps its existing redaction. Redaction
    // is idempotent — re-applying a different cached redaction would only
    // churn `redacted_because` metadata away from whatever the live
    // timeline attached (cached state never wins over the instance's
    // current state, invariant I2). This also covers the reload case: a
    // target persisted while redacted carries `unsigned.redacted_because`
    // in its record, so hydration reconstructs it as redacted and returns
    // here. The pick below therefore only runs when NO ground truth about
    // the live-attached redaction exists (standalone redaction records
    // whose target record predates the redaction). Live SDK semantics for
    // duplicate redactions are last-arrival-wins and arrival order is not
    // recoverable from cache, so the D12 ordering is a deterministic proxy
    // for it; any tied redaction prunes the target identically — only the
    // `redacted_because` metadata differs, and no choice available at
    // hydration time can be more faithful.
    if (targetEvent.isRedacted()) return;

    const latestRedaction = getLatestEvent(redactionEvents);
    if (!latestRedaction) return;

    const relationTarget = getRedactedRelationTarget(targetEvent);
    if (relationTarget) redactedRelationTargets.push(relationTarget);

    targetEvent.makeRedacted(latestRedaction, room);
  });

  return redactedRelationTargets;
};

export const applyCachedReplaceRelations = (
  events: MatrixEvent[],
  renderHeldEvents?: Set<MatrixEvent>
): void => {
  const editEventsByTarget = new Map<string, MatrixEvent[]>();
  const eventById = new Map<string, MatrixEvent>();
  // CINNY-207 AC2 render-gap RG1 (2026-07-04): track whether an
  // id-collision winner in `eventById` displaced a render-held
  // sibling. If a render-held instance for the same id appeared
  // earlier in `events` and got overwritten by a fresh clone in a
  // later push, the applier will `makeReplaced` on the fresh clone
  // instead of the render-held one — exactly candidate (a). No
  // behavior change here; only observability.
  const displacedRenderHeldByTargetId = new Set<string>();

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) {
      const previous = eventById.get(eventId);
      if (
        renderHeldEvents &&
        previous &&
        previous !== mEvent &&
        renderHeldEvents.has(previous) &&
        !renderHeldEvents.has(mEvent)
      ) {
        displacedRenderHeldByTargetId.add(eventId);
      }
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

    if (renderHeldEvents) {
      if (renderHeldEvents.has(targetEvent)) {
        countCacheProbe('hydrateApplierMutatedRenderHeldInstance');
      } else if (displacedRenderHeldByTargetId.has(targetEventId)) {
        countCacheProbe('hydrateApplierMutatedFreshInstance');
      }
    }
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
  renderHeldEvents,
}: {
  room: Room;
  events: MatrixEvent[];
  timelineSets?: Array<EventTimelineSet | undefined>;
  seenRelationEventIds?: Set<string>;
  // CINNY-207 AC2 render-gap RG1 (2026-07-04): optional observability
  // marker — set of MatrixEvent instances the render layer is
  // currently holding by reference. Passed only when the caller can
  // identify those instances (e.g. the reconciler passes
  // `cachedPage.hydratedEvents` because those are the exact instances
  // handed to `setSupplementalThreadEvents`). Used purely to bump
  // observability counters (see applyCachedReplaceRelations) — no
  // behavior change.
  renderHeldEvents?: Set<MatrixEvent>;
}): RedactedRelationTarget[] => {
  const redactedRelationTargets = applyCachedRedactions(room, events);
  applyCachedReplaceRelations(events, renderHeldEvents);
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
