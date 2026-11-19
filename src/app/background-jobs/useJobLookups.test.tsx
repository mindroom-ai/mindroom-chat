// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { getLiveReplyStore, LiveReplyStore } from '../messages/live/liveReplyStore';
import { getSubagentRunStore } from '../messages/live/subagentRunStore';
import { indexJobToolCalls, useJobLookups } from './useJobLookups';

const mx = vi.hoisted(() => ({}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
const signals = vi.hoisted(() => ({ subscribed: 0 }));
vi.mock('../threads/cross-room/threadSignalsReader', () => ({
  subscribeRoomSignals: () => {
    signals.subscribed += 1;
    return () => undefined;
  },
}));

const ROOM = '!room:example.org';
const AGENT = '@mindroom_code:example.org';
const OTHER = '@mindroom_other:example.org';
const SID = '1762790000123-0a1b2c3d';
let ids = 0;

const trace = (id: string, preview?: string) => ({
  version: 2,
  events: [
    {
      type: 'tool_call_started',
      tool_name: 'run_shell_command',
      tool_call_id: id,
      ...(preview ? { args_preview: preview } : {}),
    },
  ],
});
const message = (
  threadId: string,
  sender: string,
  content: Record<string, unknown> = {},
  unsigned: Record<string, unknown> = {}
) => {
  ids += 1;
  return new MatrixEvent({
    type: 'm.room.message',
    event_id: `$e${ids}`,
    room_id: ROOM,
    sender,
    origin_server_ts: ids,
    unsigned,
    content: {
      msgtype: 'm.text',
      body: 'text',
      'm.relates_to': { rel_type: 'm.thread', event_id: threadId },
      ...content,
    },
  });
};

/** A room whose threads hold `threads[id]`, oldest first, all loaded. */
const roomOf = (threads: Record<string, MatrixEvent[]>) => {
  const relations = { getChildEventsForEvent: () => undefined };
  const thread = (events: MatrixEvent[]) => ({
    getUnfilteredTimelineSet: () => ({
      relations,
      getLiveTimeline: () => ({ getEvents: () => events, getNeighbouringTimeline: () => null }),
    }),
    lastReply: () => events.at(-1),
    replyToEvent: undefined,
    rootEvent: undefined,
  });
  return {
    roomId: ROOM,
    getThread: (id: string) => (threads[id] ? thread(threads[id]!) : null),
    getUnfilteredTimelineSet: () => ({ relations }),
    getLiveTimeline: () => ({ getEvents: () => [] }),
  } as unknown as Room;
};
const toolJob = (jobId: string, threadId: string, toolCallId = 'call_1') => ({
  jobId,
  agentId: AGENT,
  threadId,
  toolCallId,
});
const calls = (room: Room, jobs: ReturnType<typeof toolJob>[], store = new LiveReplyStore()) => {
  const index = indexJobToolCalls(room, jobs, store, Date.now());
  return Object.fromEntries(
    jobs.flatMap((job) => {
      const call = index.get([job.agentId, job.threadId, job.toolCallId].join('\0'));
      return call ? [[job.jobId, call]] : [];
    })
  );
};

it("takes each job's call from its own agent's reply in its own thread, also one sharing its ID", () => {
  const room = roomOf({
    $a: [message('$a', AGENT, { 'io.mindroom.tool_trace': trace('call_1', 'pytest a') })],
    $b: [
      message('$b', OTHER, { 'io.mindroom.tool_trace': trace('call_1', 'rm -rf b') }),
      message('$b', AGENT, { 'io.mindroom.tool_trace': trace('call_1', 'pytest b') }),
    ],
  });
  expect(calls(room, [toolJob('job_a', '$a'), toolJob('job_b', '$b')])).toEqual({
    job_a: { tool: 'run_shell_command', preview: 'pytest a' },
    job_b: { tool: 'run_shell_command', preview: 'pytest b' },
  });
  // Two different calls of the agent's in one thread with that ID: no guess.
  const twice = roomOf({
    $a: [
      message('$a', AGENT, { 'io.mindroom.tool_trace': trace('call_1', 'one') }),
      message('$a', AGENT, { 'io.mindroom.tool_trace': trace('call_1', 'two') }),
    ],
  });
  expect(calls(twice, [toolJob('job_a', '$a')])).toEqual({});
});

it('finds the call in a loaded reply however many messages came after it', () => {
  const later = Array.from({ length: 12 }, () => message('$a', '@alice:example.org'));
  const room = roomOf({
    $a: [message('$a', AGENT, { 'io.mindroom.tool_trace': trace('call_1', 'pytest') }), ...later],
  });
  expect(calls(room, [toolJob('job_a', '$a')])).toEqual({
    job_a: { tool: 'run_shell_command', preview: 'pytest' },
  });
});

it('shows no arguments the reply no longer shows: a redacted reply, or an edit that ended its frames', () => {
  const store = new LiveReplyStore();
  const live = (replyId: string) =>
    store.ingest(
      ROOM,
      AGENT,
      {
        reply: replyId,
        sid: SID,
        seq: 0,
        snapshot: {
          md: '',
          reasoning: '',
          tools: trace('call_1', 'secret args').events,
          status: 'streaming',
          activity: '',
          segments: [],
        },
      },
      Date.now()
    );
  const redacted = message(
    '$a',
    AGENT,
    { 'io.mindroom.stream_status': 'streaming' },
    { redacted_because: { type: 'm.room.redaction' } }
  );
  live(redacted.getId()!);
  expect(calls(roomOf({ $a: [redacted] }), [toolJob('job_a', '$a')], store)).toEqual({});

  const reply = message('$b', AGENT, {
    'io.mindroom.stream_status': 'streaming',
    'io.mindroom.tool_trace': trace('call_1', 'secret args'),
  });
  live(reply.getId()!);
  reply.makeReplaced(
    new MatrixEvent({
      type: 'm.room.message',
      event_id: '$edit',
      room_id: ROOM,
      sender: AGENT,
      origin_server_ts: 1000,
      content: {
        'm.relates_to': { rel_type: 'm.replace', event_id: reply.getId() },
        'm.new_content': {
          msgtype: 'm.text',
          body: 'done',
          'io.mindroom.stream_status': 'completed',
          'io.mindroom.tool_trace': trace('call_1'),
        },
      },
    })
  );
  expect(calls(roomOf({ $b: [reply] }), [toolJob('job_b', '$b')], store)).toEqual({
    job_b: { tool: 'run_shell_command' },
  });
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  getSubagentRunStore(mx as never).clear();
  getLiveReplyStore(mx as never).clear();
  vi.unstubAllGlobals();
});

it("renders again for a frame of a listed job's run that changes its row, not for others", () => {
  const seqs = new Map<string, number>();
  const frame = (
    run: string,
    md: string,
    task = 'Task',
    tools: { type: string; tool_name: string }[] = []
  ) => ({
    run,
    sid: SID,
    seq: seqs.set(run, (seqs.get(run) ?? -1) + 1).get(run)!,
    meta: {
      agent: 'dev',
      subagent: run,
      caller: 'code',
      root: 'code',
      parent: null,
      threadId: '$a',
      source: 'delegate' as const,
      status: 'running' as const,
      startedAt: 1,
      endedAt: null,
      task,
    },
    snapshot: { md, reasoning: '', tools, status: 'streaming', activity: '', segments: [] },
  });
  const ingest = (
    run: string,
    md: string,
    task?: string,
    tools?: { type: string; tool_name: string }[]
  ) =>
    act(() => getSubagentRunStore(mx as never).ingest(ROOM, AGENT, frame(run, md, task, tools), 0));
  const jobs: BackgroundJob[] = [
    {
      jobId: 'job_1',
      agentId: AGENT,
      threadId: '$a',
      kind: 'subagent',
      tool: 'dev',
      status: 'running',
      startedAt: '2026-10-11T00:00:00+00:00',
      subagent: 'mine',
      run: 'mine',
    },
  ];
  let renders = 0;
  function Probe() {
    renders += 1;
    const { runs } = useJobLookups(roomOf({}), jobs, false);
    return <span>{runs.map((run) => run.meta.task).join()}</span>;
  }
  act(() => root.render(<Probe />));
  ingest('mine', 'Hi');
  const shown = renders;
  // Text the row does not show, and another sub-agent's frame, render nothing.
  ingest('mine', 'Hi there');
  ingest('other', 'Elsewhere');
  // A sub-agent's row shows none of its calls.
  ingest('mine', 'Hi there', 'Task', [{ type: 'tool_call_started', tool_name: 'read_file' }]);
  expect(renders).toBe(shown);
  ingest('mine', 'Hi there', 'New task');
  expect(container.textContent).toBe('New task');
  // The whole task is the headline's tooltip, so a change past its first line renders.
  const before = renders;
  ingest('mine', 'Hi there', 'New task\nwith tests');
  expect(renders).toBeGreaterThan(before);
});

it("follows a reply's frames while the list shows, beside another subscriber of that reply", () => {
  const reply = message('$a', AGENT, {
    'io.mindroom.stream_status': 'streaming',
    'io.mindroom.tool_trace': trace('call_1', 'old'),
  });
  const room = roomOf({ $a: [reply] });
  const jobs: BackgroundJob[] = [
    {
      jobId: 'job_1',
      agentId: AGENT,
      threadId: '$a',
      kind: 'tool',
      tool: 'run_shell_command',
      status: 'running',
      startedAt: '2026-10-11T00:00:00+00:00',
      toolCallId: 'call_1',
    },
  ];
  function Probe() {
    const { toolCallFor } = useJobLookups(room, jobs, true);
    return <span>{toolCallFor(jobs[0]!)?.preview}</span>;
  }
  act(() => root.render(<Probe />));
  expect(container.textContent).toBe('old');
  // The reply's row in the timeline follows its frames too.
  const store = getLiveReplyStore(mx as never);
  const stop = store.subscribe(ROOM, reply.getId()!, () => undefined);
  const frame = (seq: number, preview: string) =>
    act(() =>
      store.ingest(
        ROOM,
        AGENT,
        {
          reply: reply.getId()!,
          sid: SID,
          seq,
          snapshot: {
            md: '',
            reasoning: '',
            tools: trace('call_1', preview).events,
            status: 'streaming',
            activity: '',
            segments: [],
          },
        },
        Date.now()
      )
    );
  frame(0, 'new');
  expect(container.textContent).toBe('new');
  frame(1, 'newer');
  expect(container.textContent).toBe('newer');
  stop();
});

it('shows no call when the list opens again after its reply was redacted while folded', () => {
  const reply = message('$a', AGENT, { 'io.mindroom.tool_trace': trace('call_1', 'secret') });
  const room = roomOf({ $a: [reply] });
  const jobs = [
    { ...toolJob('job_1', '$a'), kind: 'tool', tool: 'x', status: 'running', startedAt: '' },
  ] as BackgroundJob[];
  const shown: (string | undefined)[] = [];
  function Probe({ listed }: { listed: boolean }) {
    const { toolCallFor } = useJobLookups(room, jobs, listed);
    shown.push(toolCallFor(jobs[0]!)?.preview);
    return null;
  }
  act(() => root.render(<Probe listed />));
  expect(shown.at(-1)).toBe('secret');
  act(() => root.render(<Probe listed={false} />));
  reply.setUnsigned({ redacted_because: { type: 'm.room.redaction' } } as never);
  shown.length = 0;
  act(() => root.render(<Probe listed />));
  expect(shown).not.toContain('secret');
});

it('follows nothing while the list holds no tool job with a linked call', () => {
  const store = getLiveReplyStore(mx as never);
  const subscribeRoom = vi.spyOn(store, 'subscribeRoom');
  signals.subscribed = 0;
  const jobs = [
    { jobId: 'job_1', agentId: AGENT, threadId: '$a', kind: 'subagent', tool: 'dev' },
    { jobId: 'job_2', agentId: AGENT, threadId: '$a', kind: 'tool', tool: 'shell' },
  ].map((job) => ({ ...job, status: 'running', startedAt: '' })) as BackgroundJob[];
  function Probe() {
    useJobLookups(roomOf({}), jobs, true);
    return null;
  }
  act(() => root.render(<Probe />));
  expect(subscribeRoom).not.toHaveBeenCalled();
  expect(signals.subscribed).toBe(0);
  subscribeRoom.mockRestore();
});
