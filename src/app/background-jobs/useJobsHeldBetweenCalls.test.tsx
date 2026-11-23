// @vitest-environment jsdom
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MINDROOM_ACTIVE_RUNS_EVENT } from '../matrix/protocol/activeRunsContract';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { JOBS_HOLD_MS, useJobsHeldBetweenCalls } from './useJobsHeldBetweenCalls';

const VIEWER = '@me:example.org';
const AGENT = '@mindroom_helper:example.org';
const OTHER_AGENT = '@mindroom_other:example.org';
const THREAD = '$root';
const ROOM_ID = '!room:example.org';
const START_TS = 1_763_839_200_000;

let serial = 0;

const stateEvent = (
  type: string,
  stateKey: string,
  content: Record<string, unknown>,
  sender = stateKey,
  ts = Date.now()
) =>
  new MatrixEvent({
    event_id: `$ev_${++serial}`,
    room_id: ROOM_ID,
    sender,
    state_key: stateKey,
    type,
    origin_server_ts: ts,
    content,
  });

const makeRoom = async () => {
  const room = new Room(
    ROOM_ID,
    createClient({ baseUrl: 'http://localhost:1', userId: VIEWER, timelineSupport: true }),
    VIEWER,
    { timelineSupport: true }
  );
  await room.addLiveEvents(
    [
      stateEvent('m.room.member', AGENT, { membership: 'join' }),
      stateEvent('m.room.member', OTHER_AGENT, { membership: 'join' }),
    ],
    { addToState: true }
  );
  const setRuns = (
    threads: { thread_id: string | null }[],
    { sender = AGENT, ttlMs = 180_000, ts = Date.now() } = {}
  ) =>
    act(async () => {
      await room.addLiveEvents(
        [
          stateEvent(
            MINDROOM_ACTIVE_RUNS_EVENT,
            sender,
            { version: 1, updated_at: ts, ttl_ms: ttlMs, threads },
            sender,
            ts
          ),
        ],
        { addToState: true }
      );
    });
  return { room, setRuns };
};

const job = (
  jobId: string,
  threadId: string | null = THREAD,
  agentId: string = AGENT
): BackgroundJob => ({
  jobId,
  agentId,
  threadId,
  kind: 'tool',
  tool: 'run_shell_command',
  status: 'running',
  startedAt: '2026-11-05T00:00:00+00:00',
});
const NONE: BackgroundJob[] = [];

let env: Awaited<ReturnType<typeof makeRoom>>;
let shown: string[] = [];
let statuses: string[] = [];
let renderer: ReactTestRenderer | undefined;

function Probe({ jobs, view }: { jobs: BackgroundJob[]; view: string | null }) {
  const held = useJobsHeldBetweenCalls(jobs, view, (jobId) => jobId === 'sent', env.room);
  shown = held.map((item) => item.jobId);
  statuses = held.map((item) => item.status);
  return null;
}

const show = (jobs: BackgroundJob[], view: string | null = THREAD) =>
  act(() => {
    if (renderer) renderer.update(<Probe jobs={jobs} view={view} />);
    else renderer = create(<Probe jobs={jobs} view={view} />);
  });

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(START_TS);
  env = await makeRoom();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

it('holds the bar while the agent has an active run, however long it thinks between calls', async () => {
  await env.setRuns([{ thread_id: THREAD }]);
  show([job('first')]);
  show(NONE);
  wait(JOBS_HOLD_MS * 5);
  expect(shown).toEqual(['first']);
  show([job('second')]);
  expect(shown).toEqual(['second']);
});

it('lets the bar go 2 s after the active run ends, not before', async () => {
  await env.setRuns([{ thread_id: THREAD }]);
  show([job('first')]);
  show(NONE);
  wait(JOBS_HOLD_MS * 3);
  await env.setRuns([]);
  wait(JOBS_HOLD_MS - 1);
  expect(shown).toEqual(['first']);
  wait(1);
  expect(shown).toEqual([]);
});

it('holds the bar while its room-mode run (thread_id: null) is active, then 2 s', async () => {
  await env.setRuns([{ thread_id: null }]);
  show([job('first', null)], null);
  show(NONE, null);
  wait(JOBS_HOLD_MS * 5);
  expect(shown).toEqual(['first']);
  show([job('second', null)], null);
  show(NONE, null);
  await env.setRuns([]);
  wait(JOBS_HOLD_MS - 1);
  expect(shown).toEqual(['second']);
  wait(1);
  expect(shown).toEqual([]);
});

it("lets the bar go 2 s after its own run ends while another agent's run stays active", async () => {
  await env.setRuns([{ thread_id: THREAD }], { sender: AGENT });
  await env.setRuns([{ thread_id: THREAD }], { sender: OTHER_AGENT });
  show([job('first')]);
  show(NONE);
  await env.setRuns([], { sender: AGENT });
  wait(JOBS_HOLD_MS - 1);
  expect(shown).toEqual(['first']);
  wait(1);
  expect(shown).toEqual([]);
});

it('lets the bar go 2 s after an abandoned active run expires by TTL', async () => {
  await env.setRuns([{ thread_id: THREAD }], { ttlMs: 30_000 });
  show([job('first')]);
  show(NONE);
  wait(30_000);
  expect(shown).toEqual(['first']);
  wait(1);
  wait(JOBS_HOLD_MS - 1);
  expect(shown).toEqual(['first']);
  wait(1);
  expect(shown).toEqual([]);
});

it('shows the jobs it holds as finished', () => {
  show([job('first'), { ...job('second'), status: 'awaiting_approval' }]);
  expect(statuses).toEqual(['running', 'awaiting_approval']);
  show(NONE);
  expect(shown).toEqual(['first', 'second']);
  expect(statuses).toEqual(['finished', 'finished']);
});

it('keeps the last call between two calls and shows the next one at once', () => {
  show([job('first')]);
  show(NONE);
  expect(shown).toEqual(['first']);
  wait(JOBS_HOLD_MS - 1);
  expect(shown).toEqual(['first']);
  show([job('second')]);
  expect(shown).toEqual(['second']);
});

it('lets the bar go once no call follows within the hold', () => {
  show([job('first')]);
  show(NONE);
  wait(JOBS_HOLD_MS);
  expect(shown).toEqual([]);
});

it('does not extend the hold when other views change the room jobs', () => {
  show([job('first')]);
  show(NONE);
  wait(JOBS_HOLD_MS - 500);
  show([]);
  wait(500);
  expect(shown).toEqual([]);
});

it('never shows a held job in another view', () => {
  show([job('first')]);
  show(NONE, '$other');
  expect(shown).toEqual([]);
});

it('lets stopped jobs go at once', () => {
  show([job('sent')]);
  show(NONE);
  expect(shown).toEqual([]);
  show([{ ...job('first'), status: 'cancel_requested' }]);
  show(NONE);
  expect(shown).toEqual([]);
});

it('shows nothing when a view starts without jobs', () => {
  show(NONE);
  expect(shown).toEqual([]);
});
