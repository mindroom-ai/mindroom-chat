import type { MatrixEvent } from 'matrix-js-sdk';

export type EventSourceDocKind =
  'event' | 'original' | 'latestEdit' | 'decrypted' | 'decryptionError' | 'encrypted';

export type EventSourceDoc = { kind: EventSourceDocKind; data: unknown; rawJson: string };
export type EventSourceBundle = {
  docs: [EventSourceDoc, ...EventSourceDoc[]];
  rawAll: string;
  isEdited: boolean;
  isEncrypted: boolean;
};
export type EventSummary = { eventId?: string; type?: string; sender?: string; timestamp?: number };

export const MIN_TIMESTAMP_MS = 1e12;
export const MAX_TIMESTAMP_MS = 1e14;

export const isValidTimestampMs = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= MIN_TIMESTAMP_MS &&
  value <= MAX_TIMESTAMP_MS;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const nullProto = (): Record<string, unknown> => Object.create(null) as Record<string, unknown>;
const isDropped = (v: unknown): boolean =>
  v === undefined || typeof v === 'function' || typeof v === 'symbol';

/** Produces a cycle-free, BigInt-free, `__proto__`-safe JSON snapshot using null-prototype objects. */
export const sanitizeJsonValue = (value: unknown, ancestors: Set<object> = new Set()): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[Circular]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (let i = 0; i < value.length; i += 1) {
        items.push(isDropped(value[i]) ? null : sanitizeJsonValue(value[i], ancestors));
      }
      return items;
    }
    const out = nullProto();
    for (const key of Object.keys(value)) {
      let entry: unknown;
      try {
        entry = (value as Record<string, unknown>)[key];
      } catch {
        entry = '[Unreadable]';
      }
      if (!isDropped(entry)) out[key] = sanitizeJsonValue(entry, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
};

const stringify = (sanitized: unknown): string => {
  try {
    return JSON.stringify(sanitized, null, 2) ?? 'null';
  } catch {
    return JSON.stringify(String(sanitized));
  }
};

export const safeStringifyJson = (value: unknown): string => stringify(sanitizeJsonValue(value));

const makeDoc = (kind: EventSourceDocKind, raw: unknown): EventSourceDoc => {
  const data = sanitizeJsonValue(raw);
  return { kind, data, rawJson: stringify(data) };
};

const readEffective = (mEvent: MatrixEvent): unknown => {
  try {
    return mEvent.getEffectiveEvent?.();
  } catch {
    return undefined;
  }
};

const ENCRYPTION_WIRE_KEYS = new Set([
  'algorithm',
  'ciphertext',
  'device_id',
  'sender_key',
  'session_id',
]);

/** Reconstructs the pre-edit decrypted event, merging `getOriginalContent()` with non-encryption wire keys. */
const readOriginalEffective = (mEvent: MatrixEvent): unknown => {
  const effective = readEffective(mEvent);
  if (!isRecord(effective) || typeof mEvent.getOriginalContent !== 'function') return effective;
  const content = nullProto();
  const orig: unknown = mEvent.getOriginalContent();
  if (isRecord(orig)) Object.assign(content, orig);
  const wire: unknown = mEvent.event.content;
  if (isRecord(wire)) {
    for (const key of Object.keys(wire)) {
      if (!ENCRYPTION_WIRE_KEYS.has(key) && content[key] === undefined) content[key] = wire[key];
    }
  }
  return Object.assign(nullProto(), effective, { content });
};

/** Extracts structured source documents and `rawAll` (preserving `{ encrypted, decrypted }` parity). */
export const buildEventSourceBundle = (mEvent: MatrixEvent): EventSourceBundle => {
  const edit = mEvent.replacingEvent?.() ?? undefined;
  const editDoc = edit
    ? makeDoc('latestEdit', edit.isEncrypted() ? (readEffective(edit) ?? edit.event) : edit.event)
    : undefined;
  const editDocs = editDoc ? [editDoc] : [];
  const withEditRaw = (base: string) => (editDoc ? `${base}\n\n${editDoc.rawJson}` : base);

  if (!mEvent.isEncrypted()) {
    const wireDoc = makeDoc(editDoc ? 'original' : 'event', mEvent.event);
    return {
      docs: [wireDoc, ...editDocs],
      rawAll: withEditRaw(wireDoc.rawJson),
      isEdited: Boolean(editDoc),
      isEncrypted: false,
    };
  }

  const failed = Boolean(mEvent.isDecryptionFailure?.());
  const encryptedDoc = makeDoc('encrypted', mEvent.event);
  const effective = edit ? readOriginalEffective(mEvent) : readEffective(mEvent);
  const effectiveData = sanitizeJsonValue(effective);
  const effectiveRaw = stringify(effectiveData);
  const differs = effective !== undefined && effectiveRaw !== encryptedDoc.rawJson;
  const hasClear =
    !failed &&
    differs &&
    (typeof mEvent.getClearContent !== 'function' || Boolean(mEvent.getClearContent()));
  const rawAll = withEditRaw(
    stringify(
      Object.assign(nullProto(), { encrypted: encryptedDoc.data, decrypted: effectiveData })
    )
  );

  let docs: [EventSourceDoc, ...EventSourceDoc[]] = [encryptedDoc, ...editDocs];
  if (hasClear) {
    docs = [
      { kind: editDoc ? 'original' : 'decrypted', data: effectiveData, rawJson: effectiveRaw },
      ...editDocs,
      encryptedDoc,
    ];
  } else if (failed && differs) {
    docs = [
      { kind: 'decryptionError', data: effectiveData, rawJson: effectiveRaw },
      encryptedDoc,
      ...editDocs,
    ];
  }
  return { docs, rawAll, isEdited: Boolean(editDoc), isEncrypted: true };
};

export const extractEventSummary = (data: unknown): EventSummary => {
  if (!isRecord(data)) return {};
  const str = (key: string) => {
    const v = Object.hasOwn(data, key) ? data[key] : undefined;
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const ts = Object.hasOwn(data, 'origin_server_ts') ? data.origin_server_ts : undefined;
  return {
    eventId: str('event_id'),
    type: str('type'),
    sender: str('sender'),
    timestamp: typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts : undefined,
  };
};
