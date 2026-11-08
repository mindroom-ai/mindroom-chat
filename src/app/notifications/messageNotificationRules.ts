/**
 * Which incoming messages notify on this device, and how: a desktop notification, a chime, or
 * both. The account's push rules decide (client-server API, "Push Rules"), evaluated here by the
 * SDK, so a muted room or a rule turned off in the settings stays quiet on this device too.
 */
import {
  EventType,
  KnownMembership,
  MatrixEvent,
  MsgType,
  RelationType,
  type IContent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { isRecord } from '../lib/isRecord';
import type { ViewedPlace } from '../navigation/viewedPlace';
import { matchesEnum } from '../lib/matchesEnum';
import { STREAM_STATUS_KEY, TERMINAL_STREAM_STATUSES } from '../matrix/protocol/aiRun';
import { threadReceiptNamesEvent } from '../event-store/threads/streamFinish';

/** Messages older than this when they arrive are a catch-up after time offline, not news. */
export const MESSAGE_NOTIFY_MAX_AGE_MS = 2 * 60 * 1000;

/** A message that notifies, and what its push actions ask for. */
export type MessageNotice = {
  roomId: string;
  /** The message event; for a finished agent reply, the reply it completed. */
  eventId: string;
  /** The thread the message is in, if any; clicking the notification opens it. */
  threadId?: string;
  sender: string;
  /** The content to preview: the message's, or the finished text of an agent reply. */
  content: IContent;
  /** The push actions set the `sound` tweak. */
  sound: boolean;
  /** The push actions set the `highlight` tweak (a mention or keyword). */
  highlight: boolean;
};

const relationOf = (event: MatrixEvent): Record<string, unknown> | undefined => {
  // Relations stay unencrypted, so the wire content has them before decryption too.
  const relation: unknown = event.getWireContent()['m.relates_to'];
  return isRecord(relation) ? relation : undefined;
};

/** Whether an event edits another (`m.replace`); its relation is readable before decryption. */
export const isEditEvent = (event: MatrixEvent): boolean =>
  relationOf(event)?.rel_type === RelationType.Replace;

/** The thread an event sits in, from its own `m.thread` relation. */
export const getEventThreadId = (event: MatrixEvent): string | undefined => {
  const relation = relationOf(event);
  return relation?.rel_type === RelationType.Thread && typeof relation.event_id === 'string'
    ? relation.event_id
    : undefined;
};

/**
 * Whether a message's own content marks it as an agent reply still being written: a placeholder
 * or a progress update (`io.mindroom.stream_status` other than a terminal one), whatever its
 * msgtype. Such a message never notifies; its last edit does once it completes.
 */
const isUnfinishedReply = (content: IContent): boolean => {
  const status: unknown = content[STREAM_STATUS_KEY];
  return typeof status === 'string' && !TERMINAL_STREAM_STATUSES.has(status.toLowerCase());
};

/**
 * A MindRoom agent sends its reply unfinished first (a placeholder, marked with a stream status
 * that is not terminal) and edits it until an edit marks it `io.mindroom.stream_status:
 * completed`. Push rules ignore edits, so that last edit is where the finished reply notifies.
 * Returns the reply it completes and its final content; any other edit returns undefined.
 */
export const getCompletedAgentReply = (
  room: Room,
  edit: MatrixEvent
): { reply: MatrixEvent; content: IContent } | undefined => {
  const relation = relationOf(edit);
  if (relation?.rel_type !== RelationType.Replace || typeof relation.event_id !== 'string') {
    return undefined;
  }
  const finished: unknown = edit.getContent()['m.new_content'];
  if (!isRecord(finished) || finished[STREAM_STATUS_KEY] !== 'completed') return undefined;
  if (finished.msgtype === MsgType.Notice) return undefined;
  const reply = room.findEventById(relation.event_id);
  // An edit of a message that was sent finished already (an approval, a correction) is no news.
  if (!reply || !isUnfinishedReply(reply.getOriginalContent())) return undefined;
  if (reply.getSender() !== edit.getSender()) return undefined;
  return { reply, content: finished as IContent };
};

const NOTIFYING_TYPES = new Set<string>([EventType.RoomMessage, EventType.Sticker]);

/** The push actions for `content` as if it arrived as a message of its own. */
const actionsForFinishedReply = (
  client: MatrixClient,
  reply: MatrixEvent,
  content: IContent
): ReturnType<MatrixClient['getPushActionsForEvent']> => {
  const unrelated = { ...content };
  delete unrelated['m.relates_to'];
  const standIn = new MatrixEvent({
    type: EventType.RoomMessage,
    room_id: reply.getRoomId(),
    sender: reply.getSender(),
    event_id: reply.getId(),
    origin_server_ts: reply.getTs(),
    content: unrelated,
  });
  return client.getPushActionsForEvent(standIn);
};

/**
 * Whether the account read `event` already, here or on another device. The SDK holds back the
 * edits of a thread this device never opened, so it cannot place a receipt against such an edit
 * (and warns when asked to): only a receipt in its thread that names it reads it then.
 */
const isReadAlready = (
  room: Room,
  userId: string,
  event: MatrixEvent,
  threadId: string | undefined
): boolean => {
  const eventId = event.getId();
  if (!eventId) return false;
  if (room.findEventById(eventId)) return room.hasUserReadEvent(userId, eventId);
  const thread = threadId ? room.getThread(threadId) : null;
  return !!thread && threadReceiptNamesEvent(thread, userId, eventId);
};

/**
 * Whether a live event should notify, and how. Own messages, rooms the account is not in,
 * redacted or undecryptable events, messages read already, and old events (before
 * `now - MESSAGE_NOTIFY_MAX_AGE_MS`) never do; the rest follow the push rules.
 */
export const readMessageNotice = (
  client: MatrixClient,
  room: Room,
  event: MatrixEvent,
  now: number
): MessageNotice | undefined => {
  const sender = event.getSender();
  const eventId = event.getId();
  const me = client.getUserId();
  if (!sender || !eventId || !me || sender === me) return undefined;
  if (!matchesEnum(room.getMyMembership(), KnownMembership.Join)) return undefined;
  if (event.isRedacted() || event.isDecryptionFailure()) return undefined;
  if (!NOTIFYING_TYPES.has(event.getType())) return undefined;
  if (now - event.getTs() > MESSAGE_NOTIFY_MAX_AGE_MS) return undefined;
  if (isUnfinishedReply(event.getContent())) return undefined;

  const completed = getCompletedAgentReply(room, event);
  if (isEditEvent(event) && !completed) return undefined;

  const actions = completed
    ? actionsForFinishedReply(client, completed.reply, completed.content)
    : client.getPushActionsForEvent(event);
  if (!actions?.notify) return undefined;

  const source = completed?.reply ?? event;
  const threadId = getEventThreadId(source);
  // Read already, here or on another device, before this client heard of it. The room's receipts
  // answer for threads too; a thread's own answer counts every thread as read until the account
  // sent its first threaded receipt in the room. A finished reply counts as new from the edit
  // that finished it, so a receipt sent while it streamed, on the reply itself, leaves it unread.
  if (isReadAlready(room, me, event, threadId)) return undefined;
  return {
    roomId: room.roomId,
    eventId: source.getId() ?? eventId,
    threadId,
    sender,
    content: completed?.content ?? event.getContent(),
    sound: !!actions.tweaks?.sound,
    highlight: !!actions.tweaks?.highlight,
  };
};

/**
 * Whether the person sees the message already: the window has focus and shows its room, and
 * with a thread open, that thread. Without a thread open the room's view shows its threads too.
 */
export const isNoticeOnScreen = (
  notice: Pick<MessageNotice, 'roomId' | 'threadId'>,
  place: ViewedPlace,
  windowFocused: boolean
): boolean => {
  if (!windowFocused || place.roomId !== notice.roomId) return false;
  return !place.threadId || place.threadId === notice.threadId;
};
