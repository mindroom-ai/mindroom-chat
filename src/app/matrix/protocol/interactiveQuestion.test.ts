import { MatrixEvent, RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  questionOptionReactionKeys,
  readInteractiveQuestion,
  readInteractiveSourceEventId,
  readQuestionAnswer,
} from './interactiveQuestion';

const AGENT = '@mindroom_code:x';
const ME = '@alice:x';

// As MindRoom writes it, with the emoji keys in an order other than the options'.
const payload = {
  question_text: 'Which color?',
  options: { '🟢': 'green', '2': 'green', '🔴': 'red', '1': 'red' },
  option_labels: { '🟢': 'Green', '2': 'Green', '🔴': 'Red', '1': 'Red' },
  source_event_id: '$ask',
};
const content = { body: 'Which color?', 'io.mindroom.interactive': payload };

const reaction = (sender: string, key: string, ts: number, redacted = false) => {
  const event = new MatrixEvent({
    event_id: `$${sender}${key}`,
    sender,
    type: 'm.reaction',
    origin_server_ts: ts,
    content: { 'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$q', key } },
  });
  if (redacted) Object.assign(event, { isRedacted: () => true });
  return event;
};

describe('readInteractiveQuestion', () => {
  it('lists the options in their numbers order, keyed by emoji', () => {
    expect(readInteractiveQuestion(content)).toEqual({
      text: 'Which color?',
      options: [
        { key: '🔴', label: 'Red' },
        { key: '🟢', label: 'Green' },
      ],
    });
  });

  it('reads the original content when the shown one has none, and nothing without a question', () => {
    expect(readInteractiveQuestion({ body: 'x' }, content)?.options).toHaveLength(2);
    expect(readInteractiveQuestion({ body: 'x' })).toBeUndefined();
    expect(
      readInteractiveQuestion({ 'io.mindroom.interactive': { ...payload, question_text: '' } })
    ).toBeUndefined();
    expect(readInteractiveSourceEventId(content)).toBe('$ask');
  });
});

describe('readQuestionAnswer', () => {
  const question = readInteractiveQuestion(content)!;

  it("takes the first person's option reaction, not the agent's own or a taken back one", () => {
    const reactions = [
      reaction(AGENT, '🔴', 1),
      reaction(ME, '🔴', 2, true),
      reaction('@bob:x', '👍', 3),
      reaction('@bob:x', '🟢', 5),
      reaction(ME, '🔴', 6),
    ];
    expect(readQuestionAnswer(reactions, question, ME)).toEqual({ key: '🟢', senderId: '@bob:x' });
    expect(readQuestionAnswer(reactions.slice(0, 3), question, ME)).toBeUndefined();
  });
});

describe('questionOptionReactionKeys', () => {
  const message = (sender: string) =>
    new MatrixEvent({ event_id: '$q', sender, type: 'm.room.message', content });

  it("hides the options' chips of a MindRoom agent's question only", () => {
    expect([...questionOptionReactionKeys(message(AGENT), ME)]).toEqual(['🔴', '🟢']);
    expect(questionOptionReactionKeys(message('@bob:x'), ME).size).toBe(0);
    expect(questionOptionReactionKeys(undefined, ME).size).toBe(0);
  });
});
