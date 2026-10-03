import { type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import type { IEncryptedFile } from '../../../types/matrix/common';

export const CHAT_UI_ACTION_KEY = 'io.mindroom.ui_action';

export const SETTINGS_SECTIONS = [
  'general',
  'account',
  'notifications',
  'devices',
  'emojis-stickers',
  'developer',
  'about',
] as const;
export type ChatUiSettingsSection = typeof SETTINGS_SECTIONS[number];

type ChatUiTarget = {
  eventId: string;
  agentUserId: string;
  threadId?: string;
};

/** A page too large for the event, uploaded as (encrypted) Matrix media. */
export type ChatUiCanvasDocument = {
  mxcUrl: string;
  encryptedFile?: IEncryptedFile;
  size: number;
};

export type ChatUiCanvas =
  | { title: string; html: string }
  | { title: string; document: ChatUiCanvasDocument };

export const MAX_CANVAS_DOCUMENT_BYTES = 4 * 1024 * 1024;

export type ChatUiAction = ChatUiTarget &
  (
    | { action: 'show_computer' }
    | { action: 'open_settings'; section: ChatUiSettingsSection }
    | { action: 'open_panel'; panel: 'members' }
    // The panel follows later edits of this request, so it keeps the event itself.
    | { action: 'show_canvas'; canvas: ChatUiCanvas; revisionEventId: string; event: MatrixEvent }
  );

const MAX_CANVAS_TITLE_LENGTH = 200;
// The backend sizes canvases against the Matrix event limit; this only bounds hostile input.
const MAX_CANVAS_HTML_LENGTH = 128 * 1024;

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isMxc = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('mxc://');

const readEncryptedFile = (value: unknown): IEncryptedFile | undefined => {
  if (
    !record(value) ||
    !isMxc(value.url) ||
    !record(value.key) ||
    typeof value.key.k !== 'string' ||
    typeof value.iv !== 'string' ||
    !record(value.hashes) ||
    typeof value.hashes.sha256 !== 'string'
  ) {
    return undefined;
  }
  return value as unknown as IEncryptedFile;
};

const readCanvasDocument = (value: unknown): ChatUiCanvasDocument | undefined => {
  if (
    !record(value) ||
    value.mimetype !== 'text/html' ||
    typeof value.size !== 'number' ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > MAX_CANVAS_DOCUMENT_BYTES
  ) {
    return undefined;
  }
  if (value.file !== undefined) {
    const encryptedFile = readEncryptedFile(value.file);
    return encryptedFile && value.url === undefined
      ? { mxcUrl: encryptedFile.url, encryptedFile, size: value.size }
      : undefined;
  }
  return isMxc(value.url) ? { mxcUrl: value.url, size: value.size } : undefined;
};

const readCanvas = (value: unknown): ChatUiCanvas | undefined => {
  if (!record(value) || typeof value.title !== 'string') return undefined;
  const title = value.title.trim();
  if (!title || title.length > MAX_CANVAS_TITLE_LENGTH) return undefined;
  if (typeof value.html === 'string') {
    return value.document === undefined && value.html.length <= MAX_CANVAS_HTML_LENGTH
      ? { title, html: value.html }
      : undefined;
  }
  const document = readCanvasDocument(value.document);
  return document ? { title, document } : undefined;
};

const AUTHORITY_FIELDS = [
  'version',
  'action',
  'requester_id',
  'agent_user_id',
  'room_id',
  'thread_id',
];

type LatestCanvas = {
  canvas: ChatUiCanvas;
  /** The event whose content is shown: the applied edit, or the request itself. */
  revisionEventId: string;
};

/**
 * Canvas updates are edits by the original sender. The SDK applies some edits (server-bundled
 * ones, thread backfill) without checking their sender, so this checks it again, and an edit may
 * change only the canvas itself; anything else keeps the original canvas.
 */
const readLatestCanvas = (
  event: MatrixEvent,
  eventId: string,
  sender: string,
  original: Record<string, unknown>
): LatestCanvas | undefined => {
  const originalCanvas = readCanvas(original.canvas);
  const fallback = originalCanvas
    ? { canvas: originalCanvas, revisionEventId: eventId }
    : undefined;
  const replacement = event.replacingEvent();
  const replacementId = replacement?.getId();
  if (!replacement || !replacementId?.startsWith('$') || replacement.getSender() !== sender) {
    return fallback;
  }
  const newContent = replacement.getContent<Record<string, unknown>>()['m.new_content'];
  const latest = record(newContent) ? newContent[CHAT_UI_ACTION_KEY] : undefined;
  if (!record(latest) || AUTHORITY_FIELDS.some((field) => latest[field] !== original[field])) {
    return fallback;
  }
  const canvas = readCanvas(latest.canvas);
  return canvas ? { canvas, revisionEventId: replacementId } : fallback;
};

/** Read authority from the original Matrix event, never from rendered/edited message text. */
export const readChatUiAction = (
  event: MatrixEvent,
  viewerId: string,
  room: Pick<Room, 'roomId' | 'getMember'>
): ChatUiAction | undefined => {
  const eventId = event.getId();
  const sender = event.getSender();
  if (
    !eventId?.startsWith('$') ||
    !sender ||
    event.getType() !== 'm.room.message' ||
    event.getRoomId() !== room.roomId ||
    event.isRedacted() ||
    event.status ||
    !isMindroomAgentUserIdForViewer(sender, viewerId) ||
    room.getMember(sender)?.membership !== 'join' ||
    room.getMember(viewerId)?.membership !== 'join'
  ) {
    return undefined;
  }

  const content = event.getOriginalContent<Record<string, unknown>>();
  const data = content[CHAT_UI_ACTION_KEY];
  if (
    content.msgtype !== 'm.notice' ||
    (record(content['m.relates_to']) && content['m.relates_to'].rel_type === 'm.replace') ||
    (!!event.replacingEventId() && (!record(data) || data.action !== 'show_canvas')) ||
    !record(data) ||
    data.version !== 1 ||
    data.requester_id !== viewerId ||
    data.agent_user_id !== sender ||
    data.room_id !== room.roomId
  ) {
    return undefined;
  }
  const relation = content['m.relates_to'];
  let threadId: string | undefined;
  if (data.thread_id === null) {
    if (record(relation) && relation.rel_type !== undefined) return undefined;
  } else if (
    typeof data.thread_id === 'string' &&
    data.thread_id.startsWith('$') &&
    record(relation) &&
    relation.rel_type === 'm.thread' &&
    relation.event_id === data.thread_id
  ) {
    threadId = data.thread_id;
  } else {
    return undefined;
  }

  const target: ChatUiTarget = {
    eventId,
    agentUserId: sender,
    threadId,
  };
  if (data.action === 'show_computer') return { ...target, action: 'show_computer' };
  if (
    data.action === 'open_settings' &&
    SETTINGS_SECTIONS.some((section) => section === data.section)
  ) {
    return { ...target, action: 'open_settings', section: data.section as ChatUiSettingsSection };
  }
  if (data.action === 'open_panel' && data.panel === 'members') {
    return { ...target, action: 'open_panel', panel: 'members' };
  }
  if (data.action === 'show_canvas') {
    const latest = readLatestCanvas(event, eventId, sender, data);
    return latest ? { ...target, action: 'show_canvas', ...latest, event } : undefined;
  }
  return undefined;
};
