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
    const rootFetch = new Promise<Record<string, unknown>>(() => undefined);
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

    let replacedSignals = 0;
    let threadUpdates = 0;
    placeholder.on(MatrixEventEvent.Replaced, () => {
      replacedSignals += 1;
    });
    thread.on(ThreadEvent.Update, () => {
      threadUpdates += 1;
    });
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
      3
    );

    await room.addLiveEvents([finalEdit], { addToState: false, fromCache: false });
    await flushAsyncWork();

    expect(thread.initialEventsFetched).toBe(false);
    expect(thread.replayEvents).toContain(finalEdit);
    expect(placeholder.replacingEvent()).toBe(finalEdit);
    expect(placeholder.getContent()).toMatchObject({
      body: 'Final answer',
      'io.mindroom.stream_status': 'completed',
    });
    expect(replacedSignals).toBe(1);
    expect(threadUpdates).toBe(1);
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
    root.setUnsigned({
      'm.relations': {
        'm.thread': {
          count: 1,
          current_user_participated: true,
          latest_event: latestReply.event,
        },
      },
    });
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
