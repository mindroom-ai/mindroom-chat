// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { STREAM_IDLE_LIMIT_MS } from '../matrix/client/streamingReplies';
import { finishingEdit, streamingReply } from './test-utils/jobReplies';
import { useJobRepliesStreaming } from './useJobRepliesStreaming';

const AGENT = '@mindroom_helper:example.org';
const MAIN = null;

// Replies the client has not seen stream through /sync, as after a reload.
const unvouched = new Set<string>();
vi.mock('../matrix/client/streamingReplies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/client/streamingReplies')>()),
  isStreamingReplyCurrent: (_room: Room, event: MatrixEvent) => !unvouched.has(event.getId()!),
}));

/** A room of threads and a main timeline that notes each read of one's events. */
const makeRoom = () => {
  const reads: (string | null)[] = [];
  const lists = new Map<string | null, MatrixEvent[]>();
  const sets = new Map<string | null, ReturnType<typeof makeSet>>();
  const threads = new Map<string, ReturnType<typeof makeThread>>();
  const makeSet = (id: string | null) => {
    const timeline = {
      getEvents: () => {
        reads.push(id);
        return lists.get(id) ?? [];
      },
      getNeighbouringTimeline: () => null,
      getTimelineSet: () => set,
    };
    const set = {
      thread: id === null ? undefined : threads.get(id),
      getLiveTimeline: () => timeline,
      relations: { getChildEventsForEvent: () => undefined },
    };
    return set;
  };
  const makeThread = (id: string) => ({
    id,
    getUnfilteredTimelineSet: () => sets.get(id)!,
    lastReply: () => lists.get(id)?.at(-1) ?? null,
  });
  const setOf = (id: string | null) => {
    if (id !== null && !threads.has(id)) threads.set(id, makeThread(id));
    if (!sets.has(id)) sets.set(id, makeSet(id));
    return sets.get(id)!;
  };
  const room = Object.assign(new EventEmitter(), {
    roomId: '!room:example.org',
    client: {},
    getThread: (id: string) => threads.get(id) ?? null,
    getLiveTimeline: () => setOf(MAIN).getLiveTimeline(),
    getUnfilteredTimelineSet: () => setOf(MAIN),
  });

  /** A reply in a thread or (`MAIN`) the main timeline, which nothing announces. */
  const put = (id: string, conversation: string | null) => {
    setOf(conversation);
    const event = streamingReply(room.roomId, id, AGENT, conversation);
    lists.set(conversation, [...(lists.get(conversation) ?? []), event]);
    return event;
  };
  // The room's events as the SDK sends them, each on its own.
  const announce = {
    timeline: (event: MatrixEvent, conversation: string | null) =>
      room.emit(RoomEvent.Timeline, event, room, false, false, {
        timeline: setOf(conversation).getLiveTimeline(),
      }),
    reset: (conversation: string | null) =>
      room.emit(RoomEvent.TimelineReset, room, setOf(conversation), false),
    update: (conversation: string) => {
      setOf(conversation);
      room.emit(ThreadEvent.Update, threads.get(conversation));
    },
    newReply: (event: MatrixEvent, conversation: string) =>
      room.emit(ThreadEvent.NewReply, threads.get(conversation), event),
  };
  /** The reply's finishing edit arrives. */
  const finish = (reply: MatrixEvent) => reply.makeReplaced(finishingEdit(reply));
  const clear = (conversation: string | null) => lists.set(conversation, []);
  /** Puts a message that another conversation holds into this one too, as a thread's root is. */
  const share = (event: MatrixEvent, conversation: string) => {
    setOf(conversation);
    lists.set(conversation, [...(lists.get(conversation) ?? []), event]);
  };
  return { room: room as unknown as Room, reads, put, announce, finish, clear, share };
};

const job = (threadId: string | null): BackgroundJob => ({
  jobId: `job-${threadId}`,
  agentId: AGENT,
  threadId,
  kind: 'tool',
  tool: 'run_shell_command',
  status: 'running',
  startedAt: '2026-11-05T00:00:00+00:00',
});

let room: ReturnType<typeof makeRoom>;
let streaming = false;
let renderer: ReactTestRenderer | undefined;

function Probe({ jobs, live }: { jobs: BackgroundJob[]; live: boolean }) {
  streaming = useJobRepliesStreaming(room.room, jobs, live);
  return null;
}

const show = (jobs: BackgroundJob[], live = true) =>
  act(() => {
    if (renderer) renderer.update(<Probe jobs={jobs} live={live} />);
    else renderer = create(<Probe jobs={jobs} live={live} />);
  });

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** The conversation of each read of events while `run` ran. */
const readsOf = (run: () => void, from = room) => {
  from.reads.length = 0;
  act(run);
  return [...from.reads];
};

beforeEach(() => {
  vi.useFakeTimers();
  room = makeRoom();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  unvouched.clear();
  vi.useRealTimers();
});

it('reads only the conversation an event belongs to', () => {
  room.put('$a1', '$a');
  const b = room.put('$b1', '$b');
  room.put('$m1', MAIN);
  show([job('$a'), job('$b'), job(MAIN)]);
  expect(streaming).toBe(true);
  const sayAll = (conversation: string) => () => {
    const event = room.put(`${conversation}-next`, conversation);
    room.announce.timeline(event, conversation);
    room.announce.newReply(event, conversation);
    room.announce.update(conversation);
    room.announce.reset(conversation);
  };

  // A thread without jobs, as nearly every thread of a busy room is.
  expect(readsOf(sayAll('$other'))).toEqual([]);
  // One read for each of its four events.
  expect(readsOf(sayAll('$a'))).toEqual(['$a', '$a', '$a', '$a']);
  expect(readsOf(() => room.finish(b))).toEqual(['$b']);
  expect(readsOf(() => room.announce.timeline(room.put('$m2', MAIN), MAIN))).toEqual([MAIN]);
});

// Every way a conversation's replies change must reach the result.
it.each([
  ['a thread event', '$a', (event: MatrixEvent) => room.announce.timeline(event, '$a')],
  ['a thread update', '$a', () => room.announce.update('$a')],
  ['a new thread reply', '$a', (event: MatrixEvent) => room.announce.newReply(event, '$a')],
  ['a thread timeline reset', '$a', () => room.announce.reset('$a')],
  ['a main timeline event', MAIN, (event: MatrixEvent) => room.announce.timeline(event, MAIN)],
])('sees a reply that %s brings', (_case, conversation, announce) => {
  show([job('$a'), job('$b'), job(MAIN)]);
  expect(streaming).toBe(false);
  const reply = room.put('$reply', conversation);
  act(() => {
    announce(reply);
  });
  expect(streaming).toBe(true);
});

it('reads the timeline an event was added to, whatever thread the event names', () => {
  show([job('$a'), job(MAIN)]);
  // An agent's message that began a thread: it names its thread and is in the main timeline.
  const root = room.put('$root', MAIN);
  root.setThreadId('$root');
  act(() => {
    room.announce.timeline(root, MAIN);
  });
  expect(streaming).toBe(true);
});

it('reads every conversation that holds an edited reply', () => {
  // A thread's root is in the main timeline and in its thread.
  const root = room.put('$a', MAIN);
  room.share(root, '$a');
  show([job('$a'), job(MAIN)]);
  expect(streaming).toBe(true);
  act(() => room.finish(root));
  expect(streaming).toBe(false);
});

it('reads the new room when the room changes, and no longer hears the old one', () => {
  const old = room;
  old.put('$a1', '$a');
  show([job('$a')]);
  expect(streaming).toBe(true);
  room = makeRoom();
  show([job('$a')]);
  expect(streaming).toBe(false);
  expect(readsOf(() => old.announce.update('$a'), old)).toEqual([]);
});

it('hears news of a main timeline reply that began a thread, which comes by that thread', () => {
  // The reply is not vouched for, and its jobs ended: the server is asked about it.
  unvouched.add('$root');
  room.put('$root', MAIN);
  show([job(MAIN)], false);
  expect(streaming).toBe(false);
  // The answer names the reply's thread, the one it began.
  unvouched.delete('$root');
  act(() => {
    room.announce.update('$root');
  });
  expect(streaming).toBe(true);
});

it('reads every conversation again when the main timeline resets, as at a sync gap', () => {
  room.put('$a1', '$a');
  room.put('$m1', MAIN);
  show([job('$a'), job(MAIN)]);
  expect(streaming).toBe(true);
  // The gap dropped both replies, and only the main timeline says so.
  room.clear('$a');
  room.clear(MAIN);
  act(() => {
    room.announce.reset(MAIN);
  });
  expect(streaming).toBe(false);
});

it.each([
  ['a thread', '$a'],
  ['another thread', '$b'],
  ['the main timeline', MAIN],
])('stops when the last streaming reply, in %s, gets its finishing edit', (_case, last) => {
  const replies = new Map(
    ['$a', '$b', MAIN].map((conversation) => [
      conversation,
      room.put(`reply-${conversation}`, conversation),
    ])
  );
  show([job('$a'), job('$b'), job(MAIN)]);
  replies.forEach((reply, conversation) => {
    if (conversation !== last) act(() => room.finish(reply));
  });
  expect(streaming).toBe(true);
  act(() => room.finish(replies.get(last)!));
  expect(streaming).toBe(false);
});

it('keeps streaming while another conversation of the jobs still does', () => {
  const a = room.put('$a1', '$a');
  room.put('$b1', '$b');
  show([job('$a'), job('$b')]);
  act(() => room.finish(a));
  expect(streaming).toBe(true);
  // The finished thread says more; the other one's state is remembered, not lost.
  act(() => {
    room.announce.update('$a');
  });
  expect(streaming).toBe(true);
});

it('reads a conversation again when its reply stalls, and stops when the last one does', () => {
  room.put('$a1', '$a');
  show([job('$a'), job('$b')]);
  wait(60_000);
  const later = room.put('$b1', '$b');
  act(() => {
    room.announce.timeline(later, '$b');
  });
  // The first one stalls, which is when it is read again; the second has a minute left.
  expect(readsOf(() => vi.advanceTimersByTime(STREAM_IDLE_LIMIT_MS - 60_000 + 1))).toEqual(['$a']);
  expect(streaming).toBe(true);
  wait(60_000 - 1);
  expect(streaming).toBe(true);
  expect(readsOf(() => vi.advanceTimersByTime(1))).toEqual(['$b']);
  expect(streaming).toBe(false);
});

it('reads a conversation whose job starts, and forgets one whose jobs are gone', () => {
  const a = room.put('$a1', '$a');
  show([job('$b')]);
  expect(streaming).toBe(false);
  show([job('$a'), job('$b')]);
  expect(streaming).toBe(true);
  show([job('$b')]);
  expect(streaming).toBe(false);
  // The dropped thread is not read any more: not for its events, its reply's edit or its stall.
  expect(readsOf(() => room.announce.update('$a'))).toEqual([]);
  expect(readsOf(() => vi.advanceTimersByTime(STREAM_IDLE_LIMIT_MS + 1))).toEqual([]);
  expect(readsOf(() => room.finish(a))).toEqual([]);
});

it('follows only the newest read of a conversation', () => {
  const a = room.put('$a1', '$a');
  show([job('$a')]);
  // Read again, which follows the reply's edits and its stall anew.
  act(() => {
    room.announce.update('$a');
  });
  // One read for the edit, not one for each earlier read.
  expect(readsOf(() => room.finish(a))).toEqual(['$a']);
  // The reply finished, so no read waits for its stall.
  expect(readsOf(() => vi.advanceTimersByTime(STREAM_IDLE_LIMIT_MS + 1))).toEqual([]);
});

it('says nothing streams once no job is left', () => {
  room.put('$a1', '$a');
  show([job('$a')]);
  expect(streaming).toBe(true);
  show([]);
  expect(streaming).toBe(false);
});

it('takes a reply it cannot vouch for at its word only while the jobs run', () => {
  unvouched.add('$a1');
  room.put('$a1', '$a');
  show([job('$a')], false);
  expect(streaming).toBe(false);
  show([job('$a')], true);
  expect(streaming).toBe(true);
  // Vouched for while they ran, it still counts after them.
  show([job('$a')], false);
  expect(streaming).toBe(true);
});
