// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { EventEmitter } from 'events';
import {
  MatrixEvent,
  MatrixEventEvent,
  RelationType,
  type IContent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { RelationsEvent } from 'matrix-js-sdk/lib/models/relations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { RenderMessageContent } from '../content/RenderMessageContent';

const answerQuestion = vi.hoisted(() => vi.fn());
vi.mock('../reactions/answerQuestion', () => ({ answerQuestion }));

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const COLLEAGUE = '@kai:example.org';
const ROOM_ID = '!room:example.org';

const QUESTION_HTML =
  '<p>Which color?</p>\n<ol>\n<li>🔴 Red</li>\n<li>🟢 Green</li>\n</ol>\n' +
  '<p>React with an emoji or type the number to respond.</p>';

const questionContent = (formattedBody: string): IContent => ({
  msgtype: 'm.text',
  body: 'Which color?',
  format: 'org.matrix.custom.html',
  formatted_body: formattedBody,
  'io.mindroom.interactive': {
    question_text: 'Which color?',
    options: { '🔴': 'red', '1': 'red', '🟢': 'green', '2': 'green' },
    option_labels: { '🔴': 'Red', '1': 'Red', '🟢': 'Green', '2': 'Green' },
  },
});

const reaction = (sender: string, key: string) =>
  new MatrixEvent({
    event_id: `$${key}${sender}`,
    sender,
    type: 'm.reaction',
    origin_server_ts: 2,
    content: { 'm.relates_to': { rel_type: RelationType.Annotation, event_id: '$q', key } },
  });

describe('QuestionCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const render = (
    content: IContent,
    reactions: MatrixEvent[] = [],
    {
      sender = AGENT,
      readOnly = false,
      relationsOf,
    }: { sender?: string; readOnly?: boolean; relationsOf?: () => unknown } = {}
  ) => {
    const mEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: ROOM_ID,
      event_id: '$q',
      sender,
      origin_server_ts: 1,
      content,
    });
    const relations = {
      getRelations: () => reactions,
      on: () => undefined,
      removeListener: () => undefined,
    };
    const room = {
      roomId: ROOM_ID,
      getMember: (userId: string) =>
        userId === COLLEAGUE ? { userId, roomId: ROOM_ID, rawDisplayName: 'Kai' } : null,
      getUnfilteredTimelineSet: () => ({
        relations: {
          getChildEventsForEvent: relationsOf ?? (() => (reactions.length ? relations : undefined)),
        },
      }),
    };
    const mx = {
      getUserId: () => VIEWER,
      getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
      on: () => undefined,
      removeListener: () => undefined,
    } as unknown as MatrixClient;
    act(() =>
      root.render(
        <MatrixClientProvider value={mx}>
          <ClientConfigProvider value={{}}>
            <RenderMessageContent
              mEvent={mEvent}
              roomId={ROOM_ID}
              threadId="$root"
              displayName="Helper"
              msgType="m.text"
              ts={1}
              getContent={(() => content) as never}
              urlPreview={false}
              htmlReactParserOptions={{}}
              linkifyOpts={{}}
              readOnly={readOnly}
            />
          </ClientConfigProvider>
        </MatrixClientProvider>
      )
    );
    return mEvent;
  };

  const card = () => container.querySelector<HTMLElement>('[data-question-card]');
  const buttons = () => Array.from(card()?.querySelectorAll('button') ?? []);

  it('takes the place of the question text, between the text around it', () => {
    render(questionContent(`<p>Before.</p>\n${QUESTION_HTML}\n<p>After.</p>`));
    expect(card()?.dataset.questionCard).toBe('waiting');
    expect(card()?.textContent).toContain('Waiting for you');
    expect(card()?.textContent).toContain('Which color?');
    expect(buttons().map((button) => button.textContent)).toEqual(['🔴Red', '🟢Green']);
    expect(container.querySelector('ol')).toBeNull();
    expect(container.textContent).not.toContain('React with an emoji');
    const text = container.textContent ?? '';
    expect(text.indexOf('Before.')).toBeLessThan(text.indexOf('Which color?'));
    expect(text.indexOf('Green')).toBeLessThan(text.indexOf('After.'));
  });

  it('answers with the option reaction and waits for it, and tells when it failed', async () => {
    let fail: (error: Error) => void = () => undefined;
    answerQuestion.mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));
    render(questionContent(QUESTION_HTML));
    act(() => buttons()[1]?.click());
    expect(answerQuestion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roomId: ROOM_ID }),
      '$root',
      expect.objectContaining({ eventId: '$q' }),
      '🟢'
    );
    expect(buttons().every((button) => button.disabled)).toBe(true);
    await act(async () => fail(new Error('refused')));
    expect(card()?.querySelector('[role="alert"]')).not.toBeNull();
    expect(buttons().some((button) => button.disabled)).toBe(false);
  });

  it("marks a person's answer, not the agent's own option reactions", () => {
    render(questionContent(QUESTION_HTML), [reaction(AGENT, '🔴'), reaction(COLLEAGUE, '🟢')]);
    expect(card()?.dataset.questionCard).toBe('answered');
    expect(card()?.textContent).toContain('Answered');
    const [red, green] = buttons() as [HTMLButtonElement, HTMLButtonElement];
    expect(green.getAttribute('aria-pressed')).toBe('true');
    expect(green.textContent).toContain('Kai chose');
    expect(red.getAttribute('aria-pressed')).toBe('false');
    expect(buttons().every((button) => button.disabled)).toBe(true);

    render(questionContent(QUESTION_HTML), [reaction(VIEWER, '🔴')]);
    expect(buttons()[0]?.textContent).toContain('You chose');
  });

  it('follows reactions as they come and go, from the first one on', () => {
    // None until the first reaction creates them, as the SDK does.
    const held: { relations?: EventEmitter & { getRelations: () => MatrixEvent[] } } = {};
    const mEvent = render(questionContent(QUESTION_HTML), [], {
      relationsOf: () => held.relations,
    });
    expect(card()?.dataset.questionCard).toBe('waiting');

    const answer = reaction(COLLEAGUE, '🟢');
    held.relations = Object.assign(new EventEmitter(), { getRelations: () => [answer] });
    act(() => {
      mEvent.emit(MatrixEventEvent.RelationsCreated, RelationType.Annotation, 'm.reaction');
    });
    expect(card()?.dataset.questionCard).toBe('answered');

    vi.spyOn(answer, 'isRedacted').mockReturnValue(true);
    act(() => {
      held.relations?.emit(RelationsEvent.Redaction, answer);
    });
    expect(card()?.dataset.questionCard).toBe('waiting');
  });

  it('takes the place of the block in a reply that has only its Markdown body', () => {
    // Most agent replies: the client formats the body itself, as inline text with line breaks.
    const { format: _format, formatted_body: _html, ...rest } = questionContent('');
    const block =
      'Which color?\n\n1. 🔴 Red\n2. 🟢 Green\n\nReact with an emoji or type the number to respond.';
    render({ ...rest, body: `The choice:\n\n${block}\n\n**Note:** after.` });
    expect(container.querySelectorAll('[data-question-card]')).toHaveLength(1);
    expect(card()?.textContent).toContain('Which color?');
    expect(container.querySelector('ol')).toBeNull();
    expect(container.textContent).not.toContain('React with an emoji');
    const text = container.textContent ?? '';
    expect(text.indexOf('The choice:')).toBeLessThan(text.indexOf('Which color?'));
    expect(text.indexOf('Green')).toBeLessThan(text.indexOf('Note: after.'));
  });

  it('adds only its buttons under a reply that does not show the question as written', () => {
    render(questionContent('<p>Pick one: red or green.</p>'));
    expect(container.textContent).toContain('Pick one: red or green.');
    expect(card()?.textContent).not.toContain('Which color?');
    expect(buttons()).toHaveLength(2);
  });

  it('adds its buttons under a reply whose body yields no HTML', () => {
    // Past the Markdown parser's marker budget the body renders as plain text, with no HTML.
    const body = `Which color?\n\n${'*a* '.repeat(300)}`;
    const { format: _format, formatted_body: _html, ...rest } = questionContent('');
    render({ ...rest, body });
    expect(container.textContent).toContain('*a* *a*');
    expect(card()?.textContent).not.toContain('Which color?');
    expect(buttons()).toHaveLength(2);
  });

  it('shows one card where the real question is when the reply folds its work', () => {
    const example = `<p>For example:</p>\n${QUESTION_HTML}`;
    const html = `${example}\n<p>🔧 <code>read_file</code> [1]</p>\n<p>Now:</p>\n${QUESTION_HTML}`;
    render({
      ...questionContent(html),
      // Long enough to fold its work (`isLongAgentReply`: 6000 characters).
      body: `Which color? ${'x'.repeat(6000)}`,
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'read_file' }],
      },
      'io.mindroom.ai_run': { version: 1, status: 'completed' },
    });
    const cards = () => container.querySelectorAll('[data-question-card]');
    expect(cards()).toHaveLength(1);
    expect(container.textContent).toContain('Now:');
    expect(container.textContent).not.toContain('For example:');

    const worked = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.startsWith('Worked')
    );
    act(() => worked?.click());
    expect(cards()).toHaveLength(1);
    expect(container.textContent).toContain('For example:');
    // The example stays as the reply wrote it.
    expect(container.querySelectorAll('ol')).toHaveLength(1);
    const text = container.textContent ?? '';
    expect(text.indexOf('For example:')).toBeLessThan(text.indexOf('Now:'));
  });

  it('offers no answer where it is read-only, and renders no card for anyone but an agent', () => {
    render(questionContent(QUESTION_HTML), [], { readOnly: true });
    expect(buttons().every((button) => button.disabled)).toBe(true);
    expect(card()?.textContent).not.toContain('Waiting for you');

    render(questionContent(QUESTION_HTML), [], { sender: COLLEAGUE });
    expect(card()).toBeNull();
    expect(container.querySelector('ol')).not.toBeNull();
  });
});
