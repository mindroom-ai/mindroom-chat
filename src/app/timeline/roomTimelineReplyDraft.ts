import { RelationType } from 'matrix-js-sdk';
import type { IContent, IEventRelation, MatrixEvent, Room } from 'matrix-js-sdk';
import { getEditedEvent } from '../matrix/room';
import type { IReplyDraft } from '../composer/roomInputDrafts';
import { readCanvasNoticeTitle } from '../matrix/protocol/chatUiProtocol';

/** The composer's reply draft for a timeline message, and the thread that reply belongs to. */
export type MindroomRoomTimelineReplyDraft = {
  draft: IReplyDraft;
  threadRootId: string;
};

const isContentRecord = (value: unknown): value is IContent =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The content a reply quotes: the replacement content of the message's newest edit when there is
 * one, otherwise the message's own content (the decrypted one, for an encrypted message).
 */
const contentToQuote = (room: Room, eventId: string, message: MatrixEvent): IContent => {
  const edit = getEditedEvent(eventId, message, room.getUnfilteredTimelineSet());
  const replacement: unknown = edit?.getContent()['m.new_content'];
  return isContentRecord(replacement) ? replacement : message.getContent();
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
export const buildMindroomRoomTimelineReplyDraft = (
  room: Room,
  eventId: string,
  startThread: boolean
): MindroomRoomTimelineReplyDraft | undefined => {
  const message = room.findEventById(eventId);
  const userId = message?.getSender();
  if (!message || !userId) return undefined;

  const content = contentToQuote(room, eventId, message);
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
