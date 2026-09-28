import { IEvent, MatrixEvent, RelationType } from 'matrix-js-sdk';

type StructuredCloneGlobal = typeof globalThis & {
  structuredClone?: <T>(value: T) => T;
};

export const cloneRawEvent = <TRawEvent extends Partial<IEvent>>(
  rawEvent: TRawEvent
): TRawEvent => {
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

const getRawSerializedRelationEvent = (
  mEvent: MatrixEvent,
  relationType: RelationType
): Partial<IEvent> | undefined => {
  const relations = mEvent.getUnsigned()?.['m.relations'];
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) return undefined;

  const relationEvent = (relations as Record<string, unknown>)[relationType];
  return isValidSerializedRelationEvent(relationEvent) ? relationEvent : undefined;
};

export const getSerializedRelationEvent = (
  mEvent: MatrixEvent,
  relationType: RelationType
): MatrixEvent | undefined => {
  const relationEvent = getRawSerializedRelationEvent(mEvent, relationType);
  return relationEvent ? new MatrixEvent(cloneRawEvent(relationEvent) as IEvent) : undefined;
};

export const getSerializedReplacementEvent = (mEvent: MatrixEvent): MatrixEvent | undefined =>
  getSerializedRelationEvent(mEvent, RelationType.Replace);

/**
 * The bundled replacement wrapped without copying it, for code that only reads
 * it and never keeps it. Callers must not write to it, decrypt it or attach
 * it to another event: it shares the target's unsigned data. The MatrixEvent
 * constructor only re-interns equal strings in the raw object.
 */
export const getSerializedReplacementEventView = (mEvent: MatrixEvent): MatrixEvent | undefined => {
  const relationEvent = getRawSerializedRelationEvent(mEvent, RelationType.Replace);
  return relationEvent ? new MatrixEvent(relationEvent as IEvent) : undefined;
};

export const isSameSenderEditEvent = (
  targetEvent: MatrixEvent,
  editEvent: MatrixEvent | undefined
): editEvent is MatrixEvent => !!editEvent && editEvent.getSender() === targetEvent.getSender();
