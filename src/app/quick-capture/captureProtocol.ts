export const CAPTURE_CHANNEL_NAME = 'mindroom.quickCapture';
export type CaptureChip = 'working' | 'needs-you' | 'new';
export type CaptureRoom = { id: string; name: string; direct: boolean };
export type CaptureItem = {
  threadId: string;
  title: string;
  /** The newest reply on one line; empty for a root nobody answered. */
  line: string;
  lineSender?: string;
  /** The newest reply's plain text, at most 600 characters. */
  replyText?: string;
  chip?: CaptureChip;
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
export type CaptureAction =
  | { kind: 'send'; roomId: string; text: string; images: File[]; open: boolean }
  | { kind: 'reply'; roomId: string; threadId: string; text: string }
  | { kind: 'resolve'; roomId: string; threadId: string; resolved: boolean }
  | { kind: 'selectRoom'; roomId: string }
  | { kind: 'open'; roomId: string; threadId?: string };
export type CaptureResult =
  | { ok: true; threadId?: string }
  | { ok: false; error: CaptureErrorCode };
export type CaptureMessage =
  | { v: 1; type: 'hello' }
  | { v: 1; type: 'request'; id: string; hostId: string; action: CaptureAction }
  | { v: 1; type: 'state'; hostId: string; state: CaptureState }
  | { v: 1; type: 'response'; id: string; hostId: string; result: CaptureResult }
  | { v: 1; type: 'gone'; hostId: string };

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
  isOptional(value.chip, (chip) => CHIPS.includes(chip)) &&
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
        typeof value.open === 'boolean'
      );
    case 'reply':
      return isString(value.threadId) && isString(value.text);
    case 'resolve':
      return isString(value.threadId) && typeof value.resolved === 'boolean';
    case 'selectRoom':
      return true;
    case 'open':
      return isOptional(value.threadId, isString);
    default:
      return false;
  }
};

const isResult = (value: unknown): boolean => {
  if (!isFields(value)) return false;
  if (value.ok === true) return isOptional(value.threadId, isString);
  return value.ok === false && ERROR_CODES.includes(value.error);
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
