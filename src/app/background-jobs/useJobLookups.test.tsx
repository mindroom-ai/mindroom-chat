// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import {
  clearLongTextHydrationCache,
  getLongTextSource,
  hydrateLongTextSource,
  type LongTextSource,
} from '../matrix/protocol/longText';
import { getLiveReplyStore, LiveReplyStore } from '../messages/live/liveReplyStore';
import { getSubagentRunStore } from '../messages/live/subagentRunStore';
import { indexJobToolCalls, useJobLookups } from './useJobLookups';

const mx = vi.hoisted(() => ({ getUserId: () => '@me:example.org' }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
const hydrateCachedLongText = vi.hoisted(() =>
  vi.fn(async (_mx: object, source: LongTextSource) => source.previewContent)
);
vi.mock('../event-store/cache/attachmentRepository', () => ({ hydrateCachedLongText }));
const signals = vi.hoisted(() => ({ subscribed: 0, listeners: new Set<() => void>() }));
vi.mock('../threads/cross-room/threadSignalsReader', () => ({
  subscribeRoomSignals: (_mx: unknown, _roomId: string, onChange: () => void) => {
    signals.subscribed += 1;
    signals.listeners.add(onChange);
    return () => {
      signals.listeners.delete(onChange);
    };
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
const toolJob = (jobId: string, threadId: string, toolCallId = 'call_1', agentId = AGENT) => ({
  jobId,
  agentId,
  threadId,
  toolCallId,
});
const runningToolJob = (
  jobId: string,
  threadId: string,
  toolCallId = 'call_1',
  agentId = AGENT
): BackgroundJob => ({
  ...toolJob(jobId, threadId, toolCallId, agentId),
  kind: 'tool',
  tool: 'run_shell_command',
  status: 'running',
  startedAt: '',
});
const longText = (mxcUri: string, extra: Record<string, unknown> = {}) => ({
  msgtype: 'm.file',
  body: 'preview',
  url: mxcUri,
  'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
  ...extra,
});
const hydrateSidecar = (
  reply: MatrixEvent,
  payload: Record<string, unknown>,
  client: Pick<MatrixClient, 'getUserId'> = mx
) =>
  hydrateLongTextSource(
    getLongTextSource(reply.getContent())!,
    async () => JSON.stringify({ msgtype: 'm.text', body: 'full', ...payload }),
    client
  );
const calls = (
  room: Room,
  jobs: ReturnType<typeof toolJob>[],
  store = new LiveReplyStore(),
  client?: Pick<MatrixClient, 'getUserId'>
) => {
  const index = indexJobToolCalls(room, jobs, store, Date.now(), client);
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
  clearLongTextHydrationCache();
  hydrateCachedLongText.mockReset();
  hydrateCachedLongText.mockImplementation(async (_mx, source) => source.previewContent);
  vi.unstubAllGlobals();
});

it("renders again for a frame of a listed job's run that changes its row, not for others", () => {
  const seqs = new Map<string, number>();
  const frame = (
    run: string,
    md: string,
    task = 'Task',
    tools: { type: string; tool_name: string }[] = [],
    toolCalls?: number
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
      ...(toolCalls === undefined
        ? {}
        : { usage: { inputTokens: 10, outputTokens: 5, toolCalls } }),
    },
    snapshot: { md, reasoning: '', tools, status: 'streaming', activity: '', segments: [] },
  });
  const ingest = (
    run: string,
    md: string,
    task?: string,
    tools?: { type: string; tool_name: string }[],
    toolCalls?: number
  ) =>
    act(() =>
      getSubagentRunStore(mx as never).ingest(
        ROOM,
        AGENT,
        frame(run, md, task, tools, toolCalls),
        0
      )
    );
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
  function Probe({ listed = true }: { listed?: boolean }) {
    renders += 1;
    const { runs } = useJobLookups(roomOf({}), jobs, listed);
    return (
      <span data-calls={listed ? runs[0]?.meta.usage?.toolCalls : undefined}>
        {runs.map((run) => run.meta.task).join()}
      </span>
    );
  }
  act(() => root.render(<Probe />));
  ingest('mine', 'Hi');
  const shown = renders;
  // Text the row does not show, and another sub-agent's frame, render nothing.
  ingest('mine', 'Hi there');
  ingest('other', 'Elsewhere');
  // A sub-agent's row shows none of the calls it completed.
  ingest('mine', 'Hi there', 'Task', [{ type: 'tool_call_completed', tool_name: 'read_file' }]);
  expect(renders).toBe(shown);
  // It shows the call it makes now, which renders once.
  ingest('mine', 'Hi there', 'Task', [{ type: 'tool_call_started', tool_name: 'read_file' }]);
  const calling = renders;
  expect(calling).toBeGreaterThan(shown);
  ingest('mine', 'More text', 'Task', [{ type: 'tool_call_started', tool_name: 'read_file' }]);
  expect(renders).toBe(calling);
  ingest('mine', 'Hi there', 'New task');
  expect(container.textContent).toBe('New task');
  // The whole task is the headline's tooltip, so a change past its first line renders.
  const before = renders;
  ingest('mine', 'Hi there', 'New task\nwith tests');
  expect(renders).toBeGreaterThan(before);

  // A folded list or quiet bar renders neither the current call nor its count.
  act(() => root.render(<Probe listed={false} />));
  const quiet = renders;
  ingest(
    'mine',
    'Hi there',
    'New task\nwith tests',
    [{ type: 'tool_call_started', tool_name: 'grep' }],
    2
  );
  ingest(
    'mine',
    'Hi there',
    'New task\nwith tests',
    [
      { type: 'tool_call_completed', tool_name: 'grep' },
      { type: 'tool_call_started', tool_name: 'write_file' },
    ],
    3
  );
  expect(renders).toBe(quiet);
  act(() => root.render(<Probe listed />));
  expect(container.querySelector('span')?.dataset.calls).toBe('3');
  act(() => root.render(<Probe listed={false} />));
  // What they do show still renders.
  ingest('mine', 'Hi there', 'Newer task');
  expect(container.textContent).toBe('Newer task');
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

function ToolCallProbe({ room, jobs }: { room: Room; jobs: BackgroundJob[] }) {
  const { toolCallFor } = useJobLookups(room, jobs, true);
  return <span>{toolCallFor(jobs[0]!)?.preview}</span>;
}

it('resolves args_preview from hydrated sidecars, replaces stale borrowed traces, and ignores untrusted senders', async () => {
  const client = { getUserId: () => '@me:example.org' };
  const cmd = 'uv run pytest tests/export/test_retry.py -x';
  const foreignAgent = '@mindroom_code:foreign.org';
  const bareReply = message('$a', AGENT, longText('mxc://server/trace-bare'));
  const staleReply = message(
    '$b',
    AGENT,
    longText('mxc://server/trace-stale', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          ...trace('call_old', 'older command').events,
          ...trace('call_1', 'args=old').events,
        ],
      },
    })
  );
  const clearedReply = message(
    '$c',
    AGENT,
    longText('mxc://server/trace-cleared', {
      'io.mindroom.tool_trace': trace('call_1', 'args=stale'),
    })
  );
  const foreignReply = message('$d', foreignAgent, longText('mxc://server/trace-foreign'));
  const room = roomOf({
    $a: [bareReply],
    $b: [staleReply],
    $c: [clearedReply],
    $d: [foreignReply],
  });
  const jobs = [
    toolJob('job_a', '$a'),
    toolJob('job_b_current', '$b', 'call_1'),
    toolJob('job_b_old', '$b', 'call_old'),
    toolJob('job_c', '$c'),
    toolJob('job_d', '$d', 'call_1', foreignAgent),
  ];
  const store = new LiveReplyStore();
  expect(calls(room, jobs, store, client)).toEqual({
    job_b_current: { tool: 'run_shell_command', preview: 'args=old' },
    job_b_old: { tool: 'run_shell_command', preview: 'older command' },
    job_c: { tool: 'run_shell_command', preview: 'args=stale' },
  });

  await hydrateSidecar(bareReply, { 'io.mindroom.tool_trace': trace('call_1', cmd) }, client);
  await hydrateSidecar(staleReply, { 'io.mindroom.tool_trace': trace('call_1', cmd) }, client);
  await hydrateSidecar(clearedReply, {}, client);
  await hydrateSidecar(foreignReply, { 'io.mindroom.tool_trace': trace('call_1', cmd) }, client);

  expect(calls(room, jobs, store, client)).toEqual({
    job_a: { tool: 'run_shell_command', preview: cmd },
    job_b_current: { tool: 'run_shell_command', preview: cmd },
  });
});

it('updates when an uncached long_text sidecar hydrates externally', async () => {
  const cmd = 'uv run pytest tests/export/test_retry.py -x';
  const reply = message('$a', AGENT, longText('mxc://server/external-hydrate'));
  const room = roomOf({ $a: [reply] });
  const jobs = [runningToolJob('job_1', '$a')];
  hydrateCachedLongText.mockImplementation(() => new Promise(() => undefined));

  act(() => root.render(<ToolCallProbe room={room} jobs={jobs} />));
  expect(container.textContent).toBe('');

  await act(async () => {
    await hydrateSidecar(reply, { 'io.mindroom.tool_trace': trace('call_1', cmd) });
  });
  expect(container.textContent).toBe(cmd);
});

it('proactively hydrates an uncached sidecar for an unmatched trusted tool job when its message is not mounted', async () => {
  const cmd = 'uv run pytest tests/export/test_retry.py -x';
  const foreignAgent = '@mindroom_code:foreign.org';
  const reply = message('$a', AGENT, longText('mxc://server/proactive-ok'));
  const foreignReply = message('$b', foreignAgent, longText('mxc://server/proactive-foreign'));
  const room = roomOf({ $a: [reply], $b: [foreignReply] });
  const jobs = [
    runningToolJob('job_1', '$a'),
    runningToolJob('job_2', '$b', 'call_1', foreignAgent),
  ];
  hydrateCachedLongText.mockImplementationOnce(async (client, source) =>
    hydrateLongTextSource(
      source,
      async () =>
        JSON.stringify({
          msgtype: 'm.text',
          body: 'full',
          'io.mindroom.tool_trace': trace('call_1', cmd),
        }),
      client
    )
  );

  await act(async () => {
    root.render(<ToolCallProbe room={room} jobs={jobs} />);
  });
  expect(hydrateCachedLongText).toHaveBeenCalledTimes(1);
  expect(hydrateCachedLongText).toHaveBeenCalledWith(
    mx,
    expect.objectContaining({
      mxcUri: 'mxc://server/proactive-ok',
      owner: expect.objectContaining({ roomId: ROOM, eventId: reply.getId() }),
    })
  );
  expect(container.textContent).toBe(cmd);
});

it('does not retry-loop when proactive sidecar hydration fails', async () => {
  const reply = message('$a', AGENT, longText('mxc://server/proactive-fail'));
  const room = roomOf({ $a: [reply] });
  const jobs = [runningToolJob('job_1', '$a')];
  hydrateCachedLongText.mockRejectedValue(new Error('network error'));

  await act(async () => {
    root.render(<ToolCallProbe room={room} jobs={jobs} />);
  });
  await act(async () => {
    signals.listeners.forEach((notify) => notify());
  });
  expect(hydrateCachedLongText).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe('');
});
