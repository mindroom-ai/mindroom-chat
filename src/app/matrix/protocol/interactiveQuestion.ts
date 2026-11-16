import type { MatrixEvent } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from './agentIdentity';
import { getReadableContent } from '../room';

/** Agent question content (MindRoom's `interactive_prompt_content`). */
export const INTERACTIVE_QUESTION_KEY = 'io.mindroom.interactive';
/** The line MindRoom writes under a question's options in the reply's text. */
export const INTERACTIVE_INSTRUCTION_TEXT = 'React with an emoji or type the number to respond.';

/** One answer an agent offers: the reaction `key` that picks it (an emoji) and its label. */
export type QuestionOption = { key: string; label: string };
export type InteractiveQuestion = { text: string; options: QuestionOption[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const NUMBER_KEY = /^\d+$/;
const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The question a message asks, from its shown content or else its original content. MindRoom
 * keys each option twice, by its emoji (the reaction that answers) and by its number (typed), both
 * to the same value and label; the numbers give the order the reply lists them in, since an
 * object's key order may not survive the homeserver. Without numbers, the emoji keys' order.
 */
export const readInteractiveQuestion = (
  content: Record<string, unknown>,
  originalContent?: Record<string, unknown>
): InteractiveQuestion | undefined => {
  const payload = content[INTERACTIVE_QUESTION_KEY] ?? originalContent?.[INTERACTIVE_QUESTION_KEY];
  if (!isRecord(payload) || !isRecord(payload.options)) return undefined;
  const values = payload.options;
  const labels = isRecord(payload.option_labels) ? payload.option_labels : {};
  const text = typeof payload.question_text === 'string' ? payload.question_text : '';
  const emojiKeys = Object.keys(values).filter(
    (key) => !NUMBER_KEY.test(key) && typeof values[key] === 'string'
  );
  const numbers = Object.keys(values)
    .filter((key) => NUMBER_KEY.test(key))
    .sort((a, b) => Number(a) - Number(b));
  const ordered: string[] = [];
  numbers.forEach((number) => {
    const key = emojiKeys.find(
      (candidate) =>
        !ordered.includes(candidate) &&
        values[candidate] === values[number] &&
        labels[candidate] === labels[number]
    );
    if (key) ordered.push(key);
  });
  const keys = [...ordered, ...emojiKeys.filter((key) => !ordered.includes(key))];
  const options = keys.map((key) => {
    const label = labels[key];
    return { key, label: typeof label === 'string' && label ? label : String(values[key]) };
  });
  if (options.length === 0 || !text) return undefined;
  return { text, options };
};

/** The message a question answers, when MindRoom names it. */
export const readInteractiveSourceEventId = (
  content: Record<string, unknown>,
  originalContent?: Record<string, unknown>
): string | undefined => {
  const payload = content[INTERACTIVE_QUESTION_KEY] ?? originalContent?.[INTERACTIVE_QUESTION_KEY];
  return isRecord(payload) && typeof payload.source_event_id === 'string'
    ? payload.source_event_id
    : undefined;
};

export type QuestionAnswer = { key: string; senderId: string };

/**
 * The answer a question has: the first option reaction from someone who is not a MindRoom agent
 * (the agent puts its options as reactions too), or undefined while none answered.
 */
export const readQuestionAnswer = (
  reactions: readonly MatrixEvent[],
  question: InteractiveQuestion,
  viewerId: string | undefined
): QuestionAnswer | undefined => {
  const keys = new Set(question.options.map((option) => option.key));
  const answer = reactions
    .filter((reaction) => {
      const senderId = reaction.getSender();
      return (
        !!senderId &&
        !reaction.isRedacted() &&
        keys.has(reaction.getRelation()?.key ?? '') &&
        !isMindroomAgentUserIdForViewer(senderId, viewerId)
      );
    })
    .sort((a, b) => a.getTs() - b.getTs())[0];
  const key = answer?.getRelation()?.key;
  const senderId = answer?.getSender();
  return key && senderId ? { key, senderId } : undefined;
};

/**
 * The reaction keys whose chips a MindRoom agent's question hides under it: its options. The
 * question card shows them and the answer, so their chips would only repeat it.
 */
export const questionOptionReactionKeys = (
  targetEvent: MatrixEvent | undefined,
  viewerId: string | undefined
): ReadonlySet<string> => {
  const question =
    targetEvent &&
    readInteractiveQuestion(getReadableContent(targetEvent) as Record<string, unknown>);
  if (!question || !isMindroomAgentUserIdForViewer(targetEvent?.getSender(), viewerId)) {
    return NO_KEYS;
  }
  return new Set(question.options.map((option) => option.key));
};
