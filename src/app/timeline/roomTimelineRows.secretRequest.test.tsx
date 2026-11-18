// @vitest-environment jsdom
import { EventEmitter } from 'events';
import parse from 'html-react-parser';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type { VirtualItem } from '@tanstack/react-virtual';
import { MatrixEvent, type EventTimelineSet, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markerParserOptions } from '../../test/utils/markerParserOptions';
import { SecretRequestCard } from '../approvals/SecretRequestCard';
import { ClientConfigProvider } from '../config/useClientConfig';
import {
  MINDROOM_SECRET_REQUEST_KEY,
  parseSecretRequestContent,
} from '../matrix/protocol/secretRequest';
import { ToolCallMessageContext } from '../messages/agent-run/toolCallStatus';
import {
  InlineSecretRequestsContext,
  useDrawnSecretRequestIds,
} from '../messages/inlineSecretRequests';
import { useInlineSecretRequestPlan } from '../messages/useInlineSecretRequestPlan';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';
import { renderTimelineTiles } from './roomTimelineRows';

const ROOM = '!room:example.org';
const ROOT = '$root';
const ALICE = '@alice:example.org';
const AGENT = '@mindroom_dev:example.org';

const mx = vi.hoisted(() => ({
  getUserId: () => '@alice:example.org',
  getRoom: () => ({ getMember: () => null, getJoinedMembers: () => [] }),
  on: () => undefined,
  removeListener: () => undefined,
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
vi.mock('../computer/useAgentServers', () => ({
  useOpenIdBinding: () => true,
  useRoomAgentServers: () => [],
}));

const event = (id: string, sender: string, content: Record<string, unknown>) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender,
    room_id: ROOM,
    origin_server_ts: 1_700_000_000_000,
    content,
  });

const NAMES = ['shell', 'shell', 'request_secret', 'shell'];
/** The agent's reply as its row shows it: its first `calls` tool calls, then `text`. */
const replyContent = (calls: number, text: string, status?: string) => ({
  msgtype: 'm.text',
  body: 'To deploy the demo app',
  format: 'org.matrix.custom.html',
  formatted_body: [
    '<p>To deploy the demo app</p>',
    ...NAMES.slice(0, calls).map((name, index) => `<p>🔧 <code>${name}</code> [${index + 1}]</p>`),
    `<p>${text}</p>`,
  ].join('\n'),
  'io.mindroom.tool_trace': {
    version: 2,
    events: NAMES.slice(0, calls).map((name, index) => ({
      type: 'tool_call_completed',
      tool_name: name,
      tool_call_id: `call_${index + 1}`,
    })),
  },
  ...(status ? { 'io.mindroom.stream_status': status } : {}),
});

/** The agent's card for the reply's third call, as its row shows it. */
const card = (status: 'pending' | 'saved') =>
  event('$card', AGENT, {
    msgtype: 'm.notice',
    body: 'Secret needed',
    [MINDROOM_SECRET_REQUEST_KEY]: {
      request_id: 'req-1',
      requester_id: ALICE,
      env: 'EXAMPLE_TOKEN',
      keep: { memory: 900 },
      ...(status === 'saved' ? { kept: 'memory' } : {}),
      reason: 'To deploy the demo app',
      status,
      expires_at: Date.now() + 15 * 60_000,
      response_event_id: '$reply',
      tool_call_id: 'call_3',
    },
  });

const root$ = event(ROOT, ALICE, { msgtype: 'm.text', body: 'Deploy the demo app' });
// What the homeserver has of the reply while it streams: the edit before the call that asked.
const reply = event('$reply', AGENT, replyContent(2, 'Fetching', 'streaming'));
const room = Object.assign(new EventEmitter(), { roomId: ROOM }) as unknown as Room;
const NONE = new Set<string>();
const getContent = (row: MatrixEvent) => row.getContent();

/**
 * An open thread's rows as RoomTimeline draws them: the plan, the rows hidden while their line is
 * mounted, and the tiles. `shown` is what the reply's row draws, a live frame or the durable reply.
 */
function Thread({ events, shown }: { events: MatrixEvent[]; shown: Record<string, unknown> }) {
  const plan = useInlineSecretRequestPlan({
    room,
    events,
    getContent,
    ignored: NONE,
    viewerId: ALICE,
    threadId: ROOT,
  });
  const hiddenEventIds = useDrawnSecretRequestIds(plan);
  const renderEvent = ({ eventId, event: row }: TimelineMessageRow) => {
    const request = parseSecretRequestContent(row.getContent());
    if (request) {
      return (
        <div data-message-id={eventId}>
          <SecretRequestCard
            request={request}
            roomId={ROOM}
            agentUserId={AGENT}
            eventId={eventId}
          />
        </div>
      );
    }
    if (eventId !== '$reply')
      return <p data-message-id={eventId}>{String(row.getContent().body)}</p>;
    return (
      <div data-message-id={eventId} tabIndex={-1}>
        <ToolCallMessageContext.Provider value={{ eventId, roomId: ROOM, threadId: ROOT }}>
          {parse(String(shown.formatted_body), markerParserOptions({}, shown))}
        </ToolCallMessageContext.Provider>
      </div>
    );
  };
  const tiles = renderTimelineTiles({
    virtualItems: events.map(
      (_row, index) =>
        ({ index, key: index, start: index * 40, size: 40, end: 0, lane: 0 } as VirtualItem)
    ),
    threadId: ROOT,
    threadEvents: events,
    roomWindowRows: [],
    roomRowEntries: [],
    windowStart: 0,
    readUptoAbsoluteIndex: undefined,
    ignoredUsersSet: NONE,
    showHiddenEvents: false,
    timelineSet: {} as EventTimelineSet,
    focusItem: undefined,
    messageData: {
      approvalTimeline: { hiddenEventIds: NONE },
      threadSummaryTimeline: { hiddenEventIds: NONE },
      secretRequestTimeline: { hiddenEventIds },
    } as unknown as TimelineMessageData,
    isHiddenByPlugin: () => false,
    isHiddenByPluginId: () => false,
    renderEvent,
    isQuietMarkerRow: () => false,
    unreadMarkerRef: () => undefined,
    measureElement: () => undefined,
    ledgerPxAtRender: 0,
  });
  return (
    <ClientConfigProvider value={{}}>
      <InlineSecretRequestsContext.Provider value={plan}>
        <div data-timeline-rows="">{tiles}</div>
      </InlineSecretRequestsContext.Provider>
    </ClientConfigProvider>
  );
}

let host: HTMLDivElement;
let root: Root;
const cardRow = () => host.querySelector('[data-message-id="$card"]');
const line = () => host.querySelector<HTMLElement>('[data-secret-request-for="$card"]');
/** What the thread shows of the request, in one paint: its card's row, its line in the reply. */
const shows = () => ({ row: cardRow() !== null, line: line() !== null });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("a secret request card's row in an open thread", () => {
  it('stays while the request waits, whatever the reply shows', () => {
    const events = [root$, reply, card('pending')];
    act(() =>
      root.render(<Thread events={events} shown={replyContent(4, 'Starting', 'streaming')} />)
    );

    expect(shows()).toEqual({ row: true, line: false });
  });

  it('moves into a reply that still streams, and back, with no paint of both or of neither', async () => {
    // The request was answered mid-turn: the card is done, and the homeserver's reply is still the
    // streaming edit from before the call. The row's live frame has not reached the call either.
    const events = [root$, reply, card('saved')];
    const frame = (calls: number, text: string) => (
      <Thread events={events} shown={replyContent(calls, text, 'streaming')} />
    );
    act(() => root.render(frame(2, 'Fetching')));
    expect(shows()).toEqual({ row: true, line: false });

    // As the app runs, outside act: what the thread shows after each task that changed it, which
    // is all a paint can show. Effects that run after the paint come in a later task.
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
    const paints: ReturnType<typeof shows>[] = [];
    const observer = new MutationObserver(() => paints.push(shows()));
    observer.observe(host, { childList: true, subtree: true });

    // A frame that shows the call, then one that does not (a plugin takes the reply, its work
    // folds, a newer frame leaves the call out).
    root.render(frame(4, 'Starting'));
    await vi.waitFor(() => expect(shows()).toEqual({ row: false, line: true }));
    root.render(frame(2, 'Fetching'));
    await vi.waitFor(() => expect(shows()).toEqual({ row: true, line: false }));

    observer.disconnect();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    expect(paints).toEqual([
      { row: false, line: true },
      { row: true, line: false },
    ]);
  });

  it('keeps the same line when the turn ends with the durable reply', () => {
    const events = [root$, reply, card('saved')];
    act(() =>
      root.render(<Thread events={events} shown={replyContent(4, 'Starting', 'streaming')} />)
    );
    const mounted = line();
    expect(shows()).toEqual({ row: false, line: true });

    const done = event('$reply', AGENT, replyContent(4, 'Done.'));
    act(() =>
      root.render(<Thread events={[root$, done, card('saved')]} shown={done.getContent()} />)
    );

    expect(shows()).toEqual({ row: false, line: true });
    expect(line()).toBe(mounted);
  });

  it('hands the focus inside it to the line that takes its place', async () => {
    const events = [root$, reply, card('saved')];
    act(() =>
      root.render(<Thread events={events} shown={replyContent(2, 'Fetching', 'streaming')} />)
    );
    const summary = cardRow()!.querySelector('summary')!;
    summary.tabIndex = 0;
    summary.focus();
    expect(cardRow()!.contains(document.activeElement)).toBe(true);

    await act(async () => {
      root.render(<Thread events={events} shown={replyContent(4, 'Starting', 'streaming')} />);
    });

    expect(shows()).toEqual({ row: false, line: true });
    expect(document.activeElement).toBe(line());
  });

  it('takes the focus back from the line when the reply shows the call no longer', async () => {
    const events = [root$, reply, card('saved')];
    // Another timeline before this one shows the card too, as Classic does beside a thread.
    const beside = (shown: Record<string, unknown>) => (
      <>
        <div data-timeline-rows="">
          <div data-secret-request-card="$card" tabIndex={-1} />
        </div>
        <Thread events={events} shown={shown} />
      </>
    );
    act(() => root.render(beside(replyContent(4, 'Starting', 'streaming'))));
    line()!.focus();
    expect(document.activeElement).toBe(line());

    // A newer frame leaves the call out (as folded calls or folded work do): the row is back.
    await act(async () => {
      root.render(beside(replyContent(2, 'Fetching', 'streaming')));
    });

    expect(shows()).toEqual({ row: true, line: false });
    expect(cardRow()!.contains(document.activeElement)).toBe(true);
  });

  it('stays when the call sits in a <details> of the page, wherever the parser found it', () => {
    // The second call, in a details after a call in its div, is the one that asked: a closed
    // details would hide its line while the card's row hid for it.
    const shown = {
      ...replyContent(0, ''),
      formatted_body:
        '<div>🔧 <code>shell</code> [1]<details><p>🔧 <code>request_secret</code> [2]</p></details></div>',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'shell', tool_call_id: 'call_1' },
          { type: 'tool_call_completed', tool_name: 'request_secret', tool_call_id: 'call_3' },
        ],
      },
    };
    act(() => root.render(<Thread events={[root$, reply, card('saved')]} shown={shown} />));

    expect(shows()).toEqual({ row: true, line: false });
    expect(host.querySelector('details [data-message-disclosure]')).not.toBeNull();
  });
});
