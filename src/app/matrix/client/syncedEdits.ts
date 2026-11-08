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
// By the event they redact: each one, as a redaction its sender may not send must not hide another.
const redactions = new Map<string, MatrixEvent[]>();

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
 * The newest edit of the message `eventId` the sync brought, readable or not, but none that someone
 * who may redact it redacted while the client knew it only from the message's bundle.
 */
export const getSyncedEdit = (eventId: string): MatrixEvent | undefined => newestEdits.get(eventId);

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
  const edit = replyId ? newestEdits.get(replyId) : undefined;
  const newest = edit && edit.getSender() === reply.getSender() ? edit : reply;
  const status = getStreamStatusFromContent(newest.getWireContent?.() ?? {});
  if (!status || TERMINAL_STREAM_STATUSES.has(status)) return status ? false : undefined;
  return ACTIVE_STREAM_STATUSES.has(status) ? true : undefined;
};

const keepNewer = (edits: Map<string, MatrixEvent>, eventId: string, edit: MatrixEvent) => {
  const known = edits.get(eventId);
  if (known && known.getTs() >= edit.getTs()) return;
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
  redactions.clear();
  // A redaction marks a kept edit redacted only when the client holds the edit as an event. One the
  // client knows only from its message's bundle is not kept once redacted by someone who may redact
  // it, also when it decrypts later, as the SDK patch's Room.dropRedactedBundledEdit drops it.
  const isRedactedBundle = (edit: MatrixEvent): boolean => {
    const redactors = redactions.get(edit.getId() ?? '');
    if (!redactors) return false;
    const state = mx.getRoom(edit.getRoomId())?.currentState;
    return redactors.some((redaction) =>
      Boolean(state?.maySendRedactionForEvent(edit, redaction.getSender() ?? ''))
    );
  };
  const remember = (event: MatrixEvent) => {
    const redacts = event.isRedaction() ? event.event.redacts : undefined;
    if (redacts) {
      if (redactions.size >= REMEMBERED_LIMIT) redactions.clear();
      redactions.set(redacts, [...(redactions.get(redacts) ?? []), event]);
      newestEdits.forEach((edit, messageId) => {
        if (isRedactedBundle(edit)) newestEdits.delete(messageId);
      });
      return;
    }
    const relation: unknown = event.getWireContent()['m.relates_to'];
    if (!isRecord(relation) || relation.rel_type !== RelationType.Replace) return;
    if (typeof relation.event_id !== 'string' || event.isRedacted()) return;
    if (!isRedactedBundle(event)) keepNewer(newestEdits, relation.event_id, event);
    if (isFinishingEdit(event)) keepNewer(finishingEdits, relation.event_id, event);
  };
  mx.on(ClientEvent.Event, remember);
  mx.on(MatrixEventEvent.Decrypted, remember);
  return () => {
    mx.removeListener(ClientEvent.Event, remember);
    mx.removeListener(MatrixEventEvent.Decrypted, remember);
  };
};
