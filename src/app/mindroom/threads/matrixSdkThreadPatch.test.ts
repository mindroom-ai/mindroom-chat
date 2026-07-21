import { MatrixEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { logger } from 'matrix-js-sdk/lib/logger';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import { FeatureSupport, Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOM_ID = '!cinny-126-sdk-contract:example.org';
const ROOT_ID = '$root';
const VIEWER_ID = '@viewer:example.org';

const flushAsyncWork = async (cycles = 12) => {
  for (let index = 0; index < cycles; index += 1) await Promise.resolve();
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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

const makeEdit = (eventId: string, targetId: string, body: string, ts = 3) =>
  makeEvent(
    eventId,
    {
      body: `* ${body}`,
      'm.new_content': { body, msgtype: 'm.text' },
      'm.relates_to': { event_id: targetId, rel_type: 'm.replace' },
      msgtype: 'm.text',
    },
    ts
  );

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

  it('keeps rapid pre-init edits visible across pagination target replacement', async () => {
    const releasePagination = deferred<void>();
    const placeholder = makeEvent(
      '$placeholder',
      {
        body: 'Thinking...',
        'm.relates_to': { event_id: ROOT_ID, rel_type: 'm.thread' },
        msgtype: 'm.text',
      },
      2
    );
    const freshPlaceholder = makeEvent(placeholder.getId()!, placeholder.getContent(), 2);
    const root = makeEvent(ROOT_ID, { body: 'Root', msgtype: 'm.text' }, 1, VIEWER_ID);
    setThreadSummary(root, placeholder);
    const paginateEventTimeline = vi.fn<MatrixClient['paginateEventTimeline']>(async (timeline) => {
      await releasePagination.promise;
      timeline
        .getTimelineSet()
        .addEventsToTimeline([freshPlaceholder], true, false, timeline, null);
      return true;
    });
    const room = new Room(
      ROOM_ID,
      makeClient({
        fetchRoomEvent: vi.fn().mockResolvedValue(root.event),
        paginateEventTimeline,
      }),
      VIEWER_ID
    );
    addRootToRoom(room, root);
    const thread = room.createThread(ROOT_ID, root, [placeholder], false);
    await vi.waitFor(() => expect(paginateEventTimeline).toHaveBeenCalledOnce());
    const updateBodies: unknown[] = [];
    thread.on(ThreadEvent.Update, () => updateBodies.push(placeholder.getContent().body));
    const firstEdit = makeEdit('$edit-1', placeholder.getId()!, 'First draft');
    const finalEdit = makeEdit('$edit-2', placeholder.getId()!, 'Final answer');

    thread.addEvent(firstEdit, false);
    thread.addEvent(finalEdit, false);
    await flushAsyncWork(24);

    const replacements = room.relations.getChildEventsForEvent(
      placeholder.getId()!,
      'm.replace',
      'm.room.message'
    );
    expect(thread.initialEventsFetched).toBe(false);
    expect(replacements?.getRelations()).toEqual([firstEdit, finalEdit]);
    expect(placeholder.replacingEvent()).toBe(finalEdit);
    expect(placeholder.getContent().body).toBe('Final answer');
    expect(updateBodies).toEqual(['Final answer']);

    releasePagination.resolve();
    await flushAsyncWork(24);

    expect(thread.initialEventsFetched).toBe(true);
    expect(thread.findEventById(placeholder.getId()!)).toBe(freshPlaceholder);
    expect(freshPlaceholder.replacingEvent()).toBe(finalEdit);
    expect(freshPlaceholder.getContent().body).toBe('Final answer');
  });

  it('preserves encrypted edit arrival order and rebinds after pagination', async () => {
    const releasePagination = deferred<void>();
    const placeholder = makeEvent(
      '$encrypted-placeholder',
      {
        body: 'Thinking...',
        'm.relates_to': { event_id: ROOT_ID, rel_type: 'm.thread' },
        msgtype: 'm.text',
      },
      2
    );
    const freshPlaceholder = makeEvent(placeholder.getId()!, placeholder.getContent(), 2);
    const root = makeEvent(ROOT_ID, { body: 'Root', msgtype: 'm.text' }, 1, VIEWER_ID);
    setThreadSummary(root, placeholder);
    const paginateEventTimeline = vi.fn<MatrixClient['paginateEventTimeline']>(async (timeline) => {
      await releasePagination.promise;
      timeline
        .getTimelineSet()
        .addEventsToTimeline([freshPlaceholder], true, false, timeline, null);
      return true;
    });
    const room = new Room(
      ROOM_ID,
      makeClient({
        fetchRoomEvent: vi.fn().mockResolvedValue(root.event),
        paginateEventTimeline,
      }),
      VIEWER_ID
    );
    addRootToRoom(room, root);
    const thread = room.createThread(ROOT_ID, root, [placeholder], false);
    const makeEncryptedEdit = (eventId: string) =>
      new MatrixEvent({
        content: {
          algorithm: 'test-only',
          'm.relates_to': { event_id: placeholder.getId(), rel_type: 'm.replace' },
        },
        event_id: eventId,
        origin_server_ts: 3,
        room_id: ROOM_ID,
        sender: '@agent:example.org',
        type: 'm.room.encrypted',
      });
    const firstEdit = makeEncryptedEdit('$encrypted-edit-1');
    const finalEdit = makeEncryptedEdit('$encrypted-edit-2');
    const firstDecryption = deferred<{
      clearEvent: { content: Record<string, unknown>; type: string };
    }>();
    const finalDecryption = deferred<{
      clearEvent: { content: Record<string, unknown>; type: string };
    }>();
    const firstDecryptionPromise = firstEdit.attemptDecryption({
      decryptEvent: vi.fn(() => firstDecryption.promise),
    } as never);
    const finalDecryptionPromise = finalEdit.attemptDecryption({
      decryptEvent: vi.fn(() => finalDecryption.promise),
    } as never);

    thread.addEvent(firstEdit, false);
    thread.addEvent(finalEdit, false);
    await flushAsyncWork();
    finalDecryption.resolve({
      clearEvent: {
        content: {
          body: '* Final encrypted answer',
          'm.new_content': { body: 'Final encrypted answer', msgtype: 'm.text' },
          'm.relates_to': { event_id: placeholder.getId(), rel_type: 'm.replace' },
          msgtype: 'm.text',
        },
        type: 'm.room.message',
      },
    });
    await finalDecryptionPromise;
    await flushAsyncWork(24);
    expect(thread.initialEventsFetched).toBe(false);
    expect(placeholder.replacingEvent()).toBe(finalEdit);

    firstDecryption.resolve({
      clearEvent: {
        content: {
          body: '* First encrypted draft',
          'm.new_content': { body: 'First encrypted draft', msgtype: 'm.text' },
          'm.relates_to': { event_id: placeholder.getId(), rel_type: 'm.replace' },
          msgtype: 'm.text',
        },
        type: 'm.room.message',
      },
    });
    await firstDecryptionPromise;
    await flushAsyncWork(24);
    const replacements = room.relations.getChildEventsForEvent(
      placeholder.getId()!,
      'm.replace',
      'm.room.message'
    );
    expect(replacements?.getRelations()).toEqual([firstEdit, finalEdit]);
    expect(placeholder.replacingEvent()).toBe(finalEdit);
    expect(placeholder.getContent().body).toBe('Final encrypted answer');

    releasePagination.resolve();
    await flushAsyncWork(24);
    expect(thread.findEventById(placeholder.getId()!)).toBe(freshPlaceholder);
    expect(freshPlaceholder.replacingEvent()).toBe(finalEdit);
    expect(freshPlaceholder.getContent().body).toBe('Final encrypted answer');
  });

  it('reports fire-and-forget relation failures', async () => {
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const client = makeClient({
      fetchRoomEvent: vi.fn(
        () =>
          new Promise<Record<string, unknown>>(() => {
            // Keep initialization pending while the relation failure is exercised.
          })
      ),
      paginateEventTimeline: vi.fn(),
    });
    const room = new Room(ROOM_ID, client, VIEWER_ID);
    const root = makeEvent(ROOT_ID, { body: 'Root', msgtype: 'm.text' }, 1, VIEWER_ID);
    addRootToRoom(room, root);
    const thread = room.createThread(ROOT_ID, root, [], false);
    const target = makeEvent(
      '$failure-target',
      {
        body: 'Target',
        'm.relates_to': { event_id: ROOT_ID, rel_type: 'm.thread' },
        msgtype: 'm.text',
      },
      2
    );
    await room.addLiveEvents([target], { addToState: false, fromCache: false });
    const reaction = new MatrixEvent({
      content: {
        'm.relates_to': {
          event_id: target.getId(),
          key: '👍',
          rel_type: 'm.annotation',
        },
      },
      event_id: '$failed-reaction',
      origin_server_ts: 3,
      room_id: ROOM_ID,
      sender: VIEWER_ID,
      type: 'm.reaction',
    });
    const failure = new Error('forced aggregation failure');
    vi.spyOn(Relations.prototype, 'addEvent').mockRejectedValueOnce(failure);

    thread.addEvent(reaction, false);
    await flushAsyncWork(24);

    expect(loggerError).toHaveBeenCalledWith(
      'Failed to aggregate pre-initialization thread relation: ',
      failure
    );
  });

  it('serializes initialization and retries after pagination failure', async () => {
    const firstPagination = deferred<boolean>();
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const placeholder = makeEvent(
      '$retry-placeholder',
      {
        body: 'Thinking...',
        'm.relates_to': { event_id: ROOT_ID, rel_type: 'm.thread' },
        msgtype: 'm.text',
      },
      2
    );
    const root = makeEvent(ROOT_ID, { body: 'Root', msgtype: 'm.text' }, 1, VIEWER_ID);
    setThreadSummary(root, placeholder);
    const paginateEventTimeline = vi
      .fn<MatrixClient['paginateEventTimeline']>()
      .mockImplementationOnce(() => firstPagination.promise)
      .mockResolvedValue(true);
    const room = new Room(
      ROOM_ID,
      makeClient({
        fetchRoomEvent: vi.fn().mockResolvedValue(root.event),
        paginateEventTimeline,
      }),
      VIEWER_ID
    );
    addRootToRoom(room, root);
    const thread = room.createThread(ROOT_ID, root, [placeholder], false);
    await vi.waitFor(() => expect(paginateEventTimeline).toHaveBeenCalledOnce());

    thread.addEvents([], false);
    await flushAsyncWork();
    expect(paginateEventTimeline).toHaveBeenCalledOnce();

    const failure = new Error('forced pagination failure');
    firstPagination.reject(failure);
    await flushAsyncWork(24);
    expect(thread.initialEventsFetched).toBe(false);
    expect(loggerError).toHaveBeenCalledWith(
      'Failed to load start of newly created thread: ',
      failure
    );

    thread.addEvents([], false);
    await flushAsyncWork(24);
    expect(paginateEventTimeline).toHaveBeenCalledTimes(2);
    expect(thread.initialEventsFetched).toBe(true);
  });
});
