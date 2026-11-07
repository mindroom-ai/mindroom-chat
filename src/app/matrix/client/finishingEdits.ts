import {
  ClientEvent,
  MatrixEventEvent,
  RelationType,
  type MatrixClient,
  type MatrixEvent,
} from 'matrix-js-sdk';
import {
  getStreamStatusFromContent,
  hasTerminalStreamMetadata,
  TERMINAL_STREAM_STATUSES,
} from '../protocol/aiRun';
import { isRecord } from '../../lib/isRecord';

// The edit that finished an agent's streamed reply says so in its stream status, which MindRoom
// keeps outside the encrypted payload. The SDK puts an edit on its reply only once it decrypted the
// edit, and never one it cannot decrypt, so a device without the room's keys never learned that a
// reply finished or was stopped: it showed it streaming for good (P2-e2ee-F002), and it counted
// unread messages by the order things decrypted in (P2-lane2-F005). This keeps each reply's
// finishing edit as the sync brings it, readable or not.

/** Replies remembered per client; the oldest are forgotten first. */
const REMEMBERED_LIMIT = 5000;

const editsByClient = new WeakMap<MatrixClient, Map<string, MatrixEvent>>();

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

/** The edit of `reply` by its sender that finished its stream, if the client has one. */
export const getFinishingEdit = (
  mx: MatrixClient | undefined,
  reply: MatrixEvent
): MatrixEvent | undefined => {
  const replyId = reply.getId();
  const candidates = [
    reply.replacingEvent?.(),
    mx && replyId ? editsByClient.get(mx)?.get(replyId) : undefined,
  ];
  return candidates.reduce<MatrixEvent | undefined>((newest, edit) => {
    if (!edit || edit.getSender() !== reply.getSender() || !isFinishingEdit(edit)) return newest;
    return !newest || edit.getTs() > newest.getTs() ? edit : newest;
  }, undefined);
};

/** Keeps the finishing edits the client receives; call it before the client starts. */
export const keepFinishingEdits = (mx: MatrixClient): (() => void) => {
  const edits = new Map<string, MatrixEvent>();
  editsByClient.set(mx, edits);
  const remember = (event: MatrixEvent) => {
    // Relations stay unencrypted, so the wire content has them before decryption too.
    const relation: unknown = event.getWireContent()['m.relates_to'];
    if (!isRecord(relation) || relation.rel_type !== RelationType.Replace) return;
    if (typeof relation.event_id !== 'string' || !isFinishingEdit(event)) return;
    const known = edits.get(relation.event_id);
    if (known && known.getTs() >= event.getTs()) return;
    if (edits.size >= REMEMBERED_LIMIT) edits.clear();
    edits.set(relation.event_id, event);
  };
  mx.on(ClientEvent.Event, remember);
  mx.on(MatrixEventEvent.Decrypted, remember);
  return () => {
    mx.removeListener(ClientEvent.Event, remember);
    mx.removeListener(MatrixEventEvent.Decrypted, remember);
    if (editsByClient.get(mx) === edits) editsByClient.delete(mx);
  };
};
