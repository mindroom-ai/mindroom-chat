import {
  ClientEvent,
  MatrixEventEvent,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk';
import {
  ACTIVE_STREAM_STATUSES,
  getStreamStatusFromContent,
  hasTerminalStreamMetadata,
  TERMINAL_STREAM_STATUSES,
} from '../protocol/aiRun';
import { isRecord } from '../../lib/isRecord';

// The SDK puts an edit on its message, and among the message's relations, only once it decrypted
// the edit, and never one it cannot decrypt. So a device without the key of an edit never learned
// of it: a row showed no note on an edit it could not read until a reload brought the server's
// bundled copy (P2-e2ee-F006), a device without the room's keys showed a stopped reply as
// streaming for good (P2-e2ee-F002), and unread counts depended on the order things decrypted in
// (P2-lane2-F005). This keeps, per message, the newest edit the sync brought and the edit that
// finished an agent's streamed reply, readable or not: the relation and MindRoom's stream status
// stay outside the encrypted payload.

/** Entries each map keeps; a full map starts over. */
const REMEMBERED_LIMIT = 5000;

// By message ID, which no two rooms or accounts share for different events.
const newestEdits = new Map<string, MatrixEvent>();
const finishingEdits = new Map<string, MatrixEvent>();
/** Per message, the sender and time of the newest edit that finished it; kept after a redaction. */
const finishes = new Map<string, { sender: string | undefined; ts: number }>();
let client: MatrixClient | undefined;

/**
 * Whether the room of `edit` took a redaction of it while it knew the edit only from its message's
 * bundle (eventRevision.ts), whichever way the redaction came: synced or paginated back.
 */
const isRedactedBundledEdit = (edit: MatrixEvent): boolean => {
  const editId = edit.getId();
  return !!editId && !!client?.getRoom(edit.getRoomId())?.redactedBundledEdits.has(editId);
};

/** Whether `edit` ends its reply's stream, by the status in the clear or the decrypted content. */
const isFinishingEdit = (edit: MatrixEvent): boolean => {
  // Optional calls: thread tests pass edit stand-ins without wire content or decryption state.
  const readable = !edit.isDecryptionFailure?.();
  const status =
    getStreamStatusFromContent(edit.getWireContent?.() ?? {}) ??
    (readable ? getStreamStatusFromContent(edit.getContent()) : undefined);
  if (status) return TERMINAL_STREAM_STATUSES.has(status);
  return readable && hasTerminalStreamMetadata(edit.getContent());
};

/**
 * The newest edit of the message `eventId` the sync brought, readable or not, unless the room took
 * its redaction while it knew the edit only from the message's bundle.
 */
export const getSyncedEdit = (eventId: string): MatrixEvent | undefined => {
  const edit = newestEdits.get(eventId);
  return edit && !isRedactedBundledEdit(edit) ? edit : undefined;
};

/** The edit of `reply` by its sender that finished its stream, if the client has one. */
export const getFinishingEdit = (reply: MatrixEvent): MatrixEvent | undefined => {
  const replyId = reply.getId();
  const candidates = [reply.replacingEvent?.(), replyId ? finishingEdits.get(replyId) : undefined];
  return candidates.reduce<MatrixEvent | undefined>((newest, edit) => {
    if (!edit || edit.getSender() !== reply.getSender() || !isFinishingEdit(edit)) return newest;
    return !newest || edit.getTs() > newest.getTs() ? edit : newest;
  }, undefined);
};

/**
 * Whether the agent's reply `reply` still streams by the server's word: the stream status that its
 * newest edit the client has, or the reply itself before any edit, carries in the clear. A device
 * that signed in after the reply started cannot decrypt the reply, and may hold none of its edits
 * but those since; it reads the state here (P2-e2ee-F009). Undefined when they say neither.
 */
export const isStreamingByServer = (reply: MatrixEvent): boolean | undefined => {
  if (getFinishingEdit(reply)) return false;
  const replyId = reply.getId();
  const edit = replyId ? getSyncedEdit(replyId) : undefined;
  const newest = edit && edit.getSender() === reply.getSender() ? edit : reply;
  const status = getStreamStatusFromContent(newest.getWireContent?.() ?? {});
  if (!status || TERMINAL_STREAM_STATUSES.has(status)) return status ? false : undefined;
  return ACTIVE_STREAM_STATUSES.has(status) ? true : undefined;
};

/**
 * Whether the reply's stream ended: an edit by its sender finished it, and the reply shows no
 * revision since. Redacting that edit takes the reply back to the one before, which still says it
 * streams, but the stream is over all the same (P3-webkit-cards-F004).
 */
export const hasStreamEnded = (reply: MatrixEvent): boolean => {
  const replyId = reply.getId();
  const finish = replyId ? finishes.get(replyId) : undefined;
  if (!finish || finish.sender !== reply.getSender()) return false;
  return finish.ts >= (reply.replacingEvent?.() ?? reply).getTs();
};

const keepNewer = (edits: Map<string, MatrixEvent>, eventId: string, edit: MatrixEvent) => {
  const known = edits.get(eventId);
  if (known && known.getTs() >= edit.getTs() && !isRedactedBundledEdit(known)) return;
  if (edits.size >= REMEMBERED_LIMIT) edits.clear();
  edits.set(eventId, edit);
};

/**
 * Keeps the edits the client's sync brings, in place of another client's; call it before the
 * client starts.
 */
export const keepSyncedEdits = (mx: MatrixClient): (() => void) => {
  newestEdits.clear();
  finishingEdits.clear();
  finishes.clear();
  client = mx;
  const remember = (event: MatrixEvent) => {
    const relation: unknown = event.getWireContent()['m.relates_to'];
    if (!isRecord(relation) || relation.rel_type !== RelationType.Replace) return;
    if (typeof relation.event_id !== 'string' || event.isRedacted()) return;
    if (!isRedactedBundledEdit(event)) keepNewer(newestEdits, relation.event_id, event);
    if (!isFinishingEdit(event)) return;
    keepNewer(finishingEdits, relation.event_id, event);
    const known = finishes.get(relation.event_id);
    if (known && known.ts >= event.getTs()) return;
    if (finishes.size >= REMEMBERED_LIMIT) finishes.clear();
    finishes.set(relation.event_id, { sender: event.getSender(), ts: event.getTs() });
  };
  // A room the account forgets goes with its record of redacted edits, so its newest kept edits
  // go too.
  const forgetRoom = (roomId: string) => {
    newestEdits.forEach((edit, messageId) => {
      if (edit.getRoomId() === roomId) newestEdits.delete(messageId);
    });
  };
  mx.on(ClientEvent.Event, remember);
  mx.on(MatrixEventEvent.Decrypted, remember);
  mx.on(ClientEvent.DeleteRoom, forgetRoom);
  return () => {
    mx.removeListener(ClientEvent.Event, remember);
    mx.removeListener(MatrixEventEvent.Decrypted, remember);
    mx.removeListener(ClientEvent.DeleteRoom, forgetRoom);
  };
};
