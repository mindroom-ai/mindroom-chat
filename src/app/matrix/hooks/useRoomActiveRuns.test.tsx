// @vitest-environment jsdom
import { createClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MINDROOM_ACTIVE_RUNS_EVENT, type RoomActiveRuns } from '../protocol/activeRunsContract';
import { useRoomActiveRuns } from './useRoomActiveRuns';

const VIEWER = '@me:example.org';
const AGENT = '@mindroom_helper:example.org';
const HUMAN = '@alice:example.org';
const START_TS = 1_763_839_200_000;

let nextEventId = 0;

const stateEvent = (
  type: string,
  stateKey: string,
  content: Record<string, unknown>,
  sender = AGENT,
  ts = Date.now()
) =>
  new MatrixEvent({
    event_id: `$ev_${++nextEventId}`,
    room_id: '!room:example.org',
    sender,
    state_key: stateKey,
    type,
    origin_server_ts: ts,
    content,
  });

const membership = (userId: string, value: string) =>
  stateEvent('m.room.member', userId, { membership: value }, userId);

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

const makeRoom = (roomId = '!room:example.org', lazyLoadMembers = false) =>
  new Room(
    roomId,
    createClient({ baseUrl: 'http://localhost:1', userId: VIEWER, timelineSupport: true }),
    VIEWER,
    { timelineSupport: true, lazyLoadMembers }
  );

let renderer: ReactTestRenderer | undefined;

const mount = (room: Room) => {
  const seen: RoomActiveRuns[] = [];
  function Probe() {
    seen.push(useRoomActiveRuns(room));
    return null;
  }
  act(() => {
    renderer = create(<Probe />);
  });
  return seen;
};

const addState = (room: Room, event: MatrixEvent) =>
  act(async () => {
    await room.addLiveEvents([event], { addToState: true });
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_TS);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

it('re-renders on addition, removal, room-mode null runs, and TTL timer expiry', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership(AGENT, 'join')], { addToState: true });
  const seen = mount(room);
  expect(seen.at(-1)?.runs).toEqual([]);

  await addState(room, activeRunsEvent([{ thread_id: '$root' }]));
  expect(seen.at(-1)?.threads.has('$root')).toBe(true);

  await addState(room, activeRunsEvent([]));
  expect(seen.at(-1)?.threads.has('$root')).toBe(false);

  // Room-mode run (thread_id: null) is exposed via runs and expires by timer.
  await addState(room, activeRunsEvent([{ thread_id: null }], { ttlMs: 30_000 }));
  expect(seen.at(-1)?.runs).toEqual([{ agentId: AGENT, threadId: null }]);
  expect(seen.at(-1)?.threads.size).toBe(0);

  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(seen.at(-1)?.runs).toEqual([{ agentId: AGENT, threadId: null }]);

  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(seen.at(-1)?.runs).toEqual([]);
});

it('ignores non-agent and non-joined senders and does not re-render on unrelated state', async () => {
  const room = makeRoom();
  await room.addLiveEvents(
    [
      membership(AGENT, 'join'),
      membership(HUMAN, 'join'),
      activeRunsEvent([{ thread_id: '$human' }], { sender: HUMAN }),
      activeRunsEvent([{ thread_id: '$agent' }], { sender: AGENT }),
    ],
    { addToState: true }
  );
  const seen = mount(room);
  expect(Array.from(seen.at(-1)?.threads ?? [])).toEqual(['$agent']);

  const renders = seen.length;
  await addState(room, stateEvent('m.room.topic', '', { topic: 'Focus' }));
  expect(seen).toHaveLength(renders);

  await addState(room, membership(AGENT, 'leave'));
  expect(seen.at(-1)?.threads.size).toBe(0);
});

it('catches state updates that land between render and passive effect subscription', async () => {
  const room = makeRoom();
  await room.addLiveEvents([membership(AGENT, 'join')], { addToState: true });
  const seen: RoomActiveRuns[] = [];
  let mutated = false;

  function RaceProbe() {
    const snap = useRoomActiveRuns(room);
    seen.push(snap);
    useLayoutEffect(() => {
      if (mutated) return;
      mutated = true;
      room.currentState.setStateEvents([activeRunsEvent([{ thread_id: '$race' }])]);
    }, []);
    return null;
  }

  act(() => {
    renderer = create(<RaceProbe />);
  });
  expect(seen.at(-1)?.threads.has('$race')).toBe(true);
});

it('does not re-render consumers on heartbeat while still extending the expiry timer', async () => {
  const room = makeRoom();
  await room.addLiveEvents(
    [membership(AGENT, 'join'), activeRunsEvent([{ thread_id: '$root' }], { ttlMs: 30_000 })],
    { addToState: true }
  );
  const seen = mount(room);
  const rendersBeforeHeartbeat = seen.length;
  const before = seen.at(-1)!;
  expect(before.threads.has('$root')).toBe(true);

  act(() => {
    vi.advanceTimersByTime(20_000);
  });
  await addState(
    room,
    activeRunsEvent([{ thread_id: '$root' }], { ttlMs: 30_000, ts: Date.now() })
  );
  expect(seen).toHaveLength(rendersBeforeHeartbeat);
  expect(seen.at(-1)).toBe(before);

  act(() => {
    vi.advanceTimersByTime(15_000);
  });
  expect(seen).toHaveLength(rendersBeforeHeartbeat);

  act(() => {
    vi.advanceTimersByTime(15_001);
  });
  expect(seen.at(-1)?.threads.has('$root')).toBe(false);
});

it('shows lazy-loaded missing membership while fresh, drops on redaction or explicit leave', async () => {
  const room = makeRoom('!room:example.org', true);
  const runEvent = activeRunsEvent([{ thread_id: '$t1' }], { ttlMs: 180_000 });
  await room.addLiveEvents([runEvent], { addToState: true });
  const seen = mount(room);
  expect(room.getMember(AGENT)).toBeNull();
  expect(seen.at(-1)?.threads.has('$t1')).toBe(true);

  const redaction = new MatrixEvent({
    event_id: '$red_1',
    room_id: '!room:example.org',
    sender: AGENT,
    type: 'm.room.redaction',
    redacts: runEvent.getId()!,
    origin_server_ts: Date.now(),
    content: {},
  });
  act(() => {
    runEvent.makeRedacted(redaction, room);
    room.emit(RoomEvent.Redaction, redaction, room);
  });
  expect(seen.at(-1)?.threads.size).toBe(0);

  await addState(room, activeRunsEvent([{ thread_id: '$t2' }]));
  expect(seen.at(-1)?.threads.has('$t2')).toBe(true);
  await addState(room, membership(AGENT, 'leave'));
  expect(seen.at(-1)?.threads.size).toBe(0);
});

it('commits no stale Working frame on A -> B -> A after A clears, and skips reads on unrelated renders', async () => {
  const roomA = makeRoom('!room:example.org');
  const roomB = makeRoom('!roomB:example.org');
  await roomA.addLiveEvents([membership(AGENT, 'join'), activeRunsEvent([{ thread_id: '$tA' }])], {
    addToState: true,
  });
  await roomB.addLiveEvents([membership(AGENT, 'join')], { addToState: true });

  const committed: { room: Room; working: boolean }[] = [];
  function Probe({ room, count }: { room: Room; count: number }) {
    void count;
    const snap = useRoomActiveRuns(room);
    useLayoutEffect(() => {
      committed.push({ room, working: snap.threads.has('$tA') });
    });
    return null;
  }

  act(() => {
    renderer = create(<Probe room={roomA} count={0} />);
  });
  expect(committed.at(-1)).toEqual({ room: roomA, working: true });

  act(() => {
    renderer!.update(<Probe room={roomB} count={0} />);
  });
  const getStateSpy = vi.spyOn(roomB.currentState, 'getStateEvents');
  const getMemberSpy = vi.spyOn(roomB, 'getMember');
  for (let i = 1; i <= 5; i += 1) {
    act(() => {
      renderer!.update(<Probe room={roomB} count={i} />);
    });
  }
  expect(getStateSpy).not.toHaveBeenCalled();
  expect(getMemberSpy).not.toHaveBeenCalled();

  await addState(roomA, activeRunsEvent([]));
  const beforeReturn = committed.length;
  act(() => {
    renderer!.update(<Probe room={roomA} count={6} />);
  });
  const afterReturn = committed.slice(beforeReturn);
  expect(afterReturn.length).toBeGreaterThan(0);
  expect(afterReturn.every((frame) => !frame.working)).toBe(true);
});
