import type { MatrixClient, Room } from 'matrix-js-sdk';
import { toggleReaction } from './reactionToggle';

/**
 * Answers an agent's question with one of its options, by reacting with the option's key as
 * MindRoom asks. An answer the user already gave stays: a second click never takes it back.
 */
export const answerQuestion = async (
  mx: MatrixClient,
  room: Room,
  threadId: string | undefined,
  question: { eventId: string },
  key: string
): Promise<void> => {
  // The reactions on the question; an option's key is one of them once the user answered.
  const { relations: related } = room.getUnfilteredTimelineSet();
  const relations = related.getChildEventsForEvent(question.eventId, 'm.annotation', 'm.reaction');
  const userId = mx.getUserId();
  const answered = (relations?.getRelations() ?? []).some(
    (reaction) =>
      reaction.getSender() === userId &&
      !reaction.isRedacted() &&
      reaction.getRelation()?.key === key
  );
  if (answered) return;
  await toggleReaction(mx, {
    room,
    threadId,
    targetEventId: question.eventId,
    key,
    ...(relations ? { relations } : {}),
  });
};
