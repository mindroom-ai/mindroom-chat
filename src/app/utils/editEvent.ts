import { IEvent, MatrixEvent, RelationType } from 'matrix-js-sdk';

type StructuredCloneGlobal = typeof globalThis & {
  structuredClone?: <T>(value: T) => T;
};

export const cloneRawEvent = <TRawEvent extends Partial<IEvent>>(rawEvent: TRawEvent): TRawEvent => {
  const g = globalThis as StructuredCloneGlobal;
  if (typeof g.structuredClone === 'function') {
    return g.structuredClone(rawEvent);
  }

  return JSON.parse(JSON.stringify(rawEvent)) as TRawEvent;
};

const isValidSerializedRelationEvent = (
  relationEvent: unknown
): relationEvent is Partial<IEvent> => {
  if (!relationEvent || typeof relationEvent !== 'object' || Array.isArray(relationEvent)) {
    return false;
  }

  const rawRelationEvent = relationEvent as Partial<IEvent>;
  return (
    typeof rawRelationEvent.event_id === 'string' &&
    rawRelationEvent.event_id.length > 0 &&
    typeof rawRelationEvent.origin_server_ts === 'number' &&
    Number.isFinite(rawRelationEvent.origin_server_ts) &&
    rawRelationEvent.origin_server_ts > 0
  );
};

export const getSerializedRelationEvent = (
  mEvent: MatrixEvent,
  relationType: RelationType
): MatrixEvent | undefined => {
  const relations = mEvent.getUnsigned()?.['m.relations'];
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) return undefined;

  const relationEvent = (relations as Record<string, unknown>)[relationType];
  if (!isValidSerializedRelationEvent(relationEvent)) return undefined;

  return new MatrixEvent(cloneRawEvent(relationEvent) as IEvent);
};

export const getSerializedReplacementEvent = (mEvent: MatrixEvent): MatrixEvent | undefined =>
  getSerializedRelationEvent(mEvent, RelationType.Replace);

export const isSameSenderEditEvent = (
  targetEvent: MatrixEvent,
  editEvent: MatrixEvent | undefined
): editEvent is MatrixEvent => !!editEvent && editEvent.getSender() === targetEvent.getSender();
