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
  /** Names this version of the document: its kind, and the length and a hash of its JSON. */
  snapshotKey: string;
};

export type EventSourceBundle = {
  docs: [EventSourceDoc, ...EventSourceDoc[]];
  rawAll: string;
  /** Names this version of the bundle: the length and a hash of `rawAll`, and each document's key. */
  bundleKey: string;
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
      // An index loop, not `map`, which would leave a sparse array's holes as holes.
      const items: unknown[] = [];
      for (let i = 0; i < value.length; i += 1) {
        const item: unknown = value[i];
        items.push(
          item === undefined || typeof item === 'function' || typeof item === 'symbol'
            ? null
            : sanitizeJsonValue(item, ancestors)
        );
      }
      return items;
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

/** 32-bit FNV-1a hash of a string's UTF-16 code units, as eight hexadecimal digits. */
const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const makeSanitizedDoc = (
  kind: EventSourceDocKind,
  data: unknown,
  rawJson = stringifySanitized(data)
): EventSourceDoc => ({
  kind,
  data,
  rawJson,
  snapshotKey: `${kind}:${rawJson.length}:${fnv1a(rawJson)}`,
});

const makeDoc = (kind: EventSourceDocKind, rawData: unknown): EventSourceDoc =>
  makeSanitizedDoc(kind, sanitizeJsonValue(rawData));

const makeBundle = (
  docs: [EventSourceDoc, ...EventSourceDoc[]],
  rawAll: string,
  isEncrypted: boolean
): EventSourceBundle => ({
  docs,
  rawAll,
  bundleKey: [`${rawAll.length}:${fnv1a(rawAll)}`, ...docs.map((doc) => doc.snapshotKey)].join('|'),
  isEdited: docs.some((doc) => doc.kind === 'latestEdit'),
  isEncrypted,
});

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

/** Wire content keys of the encrypted event schema, which `getEffectiveEvent()` never copies. */
const ENCRYPTION_WIRE_KEYS = new Set([
  'algorithm',
  'ciphertext',
  'device_id',
  'sender_key',
  'session_id',
]);

/**
 * The effective event of an edited encrypted event as it read before the edit. matrix-js-sdk's
 * `getEffectiveEvent()` puts the edit's `m.new_content` in `content`; here `content` is the
 * pre-edit content (`getOriginalContent()`) plus the keys only the outer wire content holds, such
 * as `m.relates_to`, which `getEffectiveEvent()` backfills the same way.
 */
const readOriginalEffectiveEvent = (mEvent: MatrixEvent): unknown => {
  const effective = readEffectiveEvent(mEvent);
  if (!isPlainRecord(effective) || typeof mEvent.getOriginalContent !== 'function') {
    return effective;
  }
  const content = createNullProtoRecord();
  const originalContent: unknown = mEvent.getOriginalContent();
  if (isPlainRecord(originalContent)) {
    for (const key of Object.keys(originalContent)) {
      content[key] = originalContent[key];
    }
  }
  const wireContent: unknown = mEvent.event.content;
  if (isPlainRecord(wireContent)) {
    for (const key of Object.keys(wireContent)) {
      if (!ENCRYPTION_WIRE_KEYS.has(key) && content[key] === undefined) {
        content[key] = wireContent[key];
      }
    }
  }
  const merged = createNullProtoRecord();
  for (const key of Object.keys(effective)) {
    merged[key] = effective[key];
  }
  merged.content = content;
  return merged;
};

const readEditData = (edit: MatrixEvent): unknown =>
  edit.isEncrypted() ? readEffectiveEvent(edit) ?? edit.event : edit.event;

/**
 * Extracts structured source documents for a Matrix event:
 * - Plain unedited: `[event]`
 * - Plain edited: `[original, latestEdit]`
 * - Encrypted, decrypted: `[decrypted, encrypted]`, or `[original, latestEdit, encrypted]` when edited
 * - Encrypted, decryption failed: `[decryptionError, encrypted]`, then `latestEdit` when edited
 * - Encrypted, decryption pending: `[encrypted]`, then `latestEdit` when edited (ciphertext never
 *   shows under an `original` tab)
 *
 * `rawAll` (Copy All) does not follow the tabs: an encrypted event is always the
 * `{ encrypted, decrypted }` pair, a plain one its wire event, and an edit follows after a blank
 * line.
 */
export const buildEventSourceBundle = (mEvent: MatrixEvent): EventSourceBundle => {
  const edit = mEvent.replacingEvent?.() ?? undefined;
  const latestEditDoc = edit ? makeDoc('latestEdit', readEditData(edit)) : undefined;
  const editDocs = latestEditDoc ? [latestEditDoc] : [];
  const withEditRaw = (baseRaw: string): string =>
    latestEditDoc ? `${baseRaw}\n\n${latestEditDoc.rawJson}` : baseRaw;

  if (!mEvent.isEncrypted()) {
    const wireDoc = makeDoc(latestEditDoc ? 'original' : 'event', mEvent.event);
    return makeBundle([wireDoc, ...editDocs], withEditRaw(wireDoc.rawJson), false);
  }

  const decryptionFailed = Boolean(mEvent.isDecryptionFailure?.());
  const encryptedDoc = makeDoc('encrypted', mEvent.event);
  const effective = edit ? readOriginalEffectiveEvent(mEvent) : readEffectiveEvent(mEvent);
  const effectiveData = sanitizeJsonValue(effective);
  const effectiveRaw = stringifySanitized(effectiveData);
  const effectiveDiffers = effective !== undefined && effectiveRaw !== encryptedDoc.rawJson;
  // A real event says whether it holds clear content; a stand-in without `getClearContent` counts
  // as decrypted when its effective event differs from its wire event.
  const hasDecryptedContent =
    !decryptionFailed &&
    effectiveDiffers &&
    (typeof mEvent.getClearContent !== 'function' || Boolean(mEvent.getClearContent()));
  const rawAll = withEditRaw(buildEncryptedPairJson(encryptedDoc.data, effectiveData));

  if (hasDecryptedContent) {
    const clearDoc = makeSanitizedDoc(
      latestEditDoc ? 'original' : 'decrypted',
      effectiveData,
      effectiveRaw
    );
    return makeBundle([clearDoc, ...editDocs, encryptedDoc], rawAll, true);
  }
  if (decryptionFailed && effectiveDiffers) {
    const errorDoc = makeSanitizedDoc('decryptionError', effectiveData, effectiveRaw);
    return makeBundle([errorDoc, encryptedDoc, ...editDocs], rawAll, true);
  }
  return makeBundle([encryptedDoc, ...editDocs], rawAll, true);
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
