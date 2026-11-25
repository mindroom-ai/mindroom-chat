import React from 'react';
import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EventStatus,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  MemoryStore,
  RelationType,
  Room,
  RoomEvent,
  Thread,
} from 'matrix-js-sdk';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  type ActivityTrackedSection,
  getRoomActivityTimestamp,
  getSubRoomTreeActivityTs,
  sortRoomIdsByActivity,
  useRoomActivityListener,
} from './roomActivity';

type FakeRoom = { roomId: string; ts: number; getLastActiveTimestamp: () => number };
type Rec = Record<string, unknown>;
type Extra = Partial<{ state_key: string; redacts: string; unsigned: Rec }>;

const fakeRoom = (roomId: string, ts: number): FakeRoom => {
  const room: FakeRoom = { roomId, ts, getLastActiveTimestamp: () => room.ts };
  return room;
};

const ev = (
  roomId: string,
  id: string,
  ts: number,
  type: string,
  content: Rec = {},
  extra?: Extra
) =>
  new MatrixEvent({
    type,
    room_id: roomId,
    event_id: id,
    sender: '@alice:example.org',
    origin_server_ts: ts,
    content,
    ...extra,
  });

const rel = (rel_type: string, event_id: string, extra?: Rec) => ({
  'm.relates_to': { rel_type, event_id, ...extra },
});

const msg = (roomId: string, id: string, ts: number, extra?: Rec, unsigned?: Rec) =>
  ev(
    roomId,
    id,
    ts,
    'm.room.message',
    { msgtype: 'm.text', body: id, ...extra },
    unsigned ? { unsigned } : undefined
  );

const enc = (roomId: string, id: string, ts: number, extra?: Rec) =>
  ev(roomId, id, ts, 'm.room.encrypted', {
    algorithm: 'm.megolm.v1.aes-sha2',
    ciphertext: 'x',
    ...extra,
  });

const addLive = (room: Room, ...events: MatrixEvent[]) =>
  room.addLiveEvents(events, { addToState: false });
const liveIds = (r: Room) =>
  r
    .getLiveTimeline()
    .getEvents()
    .map((e) => e.getId());
const liveAct = (room: Room, ...events: MatrixEvent[]) =>
  act(async () => {
    await addLive(room, ...events);
  });

const makeRealRooms = (...roomIds: string[]) => {
  const client = new MatrixClient({
    baseUrl: 'https://example.org',
    userId: '@alice:example.org',
    store: new MemoryStore(),
    timelineSupport: true,
  });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  vi.spyOn(client, 'fetchRoomEvent').mockRejectedValue(new Error('offline'));
  const rooms = roomIds.map(
    (id) => new Room(id, client, '@alice:example.org', { timelineSupport: true })
  );
  const byId = new Map(rooms.map((r) => [r.roomId, r]));
  vi.spyOn(client, 'getRoom').mockImplementation((id) => byId.get(id ?? '') ?? null);
  return { client, rooms };
};

describe('roomActivity helpers', () => {
  it('guards missing, zero, negative, and non-finite fallback activity timestamps', () => {
    expect(getRoomActivityTimestamp(undefined)).toBe(0);
    for (const bad of [0, -5, Number.NaN]) {
      expect(getRoomActivityTimestamp(fakeRoom('!x', bad) as unknown as Room)).toBe(0);
    }
    expect(getRoomActivityTimestamp(fakeRoom('!x', 1234) as unknown as Room)).toBe(1234);
  });

  it('includes real matrix-js-sdk thread replies and excludes m.replace edits', async () => {
    const { client, rooms } = makeRealRooms('!a:ex', '!b:ex', '!edit:ex', '!sum:ex');
    const [roomA, roomB, editOnly, summaryRoom] = rooms as [Room, Room, Room, Room];
    const idA = roomA.roomId;

    await addLive(
      roomA,
      msg(idA, '$a1', 100),
      msg(idA, '$a2', 300, {
        'm.new_content': { msgtype: 'm.text', body: 'ed' },
        ...rel(RelationType.Replace, '$a1'),
      })
    );
    await addLive(roomB, msg(roomB.roomId, '$b1', 200));

    expect(roomA.getLastActiveTimestamp()).toBe(300);
    expect(getRoomActivityTimestamp(roomA)).toBe(100);
    expect(getRoomActivityTimestamp(roomB)).toBe(200);
    expect(sortRoomIdsByActivity(client, [idA, roomB.roomId])).toEqual([roomB.roomId, idA]);

    // Edit-only live timeline does NOT fall back to getLastActiveTimestamp.
    editOnly
      .getLiveTimeline()
      .addEvent(msg(editOnly.roomId, '$e1', 900, rel(RelationType.Replace, '$missing')), {
        toStartOfTimeline: false,
        addToState: false,
      });
    expect(editOnly.getLastActiveTimestamp()).toBe(900);
    expect(getRoomActivityTimestamp(editOnly)).toBe(0);

    // Real thread reply at ts=400 lifts Room A above Room B even though main timeline misses it.
    await addLive(roomA, msg(idA, '$a3', 400, rel('m.thread', '$a1', { is_falling_back: true })));
    expect(roomA.getThread('$a1')).toBeInstanceOf(Thread);
    expect(liveIds(roomA)).not.toContain('$a3');
    expect(roomA.getLastActiveTimestamp()).toBe(300);
    expect(getRoomActivityTimestamp(roomA)).toBe(400);
    expect(sortRoomIdsByActivity(client, [idA, roomB.roomId])).toEqual([idA, roomB.roomId]);

    // An m.replace edit targeting the thread reply at ts=500 must not bump Room A past 400.
    await addLive(roomA, msg(idA, '$a4', 500, rel(RelationType.Replace, '$a3')));
    expect(getRoomActivityTimestamp(roomA)).toBe(400);

    // Bundled thread summary (replyToEvent on an unopened thread) contributes its reply timestamp.
    const summaryRoot = msg(summaryRoom.roomId, '$s1', 100, undefined, {
      'm.relations': {
        'm.thread': {
          latest_event: {
            type: 'm.room.message',
            room_id: summaryRoom.roomId,
            event_id: '$s2',
            sender: '@bob:example.org',
            origin_server_ts: 750,
            content: { msgtype: 'm.text', body: 'reply', ...rel('m.thread', '$s1') },
          },
          count: 1,
          current_user_participated: false,
        },
      },
    });
    await addLive(summaryRoom, summaryRoot);
    summaryRoom.createThread('$s1', summaryRoot, [], false);
    expect(getRoomActivityTimestamp(summaryRoom)).toBe(750);
  });

  it('lifts parent rooms by descendant sub-room activity and breaks ties by input order', () => {
    const fakeList = [
      fakeRoom('!a', 100),
      fakeRoom('!a1', 500),
      fakeRoom('!a2', 900),
      fakeRoom('!b', 700),
      fakeRoom('!c', 700),
    ];
    const rooms = new Map(fakeList.map((r) => [r.roomId, r]));
    const client = { getRoom: (id: string) => rooms.get(id) ?? null } as unknown as MatrixClient;
    const tree = {
      children: new Map([
        ['!a', ['!a1']],
        ['!a1', ['!a2']],
      ]),
    };

    expect(getSubRoomTreeActivityTs(client, '!a', tree)).toBe(900);
    expect(sortRoomIdsByActivity(client, ['!a', '!b', '!c'], tree)).toEqual(['!a', '!b', '!c']);
  });

  it('ignores state events, reactions, redactions, redacted messages, and hidden references while counting supported message types', async () => {
    const { client, rooms } = makeRealRooms('!a:ex', '!b:ex', '!state:ex');
    const [roomA, roomB, stateOnly] = rooms as [Room, Room, Room];
    const idA = roomA.roomId;

    await addLive(
      roomA,
      msg(idA, '$a1', 100),
      msg(idA, '$a2', 250),
      ev(idA, '$a3', 300, 'm.room.redaction', {}, { redacts: '$a2' }),
      ev(idA, '$a4', 350, 'com.example.room_features', { caps: ['t'] }, { state_key: '' }),
      ev(idA, '$a5', 400, 'm.room.member', { membership: 'join' }, { state_key: '@bob:ex' }),
      ev(idA, '$a6', 450, 'm.room.topic', { topic: 'updated' }, { state_key: '' }),
      ev(idA, '$a7', 500, 'm.reaction', rel(RelationType.Annotation, '$a1', { key: '👍' })),
      enc(idA, '$a8', 550, rel(RelationType.Reference, '$a1'))
    );
    await addLive(roomB, msg(roomB.roomId, '$b1', 200));

    expect(roomA.findEventById('$a2')?.isRedacted()).toBe(true);
    expect(roomA.getLastActiveTimestamp()).toBe(550);
    expect(getRoomActivityTimestamp(roomA)).toBe(100);
    expect(sortRoomIdsByActivity(client, [idA, roomB.roomId])).toEqual([roomB.roomId, idA]);

    // Room with only state events in its live timeline returns 0 (does not fall back).
    await addLive(
      stateOnly,
      ev(stateOnly.roomId, '$s1', 100, 'm.room.create', {}, { state_key: '' }),
      ev(stateOnly.roomId, '$s2', 900, 'com.example.room_features', {}, { state_key: '' })
    );
    expect(stateOnly.getLastActiveTimestamp()).toBe(900);
    expect(getRoomActivityTimestamp(stateOnly)).toBe(0);

    // Supported non-text message types DO count as activity.
    for (const [ts, event] of [
      [600, ev(idA, '$a9', 600, 'm.sticker', { body: 'wave' })],
      [700, enc(idA, '$a10', 700)],
      [800, ev(idA, '$a11', 800, 'io.mindroom.tool_approval', { status: 'pending' })],
    ] as const) {
      await addLive(roomA, event);
      expect(getRoomActivityTimestamp(roomA)).toBe(ts);
    }
  });
});

describe('useRoomActivityListener', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  function Harness(props: { sections: ActivityTrackedSection[]; onChange: () => void }) {
    useRoomActivityListener(props.sections, props.onChange);
    return null;
  }

  const mountListener = (
    client: MatrixClient,
    sections: ActivityTrackedSection[],
    onChange: () => void
  ) => {
    const el = React.createElement(
      MatrixClientProvider,
      { value: client },
      React.createElement(Harness, { sections, onChange })
    );
    act(() => {
      if (renderer) renderer.update(el);
      else renderer = create(el);
    });
  };

  const mockEvent = (opts: { type?: string; stateKey?: string; replace?: boolean } = {}) => ({
    getType: () => opts.type ?? 'm.room.message',
    getStateKey: () => opts.stateKey,
    getRelation: () => (opts.replace ? { rel_type: RelationType.Replace } : null),
    isRedacted: () => false,
    isRedaction: () => false,
  });

  const setupRealListener = async () => {
    const { client, rooms } = makeRealRooms('!a:ex', '!b:ex');
    const [roomA, roomB] = rooms as [Room, Room];
    for (const room of [roomA, roomB]) {
      room.on(RoomEvent.Timeline, (...args) => client.emit(RoomEvent.Timeline, ...args));
      room.on(RoomEvent.Redaction, (...args) => client.emit(RoomEvent.Redaction, ...args));
    }
    await addLive(roomA, msg(roomA.roomId, '$a1', 100));
    await addLive(roomB, msg(roomB.roomId, '$b1', 200));

    const onChange = vi.fn();
    const trackedSection: ActivityTrackedSection = {
      recent: true,
      showTimes: false,
      baseTop: [roomA.roomId, roomB.roomId],
      orderedTop: [roomB.roomId, roomA.roomId],
      tree: { children: new Map() },
      trackedRoomIds: new Set([roomA.roomId, roomB.roomId]),
    };
    mountListener(client, [trackedSection], onChange);
    return { client, roomA, roomB, trackedSection, onChange };
  };

  const decryptEvent = async (
    client: MatrixClient,
    event: MatrixEvent,
    type: string,
    content: Rec
  ) => {
    event.on(MatrixEventEvent.Decrypted, (...args) =>
      client.emit(MatrixEventEvent.Decrypted, ...args)
    );
    await act(async () => {
      await event.attemptDecryption({
        decryptEvent: async () => ({
          clearEvent: { type, content },
          senderCurve25519Key: 'k',
          claimedEd25519Key: 'k',
          forwardingCurve25519KeyChain: [],
        }),
      } as never);
    });
  };

  it('subscribes only when enabled and ignores non-messages, backfill, unrelated rooms, and no-op order updates', () => {
    const rooms = new Map(
      [fakeRoom('!a', 3000), fakeRoom('!b', 2000), fakeRoom('!b-sub', 1000)].map((r) => [
        r.roomId,
        r,
      ])
    );
    const emitter = new EventEmitter();
    const [onSpy, offSpy, onChange] = [vi.spyOn(emitter, 'on'), vi.spyOn(emitter, 'off'), vi.fn()];
    const client = Object.assign(emitter, {
      getRoom: (id: string) => rooms.get(id) ?? null,
    }) as unknown as MatrixClient;
    const section = (opts: Partial<ActivityTrackedSection>): ActivityTrackedSection => ({
      recent: false,
      showTimes: false,
      baseTop: ['!a', '!b'],
      orderedTop: ['!a', '!b'],
      tree: { children: new Map([['!b', ['!b-sub']]]) },
      trackedRoomIds: new Set(['!a', '!b', '!b-sub']),
      ...opts,
    });
    const emitLive = (event: ReturnType<typeof mockEvent>, room: FakeRoom | undefined) =>
      emitter.emit(RoomEvent.Timeline, event, room, false, false, { liveEvent: true });

    mountListener(client, [section({})], onChange);
    expect(onSpy).not.toHaveBeenCalled();
    mountListener(client, [section({ recent: true })], onChange);
    expect(onSpy).toHaveBeenCalledTimes(3);

    rooms.get('!b')!.ts = 9000;
    emitter.emit(RoomEvent.Timeline, mockEvent(), rooms.get('!b'), true, false, {
      liveEvent: true,
    });
    emitter.emit(RoomEvent.Timeline, mockEvent(), rooms.get('!b'), false, false, {
      liveEvent: false,
    });
    for (const ignored of [
      { replace: true },
      { type: 'com.example.room_features', stateKey: '' },
      { type: 'm.reaction' },
    ]) {
      emitLive(mockEvent(ignored), rooms.get('!b'));
    }
    emitLive(mockEvent(), fakeRoom('!other', 9999));
    expect(onChange).not.toHaveBeenCalled();

    rooms.get('!b')!.ts = 2000;
    rooms.get('!a')!.ts = 4000;
    emitLive(mockEvent(), rooms.get('!a'));
    expect(onChange).not.toHaveBeenCalled();

    rooms.get('!b-sub')!.ts = 5000;
    emitLive(mockEvent(), rooms.get('!b-sub'));
    expect(onChange).toHaveBeenCalledTimes(1);

    // With showTimes on (even in A to Z mode), live messages and RoomEvent.Redaction refresh; state events do not.
    onChange.mockClear();
    mountListener(client, [section({ recent: false, showTimes: true })], onChange);
    emitLive(mockEvent({ type: 'm.room.topic', stateKey: '' }), rooms.get('!a'));
    expect(onChange).not.toHaveBeenCalled();
    rooms.get('!a')!.ts = 6000;
    emitLive(mockEvent(), rooms.get('!a'));
    emitter.emit(RoomEvent.Redaction, {}, rooms.get('!a'));
    expect(onChange).toHaveBeenCalledTimes(2);

    mountListener(client, [section({})], onChange);
    expect(offSpy).toHaveBeenCalledTimes(3);
  });

  it('re-sorts on live thread replies and remote or local-echo redactions on real matrix-js-sdk Rooms', async () => {
    const { client, roomA, roomB, trackedSection, onChange } = await setupRealListener();
    const idA = roomA.roomId;

    // Live state events and reactions do not refresh or bump roomA.
    await liveAct(
      roomA,
      ev(idA, '$a_state', 300, 'com.example.room_features', {}, { state_key: '' }),
      ev(idA, '$a_react', 350, 'm.reaction', rel(RelationType.Annotation, '$a1', { key: '🎉' }))
    );
    expect(getRoomActivityTimestamp(roomA)).toBe(100);
    expect(onChange).not.toHaveBeenCalled();

    // Live thread reply at ts=400 lifts roomA above roomB.
    await liveAct(roomA, msg(idA, '$a2', 400, rel('m.thread', '$a1', { is_falling_back: true })));
    expect(roomA.getThread('$a1')).toBeInstanceOf(Thread);
    expect(liveIds(roomA)).not.toContain('$a2');
    expect(getRoomActivityTimestamp(roomA)).toBe(400);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Remote redaction refreshes once via RoomEvent.Redaction and drops roomA back to ts=100.
    trackedSection.orderedTop = [idA, roomB.roomId];
    await liveAct(roomA, ev(idA, '$a_red', 500, 'm.room.redaction', {}, { redacts: '$a2' }));
    expect(getRoomActivityTimestamp(roomA)).toBe(100);
    expect(onChange).toHaveBeenCalledTimes(2);

    // Local-echo delete: Timeline fires while target is unredacted; sync confirmation fires RoomEvent.Redaction with no second Timeline.
    trackedSection.orderedTop = [roomB.roomId, idA];
    await liveAct(roomA, msg(idA, '$a3', 600));
    expect(getRoomActivityTimestamp(roomA)).toBe(600);
    expect(onChange).toHaveBeenCalledTimes(3);
    trackedSection.orderedTop = [idA, roomB.roomId];

    const localRedaction = ev(idA, '~local_red', 650, 'm.room.redaction', {}, { redacts: '$a3' });
    localRedaction.setStatus(EventStatus.SENDING);
    localRedaction.setTxnId('txn_del_1');
    act(() => roomA.addPendingEvent(localRedaction, 'txn_del_1'));
    expect(roomA.findEventById('$a3')?.isRedacted()).toBe(false);
    expect(getRoomActivityTimestamp(roomA)).toBe(600);
    expect(onChange).toHaveBeenCalledTimes(3);

    const timelineSpy = vi.fn();
    client.on(RoomEvent.Timeline, timelineSpy);
    const remoteRed = ev(
      idA,
      '$a_echo',
      700,
      'm.room.redaction',
      {},
      { redacts: '$a3', unsigned: { transaction_id: 'txn_del_1' } }
    );
    await liveAct(roomA, remoteRed);
    client.off(RoomEvent.Timeline, timelineSpy);
    expect(timelineSpy).not.toHaveBeenCalled();
    expect(roomA.findEventById('$a3')?.isRedacted()).toBe(true);
    expect(getRoomActivityTimestamp(roomA)).toBe(100);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('refreshes on MatrixEventEvent.Decrypted when decryption changes activity status and skips older events', async () => {
    const { client, roomA, roomB, trackedSection, onChange } = await setupRealListener();
    const idA = roomA.roomId;

    // 1. Encrypted event lifts roomA, then decrypts to a non-message -> drops roomA back.
    const encryptedNonMsg = enc(idA, '$e1', 400);
    await liveAct(roomA, encryptedNonMsg);
    expect(getRoomActivityTimestamp(roomA)).toBe(400);
    expect(onChange).toHaveBeenCalledTimes(1);

    trackedSection.orderedTop = [idA, roomB.roomId];
    await decryptEvent(client, encryptedNonMsg, 'io.mindroom.background_job_cancel', {
      job_id: 'job-1',
    });
    expect(getRoomActivityTimestamp(roomA)).toBe(100);
    expect(onChange).toHaveBeenCalledTimes(2);

    // 2. Encrypted m.reference initially ignored, then decrypts to a visible message -> lifts roomA.
    trackedSection.orderedTop = [roomB.roomId, idA];
    const encryptedRef = enc(idA, '$e2', 500, rel(RelationType.Reference, '$a1'));
    await liveAct(roomA, encryptedRef);
    expect(getRoomActivityTimestamp(roomA)).toBe(100);
    expect(onChange).toHaveBeenCalledTimes(2);

    await decryptEvent(client, encryptedRef, 'm.room.message', {
      msgtype: 'm.text',
      body: 'ref',
      ...rel(RelationType.Reference, '$a1'),
    });
    expect(getRoomActivityTimestamp(roomA)).toBe(500);
    expect(onChange).toHaveBeenCalledTimes(3);

    // 3. Old backfilled encrypted event decrypting does NOT trigger onChange even with showTimes: true.
    trackedSection.showTimes = true;
    onChange.mockClear();
    const oldEncrypted = enc(idA, '$e_old', 50);
    roomA.getUnfilteredTimelineSet().addEventToTimeline(oldEncrypted, roomA.getLiveTimeline(), {
      toStartOfTimeline: true,
      addToState: false,
    });
    await decryptEvent(client, oldEncrypted, 'm.room.message', { msgtype: 'm.text', body: 'old' });
    expect(getRoomActivityTimestamp(roomA)).toBe(500);
    expect(onChange).not.toHaveBeenCalled();
  });
});
