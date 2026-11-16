import { MatrixEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isKnownRedactedEventId } from '../matrix/eventRevision';
import { receiptReadTs } from '../matrix/receiptReadTs';

const makeClient = (): MatrixClient =>
  ({
    canSupport: new Map(),
    decryptEventIfNeeded: async () => undefined,
    getUserId: () => '@alice:example.org',
    supportsThreads: () => true,
  } as unknown as MatrixClient);

const makeRoom = () => new Room('!room:example.org', makeClient(), '@alice:example.org');

const makeReply = (threadId: string, index: number) =>
  new MatrixEvent({
    content: {
      body: `Reply ${index}`,
      msgtype: 'm.text',
      'm.relates_to': { event_id: threadId, rel_type: 'm.thread' },
    },
    event_id: `$reply-${index}`,
    origin_server_ts: index,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

const threadEvent = (threadId: string, eventId: string, ts = 1) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
      'm.relates_to': { event_id: threadId, rel_type: 'm.thread' },
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

/** Adds an event to a thread's live timeline the way the thread itself does. */
const addToThread = (thread: Thread, event: MatrixEvent) =>
  thread.timelineSet.addEventToTimeline(event, thread.liveTimeline, {
    toStartOfTimeline: false,
    addToState: false,
  });

/**
 * Looks `eventId` up in the room and tells whether any of its threads was asked. It first forgets
 * which thread found each event last (the SDK looks events up as it adds them), so that only what
 * the room knows its threads hold decides whether it asks them.
 */
const lookUp = (room: Room, eventId: string) => {
  // eslint-disable-next-line dot-notation
  room['threadByFoundEventId'].clear();
  const lookups = room.getThreads().map((thread) => vi.spyOn(thread, 'findEventById'));
  const event = room.findEventById(eventId);
  const askedThreads = lookups.some((lookup) => lookup.mock.calls.length > 0);
  lookups.forEach((lookup) => lookup.mockRestore());
  return { event, askedThreads };
};

const missed = { event: undefined, askedThreads: false };

describe('matrix-js-sdk Room.findEventById (patched)', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.None;
  });

  afterEach(() => {
    Thread.hasServerSideSupport = previousThreadSupport;
    vi.restoreAllMocks();
  });

  it('finds a thread event again without scanning the other threads', () => {
    const room = makeRoom();
    const threads = Array.from({ length: 5 }, (_, index) =>
      room.createThread(
        `$thread-${index}`,
        undefined,
        [makeReply(`$thread-${index}`, index)],
        false
      )
    );
    const reply = threads[4]!.findEventById('$reply-4');
    expect(reply).toBeDefined();
    expect(room.findEventById('$reply-4')).toBe(reply);
    const otherThreadLookups = threads
      .slice(0, 4)
      .map((thread) => vi.spyOn(thread, 'findEventById'));

    expect(room.findEventById('$reply-4')).toBe(reply);
    otherThreadLookups.forEach((lookup) => expect(lookup).not.toHaveBeenCalled());
  });

  it('does not return an event from a thread the room has removed', () => {
    const room = makeRoom();
    const thread = room.createThread('$thread-0', undefined, [makeReply('$thread-0', 0)], false);
    expect(room.findEventById('$reply-0')).toBeDefined();

    // The SDK subscribes this private handler once server thread lists load.
    // eslint-disable-next-line dot-notation
    room['onThreadDelete'](thread);

    expect(room.getThread('$thread-0')).toBeNull();
    expect(room.findEventById('$reply-0')).toBeUndefined();
  });

  // A room with hundreds of threads asks for events no timeline holds (a read receipt's terminal
  // edit, the edit bundled with a thread's newest reply) once per thread on every update.
  it('answers an event no thread holds without asking any thread', () => {
    const room = makeRoom();
    Array.from({ length: 50 }, (_, index) =>
      room.createThread(
        `$thread-${index}`,
        undefined,
        [makeReply(`$thread-${index}`, index)],
        false
      )
    );

    expect(lookUp(room, '$terminal-edit')).toEqual(missed);
    expect(lookUp(room, '$reply-49').event?.getId()).toBe('$reply-49');
  });

  it('answers an ID two threads hold as before: the thread that answered it last, else room order', () => {
    const room = makeRoom();
    const first = room.createThread('$first', undefined, [threadEvent('$first', '$shared')], false);
    const second = room.createThread(
      '$second',
      undefined,
      [threadEvent('$second', '$moved')],
      false
    );
    addToThread(second, threadEvent('$second', '$shared'));

    expect(room.findEventById('$shared')).toBe(first.findEventById('$shared'));
    expect(room.findEventById('$moved')).toBe(second.findEventById('$moved'));
    addToThread(first, threadEvent('$first', '$moved'));
    expect(room.findEventById('$moved')).toBe(second.findEventById('$moved'));
  });

  describe('knows which IDs its threads hold', () => {
    it('as a thread gains and loses an event, set once or twice', () => {
      const room = makeRoom();
      const thread = room.createThread('$thread', undefined, [], false);
      room.createThread('$other', undefined, [threadEvent('$other', '$kept')], false);
      const event = threadEvent('$thread', '$event');

      addToThread(thread, event);
      addToThread(thread, event);
      expect(room.findEventById('$event')).toBe(event);
      thread.timelineSet.removeEvent('$event');

      expect(lookUp(room, '$event')).toEqual(missed);
    });

    it('through a rename and a remote echo onto an ID the thread already holds', () => {
      const room = makeRoom();
      const thread = room.createThread('$thread', undefined, [], false);
      const local = threadEvent('$thread', '$local');
      const held = threadEvent('$thread', '$held');
      const echoed = threadEvent('$thread', '$echoed');
      [local, held, echoed].forEach((event) => addToThread(thread, event));

      thread.timelineSet.replaceEventId('$local', '$remote');
      local.replaceLocalEventId('$remote');
      expect(lookUp(room, '$local')).toEqual(missed);
      expect(room.findEventById('$remote')).toBe(local);

      thread.timelineSet.handleRemoteEcho(echoed, '$echoed', '$held');
      expect(lookUp(room, '$echoed')).toEqual(missed);
      thread.timelineSet.removeEvent('$held');
      expect(lookUp(room, '$held')).toEqual(missed);
    });

    it('through a full reset, and a late page into a timeline the reset dropped', () => {
      const room = makeRoom();
      const thread = room.createThread(
        '$thread',
        undefined,
        [threadEvent('$thread', '$old')],
        false
      );
      const dropped = thread.liveTimeline;

      thread.timelineSet.resetLiveTimeline();
      expect(lookUp(room, '$old')).toEqual(missed);

      const late = threadEvent('$thread', '$late');
      thread.timelineSet.addEventsToTimeline([late], true, false, dropped);
      expect(thread.timelineSet.getTimelines()).not.toContain(dropped);
      expect(room.findEventById('$late')).toBe(late);
    });

    it('from what a thread held before the room registered it', () => {
      const room = makeRoom();
      const early = threadEvent('$thread', '$early');
      // Stands in for events a thread's constructor adds to its own timelines.
      const setEventMetadata = Thread.prototype.setEventMetadata;
      vi.spyOn(Thread.prototype, 'setEventMetadata').mockImplementation(function (
        this: Thread,
        event
      ) {
        if (!this.findEventById('$early')) addToThread(this, early);
        setEventMetadata.call(this, event);
      });

      room.createThread('$thread', undefined, [], false);

      expect(room.findEventById('$early')).toBe(early);
    });

    it('per thread instance: an instance the room deleted or replaced counts no more', () => {
      const room = makeRoom();
      room.createThread('$other', undefined, [threadEvent('$other', '$kept')], false);
      const deleted = room.createThread(
        '$thread',
        undefined,
        [threadEvent('$thread', '$gone'), threadEvent('$thread', '$both')],
        false
      );

      // eslint-disable-next-line dot-notation
      room['onThreadDelete'](deleted);
      expect(lookUp(room, '$gone')).toEqual(missed);
      const current = room.createThread(
        '$thread',
        undefined,
        [threadEvent('$thread', '$both')],
        false
      );
      expect(current).not.toBe(deleted);
      expect(lookUp(room, '$gone')).toEqual(missed);

      addToThread(deleted, threadEvent('$thread', '$stale'));
      expect(lookUp(room, '$stale')).toEqual(missed);
      deleted.timelineSet.removeEvent('$both');
      expect(room.findEventById('$both')).toBe(current.findEventById('$both'));
      expect(room.findEventById('$both')).toBeDefined();
    });
  });

  // eventRepository's cache hydration looks events up through a facade over the room.
  it('leaves a lookup facade over the room its own events', () => {
    const room = makeRoom();
    room.createThread('$thread', undefined, [threadEvent('$thread', '$reply', 5)], false);
    const detached = threadEvent('$thread', '$detached', 7);
    detached.makeRedacted(
      new MatrixEvent({ type: 'm.room.redaction', event_id: '$redaction', redacts: '$detached' }),
      room
    );
    const lookupRoom = Object.create(room) as Room;
    lookupRoom.findEventById = (id) => (id === '$detached' ? detached : room.findEventById(id));

    expect(isKnownRedactedEventId(lookupRoom, '$detached')).toBe(true);
    expect(receiptReadTs(lookupRoom, lookupRoom, '$detached', 0)).toBe(7);
    expect(receiptReadTs(lookupRoom, lookupRoom, '$reply', 0)).toBe(5);
    expect(receiptReadTs(lookupRoom, lookupRoom, '$unknown', 3)).toBe(3);
  });
});
