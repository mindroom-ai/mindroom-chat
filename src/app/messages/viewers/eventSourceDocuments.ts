import type { MatrixEvent } from 'matrix-js-sdk';

export type EventSourceDocKind = 'event' | 'original' | 'latestEdit' | 'decrypted' | 'encrypted';

export type EventSourceDoc = {
  id: string;
  kind: EventSourceDocKind;
  data: unknown;
  rawJson: string;
};

export type EventSourceBundle = {
  docs: EventSourceDoc[];
  isEdited: boolean;
  isEncrypted: boolean;
};

export type EventSummary = {
  eventId?: string;
  type?: string;
  sender?: string;
  timestamp?: number;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const shallowCloneRecord = (value: unknown): unknown =>
  isPlainRecord(value) ? { ...value } : value;

const sanitizeForJson = (value: unknown, ancestors: Set<object>): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[Circular]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeForJson(item, ancestors));
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) {
        out[key] = sanitizeForJson(entry, ancestors);
      }
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
};

/**
 * Formats any value as indented JSON without throwing on circular references, BigInt values, or
 * throwing getters.
 */
export const safeStringifyJson = (value: unknown): string => {
  try {
    const serialized = JSON.stringify(sanitizeForJson(value, new Set()), null, 2);
    return serialized ?? 'null';
  } catch {
    return JSON.stringify(String(value));
  }
};

const makeDoc = (kind: EventSourceDocKind, data: unknown): EventSourceDoc => ({
  id: kind,
  kind,
  data,
  rawJson: safeStringifyJson(data),
});

const readEffectiveEvent = (mEvent: MatrixEvent): unknown => {
  try {
    return mEvent.getEffectiveEvent?.();
  } catch {
    return undefined;
  }
};

const readEditData = (edit: MatrixEvent): unknown => {
  if (edit.isEncrypted()) {
    return shallowCloneRecord(readEffectiveEvent(edit) ?? edit.event);
  }
  return shallowCloneRecord(edit.event);
};

/**
 * Extracts structured source documents for a Matrix event:
 * - Plain unedited: `[event]`
 * - Encrypted unedited: `[decrypted, encrypted]` when decrypted differs, otherwise `[encrypted]`
 * - Plain edited: `[original, latestEdit]`
 * - Encrypted edited: `[original, latestEdit, encrypted]`
 */
export const buildEventSourceBundle = (mEvent: MatrixEvent): EventSourceBundle => {
  const isEncrypted = Boolean(mEvent.isEncrypted());
  const edit = mEvent.replacingEvent?.() ?? undefined;
  const rawEvent = shallowCloneRecord(mEvent.event);

  if (!isEncrypted && !edit) {
    return {
      docs: [makeDoc('event', rawEvent)],
      isEdited: false,
      isEncrypted: false,
    };
  }

  if (isEncrypted && !edit) {
    const encryptedDoc = makeDoc('encrypted', rawEvent);
    const effective = readEffectiveEvent(mEvent);
    if (effective !== undefined) {
      const decryptedDoc = makeDoc('decrypted', shallowCloneRecord(effective));
      if (decryptedDoc.rawJson !== encryptedDoc.rawJson) {
        return {
          docs: [decryptedDoc, encryptedDoc],
          isEdited: false,
          isEncrypted: true,
        };
      }
    }
    return {
      docs: [encryptedDoc],
      isEdited: false,
      isEncrypted: true,
    };
  }

  if (!edit) {
    return { docs: [makeDoc('event', rawEvent)], isEdited: false, isEncrypted };
  }
  const latestEditData = readEditData(edit);

  if (!isEncrypted) {
    return {
      docs: [makeDoc('original', rawEvent), makeDoc('latestEdit', latestEditData)],
      isEdited: true,
      isEncrypted: false,
    };
  }

  const originalData = shallowCloneRecord(readEffectiveEvent(mEvent) ?? mEvent.event);
  return {
    docs: [
      makeDoc('original', originalData),
      makeDoc('latestEdit', latestEditData),
      makeDoc('encrypted', rawEvent),
    ],
    isEdited: true,
    isEncrypted: true,
  };
};

/** Safely reads top-level Matrix metadata fields from a parsed event document. */
export const extractEventSummary = (data: unknown): EventSummary => {
  if (!isPlainRecord(data)) return {};

  const eventId =
    typeof data.event_id === 'string' && data.event_id.length > 0 ? data.event_id : undefined;
  const type = typeof data.type === 'string' && data.type.length > 0 ? data.type : undefined;
  const sender =
    typeof data.sender === 'string' && data.sender.length > 0 ? data.sender : undefined;
  const timestamp =
    typeof data.origin_server_ts === 'number' &&
    Number.isFinite(data.origin_server_ts) &&
    data.origin_server_ts > 0
      ? data.origin_server_ts
      : undefined;

  return { eventId, type, sender, timestamp };
};
