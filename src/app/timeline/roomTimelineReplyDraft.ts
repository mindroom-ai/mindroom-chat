import { RelationType } from 'matrix-js-sdk';
import type { IEventRelation, Room } from 'matrix-js-sdk';
import { getQuotedContent } from '../matrix/quotedContent';
import type { IReplyDraft } from '../composer/roomInputDrafts';
import { readCanvasNoticeTitle } from '../matrix/protocol/chatUiProtocol';

/** The composer's reply draft for a timeline message, and the thread that reply belongs to. */
export type RoomTimelineReplyDraft = {
  draft: IReplyDraft;
  threadRootId: string;
};

/**
 * The reply draft for the message `eventId` of `room`, or undefined when the room does not have
 * that message, the message has no sender, or its text is not a string.
 *
 * With `startThread` the reply relates to the root of the message's thread, which is the message
 * itself when it is in no thread. Otherwise the reply keeps the message's own relation, read from
 * the wire content so that an encrypted message's cleartext relation counts too: a reply to a
 * message inside a thread stays in that thread.
 */
export const buildRoomTimelineReplyDraft = (
  room: Room,
  eventId: string,
  startThread: boolean
): RoomTimelineReplyDraft | undefined => {
  const message = room.findEventById(eventId);
  const userId = message?.getSender();
  if (!message || !userId) return undefined;

  const content = getQuotedContent(room, eventId, message);
  const text: unknown = content.body;
  if (typeof text !== 'string') return undefined;

  const threadRootId = message.threadRootId || eventId;
  const relation: IEventRelation | undefined = startThread
    ? { rel_type: RelationType.Thread, event_id: threadRootId }
    : message.getWireContent()['m.relates_to'];
  const draft: IReplyDraft = {
    userId,
    eventId,
    body: text,
    formattedBody: content.formatted_body,
    relation,
  };
  // A canvas notice's body is the fallback for other clients; the reply bar names the canvas.
  const canvasTitle = readCanvasNoticeTitle(content);
  if (canvasTitle) draft.previewText = canvasTitle;
  return { draft, threadRootId };
};
