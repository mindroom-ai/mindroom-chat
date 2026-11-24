import React from 'react';
import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MatrixClient,
  MatrixEvent,
  MemoryStore,
  RelationType,
  Room,
  RoomEvent,
  Thread,
} from 'matrix-js-sdk';
import { matchesEnum } from '../../lib/matchesEnum';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  type ActivityTrackedSection,
  getRoomActivityTimestamp,
  getSubRoomTreeActivityTs,
  sortRoomIdsByActivity,
  useRoomActivityListener,
} from './roomActivity';

type FakeRoom = { roomId: string; ts: number; getLastActiveTimestamp: () => number };

const makeFakeRoom = (roomId: string, ts: number): FakeRoom => {
  const room: FakeRoom = { roomId, ts, getLastActiveTimestamp: () => room.ts };
  return room;
};

const makeMatrixEvent = (
  roomId: string,
  eventId: string,
  ts: number,
  content: Record<string, unknown>,
  unsigned?: Record<string, unknown>
) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: roomId,
    event_id: eventId,
    sender: '@alice:example.org',
    origin_server_ts: ts,
    content,
    ...(unsigned ? { unsigned } : undefined),
  });

const makeRealClient = () => {
  const client = new MatrixClient({
    baseUrl: 'https://example.org',
    userId: '@alice:example.org',
    store: new MemoryStore(),
    timelineSupport: true,
  });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  vi.spyOn(client, 'fetchRoomEvent').mockRejectedValue(new Error('offline'));
  return client;
};

const makeRealRoom = (roomId: string, client: MatrixClient) =>
  new Room(roomId, client, '@alice:example.org', { timelineSupport: true });

describe('roomActivity helpers', () => {
  it('guards missing, zero, negative, and non-finite fallback activity timestamps', () => {
    expect(getRoomActivityTimestamp(undefined)).toBe(0);
    expect(getRoomActivityTimestamp({ getLastActiveTimestamp: () => 0 } as unknown as Room)).toBe(
      0
    );
    expect(getRoomActivityTimestamp({ getLastActiveTimestamp: () => -5 } as unknown as Room)).toBe(
      0
    );
    expect(
      getRoomActivityTimestamp({ getLastActiveTimestamp: () => Number.NaN } as unknown as Room)
    ).toBe(0);
    expect(
      getRoomActivityTimestamp({ getLastActiveTimestamp: () => 1234 } as unknown as Room)
    ).toBe(1234);
  });

  it('includes real matrix-js-sdk thread replies and excludes m.replace edits', async () => {
    const client = makeRealClient();
    const roomA = makeRealRoom('!a:example.org', client);
    const roomB = makeRealRoom('!b:example.org', client);
    const editOnly = makeRealRoom('!edit-only:example.org', client);
    const roomsById = new Map([
      [roomA.roomId, roomA],
      [roomB.roomId, roomB],
      [editOnly.roomId, editOnly],
    ]);
    vi.spyOn(client, 'getRoom').mockImplementation((id) => roomsById.get(id ?? '') ?? null);

    // Room A: main message at ts=100, then m.replace edit at ts=300.
    // Room B: main message at ts=200.
    const aRoot = makeMatrixEvent(roomA.roomId, '$a1', 100, { msgtype: 'm.text', body: 'hi' });
    const aEdit = makeMatrixEvent(roomA.roomId, '$a2', 300, {
      msgtype: 'm.text',
      body: '* hi edited',
      'm.new_content': { msgtype: 'm.text', body: 'hi edited' },
      'm.relates_to': { rel_type: RelationType.Replace, event_id: '$a1' },
    });
    const bMsg = makeMatrixEvent(roomB.roomId, '$b1', 200, { msgtype: 'm.text', body: 'hey' });
    await roomA.addLiveEvents([aRoot, aEdit], { addToState: false });
    await roomB.addLiveEvents([bMsg], { addToState: false });

    // SDK's getLastActiveTimestamp includes the m.replace edit (300), but ours stays at 100.
    expect(roomA.getLastActiveTimestamp()).toBe(300);
    expect(getRoomActivityTimestamp(roomA)).toBe(100);
    expect(getRoomActivityTimestamp(roomB)).toBe(200);
    expect(sortRoomIdsByActivity(client, [roomA.roomId, roomB.roomId])).toEqual([
      roomB.roomId,
      roomA.roomId,
    ]);

    // Room whose live timeline only has an m.replace edit does NOT fall back to getLastActiveTimestamp.
    editOnly.getLiveTimeline().addEvent(
      makeMatrixEvent(editOnly.roomId, '$e1', 900, {
        msgtype: 'm.text',
        body: '* edited',
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$missing' },
      }),
      { toStartOfTimeline: false, addToState: false }
    );
    expect(editOnly.getLastActiveTimestamp()).toBe(900);
    expect(getRoomActivityTimestamp(editOnly)).toBe(0);

    // Real thread reply in Room A at ts=400 lifts Room A above Room B (ts=200), even though
    // roomA.getLastActiveTimestamp() still only sees the main timeline!
    const aReply = makeMatrixEvent(roomA.roomId, '$a3', 400, {
      msgtype: 'm.text',
      body: 'thread reply',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$a1', is_falling_back: true },
    });
    await roomA.addLiveEvents([aReply], { addToState: false });
    const thread = roomA.getThread('$a1');
    expect(thread).toBeInstanceOf(Thread);
    // Confirm the thread reply is NOT on the main timeline (SDK getLastActiveTimestamp misses it).
    expect(
      roomA
        .getLiveTimeline()
        .getEvents()
        .map((e) => e.getId())
    ).not.toContain('$a3');
    expect(roomA.getLastActiveTimestamp()).toBe(300);
    expect(getRoomActivityTimestamp(roomA)).toBe(400);
    expect(sortRoomIdsByActivity(client, [roomA.roomId, roomB.roomId])).toEqual([
      roomA.roomId,
      roomB.roomId,
    ]);

    // An m.replace edit targeting the thread reply at ts=500 must not bump Room A past 400.
    const aReplyEdit = makeMatrixEvent(roomA.roomId, '$a4', 500, {
      msgtype: 'm.text',
      body: '* thread reply edited',
      'm.new_content': { msgtype: 'm.text', body: 'thread reply edited' },
      'm.relates_to': { rel_type: RelationType.Replace, event_id: '$a3' },
    });
    await roomA.addLiveEvents([aReplyEdit], { addToState: false });
    expect(getRoomActivityTimestamp(roomA)).toBe(400);

    // Bundled thread summary (replyToEvent on an unopened thread without loaded reply events)
    // also contributes its reply timestamp.
    const summaryRoom = makeRealRoom('!summary:example.org', client);
    const summaryReplyRaw = {
      type: 'm.room.message',
      room_id: summaryRoom.roomId,
      event_id: '$s2',
      sender: '@bob:example.org',
      origin_server_ts: 750,
      content: {
        msgtype: 'm.text',
        body: 'summary latest reply',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$s1' },
      },
    };
    const summaryRoot = makeMatrixEvent(
      summaryRoom.roomId,
      '$s1',
      100,
      { msgtype: 'm.text', body: 'root' },
      {
        'm.relations': {
          'm.thread': {
            latest_event: summaryReplyRaw,
            count: 1,
            current_user_participated: false,
          },
        },
      }
    );
    await summaryRoom.addLiveEvents([summaryRoot], { addToState: false });
    summaryRoom.createThread('$s1', summaryRoot, [], false);
    expect(getRoomActivityTimestamp(summaryRoom)).toBe(750);
  });

  it('lifts parent rooms by descendant sub-room activity and breaks ties by input order', () => {
    const rooms = new Map(
      [
        makeFakeRoom('!alpha', 100),
        makeFakeRoom('!alpha-sub', 500),
        makeFakeRoom('!alpha-grand', 900),
        makeFakeRoom('!beta', 700),
        makeFakeRoom('!gamma', 700),
      ].map((room) => [room.roomId, room])
    );
    const client = { getRoom: (id: string) => rooms.get(id) ?? null } as unknown as MatrixClient;
    const tree = {
      children: new Map([
        ['!alpha', ['!alpha-sub']],
        ['!alpha-sub', ['!alpha-grand']],
      ]),
    };

    expect(getSubRoomTreeActivityTs(client, '!alpha', tree)).toBe(900);
    expect(sortRoomIdsByActivity(client, ['!alpha', '!beta', '!gamma'], tree)).toEqual([
      '!alpha',
      '!beta',
      '!gamma',
    ]);
  });
});

describe('useRoomActivityListener', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const makeTimelineEvent = (replace = false) => ({
    isRelation: (rel?: string) =>
      rel ? replace && matchesEnum(rel, RelationType.Replace) : replace,
  });

  it('subscribes only when enabled and ignores edits, backfill, unrelated rooms, and no-op order updates', () => {
    const rooms = new Map(
      [makeFakeRoom('!a', 3000), makeFakeRoom('!b', 2000), makeFakeRoom('!b-sub', 1000)].map(
        (room) => [room.roomId, room]
      )
    );
    const emitter = new EventEmitter();
    const onSpy = vi.spyOn(emitter, 'on');
    const offSpy = vi.spyOn(emitter, 'off');
    const client = Object.assign(emitter, {
      getRoom: (id: string) => rooms.get(id) ?? null,
    }) as unknown as MatrixClient;
    const onChange = vi.fn();

    const tree = { children: new Map([['!b', ['!b-sub']]]) };
    const section = (opts: Partial<ActivityTrackedSection>): ActivityTrackedSection => ({
      recent: false,
      showTimes: false,
      baseTop: ['!a', '!b'],
      orderedTop: ['!a', '!b'],
      tree,
      trackedRoomIds: new Set(['!a', '!b', '!b-sub']),
      ...opts,
    });

    function Harness({ sections }: { sections: ActivityTrackedSection[] }) {
      useRoomActivityListener(sections, onChange);
      return null;
    }

    // Disabled -> no Timeline listener at all.
    act(() => {
      renderer = create(
        React.createElement(
          MatrixClientProvider,
          { value: client },
          React.createElement(Harness, { sections: [section({})] })
        )
      );
    });
    expect(onSpy).not.toHaveBeenCalled();

    // Enabled for Recent mode only.
    act(() => {
      renderer!.update(
        React.createElement(
          MatrixClientProvider,
          { value: client },
          React.createElement(Harness, { sections: [section({ recent: true })] })
        )
      );
    });
    expect(onSpy).toHaveBeenCalledTimes(1);

    // Ignore history backfill, non-live events, m.replace edits, and untracked rooms.
    rooms.get('!b')!.ts = 9000;
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!b'), true, false, {
      liveEvent: true,
    });
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!b'), false, false, {
      liveEvent: false,
    });
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(true), rooms.get('!b'), false, false, {
      liveEvent: true,
    });
    emitter.emit(
      RoomEvent.Timeline,
      makeTimelineEvent(false),
      makeFakeRoom('!other', 9999),
      false,
      false,
      { liveEvent: true }
    );
    expect(onChange).not.toHaveBeenCalled();

    // Message in top room that preserves order does not bump when showTimes is off.
    rooms.get('!b')!.ts = 2000;
    rooms.get('!a')!.ts = 4000;
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!a'), false, false, {
      liveEvent: true,
    });
    expect(onChange).not.toHaveBeenCalled();

    // Live message in nested sub-room lifts !b above !a -> bumps!
    rooms.get('!b-sub')!.ts = 5000;
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!b-sub'), false, false, {
      liveEvent: true,
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // With showTimes on (even in A to Z mode), a live message in a tracked room bumps to refresh "now".
    onChange.mockClear();
    act(() => {
      renderer!.update(
        React.createElement(
          MatrixClientProvider,
          { value: client },
          React.createElement(Harness, { sections: [section({ recent: false, showTimes: true })] })
        )
      );
    });
    rooms.get('!a')!.ts = 6000;
    emitter.emit(RoomEvent.Timeline, makeTimelineEvent(false), rooms.get('!a'), false, false, {
      liveEvent: true,
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Disabling unsubscribes cleanly.
    act(() => {
      renderer!.update(
        React.createElement(
          MatrixClientProvider,
          { value: client },
          React.createElement(Harness, { sections: [section({})] })
        )
      );
    });
    expect(offSpy).toHaveBeenCalledTimes(1);
  });

  it('re-sorts when a live thread reply arrives on a real matrix-js-sdk Room', async () => {
    const client = makeRealClient();
    const roomA = makeRealRoom('!a:example.org', client);
    const roomB = makeRealRoom('!b:example.org', client);
    const roomsById = new Map([
      [roomA.roomId, roomA],
      [roomB.roomId, roomB],
    ]);
    vi.spyOn(client, 'getRoom').mockImplementation((id) => roomsById.get(id ?? '') ?? null);
    // Match MatrixClient sync re-emission of RoomEvent.Timeline from rooms.
    roomA.on(RoomEvent.Timeline, (...args) => client.emit(RoomEvent.Timeline, ...args));
    roomB.on(RoomEvent.Timeline, (...args) => client.emit(RoomEvent.Timeline, ...args));

    const aRoot = makeMatrixEvent(roomA.roomId, '$a1', 100, { msgtype: 'm.text', body: 'root' });
    const bMsg = makeMatrixEvent(roomB.roomId, '$b1', 200, { msgtype: 'm.text', body: 'newer' });
    await roomA.addLiveEvents([aRoot], { addToState: false });
    await roomB.addLiveEvents([bMsg], { addToState: false });

    const onChange = vi.fn();
    const sections: ActivityTrackedSection[] = [
      {
        recent: true,
        showTimes: false,
        baseTop: [roomA.roomId, roomB.roomId],
        orderedTop: [roomB.roomId, roomA.roomId],
        tree: { children: new Map() },
        trackedRoomIds: new Set([roomA.roomId, roomB.roomId]),
      },
    ];
    function Harness() {
      useRoomActivityListener(sections, onChange);
      return null;
    }
    act(() => {
      renderer = create(
        React.createElement(MatrixClientProvider, { value: client }, React.createElement(Harness))
      );
    });

    // Live thread reply in roomA at ts=400 emits RoomEvent.Timeline and lifts roomA above roomB.
    const aReply = makeMatrixEvent(roomA.roomId, '$a2', 400, {
      msgtype: 'm.text',
      body: 'reply',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$a1', is_falling_back: true },
    });
    await act(async () => {
      await roomA.addLiveEvents([aReply], { addToState: false });
    });
    expect(roomA.getThread('$a1')).toBeInstanceOf(Thread);
    expect(
      roomA
        .getLiveTimeline()
        .getEvents()
        .map((e) => e.getId())
    ).not.toContain('$a2');
    expect(getRoomActivityTimestamp(roomA)).toBe(400);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
