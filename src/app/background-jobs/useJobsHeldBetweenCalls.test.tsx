// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { JOBS_HOLD_MS, useJobsHeldBetweenCalls } from './useJobsHeldBetweenCalls';

const AGENT = '@mindroom_helper:example.org';
const OTHER_AGENT = '@mindroom_scout:example.org';
const THREAD = '$thread';

// Replies the client has not seen stream through /sync, as after a reload.
const unvouched = new Set<string>();
vi.mock('../matrix/client/streamingReplies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/client/streamingReplies')>()),
  isStreamingReplyCurrent: (_room: Room, event: MatrixEvent) => !unvouched.has(event.getId()!),
}));

const timelineSet = (events: () => MatrixEvent[]) => ({
  getLiveTimeline: () => ({ getEvents: events, getNeighbouringTimeline: () => null }),
  relations: { getChildEventsForEvent: () => undefined },
});

/** A room as the jobs bar reads it: a thread's events and the main timeline's. */
const makeRoom = () => {
  const main: MatrixEvent[] = [];
  const threadEvents: MatrixEvent[] = [];
  const thread = Object.assign(new EventEmitter(), {
    getUnfilteredTimelineSet: () => timelineSet(() => threadEvents),
    lastReply: () => threadEvents.at(-1) ?? null,
  });
  const room = Object.assign(new EventEmitter(), {
    roomId: '!room:example.org',
    client: {},
    getThread: (id: string) => (id === THREAD ? thread : null),
    getLiveTimeline: () => timelineSet(() => main).getLiveTimeline(),
    getUnfilteredTimelineSet: () => timelineSet(() => main),
  });
  /** A reply that streams, in the thread or (`null`) in the main timeline; it arrives at once. */
  const streamReply = (id: string, sender = AGENT, threadId: string | null = THREAD) => {
    const event = new MatrixEvent({
      event_id: id,
      room_id: room.roomId,
      sender,
      type: 'm.room.message',
      origin_server_ts: 1,
      content: {
        msgtype: 'm.text',
        body: 'Working on it',
        'io.mindroom.stream_status': 'streaming',
        ...(threadId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } } : {}),
      },
    });
    if (threadId) {
      threadEvents.push(event);
      act(() => {
        thread.emit(ThreadEvent.Update, thread);
        room.emit(ThreadEvent.Update, thread);
      });
    } else {
      main.push(event);
      act(() => {
        room.emit('Room.timeline', event, room);
      });
    }
    return event;
  };
  /** The reply's finishing edit arrives. */
  const finish = (reply: MatrixEvent) =>
    act(() => {
      reply.makeReplaced(
        new MatrixEvent({
          event_id: `${reply.getId()}-done`,
          room_id: room.roomId,
          sender: reply.getSender(),
          type: 'm.room.message',
          origin_server_ts: 2,
          content: {
            msgtype: 'm.text',
            body: '* Done',
            'm.new_content': {
              msgtype: 'm.text',
              body: 'Done',
              'io.mindroom.stream_status': 'completed',
            },
            'm.relates_to': { rel_type: 'm.replace', event_id: reply.getId() },
          },
        })
      );
    });
  return { room: room as unknown as Room, streamReply, finish };
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

let room: ReturnType<typeof makeRoom>;
let shown: string[] = [];
let statuses: string[] = [];
let renderer: ReactTestRenderer | undefined;

function Probe({ jobs, view }: { jobs: BackgroundJob[]; view: string | null }) {
  const held = useJobsHeldBetweenCalls(jobs, view, (jobId) => jobId === 'sent', room.room);
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

it('holds the bar while the reply streams, however long the model thinks between calls', () => {
  room.streamReply('$reply');
  show([job('first')]);
  show(NONE);
  wait(JOBS_HOLD_MS * 5);
  expect(shown).toEqual(['first']);
  show([job('second')]);
  expect(shown).toEqual(['second']);
});

it('lets the bar go 2 s after the reply that ran the jobs ends, not before', () => {
  const reply = room.streamReply('$reply');
  show([job('first')]);
  show(NONE);
  wait(JOBS_HOLD_MS * 3);
  room.finish(reply);
  wait(JOBS_HOLD_MS - 1);
  expect(shown).toEqual(['first']);
  wait(1);
  expect(shown).toEqual([]);
});

it('holds the bar while its reply streams in the main timeline, then 2 s', () => {
  // A room whose agents answer in the main timeline: the jobs name no thread.
  const reply = room.streamReply('$reply', AGENT, null);
  show([job('first', null)], null);
  show(NONE, null);
  wait(JOBS_HOLD_MS * 5);
  expect(shown).toEqual(['first']);
  show([job('second', null)], null);
  show(NONE, null);
  room.finish(reply);
  wait(JOBS_HOLD_MS - 1);
  expect(shown).toEqual(['second']);
  wait(1);
  expect(shown).toEqual([]);
});

it("lets the bar go 2 s after its own reply ends while another agent's reply streams", () => {
  const reply = room.streamReply('$reply');
  room.streamReply('$other', OTHER_AGENT);
  show([job('first')]);
  show(NONE);
  room.finish(reply);
  wait(JOBS_HOLD_MS - 1);
  expect(shown).toEqual(['first']);
  wait(1);
  expect(shown).toEqual([]);
});

it('holds the bar for a reply the client did not see stream yet, as after a reload', () => {
  const reply = room.streamReply('$reply');
  unvouched.add('$reply');
  show([job('first')]);
  show(NONE);
  wait(JOBS_HOLD_MS * 5);
  expect(shown).toEqual(['first']);
  room.finish(reply);
  wait(JOBS_HOLD_MS);
  expect(shown).toEqual([]);
});

it('does not hold the bar for a reply it did not see stream while the jobs ran', () => {
  show([job('first')]);
  show(NONE);
  // It arrives only after its jobs, from a sync this client cannot vouch for.
  unvouched.add('$reply');
  room.streamReply('$reply');
  wait(JOBS_HOLD_MS);
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
  act(() => {
    vi.advanceTimersByTime(JOBS_HOLD_MS - 1);
  });
  expect(shown).toEqual(['first']);
  show([job('second')]);
  expect(shown).toEqual(['second']);
});

it('lets the bar go once no call follows within the hold', () => {
  show([job('first')]);
  show(NONE);
  act(() => {
    vi.advanceTimersByTime(JOBS_HOLD_MS);
  });
  expect(shown).toEqual([]);
});

it('does not extend the hold when other views change the room jobs', () => {
  show([job('first')]);
  show(NONE);
  act(() => {
    vi.advanceTimersByTime(JOBS_HOLD_MS - 500);
  });
  // A job elsewhere in the room gives this view a new empty list.
  show([]);
  act(() => {
    vi.advanceTimersByTime(500);
  });
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
