import {
  EventStatus,
  EventType,
  FeatureSupport,
  MatrixEvent,
  MsgType,
  PendingEventOrdering,
  RelationType,
  Room,
  RoomEvent,
  Thread,
  ThreadEvent,
  createClient,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOM_ID = '!room:example.org';
const USER_ID = '@user:example.org';

type SendResponse = { event_id: string };

type PendingRequest = {
  event: MatrixEvent;
  resolve: (response: SendResponse) => void;
  content: Record<string, unknown>;
};

const makeDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const makeHarness = (ordering = PendingEventOrdering.Chronological) => {
  const client = createClient({
    accessToken: 'token',
    baseUrl: 'https://matrix.example.org',
    timelineSupport: true,
    userId: USER_ID,
  });
  const room = new Room(ROOM_ID, client, USER_ID, {
    pendingEventOrdering: ordering,
    timelineSupport: true,
  });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  client.store.storeRoom(room);

  const requests: PendingRequest[] = [];
  const sendEventHttpRequest = vi.fn((event: MatrixEvent) => {
    const response = makeDeferred<SendResponse>();
    requests.push({
      content: structuredClone(event.getWireContent()),
      event,
      resolve: response.resolve,
    });
    return response.promise;
  });
  (
    client as unknown as {
      sendEventHttpRequest: typeof sendEventHttpRequest;
    }
  ).sendEventHttpRequest = sendEventHttpRequest;

  return { client, requests, room, sendEventHttpRequest };
};

const addLocalTarget = (room: Room, txnId: string): MatrixEvent => {
  const event = new MatrixEvent({
    content: {
      body: txnId,
      msgtype: MsgType.Text,
    },
    event_id: `~${ROOM_ID}:${txnId}`,
    origin_server_ts: Date.now(),
    room_id: ROOM_ID,
    sender: USER_ID,
    type: EventType.RoomMessage,
  });
  event.setTxnId(txnId);
  event.setStatus(EventStatus.SENDING);
  room.addPendingEvent(event, txnId);
  return event;
};

const makeReplyContent = (relationTarget: string, replyTarget = relationTarget) => ({
  body: 'reply',
  msgtype: MsgType.Text,
  'm.relates_to': {
    event_id: relationTarget,
    rel_type: RelationType.Thread,
    'm.in_reply_to': {
      event_id: replyTarget,
    },
  },
});

const waitForRequestCount = async (requests: PendingRequest[], count: number) => {
  await vi.waitFor(() => {
    expect(requests).toHaveLength(count);
  });
};

const finishRequest = async (
  requests: PendingRequest[],
  index: number,
  eventId: string,
  sendPromise: Promise<SendResponse>
) => {
  requests[index].resolve({ event_id: eventId });
  await sendPromise;
};

afterEach(() => {
  Thread.hasServerSideSupport = FeatureSupport.None;
});

describe('matrix-js-sdk local-echo association patch', () => {
  it('queues a chronological reply without calling getPendingEvents and rewrites both targets', async () => {
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    const { client, requests, room } = makeHarness();
    const canonicalThreadFetch = makeDeferred<MatrixEvent['event']>();
    const fetchRoomEvent = vi
      .spyOn(client, 'fetchRoomEvent')
      .mockReturnValue(canonicalThreadFetch.promise);
    const paginateEventTimeline = vi
      .spyOn(client, 'paginateEventTimeline')
      .mockResolvedValue(false);
    const getPendingEvents = vi.spyOn(room, 'getPendingEvents');
    const rootTxnId = 'root';
    const rootLocalId = `~${ROOM_ID}:${rootTxnId}`;

    const rootSend = client.sendMessage(
      ROOM_ID,
      { body: 'root', msgtype: MsgType.Text },
      rootTxnId
    );
    const replySend = client.sendMessage(ROOM_ID, makeReplyContent(rootLocalId), 'reply');

    const pendingReply = room.getEventForTxnId('reply');
    expect(pendingReply?.getId()).toBe(`~${ROOM_ID}:reply`);
    expect(room.relations.getAllChildEventsForEvent(rootLocalId)).toContain(pendingReply);
    expect(room.eventShouldLiveIn(pendingReply!)).toEqual({
      shouldLiveInRoom: false,
      shouldLiveInThread: true,
      threadId: rootLocalId,
    });
    const provisionalThread = room.getThread(rootLocalId);
    expect(provisionalThread?.events).toContain(pendingReply);
    expect(fetchRoomEvent).not.toHaveBeenCalled();
    expect(paginateEventTimeline).not.toHaveBeenCalled();
    expect(getPendingEvents).not.toHaveBeenCalled();

    await waitForRequestCount(requests, 1);
    await finishRequest(requests, 0, '$root', rootSend);
    await waitForRequestCount(requests, 2);

    expect(room.relations.getAllChildEventsForEvent(rootLocalId)).not.toContain(pendingReply);
    expect(room.relations.getAllChildEventsForEvent('$root')).toContain(pendingReply);
    expect(room.getThread(rootLocalId)).toBeNull();
    expect(room.getThread('$root')?.events).toContain(pendingReply);
    expect(room.getThread('$root')?.replayEvents).toContain(pendingReply);
    expect(provisionalThread?.listenerCount(ThreadEvent.Update)).toBe(0);
    expect(provisionalThread?.timelineSet.listenerCount(RoomEvent.Timeline)).toBe(0);
    expect(fetchRoomEvent).toHaveBeenCalledWith(ROOM_ID, '$root');
    expect(paginateEventTimeline).not.toHaveBeenCalled();
    expect(requests[1].content['m.relates_to']).toEqual({
      event_id: '$root',
      rel_type: RelationType.Thread,
      'm.in_reply_to': {
        event_id: '$root',
      },
    });

    await finishRequest(requests, 1, '$reply', replySend);
  });

  it('keeps dependent replacement working with detached pending ordering', async () => {
    const { client, requests, room } = makeHarness(PendingEventOrdering.Detached);
    const rootTxnId = 'detached-root';
    const rootLocalId = `~${ROOM_ID}:${rootTxnId}`;

    const rootSend = client.sendMessage(
      ROOM_ID,
      { body: 'root', msgtype: MsgType.Text },
      rootTxnId
    );
    const replySend = client.sendMessage(ROOM_ID, makeReplyContent(rootLocalId), 'detached-reply');

    expect(room.getPendingEvent(rootLocalId)).toBe(room.getEventForTxnId(rootTxnId));
    expect(room.getPendingEvent(`~${ROOM_ID}:detached-reply`)).toBe(
      room.getEventForTxnId('detached-reply')
    );

    await waitForRequestCount(requests, 1);
    await finishRequest(requests, 0, '$detached-root', rootSend);
    await waitForRequestCount(requests, 2);
    expect(requests[1].content['m.relates_to']).toEqual(
      expect.objectContaining({
        event_id: '$detached-root',
        'm.in_reply_to': { event_id: '$detached-root' },
      })
    );
    await finishRequest(requests, 1, '$detached-reply', replySend);
  });

  it('rewrites immediately when HTTP acknowledgement won the listener race', async () => {
    const { client, requests, room } = makeHarness();
    const rootTxnId = 'confirmed-before-reply';
    const rootLocalId = `~${ROOM_ID}:${rootTxnId}`;
    const rootSend = client.sendMessage(
      ROOM_ID,
      { body: 'root', msgtype: MsgType.Text },
      rootTxnId
    );

    await waitForRequestCount(requests, 1);
    await finishRequest(requests, 0, '$confirmed-root', rootSend);
    expect(room.getEventForTxnId(rootTxnId)?.getId()).toBe('$confirmed-root');

    const replySend = client.sendMessage(ROOM_ID, makeReplyContent(rootLocalId), 'late-reply');
    await waitForRequestCount(requests, 2);
    expect(requests[1].content['m.relates_to']).toEqual(
      expect.objectContaining({
        event_id: '$confirmed-root',
        'm.in_reply_to': { event_id: '$confirmed-root' },
      })
    );
    await finishRequest(requests, 1, '$late-reply', replySend);
  });

  it('resolves a stale local target after the remote echo evicts its transaction entry', async () => {
    const { client, requests, room } = makeHarness();
    const rootTxnId = 'remote-echo-root';
    const root = addLocalTarget(room, rootTxnId);
    const rootLocalId = root.getId()!;
    const remoteRoot = new MatrixEvent({
      content: root.getContent(),
      event_id: '$remote-echo-root',
      origin_server_ts: Date.now(),
      room_id: ROOM_ID,
      sender: USER_ID,
      type: EventType.RoomMessage,
      unsigned: {
        transaction_id: rootTxnId,
      },
    });

    room.handleRemoteEcho(remoteRoot, root);

    expect(room.getEventForTxnId(rootTxnId)).toBeUndefined();
    expect(room.findEventById(rootLocalId)).toBeUndefined();
    expect(room.findEventById('$remote-echo-root')).toBe(root);

    const replySend = client.sendMessage(
      ROOM_ID,
      makeReplyContent(rootLocalId),
      'post-remote-echo-reply'
    );

    await waitForRequestCount(requests, 1);
    expect(requests[0].content['m.relates_to']).toEqual({
      event_id: '$remote-echo-root',
      rel_type: RelationType.Thread,
      'm.in_reply_to': {
        event_id: '$remote-echo-root',
      },
    });
    expect(JSON.stringify(requests[0].content)).not.toContain(rootLocalId);
    await finishRequest(requests, 0, '$post-remote-echo-reply', replySend);
  });

  it('resolves an evicted transaction target loaded only in a non-live thread timeline', async () => {
    const { client, requests, room } = makeHarness();
    vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
    const root = new MatrixEvent({
      content: {
        body: 'root',
        msgtype: MsgType.Text,
      },
      event_id: '$thread-root',
      origin_server_ts: Date.now(),
      room_id: ROOM_ID,
      sender: USER_ID,
      type: EventType.RoomMessage,
    });
    const replyTxnId = 'remote-echo-thread-reply';
    const localReplyId = `~${ROOM_ID}:${replyTxnId}`;
    const confirmedReply = new MatrixEvent({
      content: makeReplyContent('$thread-root'),
      event_id: '$remote-echo-thread-reply',
      origin_server_ts: Date.now(),
      room_id: ROOM_ID,
      sender: USER_ID,
      type: EventType.RoomMessage,
      unsigned: {
        transaction_id: replyTxnId,
      },
    });
    const thread = room.createThread('$thread-root', root, [], false);
    const threadTimelineSet = thread.getUnfilteredTimelineSet();
    const historicalTimeline = threadTimelineSet.addTimeline();
    threadTimelineSet.addEventToTimeline(confirmedReply, historicalTimeline, {
      addToState: false,
      toStartOfTimeline: false,
    });

    expect(room.getEventForTxnId(replyTxnId)).toBeUndefined();
    expect(room.getLiveTimeline().getEvents()).not.toContain(confirmedReply);
    expect(thread.events).not.toContain(confirmedReply);
    expect(historicalTimeline.getEvents()).toContain(confirmedReply);

    const send = client.sendMessage(
      ROOM_ID,
      makeReplyContent('$thread-root', localReplyId),
      'reply-to-thread-only-event'
    );

    await waitForRequestCount(requests, 1);
    expect(requests[0].content['m.relates_to']).toEqual({
      event_id: '$thread-root',
      rel_type: RelationType.Thread,
      'm.in_reply_to': {
        event_id: '$remote-echo-thread-reply',
      },
    });
    expect(JSON.stringify(requests[0].content)).not.toContain(localReplyId);
    await finishRequest(requests, 0, '$reply-to-thread-only-event', send);
  });

  it('rewrites only a local thread root when the explicit reply target is already confirmed', async () => {
    const { client, requests, room } = makeHarness();
    const root = addLocalTarget(room, 'local-thread-root');
    const rootLocalId = root.getId()!;

    const send = client.sendMessage(
      ROOM_ID,
      makeReplyContent(rootLocalId, '$explicit-reply-target'),
      'explicit-reply'
    );
    room.updatePendingEvent(root, EventStatus.SENT, '$thread-root');

    await waitForRequestCount(requests, 1);
    expect(requests[0].content['m.relates_to']).toEqual({
      event_id: '$thread-root',
      rel_type: RelationType.Thread,
      'm.in_reply_to': {
        event_id: '$explicit-reply-target',
      },
    });
    await finishRequest(requests, 0, '$explicit-reply', send);
  });

  it.each([
    ['relation first', 0, 1],
    ['reply first', 1, 0],
  ])(
    'resolves distinct local relation and reply targets independently: %s',
    async (_label, firstIndex, secondIndex) => {
      const { client, requests, room } = makeHarness();
      const relationTarget = addLocalTarget(room, 'relation-target');
      const replyTarget = addLocalTarget(room, 'reply-target');
      const targets = [relationTarget, replyTarget];
      const confirmedIds = ['$relation-target', '$reply-target'];

      const send = client.sendMessage(
        ROOM_ID,
        makeReplyContent(relationTarget.getId()!, replyTarget.getId()!),
        'two-target-reply'
      );
      room.updatePendingEvent(targets[firstIndex], EventStatus.SENT, confirmedIds[firstIndex]);
      room.updatePendingEvent(targets[secondIndex], EventStatus.SENT, confirmedIds[secondIndex]);

      await waitForRequestCount(requests, 1);
      expect(requests[0].content['m.relates_to']).toEqual({
        event_id: '$relation-target',
        rel_type: RelationType.Thread,
        'm.in_reply_to': {
          event_id: '$reply-target',
        },
      });
      await finishRequest(requests, 0, '$two-target-reply', send);
    }
  );

  it('keeps redaction association replacement intact', async () => {
    const { client, requests, room } = makeHarness();
    const target = addLocalTarget(room, 'redaction-target');
    const sendCompleteEvent = (
      client as unknown as {
        sendCompleteEvent: (params: {
          eventObject: Partial<MatrixEvent['event']>;
          roomId: string;
          threadId: null;
          txnId: string;
        }) => Promise<SendResponse>;
      }
    ).sendCompleteEvent.bind(client);

    const send = sendCompleteEvent({
      eventObject: {
        content: {},
        redacts: target.getId(),
        type: EventType.RoomRedaction,
      },
      roomId: ROOM_ID,
      threadId: null,
      txnId: 'redaction',
    });
    room.updatePendingEvent(target, EventStatus.SENT, '$redaction-target');

    await waitForRequestCount(requests, 1);
    expect(requests[0].event.event.redacts).toBe('$redaction-target');
    await finishRequest(requests, 0, '$redaction', send);
  });

  it('preserves the existing one-argument association update behavior', () => {
    const localTargetId = `~${ROOM_ID}:compatibility-target`;
    const relation = new MatrixEvent({
      content: makeReplyContent(localTargetId),
      event_id: `~${ROOM_ID}:compatibility-relation`,
      room_id: ROOM_ID,
      type: EventType.RoomMessage,
    });
    const redaction = new MatrixEvent({
      content: {},
      event_id: `~${ROOM_ID}:compatibility-redaction`,
      redacts: localTargetId,
      room_id: ROOM_ID,
      type: EventType.RoomRedaction,
    });

    relation.updateAssociatedId('$relation-target');
    redaction.updateAssociatedId('$redaction-target');

    expect(relation.relationEventId).toBe('$relation-target');
    expect(relation.replyEventId).toBe(localTargetId);
    expect(redaction.event.redacts).toBe('$redaction-target');
  });

  it('rewrites lifted encrypted relation fields after encryption completes', async () => {
    const { client, requests, room } = makeHarness();
    const target = addLocalTarget(room, 'encrypted-target');
    const encryptionReady = makeDeferred<void>();
    const releaseEncryption = makeDeferred<void>();

    (
      client as unknown as {
        encryptEventIfNeeded: (event: MatrixEvent, room?: Room) => Promise<void>;
      }
    ).encryptEventIfNeeded = async (event) => {
      const relation = structuredClone(event.getWireContent()['m.relates_to']);
      event.makeEncrypted(
        EventType.RoomMessageEncrypted,
        {
          algorithm: 'test',
          ciphertext: 'test',
          'm.relates_to': relation,
        },
        'curve25519:test',
        'ed25519:test'
      );
      encryptionReady.resolve();
      await releaseEncryption.promise;
    };

    const send = client.sendMessage(ROOM_ID, makeReplyContent(target.getId()!), 'encrypted-reply');
    await encryptionReady.promise;
    room.updatePendingEvent(target, EventStatus.SENT, '$encrypted-target');
    releaseEncryption.resolve();

    await waitForRequestCount(requests, 1);
    expect(requests[0].event.getWireType()).toBe(EventType.RoomMessageEncrypted);
    expect(requests[0].content['m.relates_to']).toEqual({
      event_id: '$encrypted-target',
      rel_type: RelationType.Thread,
      'm.in_reply_to': {
        event_id: '$encrypted-target',
      },
    });
    expect(JSON.stringify(requests[0].content)).not.toContain(`~${ROOM_ID}:`);
    await finishRequest(requests, 0, '$encrypted-reply', send);
  });

  it('documents the in-flight encryption snapshot that the composer local-root gate avoids', async () => {
    const { client, requests, room } = makeHarness();
    const target = addLocalTarget(room, 'encrypting-target');
    const localTargetId = target.getId()!;
    const contentSnapshotTaken = makeDeferred<void>();
    const releaseEncryption = makeDeferred<void>();

    (
      client as unknown as {
        encryptEventIfNeeded: (event: MatrixEvent, room?: Room) => Promise<void>;
      }
    ).encryptEventIfNeeded = async (event) => {
      const relationSnapshot = structuredClone(event.getWireContent()['m.relates_to']);
      contentSnapshotTaken.resolve();
      await releaseEncryption.promise;
      event.makeEncrypted(
        EventType.RoomMessageEncrypted,
        {
          algorithm: 'test',
          ciphertext: 'test',
          'm.relates_to': relationSnapshot,
        },
        'curve25519:test',
        'ed25519:test'
      );
    };

    const send = client.sendMessage(ROOM_ID, makeReplyContent(target.getId()!), 'encrypting-reply');
    await contentSnapshotTaken.promise;
    room.updatePendingEvent(target, EventStatus.SENT, '$encrypting-target');
    releaseEncryption.resolve();

    await waitForRequestCount(requests, 1);
    expect(requests[0].content['m.relates_to']).toEqual({
      event_id: localTargetId,
      rel_type: RelationType.Thread,
      'm.in_reply_to': {
        event_id: localTargetId,
      },
    });
    await finishRequest(requests, 0, '$encrypting-reply', send);
  });
});
