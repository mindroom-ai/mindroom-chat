// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  createClient,
  MatrixEvent,
  SyncState,
  type IEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { _createAndReEmitRoom } from 'matrix-js-sdk/lib/sync';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isThreadListTimeline, useLiveEventArrive } from './roomLiveEventArrive';
import { useRoomLiveRenderController } from './roomLiveRenderController';
import { createDefaultThreadFilterState } from './roomThreadOverviewModel';
import { loadRoomThreads } from './roomThreadList';
import type { Timeline } from './timelinePagination';

const ROOM = '!lists:example.org';
const ME = '@me:example.org';
const ROOTS = 4;

const roomEvent = (id: string, ts: number, content: Record<string, unknown> = {}): IEvent =>
  ({
    event_id: id,
    room_id: ROOM,
    sender: ME,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: { msgtype: 'm.text', body: id, ...content },
  } as IEvent);

const threadReply = (rootId: string, id: string, ts: number): IEvent =>
  roomEvent(id, ts, { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } });

/** A root as /threads lists it, with the thread summary the server bundles. */
const listedRoot = (index: number): IEvent => {
  const rootId = `$root-${index}`;
  return {
    ...roomEvent(rootId, 1000 + index * 10),
    unsigned: {
      'm.relations': {
        'm.thread': {
          count: 1,
          current_user_participated: true,
          latest_event: threadReply(rootId, `${rootId}-reply-1`, 1000 + index * 10 + 1),
        },
      },
    },
  };
};

/** A real client and room, re-emitted like a synced one, whose only server is a /threads list. */
const roomWithThreadList = () => {
  const roots = Array.from({ length: ROOTS }, (_, index) => listedRoot(index)).reverse();
  const client: MatrixClient = createClient({
    baseUrl: 'https://example.org',
    userId: ME,
    accessToken: 'token',
    timelineSupport: true,
    fetchFn: async (input) => {
      const url = new URL(String(input));
      if (!decodeURIComponent(url.pathname).endsWith('/threads')) {
        throw new Error(`Unexpected request ${url.pathname}`);
      }
      return new Response(JSON.stringify({ chunk: roots }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  vi.spyOn(client, 'getSyncState').mockReturnValue(SyncState.Syncing);
  const room = _createAndReEmitRoom(client, ROOM, {});
  room.setMaxListeners(0);
  client.store.storeRoom(room);
  return { client, room, mapper: client.getEventMapper() };
};

const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

/** What the sync does with a new event of the room: append it to the live timelines. */
const receive = async (room: Room, event: MatrixEvent) => {
  await act(async () => {
    await room.addLiveEvents([event], { addToState: false });
    await settle();
  });
};

type Arrival = { id: string | undefined; live: boolean; fromList: boolean };

const ArrivalLog = ({ room, arrivals }: { room: Room; arrivals: Arrival[] }) => {
  useLiveEventArrive(room, (event, meta) => {
    arrivals.push({
      id: event.getId(),
      live: meta.liveEvent,
      fromList: isThreadListTimeline(room, meta.timeline),
    });
  });
  return null;
};

describe('live arrivals and the SDK thread lists', () => {
  let support: [FeatureSupport, FeatureSupport, FeatureSupport];
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => {
    support = [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ];
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    Thread.hasServerSideListSupport = FeatureSupport.Stable;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    [
      Thread.hasServerSideSupport,
      Thread.hasServerSideListSupport,
      Thread.hasServerSideFwdPaginationSupport,
    ] = support;
    vi.restoreAllMocks();
  });

  it('reports the roots a thread list load adds as not live, and a synced message as live', async () => {
    const { room, mapper } = roomWithThreadList();
    const arrivals: Arrival[] = [];
    act(() => {
      renderer = create(<ArrivalLog room={room} arrivals={arrivals} />);
    });

    await act(async () => {
      await loadRoomThreads(room);
      await settle();
    });

    const listed = arrivals.filter((arrival) => arrival.fromList);
    // Every root in the All list, and in the My list, where the user took part in each.
    expect(listed).toHaveLength(ROOTS * 2);
    expect(listed.filter((arrival) => arrival.live)).toEqual([]);

    await receive(room, mapper(roomEvent('$news', 5000)));
    expect(arrivals.filter((arrival) => arrival.id === '$news')).toEqual([
      { id: '$news', live: true, fromList: false },
    ]);
  });

  it('keeps a thread reply live while the lists add its root again as not live', async () => {
    const { room, mapper } = roomWithThreadList();
    const arrivals: Arrival[] = [];
    act(() => {
      renderer = create(<ArrivalLog room={room} arrivals={arrivals} />);
    });
    await act(async () => {
      await loadRoomThreads(room);
      await settle();
    });
    arrivals.length = 0;

    await receive(room, mapper(threadReply('$root-1', '$root-1-reply-2', 6000)));

    expect(arrivals.filter((arrival) => arrival.id === '$root-1-reply-2')).toEqual([
      { id: '$root-1-reply-2', live: true, fromList: false },
    ]);
    const rootAgain = arrivals.filter((arrival) => arrival.id === '$root-1');
    expect(rootAgain.length).toBeGreaterThan(0);
    expect(rootAgain).toEqual(
      rootAgain.map(() => ({ id: '$root-1', live: false, fromList: true }))
    );
  });

  const renderRoomView = (client: MatrixClient, room: Room, threadId?: string) => {
    const setTimeline = vi.fn();
    const scrollToBottomRef = { current: { count: 0, smooth: false } };
    const observeLiveTail = vi.fn();
    const notifyThreadEventsChanged = vi.fn();
    const setUnreadInfo = vi.fn();
    // A reader at the bottom of a window that reaches the live end.
    const scrollElement = {
      clientHeight: 400,
      scrollHeight: 1000,
      scrollTop: 600,
    } as HTMLDivElement;
    const RoomView = () => {
      useRoomLiveRenderController({
        atBottomRef: { current: false },
        atLiveEndRef: { current: true },
        effectiveThreadFilterState: createDefaultThreadFilterState(),
        hideActivity: false,
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
        ignoredUsersSet: new Set(),
        markLiveExpansionCandidate: vi.fn(),
        mx: client,
        normalThreadRecordMap: new Map(),
        onStoreThreadSummary: vi.fn(),
        room,
        roomThreadFilterActive: false,
        scrollRef: { current: scrollElement },
        scrollToBottomRef,
        setSupplementalThreadEvents: vi.fn(),
        observeLiveTail,
        notifyThreadEventsChanged,
        setTimeline,
        setUnreadInfo,
        showHiddenEvents: false,
        threadEventIndexMapRef: { current: new Map() },
        threadId,
        threadResolutionMap: new Map(),
        timelineAtLiveEnd: true,
        unreadInfo: undefined,
      });
      return null;
    };
    act(() => {
      renderer = create(<RoomView />);
    });
    /** The windows the room view's updates set, applied to a window of rows 0 to 10. */
    const windows = () =>
      setTimeline.mock.calls.map(([update]) =>
        typeof update === 'function'
          ? (update as (current: Timeline) => Timeline)({
              linkedTimelines: [],
              range: { start: 0, end: 10 },
            }).range
          : (update as Timeline).range
      );
    return {
      scrollToBottomRef,
      observeLiveTail,
      notifyThreadEventsChanged,
      setUnreadInfo,
      windows,
    };
  };

  it('does not grow the room view window or follow the bottom when a thread list loads', async () => {
    const { client, room, mapper } = roomWithThreadList();
    const view = renderRoomView(client, room);

    await act(async () => {
      await loadRoomThreads(room);
      await settle();
    });

    expect(view.windows().filter((range) => range.end !== 10)).toEqual([]);
    expect(view.scrollToBottomRef.current.count).toBe(0);
    expect(view.setUnreadInfo).not.toHaveBeenCalled();

    // A message the sync appends still grows the window by its row and follows it.
    await receive(room, mapper(roomEvent('$news', 5000)));
    expect(view.windows().filter((range) => range.end !== 10)).toEqual([{ start: 0, end: 11 }]);
    expect(view.scrollToBottomRef.current.count).toBe(1);
  });

  it('does not refresh or pin an open thread when the thread list adds its root again', async () => {
    const { client, room } = roomWithThreadList();
    const view = renderRoomView(client, room, '$root-2');

    await act(async () => {
      await loadRoomThreads(room);
      await settle();
    });

    expect(view.observeLiveTail).not.toHaveBeenCalled();
    expect(view.notifyThreadEventsChanged).not.toHaveBeenCalled();
    expect(view.scrollToBottomRef.current.count).toBe(0);
  });
});
