import { type IContent, type Room } from 'matrix-js-sdk';
import type { IReplyDraft } from '../../state/room/roomInputDrafts';
import { getEditedEvent } from '../../utils/room';
import { resolveCanonicalMatrixEventId } from './threadRouteUtils';

export type MindroomRoomTimelineReplyDraft = {
  draft: IReplyDraft;
  threadRootId: string;
};

export const resolveMindroomReplyDraftEventIds = (room: Room, draft: IReplyDraft): IReplyDraft => {
  const eventId = resolveCanonicalMatrixEventId(room, draft.eventId) ?? draft.eventId;
  const relation = draft.relation;
  if (!relation) {
    return eventId === draft.eventId ? draft : { ...draft, eventId };
  }

  const relationEventId =
    resolveCanonicalMatrixEventId(room, relation.event_id) ?? relation.event_id;
  const replyEventId = relation['m.in_reply_to']?.event_id;
  const canonicalReplyEventId = resolveCanonicalMatrixEventId(room, replyEventId) ?? replyEventId;
  if (
    eventId === draft.eventId &&
    relationEventId === relation.event_id &&
    canonicalReplyEventId === replyEventId
  ) {
    return draft;
  }

  return {
    ...draft,
    eventId,
    relation: {
      ...relation,
      event_id: relationEventId,
      ...(relation['m.in_reply_to']
        ? {
            'm.in_reply_to': {
              ...relation['m.in_reply_to'],
              event_id: canonicalReplyEventId!,
            },
          }
        : {}),
    },
  };
};

export const buildMindroomRoomTimelineReplyDraft = (
  room: Room,
  eventId: string,
  startThread: boolean
): MindroomRoomTimelineReplyDraft | undefined => {
  const replyEvent = room.findEventById(eventId);
  if (!replyEvent) return undefined;

  const threadRootId = replyEvent.threadRootId ?? eventId;
  const editedReply = getEditedEvent(eventId, replyEvent, room.getUnfilteredTimelineSet());
  const content: IContent = editedReply?.getContent()['m.new_content'] ?? replyEvent.getContent();
  const { body, formatted_body: formattedBody } = content;
  const { 'm.relates_to': relation } = startThread
    ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId } }
    : replyEvent.getWireContent();
  const senderId = replyEvent.getSender();

  if (!senderId || typeof body !== 'string') return undefined;

  return {
    draft: {
      userId: senderId,
      eventId,
      body,
      formattedBody,
      relation,
    },
    threadRootId,
  };
};
