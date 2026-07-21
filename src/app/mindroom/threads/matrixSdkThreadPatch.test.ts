import { MatrixEvent, MatrixEventEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { logger } from 'matrix-js-sdk/lib/logger';
import { FeatureSupport, Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOM_ID = '!cinny-126-sdk-contract:example.org';
const ROOT_ID = '$root';
const VIEWER_ID = '@viewer:example.org';

const flushAsyncWork = async (cycles = 12) => {
  for (let index = 0; index < cycles; index += 1) await Promise.resolve();
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const makeEvent = (
  eventId: string,
  content: Record<string, unknown>,
  ts: number,
  sender = '@agent:example.org'
) =>
  new MatrixEvent({
    content,
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
  });

const addRootToRoom = (room: Room, root: MatrixEvent) => {
  room.getUnfilteredTimelineSet().addEventToTimeline(root, room.getLiveTimeline(), {
    addToState: false,
    roomState: room.currentState,
    toStartOfTimeline: false,
  });
};

const setThreadSummary = (root: MatrixEvent, latestReply: MatrixEvent) => {
  root.setUnsigned({
    'm.relations': {
      'm.thread': {
        count: 1,
        current_user_participated: true,
        latest_event: latestReply.event,
      },
    },
  });
};

const makeClient = (overrides: Partial<MatrixClient> = {}) =>
  ({
    canSupport: new Map([[Feature.RelationsRecursion, ServerSupport.Stable]]),
    getEventMapper:
      () =>
      (event: MatrixEvent | Record<string, unknown>): MatrixEvent =>
        event instanceof MatrixEvent ? event : new MatrixEvent(event),
    getUserId: () => VIEWER_ID,
    supportsThreads: () => true,
    ...overrides,
  } as unknown as MatrixClient);

describe('matrix-js-sdk CINNY-126 patch contract', () => {
  let previousThreadSupport: FeatureSupport;

  beforeEach(() => {
    previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Thread.hasServerSideSupport = previousThreadSupport;
  });

  it('aggregates replacements and publishes a thread update before initial pagination completes', async () => {
    const rootFetch = new Promise<Record<string, unknown>>(() => {
      // Deliberately unresolved so the assertions observe the pre-initialization path.
    });
    const client = makeClient({
      fetchRoomEvent: vi.fn(() => rootFetch),
      paginateEventTimeline: vi.fn(),
    });
    const room = new Room(ROOM_ID, client, VIEWER_ID);
    const root = makeEvent(ROOT_ID, { body: 'Root', msgtype: 'm.text' }, 1, VIEWER_ID);
    addRootToRoom(room, root);
    const thread = room.createThread(ROOT_ID, root, [], false);
    const placeholder = makeEvent(
      '$placeholder',
      {
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
        'm.relates_to': { event_id: ROOT_ID, rel_type: 'm.thread' },
        msgtype: 'm.text',
      },
      2
    );
    await room.addLiveEvents([placeholder], { addToState: false, fromCache: false });

    const replacedEventIds: Array<string | undefined> = [];
    const threadUpdateBodies: unknown[] = [];
    placeholder.on(MatrixEventEvent.Replaced, () => {
      replacedEventIds.push(placeholder.replacingEvent()?.getId());
    });
    thread.on(ThreadEvent.Update, () => {
      threadUpdateBodies.push(placeholder.getContent().body);
    });
    const streamingEdit = makeEvent(
      '$streaming-edit',
      {
        body: '* First draft',
        'io.mindroom.stream_status': 'streaming',
        'm.new_content': {
          body: 'First draft',
          'io.mindroom.stream_status': 'streaming',
          msgtype: 'm.notice',
        },
        'm.relates_to': { event_id: '$placeholder', rel_type: 'm.replace' },
        msgtype: 'm.notice',
      },
      3
    );
    const finalEdit = makeEvent(
      '$final-edit',
      {
        body: '* Final answer',
        'io.mindroom.stream_status': 'completed',
        'm.new_content': {
          body: 'Final answer',
          'io.mindroom.stream_status': 'completed',
          msgtype: 'm.text',
        },
        'm.relates_to': { event_id: '$placeholder', rel_type: 'm.replace' },
        msgtype: 'm.text',
      },
      4
    );

    await room.addLiveEvents([streamingEdit], { addToState: false, fromCache: false });
    await flushAsyncWork();
    await room.addLiveEvents([finalEdit], { addToState: false, fromCache: false });
    await flushAsyncWork();

    expect(thread.initialEventsFetched).toBe(false);
    expect(thread.replayEvents).toContain(streamingEdit);
    expect(thread.replayEvents).toContain(finalEdit);
    expect(placeholder.replacingEvent()).toBe(finalEdit);
    expect(placeholder.getContent()).toMatchObject({
      body: 'Final answer',
      'io.mindroom.stream_status': 'completed',
    });
    expect(replacedEventIds).toEqual(['$streaming-edit', '$final-edit']);
    expect(threadUpdateBodies).toEqual(['First draft', 'Final answer']);

    const replacementListenerCount = placeholder.listenerCount(MatrixEventEvent.Replaced);
    expect(replacementListenerCount).toBe(1);
    const staleEdits = Array.from({ length: 25 }, (_, index) =>
      makeEvent(
        `$stale-edit-${index}`,
        {
          body: `* Stale draft ${index}`,
          'm.new_content': { body: `Stale draft ${index}`, msgtype: 'm.text' },
          'm.relates_to': { event_id: '$placeholder', rel_type: 'm.replace' },
          msgtype: 'm.text',
        },
        3
      )
    );

    await room.addLiveEvents(staleEdits, { addToState: false, fromCache: false });
    await flushAsyncWork();

    expect(placeholder.replacingEvent()).toBe(finalEdit);
    expect(placeholder.getContent().body).toBe('Final answer');
    expect(threadUpdateBodies).toEqual(['First draft', 'Final answer']);
    expect(placeholder.listenerCount(MatrixEventEvent.Replaced)).toBe(replacementListenerCount);
  });

  it('applies the first edit that arrives while initial pagination has reset the timeline', async () => {
    const pagination = deferred<boolean>();
    const placeholder = makeEvent(
      '$pagination-placeholder',
      {
        body: 'Thinking...',
        'm.relates_to': { event_id: ROOT_ID, rel_type: 'm.thread' },
        msgtype: 'm.text',
      },
      2
    );
    const root = makeEvent(ROOT_ID, { body: 'Root', msgtype: 'm.text' }, 1, VIEWER_ID);
    setThreadSummary(root, placeholder);
    const paginateEventTimeline = vi.fn(() => pagination.promise);
    const client = makeClient({
      fetchRoomEvent: vi.fn().mockResolvedValue(root.event),
      paginateEventTimeline,
    });
    const room = new Room(ROOM_ID, client, VIEWER_ID);
    addRootToRoom(room, root);
    const thread = room.createThread(ROOT_ID, root, [placeholder], false);

    await flushAsyncWork();

    expect(paginateEventTimeline).toHaveBeenCalledOnce();
    expect(thread.initialEventsFetched).toBe(false);
    expect(thread.findEventById(placeholder.getId()!)).toBeUndefined();

    const replacementSignals: string[] = [];
    const threadUpdateBodies: unknown[] = [];
    placeholder.on(MatrixEventEvent.Replaced, () => {
      replacementSignals.push(placeholder.replacingEvent()?.getId() ?? 'missing');
    });
    thread.on(ThreadEvent.Update, () => {
      threadUpdateBodies.push(placeholder.getContent().body);
    });
    const edit = makeEvent(
      '$during-pagination-edit',
      {
        body: '* Final during pagination',
        'm.new_content': { body: 'Final during pagination', msgtype: 'm.text' },
        'm.relates_to': { event_id: placeholder.getId(), rel_type: 'm.replace' },
        msgtype: 'm.text',
      },
      3
    );

    thread.addEvent(edit, false);
    await flushAsyncWork();

    expect(placeholder.replacingEvent()).toBe(edit);
    expect(placeholder.getContent().body).toBe('Final during pagination');
    expect(replacementSignals).toEqual(['$during-pagination-edit']);
    expect(threadUpdateBodies).toEqual(['Final during pagination']);

    pagination.resolve(true);
    await flushAsyncWork();
  });

  it('reapplies a pre-init edit to the fresh target instance returned by pagination', async () => {
    const releasePagination = deferred<void>();
    const placeholder = makeEvent(
      '$remapped-placeholder',
      {
        body: 'Thinking...',
        'm.relates_to': { event_id: ROOT_ID, rel_type: 'm.thread' },
        msgtype: 'm.text',
      },
      2
    );
    const freshPlaceholder = makeEvent(
      placeholder.getId()!,
      {
        body: 'Thinking...',
        'm.relates_to': { event_id: ROOT_ID, rel_type: 'm.thread' },
        msgtype: 'm.text',
      },
      2
    );
    const root = makeEvent(ROOT_ID, { body: 'Root', msgtype: 'm.text' }, 1, VIEWER_ID);
    setThreadSummary(root, placeholder);
    const paginateEventTimeline = vi.fn<MatrixClient['paginateEventTimeline']>(async (timeline) => {
      await releasePagination.promise;
      timeline
        .getTimelineSet()
        .addEventsToTimeline([freshPlaceholder], true, false, timeline, null);
      return true;
    });
    const client = makeClient({
      fetchRoomEvent: vi.fn().mockResolvedValue(root.event),
      paginateEventTimeline,
    });
    const room = new Room(ROOM_ID, client, VIEWER_ID);
    addRootToRoom(room, root);
    const thread = room.createThread(ROOT_ID, root, [placeholder], false);
    const edit = makeEvent(
      '$pre-pagination-edit',
      {
        body: '* Final after remap',
        'm.new_content': { body: 'Final after remap', msgtype: 'm.text' },
        'm.relates_to': { event_id: placeholder.getId(), rel_type: 'm.replace' },
        msgtype: 'm.text',
      },
      3
    );

    thread.addEvent(edit, false);
    await flushAsyncWork();

    expect(paginateEventTimeline).toHaveBeenCalledOnce();
    expect(placeholder.replacingEvent()).toBe(edit);
    expect(placeholder.getContent().body).toBe('Final after remap');
    expect(freshPlaceholder).not.toBe(placeholder);

    releasePagination.resolve();
    await flushAsyncWork(24);

    expect(thread.initialEventsFetched).toBe(true);
    expect(thread.findEventById(placeholder.getId()!)).toBe(freshPlaceholder);
    expect(freshPlaceholder.replacingEvent()).toBe(edit);
    expect(freshPlaceholder.getContent().body).toBe('Final after remap');
    expect(placeholder.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
    expect(freshPlaceholder.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
  });

  it('retries initial pagination after the first request rejects', async () => {
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const latestReply = makeEvent(
      '$latest-reply',
      {
        body: 'Latest reply',
        'm.relates_to': { event_id: ROOT_ID, rel_type: 'm.thread' },
        msgtype: 'm.text',
      },
      2
    );
    const root = makeEvent(ROOT_ID, { body: 'Root', msgtype: 'm.text' }, 1, VIEWER_ID);
    setThreadSummary(root, latestReply);
    const paginateEventTimeline = vi
      .fn<MatrixClient['paginateEventTimeline']>()
      .mockRejectedValueOnce(new Error('forced pagination failure'))
      .mockResolvedValue(true);
    const client = makeClient({
      fetchRoomEvent: vi.fn().mockResolvedValue(root.event),
      paginateEventTimeline,
    });
    const room = new Room(ROOM_ID, client, VIEWER_ID);
    addRootToRoom(room, root);
    try {
      const thread = room.createThread(ROOT_ID, root, [], false);

      await flushAsyncWork();

      expect(paginateEventTimeline).toHaveBeenCalledOnce();
      expect(thread.initialEventsFetched).toBe(false);
      expect(loggerError).toHaveBeenCalledWith(
        'Failed to load start of newly created thread: ',
        expect.objectContaining({ message: 'forced pagination failure' })
      );

      thread.addEvents([], false);
      await flushAsyncWork();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(paginateEventTimeline).toHaveBeenCalledTimes(2);
      expect(thread.initialEventsFetched).toBe(true);
      expect(thread.replayEvents).toBeNull();
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection);
    }
  });
});
