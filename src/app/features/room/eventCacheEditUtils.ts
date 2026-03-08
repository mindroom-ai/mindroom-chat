import { IEvent, MatrixEvent, RelationType } from 'matrix-js-sdk';
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

export const serializeEventsForCache = (events: MatrixEvent[]): Partial<IEvent>[] => {
  const serializedEvents = new Map<string, Partial<IEvent>>();
  const eventById = new Map<string, MatrixEvent>();

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    const rawEvent = mEvent.event as Partial<IEvent> | undefined;
    if (!eventId || !rawEvent) return;

    serializedEvents.set(eventId, cloneRawEvent(rawEvent));
    eventById.set(eventId, mEvent);
  });

  applyCachedReplaceRelations(events);

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
