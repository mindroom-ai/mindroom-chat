import type { IEvent, MatrixEvent, Room } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk';
import { getSerializedReplacementEvent, isSameSenderEditEvent } from '../../utils/editEvent';
import { getLatestEdit } from '../../utils/room';

export type ReplacementRevision = {
  readonly eventId: string;
  readonly ts: number;
};

export type EventRevisionDescriptor = {
  readonly redacted: boolean;
  readonly replacement?: ReplacementRevision;
  readonly aggregations: Record<string, unknown>;
};

export type RelationSnapshotMode = 'partial' | 'authoritative';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
};

const getRawReplacement = (rawEvent: Partial<IEvent>): Partial<IEvent> | undefined => {
  const relations = (rawEvent.unsigned as Record<string, unknown> | undefined)?.['m.relations'] as
    | Record<string, unknown>
    | undefined;
  const replacement = relations?.[RelationType.Replace];
  if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
    return undefined;
  }
  return replacement as Partial<IEvent>;
};

const withoutRawReplacement = (rawEvent: Partial<IEvent>): Partial<IEvent> => {
  const unsigned = rawEvent.unsigned;
  const relations = unsigned?.['m.relations'];
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) return rawEvent;
  if (!(RelationType.Replace in relations)) return rawEvent;

  const nextRelations = { ...relations };
  delete nextRelations[RelationType.Replace];
  const nextUnsigned = { ...unsigned };
  if (Object.keys(nextRelations).length > 0) {
    nextUnsigned['m.relations'] = nextRelations;
  } else {
    delete nextUnsigned['m.relations'];
  }
  return { ...rawEvent, unsigned: nextUnsigned };
};

const getNonReplacementRelations = (rawEvent: Partial<IEvent>): Record<string, unknown> => {
  const relations = rawEvent.unsigned?.['m.relations'];
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) return {};
  const nextRelations = { ...relations };
  delete nextRelations[RelationType.Replace];
  return nextRelations;
};

const canonicalizeAggregation = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeAggregation(item));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((childKey) => [childKey, canonicalizeAggregation(value[childKey])])
  );
};

const canonicalizeRelationBundle = (relationType: string, value: unknown): unknown => {
  const canonical = canonicalizeAggregation(value);
  if (
    (relationType === RelationType.Annotation || relationType === RelationType.Reference) &&
    isRecord(canonical) &&
    Array.isArray(canonical.chunk)
  ) {
    return {
      ...canonical,
      chunk: [...canonical.chunk].sort((left, right) =>
        stableSerialize(left).localeCompare(stableSerialize(right))
      ),
    };
  }
  return canonical;
};

const canonicalizeRelations = (relations: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.keys(relations)
      .sort()
      .map((relationType) => [
        relationType,
        canonicalizeRelationBundle(relationType, relations[relationType]),
      ])
  );

const mergeNonReplacementRelations = (
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  mode: RelationSnapshotMode = 'partial'
): Record<string, unknown> => {
  const canonicalIncoming = canonicalizeRelations(incoming);
  if (mode === 'authoritative') return canonicalIncoming;
  // Partial SDK serializations may omit unrelated bundles. Add newly seen
  // relation types, but keep an existing type until an explicitly
  // authoritative server snapshot replaces or removes it.
  return { ...canonicalIncoming, ...canonicalizeRelations(current) };
};

const withMergedRelations = (
  base: Partial<IEvent>,
  current: Partial<IEvent>,
  incoming: Partial<IEvent>,
  replacement: Partial<IEvent> | undefined,
  mode: RelationSnapshotMode
): Partial<IEvent> => {
  const unsigned = { ...current.unsigned, ...incoming.unsigned };
  delete unsigned['m.relations'];
  const relations = mergeNonReplacementRelations(
    getNonReplacementRelations(current),
    getNonReplacementRelations(incoming),
    mode
  );
  if (replacement) relations[RelationType.Replace] = replacement;
  if (Object.keys(relations).length > 0) unsigned['m.relations'] = relations;
  if (Object.keys(unsigned).length === 0) {
    const withoutUnsigned = { ...base };
    delete withoutUnsigned.unsigned;
    return withoutUnsigned;
  }
  return { ...base, unsigned };
};

const mergeRedactedRawEvent = (
  redactedBase: Partial<IEvent>,
  current: Partial<IEvent>,
  incoming: Partial<IEvent>,
  mode: RelationSnapshotMode
): Partial<IEvent> => {
  const base = withoutRawReplacement(redactedBase);
  const relations = mergeNonReplacementRelations(
    getNonReplacementRelations(current),
    getNonReplacementRelations(incoming),
    mode
  );
  const unsigned = { ...base.unsigned };
  delete unsigned['m.relations'];
  if (Object.keys(relations).length === 0) return { ...base, unsigned };

  return {
    ...base,
    unsigned: {
      ...unsigned,
      'm.relations': relations,
    },
  };
};

const getReplacementRevision = (
  targetSender: string | undefined,
  replacement: Partial<IEvent> | undefined
): ReplacementRevision | undefined => {
  if (!replacement || replacement.sender !== targetSender) return undefined;
  const eventId = replacement.event_id;
  const ts = replacement.origin_server_ts;
  if (
    typeof eventId !== 'string' ||
    eventId.length === 0 ||
    typeof ts !== 'number' ||
    !Number.isFinite(ts)
  ) {
    return undefined;
  }
  return { eventId, ts };
};

const compareReplacementRevision = (
  candidate: ReplacementRevision | undefined,
  current: ReplacementRevision | undefined
): number => {
  if (!candidate) return current ? -1 : 0;
  if (!current) return 1;
  if (candidate.ts !== current.ts) return candidate.ts > current.ts ? 1 : -1;
  if (candidate.eventId === current.eventId) return 0;
  return candidate.eventId > current.eventId ? 1 : -1;
};

export const describeRawEventRevision = (rawEvent: Partial<IEvent>): EventRevisionDescriptor => ({
  redacted: !!rawEvent.unsigned?.redacted_because,
  replacement: getReplacementRevision(rawEvent.sender, getRawReplacement(rawEvent)),
  aggregations: canonicalizeRelations(getNonReplacementRelations(rawEvent)),
});

export const describeMatrixEventRevision = (event: MatrixEvent): EventRevisionDescriptor => {
  const replacement = getLatestEdit(
    event,
    [event.replacingEvent() ?? undefined, getSerializedReplacementEvent(event)].filter(
      (candidate): candidate is MatrixEvent => isSameSenderEditEvent(event, candidate)
    )
  );

  return {
    redacted: event.isRedacted(),
    replacement: replacement
      ? getReplacementRevision(event.getSender(), replacement.event as Partial<IEvent>)
      : undefined,
    aggregations: canonicalizeRelations(getNonReplacementRelations(event.event as Partial<IEvent>)),
  };
};

export const mergeEventRevisionDescriptors = (
  current: EventRevisionDescriptor,
  incoming: EventRevisionDescriptor
): EventRevisionDescriptor => ({
  redacted: current.redacted || incoming.redacted,
  replacement:
    current.redacted || incoming.redacted
      ? undefined
      : compareReplacementRevision(incoming.replacement, current.replacement) > 0
      ? incoming.replacement
      : current.replacement,
  aggregations: mergeNonReplacementRelations(current.aggregations, incoming.aggregations),
});

export const hasEventRevisionUpgrade = (
  candidate: EventRevisionDescriptor,
  current: EventRevisionDescriptor
): boolean => {
  const redactionUpgrade = candidate.redacted && !current.redacted;
  const replacementUpgrade =
    !current.redacted &&
    !candidate.redacted &&
    compareReplacementRevision(candidate.replacement, current.replacement) > 0;
  return (
    redactionUpgrade ||
    replacementUpgrade ||
    stableSerialize(candidate.aggregations) !== stableSerialize(current.aggregations)
  );
};

/**
 * Compare two observations of one logical event. Redaction is monotonic;
 * otherwise the newest valid same-sender replacement wins by Matrix's
 * timestamp/event-id ordering.
 */
export const compareEventRevisions = (
  candidate: EventRevisionDescriptor,
  current: EventRevisionDescriptor
): number => {
  if (candidate.redacted !== current.redacted) return candidate.redacted ? 1 : -1;
  if (candidate.redacted) return 0;
  return compareReplacementRevision(candidate.replacement, current.replacement);
};

/**
 * Merge two serialized observations of one event without discarding newer
 * unrelated unsigned data. Redaction is monotonic; otherwise only an older
 * bundled replacement is carried forward into the incoming observation.
 */
export const mergeRawEventRevisions = (
  current: Partial<IEvent> | undefined,
  incoming: Partial<IEvent>,
  relationSnapshotMode: RelationSnapshotMode = 'partial'
): Partial<IEvent> => {
  if (!current || current.event_id !== incoming.event_id) {
    return describeRawEventRevision(incoming).redacted ? withoutRawReplacement(incoming) : incoming;
  }

  const currentRevision = describeRawEventRevision(current);
  const incomingRevision = describeRawEventRevision(incoming);
  if (currentRevision.redacted) {
    return mergeRedactedRawEvent(current, current, incoming, relationSnapshotMode);
  }
  if (incomingRevision.redacted) {
    return mergeRedactedRawEvent(incoming, current, incoming, relationSnapshotMode);
  }
  const currentReplacement = getRawReplacement(current);
  const incomingReplacement = getRawReplacement(incoming);
  const replacement =
    compareReplacementRevision(incomingRevision.replacement, currentRevision.replacement) >= 0
      ? incomingRevision.replacement
        ? incomingReplacement
        : undefined
      : currentRevision.replacement
      ? currentReplacement
      : undefined;
  return withMergedRelations(incoming, current, incoming, replacement, relationSnapshotMode);
};

/** Merge a cached/fetched observation into the SDK-owned same-id instance. */
export const mergeSameIdEventRevision = ({
  liveEvent,
  rawEvent,
  mapEvent,
  room,
}: {
  liveEvent: MatrixEvent;
  rawEvent: Partial<IEvent>;
  mapEvent: (rawEvent: Partial<IEvent>) => MatrixEvent;
  room: Room;
}): MatrixEvent => {
  const rawRedactedBecause = rawEvent.unsigned?.redacted_because;
  if (rawRedactedBecause && !liveEvent.isRedacted()) {
    liveEvent.makeRedacted(mapEvent(rawRedactedBecause as Partial<IEvent>), room);
  }

  if (liveEvent.isRedacted()) return liveEvent;

  const incomingEvent = mapEvent(rawEvent);
  const incomingReplacement = getSerializedReplacementEvent(incomingEvent);
  if (!isSameSenderEditEvent(liveEvent, incomingReplacement)) return liveEvent;

  const currentReplacement = liveEvent.replacingEvent() ?? undefined;
  const serializedLiveReplacementCandidate = getSerializedReplacementEvent(liveEvent);
  const serializedLiveReplacement = isSameSenderEditEvent(
    liveEvent,
    serializedLiveReplacementCandidate
  )
    ? serializedLiveReplacementCandidate
    : undefined;
  const latestReplacement = getLatestEdit(
    liveEvent,
    [currentReplacement, serializedLiveReplacement, incomingReplacement].filter(
      (candidate): candidate is MatrixEvent => !!candidate
    )
  );
  if (latestReplacement && latestReplacement !== currentReplacement) {
    liveEvent.makeReplaced(latestReplacement);
  }
  return liveEvent;
};
