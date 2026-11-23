// @vitest-environment jsdom
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MINDROOM_ACTIVE_RUNS_EVENT } from '../matrix/protocol/activeRunsContract';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { useJobRepliesStreaming } from './useJobRepliesStreaming';

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

const activeRunsEvent = (
  threads: { thread_id: string | null }[],
  { sender = AGENT, ttlMs = 30_000, ts = Date.now() } = {}
) =>
  stateEvent(
    MINDROOM_ACTIVE_RUNS_EVENT,
    sender,
    { version: 1, updated_at: ts, ttl_ms: ttlMs, threads },
    sender,
    ts
  );

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
  return room;
};

const job = (jobId: string, threadId: string | null = THREAD, agentId = AGENT): BackgroundJob => ({
  jobId,
  agentId,
  threadId,
  kind: 'tool',
  tool: 'run_shell_command',
  status: 'running',
  startedAt: '2026-11-05T00:00:00+00:00',
});

let renderer: ReactTestRenderer | undefined;
let streaming = false;

function Probe({ room, jobs }: { room: Room | undefined; jobs: BackgroundJob[] }) {
  streaming = useJobRepliesStreaming(room, jobs);
  return null;
}

const render = (room: Room | undefined, jobs: BackgroundJob[]) =>
  act(() => {
    if (renderer) renderer.update(<Probe room={room} jobs={jobs} />);
    else renderer = create(<Probe room={room} jobs={jobs} />);
  });

const setRuns = (room: Room, event: MatrixEvent) =>
  act(async () => {
    await room.addLiveEvents([event], { addToState: true });
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_TS);
  streaming = false;
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

it('matches threaded active runs by agent and threadId and clears on removal or TTL expiry', async () => {
  const room = await makeRoom();
  render(room, [job('j1', THREAD, AGENT)]);
  expect(streaming).toBe(false);

  // Another agent or another thread does not match.
  await setRuns(room, activeRunsEvent([{ thread_id: THREAD }], { sender: OTHER_AGENT }));
  await setRuns(room, activeRunsEvent([{ thread_id: '$other' }], { sender: AGENT }));
  expect(streaming).toBe(false);

  // Matching agent + threadId matches.
  await setRuns(room, activeRunsEvent([{ thread_id: THREAD }], { sender: AGENT, ttlMs: 30_000 }));
  expect(streaming).toBe(true);

  // Clears on TTL expiry.
  act(() => {
    vi.advanceTimersByTime(30_001);
  });
  expect(streaming).toBe(false);

  // Clears on explicit empty state.
  await setRuns(room, activeRunsEvent([{ thread_id: THREAD }], { sender: AGENT }));
  expect(streaming).toBe(true);
  await setRuns(room, activeRunsEvent([], { sender: AGENT }));
  expect(streaming).toBe(false);
});

it('matches room-mode jobs (threadId: null) against active runs with thread_id: null', async () => {
  const room = await makeRoom();
  render(room, [job('j1', null, AGENT)]);
  expect(streaming).toBe(false);

  // Threaded run does not match a room-mode job.
  await setRuns(room, activeRunsEvent([{ thread_id: THREAD }], { sender: AGENT }));
  expect(streaming).toBe(false);

  // Room-mode run (thread_id: null) matches and expires on TTL.
  await setRuns(room, activeRunsEvent([{ thread_id: null }], { sender: AGENT, ttlMs: 30_000 }));
  expect(streaming).toBe(true);

  act(() => {
    vi.advanceTimersByTime(30_001);
  });
  expect(streaming).toBe(false);
});

it('returns false when room is undefined or jobs are empty', async () => {
  const room = await makeRoom();
  await setRuns(room, activeRunsEvent([{ thread_id: THREAD }], { sender: AGENT }));
  render(undefined, [job('j1', THREAD, AGENT)]);
  expect(streaming).toBe(false);

  render(room, []);
  expect(streaming).toBe(false);
});
