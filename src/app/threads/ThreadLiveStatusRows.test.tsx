import React from 'react';
import {
  ClientEvent,
  createClient,
  MatrixEvent,
  MatrixEventEvent,
  RelationType,
  Room,
  type MatrixClient,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { getLiveReplyStore } from '../messages/live/liveReplyStore';
import { getSubagentRunStore } from '../messages/live/subagentRunStore';
import type { CrossRoomThreadIndexEntry } from './cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from './cross-room/threadSignals';
import { ThreadLiveStatusRows } from './ThreadLiveStatusRows';

// Stands in for what a thread's events say it waits on, when a test sets it.
const signals = vi.hoisted(() => ({
  read: undefined as ((now: number) => Partial<ThreadSignals>) | undefined,
}));
vi.mock('./cross-room/threadSignals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cross-room/threadSignals')>();
  return {
    ...actual,
    readThreadSignals: (...args: Parameters<typeof actual.readThreadSignals>) =>
      signals.read ? signals.read(args[3]) : actual.readThreadSignals(...args),
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';
const AGENT = '@mindroom_code:example.org';
const ROOT = '$root';

const started = (name: string) => ({ type: 'tool_call_started', tool_name: name });
const completed = (name: string) => ({ type: 'tool_call_completed', tool_name: name });

const reply = (id: string, ts: number, content: Record<string, unknown>) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: AGENT,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: id,
      ...content,
      'm.relates_to': { rel_type: RelationType.Thread, event_id: ROOT },
    },
  });

const priced = reply('$priced', 2000, {
  'io.mindroom.ai_run': { version: 1, status: 'completed', cost: { usd: '0.5' } },
});
const streamingReply = reply('$streaming', 3000, {
  'io.mindroom.stream_status': 'streaming',
  'io.mindroom.tool_trace': { version: 2, events: [started('shell'), started('grep')] },
});

const jobsState = (jobs: Record<string, unknown>[]) =>
  new MatrixEvent({
    type: 'io.mindroom.background_jobs',
    state_key: AGENT,
    sender: AGENT,
    room_id: ROOM_ID,
    event_id: '$jobs',
    content: { jobs },
  });

const job = (jobId: string, status: string) => ({
  job_id: jobId,
  thread_id: ROOT,
  kind: 'tool',
  tool: 'run_tests',
  status,
  started_at: `2026-11-16T00:00:0${jobId.slice(-1)}+00:00`,
});

const setup = async (replies: MatrixEvent[]) => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: ME });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({ chunk: [] });
  const room = new Room(ROOM_ID, mx, ME);
  mx.store.storeRoom(room);
  const root = new MatrixEvent({
    event_id: ROOT,
    room_id: ROOM_ID,
    sender: ME,
    type: 'm.room.message',
    origin_server_ts: 1000,
    content: { msgtype: 'm.text', body: 'Ship it' },
  });
  room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  const thread = room.createThread(ROOT, root, [], false);
  thread.addEvents(replies, false);
  await vi.waitFor(() => expect(thread.events.length).toBeGreaterThanOrEqual(replies.length));
  return { mx, room };
};

const entryFor = (streaming: boolean) =>
  ({
    key: `${ROOM_ID}\u0000${ROOT}`,
    roomId: ROOM_ID,
    threadRootId: ROOT,
    generation: 0,
    isInvolved: true,
    threadRecord: { status: { isStreaming: streaming } },
  } as unknown as CrossRoomThreadIndexEntry);

const textOf = (renderer: ReactTestRenderer): string[] =>
  renderer.root
    .findAllByType('span')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string');

describe('ThreadLiveStatusRows', () => {
  let renderer: ReactTestRenderer | undefined;
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    signals.read = undefined;
    vi.useRealTimers();
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  const render = (mx: MatrixClient, room: Room, streaming: boolean) => {
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ThreadLiveStatusRows room={room} entry={entryFor(streaming)} />
        </MatrixClientProvider>
      );
    });
    return renderer!;
  };

  it('shows nothing for an idle thread with no priced reply', async () => {
    const { mx, room } = await setup([reply('$plain', 2000, {})]);

    expect(textOf(render(mx, room, false))).toEqual([]);
  });

  it('shows what a busy thread runs and what it cost', async () => {
    const { mx, room } = await setup([priced, streamingReply]);
    room.currentState.setStateEvents([
      jobsState([job('job-1', 'running'), job('job-2', 'awaiting_approval')]),
    ]);
    getSubagentRunStore(mx).ingest(
      ROOM_ID,
      AGENT,
      {
        run: 'del-1',
        sid: '1762790000123-0a1b2c3d',
        seq: 0,
        meta: {
          agent: 'helper',
          subagent: 'del-1',
          caller: 'code',
          root: 'code',
          parent: null,
          threadId: ROOT,
          source: 'delegate',
          status: 'running',
          startedAt: 1762790000,
          endedAt: null,
        },
        snapshot: { md: '', reasoning: '', tools: [], status: 'streaming', activity: '' },
      },
      Date.now()
    );

    expect(textOf(render(mx, room, true))).toEqual([
      'Status',
      'Streaming',
      'Tools',
      '2 running: shell, grep',
      'Sub-agents',
      '1 active',
      'Background',
      '2 jobs, 1 waiting for approval',
      'Cost',
      '≥ $0.50',
    ]);
  });

  it("follows the reply's live frames while it is shown", async () => {
    const { mx, room } = await setup([streamingReply]);
    const rows = render(mx, room, true);
    expect(textOf(rows)).toContain('2 running: shell, grep');

    act(() =>
      getLiveReplyStore(mx).ingest(
        ROOM_ID,
        AGENT,
        {
          reply: '$streaming',
          sid: '1762790000123-0a1b2c3d',
          seq: 0,
          snapshot: {
            md: 'Working',
            reasoning: '',
            tools: [completed('shell'), started('grep')],
            status: 'streaming',
            activity: '',
          },
        },
        Date.now()
      )
    );

    expect(textOf(rows)).toContain('1 running: grep');
  });

  it('counts no tool once the reply stopped streaming', async () => {
    const { mx, room } = await setup([streamingReply]);

    expect(textOf(render(mx, room, false))).toEqual([]);
  });

  it('follows what the room hears while it is shown, such as a reaction answering the question', async () => {
    const { mx, room } = await setup([reply('$plain', 2000, {})]);
    let asking = true;
    signals.read = () =>
      asking ? { pendingQuestion: {} as ThreadSignals['pendingQuestion'] } : {};
    const rows = render(mx, room, false);
    expect(textOf(rows)).toEqual(['Status', 'Waiting for an answer']);

    asking = false;
    act(() => {
      mx.emit(ClientEvent.Event, new MatrixEvent({ type: 'm.reaction', room_id: ROOM_ID }));
    });

    expect(textOf(rows)).toEqual([]);
  });

  it('lets an approval go once it expires while shown', async () => {
    const { mx, room } = await setup([reply('$plain', 2000, {})]);
    vi.useFakeTimers({ now: 10_000 });
    signals.read = (now) =>
      now < 70_000
        ? { pendingApproval: {} as ThreadSignals['pendingApproval'], waitsUntil: 70_000 }
        : {};
    const rows = render(mx, room, false);
    expect(textOf(rows)).toEqual(['Status', 'Waiting for approval']);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(textOf(rows)).toEqual([]);
  });

  it('sums the cost again when a reply edit decrypts while shown', async () => {
    const edit = new MatrixEvent({
      event_id: '$edit',
      room_id: ROOM_ID,
      sender: AGENT,
      type: 'm.room.message',
      origin_server_ts: 2500,
      content: {
        msgtype: 'm.text',
        body: '* edited',
        'm.new_content': { msgtype: 'm.text', body: 'edited' },
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$priced' },
      },
    });
    const { mx, room } = await setup([priced]);
    const { timelineSet } = room.getThread(ROOT)!;
    timelineSet.relations.aggregateChildEvent(edit, timelineSet);
    const rows = render(mx, room, false);
    expect(textOf(rows)).toEqual([]);

    // What the edit says becomes readable, with the run's cost.
    edit.setClearData({
      clearEvent: {
        type: 'm.room.message',
        content: {
          ...edit.getContent(),
          'm.new_content': {
            msgtype: 'm.text',
            body: 'edited',
            'io.mindroom.ai_run': { version: 1, status: 'completed', cost: { usd: '0.75' } },
          },
        },
      },
    } as Parameters<MatrixEvent['setClearData']>[0]);
    act(() => {
      mx.emit(MatrixEventEvent.Decrypted, edit);
    });

    expect(textOf(rows)).toEqual(['Cost', '≥ $0.75']);
  });
});
