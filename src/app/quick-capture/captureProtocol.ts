export const CAPTURE_CHANNEL_NAME = 'mindroom.quickCapture';
export type CaptureChip = 'working' | 'needs-you' | 'new';
export type CaptureRoom = { id: string; name: string; direct: boolean };
export type CaptureItem = {
  threadId: string;
  title: string;
  /** The newest reply on one line; empty for a root nobody answered. */
  line: string;
  lineSender?: string;
  /** The newest reply's plain text, at most 600 characters and an ellipsis where it is cut. */
  replyText?: string;
  /** The newest reply as its sender wrote it, whole, where it differs. */
  copyText?: string;
  chip?: CaptureChip;
  /** A pinned thread, which cannot be resolved. */
  pinned?: true;
  resolved: boolean;
  ts: number;
};
export type CaptureState = {
  userId: string;
  roomId: string | null;
  rooms: CaptureRoom[];
  items: CaptureItem[];
};
export type CaptureErrorCode =
  | 'no-room'
  | 'upload-failed'
  | 'send-failed'
  | 'forbidden'
  | 'timeout';
/** What went out of an entry that failed after it started its thread. */
export type CapturePosted = { threadId: string; images: number };
export type CaptureAction =
  | {
      kind: 'send';
      roomId: string;
      text: string;
      images: File[];
      open: boolean;
      /** The thread an earlier, partly sent try of the entry started. */
      threadId?: string;
    }
  | { kind: 'reply'; roomId: string; threadId: string; text: string }
  | { kind: 'resolve'; roomId: string; threadId: string; resolved: boolean }
  | { kind: 'selectRoom'; roomId: string }
  | { kind: 'open'; roomId: string; threadId?: string }
  | { kind: 'read'; roomId: string; threadId: string };
export type CaptureResult =
  | { ok: true; threadId?: string }
  | { ok: false; error: CaptureErrorCode; posted?: CapturePosted };
export type CaptureMessage =
  | { v: 1; type: 'hello' }
  | { v: 1; type: 'request'; id: string; hostId: string; action: CaptureAction }
  | { v: 1; type: 'state'; hostId: string; state: CaptureState }
  | { v: 1; type: 'response'; id: string; hostId: string; result: CaptureResult }
  | { v: 1; type: 'gone'; hostId: string };

/** A fresh id for a host or a request; `crypto.randomUUID` is missing outside a secure context. */
export const newCaptureId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';
const isOptional = (value: unknown, check: (value: unknown) => boolean): boolean =>
  value === undefined || check(value);
const isArrayOf = (value: unknown, check: (item: unknown) => boolean): boolean =>
  Array.isArray(value) && value.every(check);

const CHIPS: readonly unknown[] = ['working', 'needs-you', 'new'];
const ERROR_CODES: readonly unknown[] = [
  'no-room',
  'upload-failed',
  'send-failed',
  'forbidden',
  'timeout',
];

const isRoom = (value: unknown): boolean =>
  isFields(value) &&
  isString(value.id) &&
  isString(value.name) &&
  typeof value.direct === 'boolean';

const isItem = (value: unknown): boolean =>
  isFields(value) &&
  isString(value.threadId) &&
  isString(value.title) &&
  isString(value.line) &&
  isOptional(value.lineSender, isString) &&
  isOptional(value.replyText, isString) &&
  isOptional(value.copyText, isString) &&
  isOptional(value.chip, (chip) => CHIPS.includes(chip)) &&
  isOptional(value.pinned, (pinned) => pinned === true) &&
  typeof value.resolved === 'boolean' &&
  typeof value.ts === 'number';

const isState = (value: unknown): boolean =>
  isFields(value) &&
  isString(value.userId) &&
  (value.roomId === null || isString(value.roomId)) &&
  isArrayOf(value.rooms, isRoom) &&
  isArrayOf(value.items, isItem);

const isAction = (value: unknown): boolean => {
  if (!isFields(value) || !isString(value.roomId)) return false;
  switch (value.kind) {
    case 'send':
      return (
        isString(value.text) &&
        isArrayOf(value.images, (image) => image instanceof File) &&
        typeof value.open === 'boolean' &&
        isOptional(value.threadId, isString)
      );
    case 'reply':
      return isString(value.threadId) && isString(value.text);
    case 'resolve':
      return isString(value.threadId) && typeof value.resolved === 'boolean';
    case 'selectRoom':
      return true;
    case 'open':
      return isOptional(value.threadId, isString);
    case 'read':
      return isString(value.threadId);
    default:
      return false;
  }
};

const isResult = (value: unknown): boolean => {
  if (!isFields(value)) return false;
  if (value.ok === true) return isOptional(value.threadId, isString);
  return (
    value.ok === false &&
    ERROR_CODES.includes(value.error) &&
    isOptional(
      value.posted,
      (posted) =>
        isFields(posted) &&
        isString(posted.threadId) &&
        Number.isInteger(posted.images) &&
        (posted.images as number) >= 0
    )
  );
};

export const isCaptureMessage = (value: unknown): value is CaptureMessage => {
  if (!isFields(value) || value.v !== 1) return false;
  switch (value.type) {
    case 'hello':
      return true;
    case 'request':
      return isString(value.id) && isString(value.hostId) && isAction(value.action);
    case 'state':
      return isString(value.hostId) && isState(value.state);
    case 'response':
      return isString(value.id) && isString(value.hostId) && isResult(value.result);
    case 'gone':
      return isString(value.hostId);
    default:
      return false;
  }
};
