import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  readRoomQuestionAnswer,
  type InteractiveQuestion,
} from '../../matrix/protocol/interactiveQuestion';
import { toggleReaction } from './reactionToggle';

/**
 * Answers an agent's question with one of its options, by reacting with the option's key as
 * MindRoom asks. A question takes one answer: once anyone gave one, nothing is sent, so a second
 * click never takes it back or adds another.
 */
export const answerQuestion = async (
  mx: MatrixClient,
  room: Room,
  threadId: string | undefined,
  question: InteractiveQuestion & { eventId: string },
  key: string
): Promise<void> => {
  if (readRoomQuestionAnswer(room, question.eventId, question, mx.getUserId() ?? undefined)) return;
  // Without an answer the user has no option reaction there to take back: this adds one.
  await toggleReaction(mx, { room, threadId, targetEventId: question.eventId, key });
};
