import { MatrixEvent } from 'matrix-js-sdk';
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { hasTerminalStreamMetadata } from '../../matrix/protocol/aiRun';
import { getEditedEvent } from '../../matrix/room';

/**
 * The edit that finished `reply`'s stream: its newest edit by its sender, as the SDK applied it,
 * as `thread`'s timeline holds it, or as the server bundles it with the reply (`getEditedEvent`),
 * when that edit ends the stream. The server counts the finished reply as new from this edit, and
 * a receipt that reads it names this edit. Only SDK events carry edits.
 */
export const getFinishingEdit = (reply: MatrixEvent, thread?: Thread): MatrixEvent | undefined => {
  if (!(reply instanceof MatrixEvent)) return undefined;
  const replyId = reply.getId();
  if (!replyId) return undefined;
  const edit = getEditedEvent(replyId, reply, thread?.timelineSet);
  return edit && hasTerminalStreamMetadata(edit.getContent()) ? edit : undefined;
};

/** Whether the user's receipt in the thread, public or private, names `eventId`. */
export const threadReceiptNamesEvent = (thread: Thread, userId: string, eventId: string) =>
  [ReceiptType.Read, ReceiptType.ReadPrivate].some(
    (type) => thread.getReadReceiptForUserId(userId, false, type)?.eventId === eventId
  );
