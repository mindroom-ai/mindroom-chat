import {
  ClientEvent,
  EventStatus,
  EventType,
  MatrixEvent,
  RelationType,
  RoomEvent,
  SyncState,
  type ClientEventHandlerMap,
  type MatrixClient,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { isRecord } from '../../lib/isRecord';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../../lib/safeLocalStorage';

/**
 * Messages the person sent that the server has not confirmed yet, kept in localStorage per
 * account like the composer's drafts, so a reload or a page load elsewhere does not lose them.
 * localStorage rather than IndexedDB: its write is done before the next line runs, so a message
 * sent right before the page goes away is kept too.
 * After the next start they come back as unsent rows, "Not sent" with Retry and Delete; they are
 * never sent again on their own, so a message such as "stop" cannot reach an agent long after it
 * was written. Retry reuses the transaction ID, so the server drops a copy that already arrived.
 */
type UnsentMessage = {
  roomId: string;
  txnId: string;
  content: Record<string, unknown>;
  ts: number;
};

const STORAGE_PREFIX = 'unsentMessages:';
const SENDING_STATUSES = new Set<EventStatus | null>([
  EventStatus.ENCRYPTING,
  EventStatus.QUEUED,
  EventStatus.SENDING,
]);

const storageKey = (userId: string) => `${STORAGE_PREFIX}${userId}`;

const isUnsentMessage = (value: unknown): value is UnsentMessage =>
  isRecord(value) &&
  typeof value.roomId === 'string' &&
  typeof value.txnId === 'string' &&
  typeof value.ts === 'number' &&
  isRecord(value.content);

const readUnsent = (userId: string): UnsentMessage[] => {
  const raw = getStorageItemSafe(getSafeLocalStorage(), storageKey(userId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isUnsentMessage) : [];
  } catch {
    return [];
  }
};

const writeUnsent = (userId: string, messages: UnsentMessage[]): void => {
  const storage = getSafeLocalStorage();
  if (messages.length === 0) removeStorageItemSafe(storage, storageKey(userId));
  else setStorageItemSafe(storage, storageKey(userId), JSON.stringify(messages));
};

/** Forgets the unsent messages of an account, as signing out does with its drafts. */
export const clearUnsentMessages = (userId: string): void => {
  removeStorageItemSafe(getSafeLocalStorage(), storageKey(userId));
};

/**
 * A message worth keeping: text, a long text sent as its file, or an attachment already uploaded.
 * Not an edit, and not an encrypted attachment, whose content holds the key to its file (a long
 * text's file holds only the text, which the drafts keep in the clear too).
 */
const isKeptMessage = (event: MatrixEvent): boolean => {
  if (event.getType() !== 'm.room.message') return false;
  const content = event.getContent();
  if (content['m.relates_to']?.rel_type === RelationType.Replace) return false;
  return content.file === undefined || isRecord(content['io.mindroom.long_text']);
};

const isOnServer = (room: Room, txnId: string): boolean => {
  const sentHere = (event: MatrixEvent) => event.getUnsigned().transaction_id === txnId;
  return (
    room.getLiveTimeline().getEvents().some(sentHere) ||
    room.getThreads().some((thread) => thread.liveTimeline.getEvents().some(sentHere))
  );
};

/** Puts an unsent message back as an unsent local echo, the way the SDK adds one when sending. */
const restoreUnsent = (room: Room, message: UnsentMessage, userId: string) => {
  const event = new MatrixEvent({
    type: EventType.RoomMessage,
    content: message.content,
    event_id: `~${room.roomId}:${message.txnId}`,
    sender: userId,
    room_id: room.roomId,
    origin_server_ts: message.ts,
  });
  const threadId = event.threadRootId;
  const thread = threadId ? room.getThread(threadId) : null;
  if (thread) event.setThread(thread);
  event.setTxnId(message.txnId);
  event.setStatus(EventStatus.NOT_SENT);
  room.addPendingEvent(event, message.txnId);
};

/**
 * Keeps the account's unsent messages in storage while they wait for the server, puts the ones a
 * previous page left behind back as unsent rows once the rooms are known, and asks before the
 * page closes or reloads while anything is still going out. Call before the client starts.
 */
export const keepUnsentMessages = (mx: MatrixClient): (() => void) => {
  const userId = mx.getUserId();
  if (!userId) return () => undefined;
  // The SDK forgets an echo's transaction ID once the server's copy arrives.
  const txnIds = new WeakMap<MatrixEvent, string>();
  // Every event on its way, reactions and edits included; a failed one waits for the person.
  const sending = new Set<MatrixEvent>();

  const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
    if (sending.size === 0 && mx.getCurrentUploads().length === 0) return;
    event.preventDefault();
    // Older Safari and Firefox ask only when a return value is set.
    // eslint-disable-next-line no-param-reassign
    event.returnValue = '';
  };

  const onEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event, room) => {
    if (SENDING_STATUSES.has(event.status)) sending.add(event);
    else sending.delete(event);
    const txnId = event.getTxnId() ?? txnIds.get(event);
    if (!txnId || !isKeptMessage(event)) return;
    txnIds.set(event, txnId);
    const messages = readUnsent(userId);
    const index = messages.findIndex((message) => message.txnId === txnId);
    if (!SENDING_STATUSES.has(event.status) && event.status !== EventStatus.NOT_SENT) {
      if (index >= 0)
        writeUnsent(
          userId,
          messages.filter((_, at) => at !== index)
        );
      return;
    }
    if (index >= 0) return;
    // In the order they were sent, which is the order they come back in.
    writeUnsent(userId, [
      ...messages,
      { roomId: room.roomId, txnId, content: event.getContent(), ts: event.getTs() },
    ]);
  };

  const onSync: ClientEventHandlerMap[ClientEvent.Sync] = (state) => {
    if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;
    mx.removeListener(ClientEvent.Sync, onSync);
    const kept = readUnsent(userId).filter((message) => {
      const room = mx.getRoom(message.roomId);
      // A room this start does not know yet keeps its messages for a later one.
      if (!room) return true;
      if (room.getEventForTxnId(message.txnId)) return true;
      if (isOnServer(room, message.txnId)) return false;
      restoreUnsent(room, message, userId);
      return true;
    });
    writeUnsent(userId, kept);
  };

  mx.on(RoomEvent.LocalEchoUpdated, onEcho);
  mx.on(ClientEvent.Sync, onSync);
  globalThis.addEventListener?.('beforeunload', warnBeforeLeaving);
  return () => {
    mx.removeListener(RoomEvent.LocalEchoUpdated, onEcho);
    mx.removeListener(ClientEvent.Sync, onSync);
    globalThis.removeEventListener?.('beforeunload', warnBeforeLeaving);
  };
};
