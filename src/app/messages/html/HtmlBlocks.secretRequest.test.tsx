import { EventEmitter } from 'events';
import parse from 'html-react-parser';
import { getDefaultStore } from 'jotai';
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { markerParserOptions } from '../../../test/utils/markerParserOptions';
import type { SecretRequest, SecretRequestStatus } from '../../matrix/protocol/secretRequest';
import { InlineSecretRequestsContext, type InlineSecretRequestPlan } from '../inlineSecretRequests';
import { settingsAtom } from '../../preferences/settings';
import { MessageExtras } from '../MessageExtras';
import { ToolCallsFold } from '../agent-run/ToolCallsFold';
import { ToolCallMessageContext, ToolCallsCogContext } from '../agent-run/toolCallStatus';
import { loadLiveMarkdown, renderLiveMarkdown } from '../live/liveMarkdown';
import { getLiveReplyStore } from '../live/liveReplyStore';
import { useLiveReplyContent } from '../live/useLiveReplyContent';
import { useInlineSecretRequestPlan } from '../useInlineSecretRequestPlan';
import { AGENT, cardEvent, markers, traceEvents } from '../test-utils/secretRequestEvents';
import { resolveHtmlReactParserOptions } from '../../rich-text/htmlReactParserOptions';
import { formatMarkdownTextBodyAsHtml } from './blocks';
import { useToolTraceMarkerParserOptions } from './HtmlBlocks';

const mx = new EventEmitter() as unknown as MatrixClient;
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));

// The line itself is SecretRequestLine.test.tsx's; here only where the reply draws it.
vi.mock('../../approvals/SecretRequestLine', () => ({
  SecretRequestLine: ({ request }: { request: SecretRequest }) => (
    <div data-secret-line={request.status}>secret line</div>
  ),
}));

const html = [
  '<p>Pulling the checkout.</p>',
  '<p>🔧 <code>shell</code> [1]</p>',
  '<p>🔧 <code>shell</code> [2]</p>',
  '<p>🔧 <code>request_secret</code> [3]</p>',
  '<p>🔧 <code>shell</code> [4]</p>',
  '<p>Done.</p>',
].join('\n');

const content = {
  msgtype: 'm.text',
  body: 'Pulling the checkout.',
  format: 'org.matrix.custom.html',
  formatted_body: html,
  'io.mindroom.tool_trace': {
    version: 2,
    events: ['shell', 'shell', 'request_secret', 'shell'].map((name, index) => ({
      type: 'tool_call_completed',
      tool_name: name,
      tool_call_id: `call_${index + 1}`,
    })),
  },
};

const request = (status: SecretRequestStatus): SecretRequest => ({
  kind: 'temporary',
  requestId: 'req-1',
  requesterId: '@bas:example.org',
  env: 'SUDO_PASSWORD',
  keep: { memory: 900 },
  kept: status === 'saved' ? 'memory' : null,
  reason: 'To restart',
  status,
  expiresAt: Date.now() + 15 * 60_000,
});

const secrets = (
  status: SecretRequestStatus,
  index = 3,
  value: SecretRequest = request(status)
): InlineSecretRequestPlan => ({
  hiddenEventIds: new Set(['$card']),
  byReply: new Map([
    [
      '$reply',
      new Map([[index, { eventId: '$card', request: value, agentUserId: '@mindroom_dev:x' }]]),
    ],
  ]),
  waitingReplyIds: new Set(),
});

/** A section of the reply's extras with the marker of its body's third call, as a list item. */
const extras = {
  version: 1 as const,
  sections: [
    {
      title: 'Trace',
      contentType: 'text/markdown' as const,
      content: '- 🔧 `request_secret` [3]',
      collapsed: false,
    },
  ],
};

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

let renderer: ReactTestRenderer | undefined;
const render = (value: InlineSecretRequestPlan, withExtras = false) =>
  act(() => {
    renderer = create(
      <InlineSecretRequestsContext.Provider value={value}>
        <ToolCallMessageContext.Provider
          value={{ eventId: '$reply', roomId: '!room:x', threadId: '$root' }}
        >
          <ToolCallsFold>
            <ToolCallsCogContext.Consumer>{(cog) => cog}</ToolCallsCogContext.Consumer>
            {parse(html, markerParserOptions({}, content))}
            {withExtras && (
              <MessageExtras extras={extras} htmlReactParserOptions={{}} markerContent={content} />
            )}
          </ToolCallsFold>
        </ToolCallMessageContext.Provider>
      </InlineSecretRequestsContext.Provider>
    );
  });

/** The reply's lines in order: each run of calls by its title, and the secret line. */
const lines = () =>
  renderer!.root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        (node.props['data-secret-line'] !== undefined ||
          (node.type === 'button' && node.props['aria-controls'] !== undefined))
    )
    .map((node) =>
      node.props['data-secret-line'] !== undefined
        ? `secret:${node.props['data-secret-line']}`
        : textOf(node)
            .replace(/(shell|request_secret).*$/, '')
            .trim()
    );
const cog = () =>
  renderer!.root.findAll((node) => node.props['data-tool-calls-fold'] !== undefined)[0];

const showToolCalls = (shown: boolean) => {
  const store = getDefaultStore();
  act(() => store.set(settingsAtom, { ...store.get(settingsAtom), showToolCalls: shown }));
};

describe('a secret request in its reply', () => {
  beforeEach(() => showToolCalls(true));
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    showToolCalls(true);
  });

  it('takes the place of the call that asked, splitting its run', () => {
    render(secrets('saved'));
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
  });

  it("takes its call's place in the body only: the extras keep their tool line", () => {
    render(secrets('declined'), true);
    expect(lines()).toEqual([
      'Ran 2 tool calls',
      'secret:declined',
      'Ran 1 tool call',
      'Ran 1 tool call',
    ]);
    expect(
      renderer!.root.findAll((node) => node.props['data-secret-line'] !== undefined)
    ).toHaveLength(1);
  });

  it('starts or ends a run without an empty run beside it', () => {
    render(secrets('saved', 1));
    expect(lines()).toEqual(['secret:saved', 'Ran 3 tool calls']);
    act(() => renderer?.unmount());
    render(secrets('saved', 4));
    expect(lines()).toEqual(['Ran 3 tool calls', 'secret:saved']);
  });

  it('leaves the run whole without a request for one of its calls', () => {
    render({ hiddenEventIds: new Set(), byReply: new Map(), waitingReplyIds: new Set() });
    expect(lines()).toEqual(['Ran 4 tool calls']);
    act(() => renderer?.unmount());
    render(secrets('saved', 9));
    expect(lines()).toEqual(['Ran 4 tool calls']);
  });

  it('hides with the other calls once done, and shows with them when the cog opens', () => {
    showToolCalls(false);
    render(secrets('saved'));

    expect(lines()).toEqual([]);
    expect(cog()?.props['data-state']).toBe('done');
    act(() => {
      renderer!.root.findByProps({ 'aria-expanded': false, title: 'Used 4 tools' }).props.onClick();
    });
    expect(lines()).toEqual(['Ran 2 tool calls', 'secret:saved', 'Ran 1 tool call']);
  });
});

describe('a secret request in a reply that streams', () => {
  const ROOM = '!room:example.org';
  const SID = '1761858000123-0a1b2c3d';
  const CALLS = ['call_1', 'call_2'];
  const room = Object.assign(new EventEmitter(), { roomId: ROOM }) as unknown as Room;
  const NONE = new Set<string>();
  const getContent = (event: MatrixEvent) => event.getContent();
  const BASE = {};

  /** The agent's reply as its edits leave it: streaming, or done with the whole body. */
  const reply = (status: 'streaming' | 'completed', md: string) =>
    new MatrixEvent({
      event_id: '$reply',
      type: 'm.room.message',
      room_id: ROOM,
      sender: AGENT,
      content: {
        msgtype: 'm.text',
        body: md,
        format: 'org.matrix.custom.html',
        formatted_body: renderLiveMarkdown(md),
        'io.mindroom.stream_status': status,
        'io.mindroom.tool_trace': { version: 2, events: traceEvents(CALLS) },
      },
    });

  let seq = 0;
  const frame = (md: string) =>
    act(() => {
      seq += 1;
      getLiveReplyStore(mx).ingest(
        ROOM,
        AGENT,
        {
          reply: '$reply',
          sid: SID,
          seq,
          snapshot: {
            md,
            reasoning: '',
            tools: traceEvents(CALLS),
            status: 'streaming',
            activity: '',
            segments: [],
          },
        },
        Date.now()
      );
    });

  /** The reply's row as the timeline draws it, over its live frames. */
  function Reply({ event }: { event: MatrixEvent }) {
    const { content } = useLiveReplyContent(mx, event, event.getContent());
    const source = useToolTraceMarkerParserOptions(BASE, content);
    const html =
      typeof content.formatted_body === 'string'
        ? content.formatted_body
        : formatMarkdownTextBodyAsHtml(String(content.body));
    return <ToolCallsFold>{parse(html, resolveHtmlReactParserOptions(source))}</ToolCallsFold>;
  }

  /** The thread: the reply, then the rows of the cards its plan leaves. */
  function Thread({ events }: { events: MatrixEvent[] }) {
    const value = useInlineSecretRequestPlan({
      room,
      events,
      getContent,
      ignored: NONE,
      viewerId: '@bas:example.org',
      threadId: '$root',
    });
    const [first, ...rest] = events;
    return (
      <InlineSecretRequestsContext.Provider value={value}>
        <ToolCallMessageContext.Provider
          value={{ eventId: '$reply', roomId: ROOM, threadId: '$root' }}
        >
          {first && <Reply event={first} />}
          {rest
            .filter((event) => !value.hiddenEventIds.has(event.getId() ?? ''))
            .map((event) => (
              <div key={event.getId()} data-card-row={event.getId()} />
            ))}
        </ToolCallMessageContext.Provider>
      </InlineSecretRequestsContext.Provider>
    );
  }

  const show = (events: MatrixEvent[]) =>
    act(() => {
      const tree = <Thread events={events} />;
      if (renderer) renderer.update(tree);
      else renderer = create(tree);
    });
  const cardRows = () =>
    renderer!.root.findAll((node) => node.props['data-card-row'] !== undefined).length;
  const secretLine = () =>
    renderer!.root.find((node) => node.props['data-secret-line'] !== undefined);

  beforeAll(async () => {
    await loadLiveMarkdown();
  });
  beforeEach(() => showToolCalls(true));
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    act(() => getLiveReplyStore(mx).clear());
  });

  it('draws the done request at its call once a frame shows the call, and keeps it to the end', () => {
    // The durable edit stopped before the call that asked; the frames go on.
    const card = cardEvent();
    frame(markers(1));
    show([reply('streaming', markers(1)), card]);
    expect(lines()).toEqual(['Ran 1 tool call']);
    expect(cardRows()).toBe(1);

    frame(`${markers(2)}\n\nTo deploy the demo app`);
    expect(lines()).toEqual(['Ran 1 tool call', 'secret:saved']);
    expect(cardRows()).toBe(0);
    const drawn = secretLine();

    // The stream ends with the durable body: the line stays, the same one.
    show([reply('completed', `${markers(2)}\n\nTo deploy the demo app`), card]);
    act(() => getLiveReplyStore(mx).drop(ROOM, '$reply'));
    expect(lines()).toEqual(['Ran 1 tool call', 'secret:saved']);
    expect(cardRows()).toBe(0);
    // Compared as a boolean: a failed toBe would print the whole fiber tree.
    expect(secretLine() === drawn).toBe(true);
  });
});
