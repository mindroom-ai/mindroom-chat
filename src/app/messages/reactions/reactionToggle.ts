import { EventType, RelationType, type MatrixClient, type Relations, type Room } from 'matrix-js-sdk';
import { discardFailedLocalEcho } from '../../matrix/protocol/pendingLocalEcho';

type ReactionToggle = {
  room: Room;
  /** The thread the message is in, for a reaction to a thread reply. */
  threadId?: string;
  targetEventId: string;
  key: string;
  /** The shortcode of a custom emoji, which other clients show as its name. */
  shortcode?: string;
  /** The reactions the message has, to find the user's own. */
  relations?: Relations;
  /** Sends the reaction again after taking back the user's own, as a Stop for a later run does. */
  resend?: boolean;
};

/** The ID of the user's own reaction `key` among `relations`, unless it was taken back. */
const ownReactionId = (relations: Relations | undefined, key: string, userId: string | null) => {
  const reactions = relations
    ?.getSortedAnnotationsByKey()
    ?.find(([annotationKey]) => annotationKey === key)?.[1];
  const own =
    reactions && [...reactions].find((event) => event.getSender() === userId && !event.isRedacted());
  return own?.getId();
};

/**
 * Adds the user's reaction `key` to a message, or takes it back when they already reacted with
 * it. The client shows either change before the server confirms it, so when the server refuses,
 * the local echo is dropped (no reaction that only this user sees, no redaction stuck as unsent)
 * and the promise rejects for the caller to tell the user.
 */
export const toggleReaction = async (
  mx: MatrixClient,
  { room, threadId, targetEventId, key, shortcode, relations, resend }: ReactionToggle
): Promise<void> => {
  const ownId = ownReactionId(relations, key, mx.getUserId());
  let txnId = mx.makeTxnId();
  try {
    if (ownId) {
      await mx.redactEvent(room.roomId, ownId, txnId);
      if (!resend) return;
      // The server refuses a second equal reaction, so the earlier one goes first.
      txnId = mx.makeTxnId();
    }
    const content = {
      'm.relates_to': { rel_type: RelationType.Annotation, event_id: targetEventId, key },
      ...(shortcode ? { shortcode } : {}),
    };
    await mx.sendEvent(room.roomId, threadId ?? null, EventType.Reaction, content as never, txnId);
  } catch (error) {
    discardFailedLocalEcho(mx, room.getEventForTxnId(txnId) ?? undefined);
    throw error;
  }
};
