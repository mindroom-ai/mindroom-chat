import type { MatrixEvent } from 'matrix-js-sdk';

export type EventSourceDocKind =
  | 'event'
  | 'original'
  | 'latestEdit'
  | 'decrypted'
  | 'decryptionError'
  | 'encrypted';

export type EventSourceDoc = {
  kind: EventSourceDocKind;
  data: unknown;
  rawJson: string;
};

export type EventSourceBundle = {
  docs: [EventSourceDoc, ...EventSourceDoc[]];
  rawAll: string;
  isEdited: boolean;
  isEncrypted: boolean;
};

export type EventSummary = {
  eventId?: string;
  type?: string;
  sender?: string;
  timestamp?: number;
};

export const MIN_TIMESTAMP_MS = 1e12;
export const MAX_TIMESTAMP_MS = 1e14;

/** Whether `value` is a finite millisecond epoch timestamp safely within `Intl.DateTimeFormat` bounds. */
export const isValidTimestampMs = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= MIN_TIMESTAMP_MS &&
  value <= MAX_TIMESTAMP_MS;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const createNullProtoRecord = (): Record<string, unknown> =>
  Object.create(null) as Record<string, unknown>;

/**
 * Produces a cycle-free, BigInt-free, `__proto__`-safe JSON snapshot using null-prototype objects
 * so the JSON tree, Raw view, Copy All, and per-field copy share one identical representation.
 */
export const sanitizeJsonValue = (value: unknown, ancestors: Set<object> = new Set()): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[Circular]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
          return null;
        }
        return sanitizeJsonValue(item, ancestors);
      });
    }
    const out = createNullProtoRecord();
    for (const key of Object.keys(value)) {
      let entry: unknown;
      try {
        entry = (value as Record<string, unknown>)[key];
      } catch {
        entry = '[Unreadable]';
      }
      if (entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol') {
        out[key] = sanitizeJsonValue(entry, ancestors);
      }
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
};

const stringifySanitized = (sanitized: unknown): string => {
  try {
    const serialized = JSON.stringify(sanitized, null, 2);
    return serialized ?? 'null';
  } catch {
    return JSON.stringify(String(sanitized));
  }
};

/**
 * Formats any value as indented JSON without throwing on circular references, BigInt values,
 * throwing getters, or `__proto__` keys.
 */
export const safeStringifyJson = (value: unknown): string =>
  stringifySanitized(sanitizeJsonValue(value));

const makeDoc = (kind: EventSourceDocKind, rawData: unknown): EventSourceDoc => {
  const data = sanitizeJsonValue(rawData);
  return {
    kind,
    data,
    rawJson: stringifySanitized(data),
  };
};

const buildEncryptedPairJson = (encryptedData: unknown, decryptedData: unknown): string => {
  const pair = createNullProtoRecord();
  pair.encrypted = encryptedData;
  pair.decrypted = decryptedData;
  return stringifySanitized(pair);
};

const readEffectiveEvent = (mEvent: MatrixEvent): unknown => {
  try {
    return mEvent.getEffectiveEvent?.();
  } catch {
    return undefined;
  }
};

const readOriginalEffectiveEvent = (mEvent: MatrixEvent): unknown => {
  const effective = readEffectiveEvent(mEvent);
  if (isPlainRecord(effective) && typeof mEvent.getOriginalContent === 'function') {
    const merged = createNullProtoRecord();
    for (const key of Object.keys(effective)) {
      merged[key] = effective[key];
    }
    merged.content = mEvent.getOriginalContent();
    return merged;
  }
  return effective ?? mEvent.event;
};

const readEditData = (edit: MatrixEvent): unknown =>
  edit.isEncrypted() ? readEffectiveEvent(edit) ?? edit.event : edit.event;

/**
 * Extracts structured source documents for a Matrix event:
 * - Plain unedited: `[event]`
 * - Encrypted unedited: `[decrypted | decryptionError, encrypted]` when effective differs, otherwise `[encrypted]`
 * - Plain edited: `[original, latestEdit]`
 * - Encrypted edited: `[original | decryptionError, latestEdit, encrypted]`
 */
export const buildEventSourceBundle = (mEvent: MatrixEvent): EventSourceBundle => {
  const isEncrypted = Boolean(mEvent.isEncrypted());
  const edit = mEvent.replacingEvent?.() ?? undefined;
  const decryptionFailed = Boolean(mEvent.isDecryptionFailure?.());

  if (!edit) {
    if (!isEncrypted) {
      const eventDoc = makeDoc('event', mEvent.event);
      return {
        docs: [eventDoc],
        rawAll: eventDoc.rawJson,
        isEdited: false,
        isEncrypted: false,
      };
    }

    const encryptedDoc = makeDoc('encrypted', mEvent.event);
    const effective = readEffectiveEvent(mEvent);
    if (effective !== undefined) {
      const effectiveDoc = makeDoc(decryptionFailed ? 'decryptionError' : 'decrypted', effective);
      if (effectiveDoc.rawJson !== encryptedDoc.rawJson) {
        return {
          docs: [effectiveDoc, encryptedDoc],
          rawAll: buildEncryptedPairJson(encryptedDoc.data, effectiveDoc.data),
          isEdited: false,
          isEncrypted: true,
        };
      }
    }
    return {
      docs: [encryptedDoc],
      rawAll: encryptedDoc.rawJson,
      isEdited: false,
      isEncrypted: true,
    };
  }

  const latestEditDoc = makeDoc('latestEdit', readEditData(edit));

  if (!isEncrypted) {
    const originalDoc = makeDoc('original', mEvent.event);
    return {
      docs: [originalDoc, latestEditDoc],
      rawAll: `${originalDoc.rawJson}\n\n${latestEditDoc.rawJson}`,
      isEdited: true,
      isEncrypted: false,
    };
  }

  const originalDoc = makeDoc(
    decryptionFailed ? 'decryptionError' : 'original',
    readOriginalEffectiveEvent(mEvent)
  );
  const encryptedDoc = makeDoc('encrypted', mEvent.event);
  const encryptedAndDecrypted = buildEncryptedPairJson(encryptedDoc.data, originalDoc.data);
  return {
    docs: [originalDoc, latestEditDoc, encryptedDoc],
    rawAll: `${encryptedAndDecrypted}\n\n${latestEditDoc.rawJson}`,
    isEdited: true,
    isEncrypted: true,
  };
};

/** Safely reads top-level Matrix metadata fields from a parsed event document. */
export const extractEventSummary = (data: unknown): EventSummary => {
  if (!isPlainRecord(data)) return {};

  const rawEventId = Object.hasOwn(data, 'event_id') ? data.event_id : undefined;
  const rawType = Object.hasOwn(data, 'type') ? data.type : undefined;
  const rawSender = Object.hasOwn(data, 'sender') ? data.sender : undefined;
  const rawTimestamp = Object.hasOwn(data, 'origin_server_ts') ? data.origin_server_ts : undefined;

  const eventId = typeof rawEventId === 'string' && rawEventId.length > 0 ? rawEventId : undefined;
  const type = typeof rawType === 'string' && rawType.length > 0 ? rawType : undefined;
  const sender = typeof rawSender === 'string' && rawSender.length > 0 ? rawSender : undefined;
  const timestamp =
    typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp) && rawTimestamp > 0
      ? rawTimestamp
      : undefined;

  return { eventId, type, sender, timestamp };
};
