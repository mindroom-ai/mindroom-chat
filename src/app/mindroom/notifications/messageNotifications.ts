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
import { matchPath } from 'react-router-dom';
import { isRecord } from '../../utils/isRecord';
import { getCanonicalAliasRoomId, isRoomAlias } from '../../utils/matrix';
import { decodeRouteParam } from '../../pages/pathUtils';
import { DIRECT_ROOM_PATH, HOME_ROOM_PATH, SPACE_ROOM_PATH } from '../../pages/paths';
import { matchesEnum } from '../../utils/matchesEnum';

/** Messages older than this when they arrive are a catch-up after time offline, not news. */
export const MESSAGE_NOTIFY_MAX_AGE_MS = 2 * 60 * 1000;

const STREAM_STATUS_KEY = 'io.mindroom.stream_status';

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

/** The room and thread the window shows, read from the app's address. */
type ViewedPlace = { roomId?: string; threadId?: string };

const relationOf = (event: MatrixEvent): Record<string, unknown> | undefined => {
  // Relations stay unencrypted, so the wire content has them before decryption too.
  const relation: unknown = event.getWireContent()['m.relates_to'];
  return isRecord(relation) ? relation : undefined;
};

/** The thread an event sits in, from its own `m.thread` relation. */
export const getEventThreadId = (event: MatrixEvent): string | undefined => {
  const relation = relationOf(event);
  return relation?.rel_type === RelationType.Thread && typeof relation.event_id === 'string'
    ? relation.event_id
    : undefined;
};

/**
 * A MindRoom agent streams its reply as an `m.notice` (which push rules never notify for) and
 * edits it into an `m.text` once done, marked `io.mindroom.stream_status: completed`. Push rules
 * ignore edits too, so that last edit is where the finished reply notifies. Returns the reply it
 * completes and its final content; any other edit returns undefined.
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
  if (!reply || reply.getOriginalContent().msgtype !== MsgType.Notice) return undefined;
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

  const completed = getCompletedAgentReply(room, event);
  if (relationOf(event)?.rel_type === RelationType.Replace && !completed) return undefined;

  const actions = completed
    ? actionsForFinishedReply(client, completed.reply, completed.content)
    : client.getPushActionsForEvent(event);
  if (!actions?.notify) return undefined;

  const source = completed?.reply ?? event;
  // Read already, here or on another device, before this client heard of it. The room's receipts
  // answer for threads too; a thread's own answer counts every thread as read until the account
  // sent its first threaded receipt in the room.
  if (room.hasUserReadEvent(me, source.getId() ?? eventId)) return undefined;
  return {
    roomId: room.roomId,
    eventId: source.getId() ?? eventId,
    threadId: getEventThreadId(source),
    sender,
    content: completed?.content ?? event.getContent(),
    sound: !!actions.tweaks?.sound,
    highlight: !!actions.tweaks?.highlight,
  };
};

const ROOM_ROUTES = [HOME_ROOM_PATH, DIRECT_ROOM_PATH, SPACE_ROOM_PATH];

/** The room (by ID) and thread a location shows; aliases resolve through the joined rooms. */
export const getViewedPlace = (
  client: MatrixClient,
  location: Pick<Location, 'pathname' | 'search'>
): ViewedPlace => {
  const threadId = new URLSearchParams(location.search).get('threadId') ?? undefined;
  for (const route of ROOM_ROUTES) {
    const encoded = matchPath(route, location.pathname)?.params.roomIdOrAlias;
    if (encoded) {
      const roomIdOrAlias = decodeRouteParam(encoded);
      const roomId = isRoomAlias(roomIdOrAlias)
        ? getCanonicalAliasRoomId(client, roomIdOrAlias)
        : roomIdOrAlias;
      return { roomId, threadId };
    }
  }
  return {};
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
