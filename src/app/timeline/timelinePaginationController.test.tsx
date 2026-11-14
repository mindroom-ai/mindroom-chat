import { useCallback, useState, type SetStateAction } from 'react';
import {
  Direction,
  MatrixEvent,
  type EventTimeline,
  type EventTimelineSet,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptAllTimelineEvent } from '../matrix/room';
import type { RecalibrateFilterOpts, Timeline } from '../event-store/timeline/timelinePagination';
import { paginateRoomHistory } from '../event-store/sdk/roomHistoryPageSdk';
import { useEventTimelineLoader, useTimelinePagination } from './timelinePaginationController';

vi.mock('../matrix/room', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../matrix/room')>()),
  decryptAllTimelineEvent: vi.fn(),
}));
// Pages of the room's own history go through roomHistoryPageSdk, which has its own tests. Here
// such a page is the SDK's page, so the fake timelines take its events the same way.
vi.mock('../event-store/sdk/roomHistoryPageSdk', () => ({
  paginateRoomHistory: vi.fn(
    (mx: MatrixClient, _room: Room, edge: EventTimeline, backwards: boolean, limit: number) =>
      mx.paginateEventTimeline(edge, { backwards, limit })
  ),
}));

const decryptMock = vi.mocked(decryptAllTimelineEvent);

/** The parts of an SDK timeline the pager and the loader read, plus a name to tell them apart. */
type FakeTimeline = {
  name: string;
  events: MatrixEvent[];
  backToken: string | null;
  forwardToken: string | null;
  older: FakeTimeline | null;
  newer: FakeTimeline | null;
  getEvents: () => MatrixEvent[];
  getNeighbouringTimeline: (direction: Direction) => FakeTimeline | null;
  getPaginationToken: (direction: Direction) => string | null;
};

const makeTimeline = (
  name: string,
  events: MatrixEvent[],
  tokens: { back?: string; forward?: string } = {}
): FakeTimeline => {
  const timeline: FakeTimeline = {
    name,
    events,
    backToken: tokens.back ?? null,
    forwardToken: tokens.forward ?? null,
    older: null,
    newer: null,
    getEvents: () => timeline.events,
    getNeighbouringTimeline: (direction) =>
      direction === Direction.Backward ? timeline.older : timeline.newer,
    getPaginationToken: (direction) =>
      direction === Direction.Backward ? timeline.backToken : timeline.forwardToken,
  };
  return timeline;
};

/** Links two timelines as the SDK does when it joins them: `older` right before `newer`. */
const link = (older: FakeTimeline, newer: FakeTimeline) => {
  older.newer = newer;
  newer.older = older;
};

const sdk = (timeline: FakeTimeline) => timeline as unknown as EventTimeline;
const nameOf = (timeline: EventTimeline) => (timeline as unknown as FakeTimeline).name;

const message = (eventId: string, threadRootId?: string) =>
  new MatrixEvent({
    event_id: eventId,
    type: 'm.room.message',
    sender: '@alice:example.org',
    room_id: '!room:example.org',
    origin_server_ts: 1,
    content: threadRootId
      ? {
          msgtype: 'm.text',
          body: eventId,
          'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId },
        }
      : { msgtype: 'm.text', body: eventId },
  });

const messages = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => message(`${prefix}${index}`));

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };

const defer = (): Deferred => {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

/** Decryption that settles only when the test says so, one per timeline name. */
const holdDecryption = () => {
  const pending = new Map<string, Deferred>();
  decryptMock.mockImplementation((_mx, timeline) => {
    const deferred = defer();
    pending.set(nameOf(timeline), deferred);
    return deferred.promise;
  });
  return pending;
};

const makeClient = () => {
  const paginateEventTimeline =
    vi.fn<
      (timeline: EventTimeline, opts: { backwards?: boolean; limit?: number }) => Promise<boolean>
    >();
  const getEventTimeline =
    vi.fn<(timelineSet: EventTimelineSet, eventId: string) => Promise<EventTimeline | null>>();
  const client = { paginateEventTimeline, getEventTimeline } as unknown as MatrixClient;
  return { client, paginateEventTimeline, getEventTimeline };
};

const windowOver = (timelines: FakeTimeline[], range: Timeline['range']): Timeline => ({
  linkedTimelines: timelines.map(sdk),
  range,
});

const mountPager = ({
  client,
  initial,
  filterOpts,
}: {
  client: MatrixClient;
  initial: Timeline;
  filterOpts?: RecalibrateFilterOpts;
}) => {
  const view: { timeline: Timeline; paginate: (backwards: boolean) => Promise<void> } = {
    timeline: initial,
    paginate: () => Promise.resolve(),
  };
  const updates: SetStateAction<Timeline>[] = [];
  const filterOptsRef = { current: filterOpts };
  const Host = () => {
    const [timeline, setTimeline] = useState(initial);
    const recordingSetTimeline = useCallback((update: SetStateAction<Timeline>) => {
      updates.push(update);
      setTimeline(update);
    }, []);
    view.timeline = timeline;
    view.paginate = useTimelinePagination(
      client,
      timeline,
      recordingSetTimeline,
      50,
      filterOptsRef
    );
    return null;
  };
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<Host />);
  });
  return { view, updates, unmount: () => act(() => renderer?.unmount()) };
};

beforeEach(() => {
  decryptMock.mockReset();
  decryptMock.mockResolvedValue(undefined);
});

describe('useTimelinePagination', () => {
  it('drops calls while a page is out and asks again once it has landed', async () => {
    const live = makeTimeline('live', [message('$a')], { back: 'older', forward: 'newer' });
    const { client, paginateEventTimeline } = makeClient();
    const answers: Array<() => void> = [];
    paginateEventTimeline.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          answers.push(() => resolve(true));
        })
    );
    const { view } = mountPager({ client, initial: windowOver([live], { start: 0, end: 1 }) });

    let first: Promise<void> | undefined;
    await act(async () => {
      first = view.paginate(true);
    });
    // Both directions give up at once while the older page is out; neither waits for it.
    let settled = 0;
    await act(async () => {
      void view.paginate(true).then(() => (settled += 1));
      void view.paginate(false).then(() => (settled += 1));
    });
    expect(settled).toBe(2);
    expect(paginateEventTimeline).toHaveBeenCalledTimes(1);

    await act(async () => {
      answers[0]?.();
      await first;
    });
    let second: Promise<void> | undefined;
    await act(async () => {
      second = view.paginate(false);
    });
    expect(paginateEventTimeline).toHaveBeenCalledTimes(2);
    expect(paginateEventTimeline).toHaveBeenLastCalledWith(sdk(live), {
      backwards: false,
      limit: 50,
    });
    await act(async () => {
      answers[1]?.();
      await second;
    });
  });

  it('takes timelines the SDK linked at a tokenless edge into the window without a request', async () => {
    const older = makeTimeline('older', messages('$o', 2));
    const live = makeTimeline('live', messages('$l', 2));
    const { client, paginateEventTimeline } = makeClient();
    const { view } = mountPager({ client, initial: windowOver([live], { start: 0, end: 2 }) });

    link(older, live);
    await act(() => view.paginate(true));

    expect(paginateEventTimeline).not.toHaveBeenCalled();
    expect(view.timeline.linkedTimelines.map(nameOf)).toEqual(['older', 'live']);
    expect(view.timeline.range).toEqual({ start: 2, end: 4 });
  });

  it('changes nothing at a tokenless edge with nothing linked to it', async () => {
    const live = makeTimeline('live', messages('$l', 2));
    const { client, paginateEventTimeline } = makeClient();
    const { view, updates } = mountPager({
      client,
      initial: windowOver([live], { start: 0, end: 2 }),
    });

    await act(() => view.paginate(true));
    await act(() => view.paginate(false));

    expect(paginateEventTimeline).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('decrypts the edge and every timeline before it before an older page moves the window', async () => {
    const edge = makeTimeline('edge', [message('$e1')], { back: 'older' });
    const live = makeTimeline('live', [message('$l1')]);
    link(edge, live);
    const fresh = makeTimeline('fresh', messages('$f', 2));
    const { client, paginateEventTimeline } = makeClient();
    paginateEventTimeline.mockImplementation(async () => {
      // The page fills the edge and joins a timeline the SDK already held before it.
      edge.events.unshift(message('$e0'));
      link(fresh, edge);
      return true;
    });
    const decryptions = holdDecryption();
    const { view, updates } = mountPager({
      client,
      initial: windowOver([edge, live], { start: 0, end: 2 }),
    });

    let page: Promise<void> | undefined;
    await act(async () => {
      page = view.paginate(true);
    });
    expect([...decryptions.keys()].sort()).toEqual(['edge', 'fresh']);
    expect(decryptMock).toHaveBeenCalledWith(client, sdk(fresh));

    await act(async () => {
      decryptions.get('fresh')?.reject(new Error('no key'));
    });
    expect(updates).toHaveLength(0);

    await act(async () => {
      decryptions.get('edge')?.resolve();
      await page;
    });
    expect(view.timeline.linkedTimelines.map(nameOf)).toEqual(['fresh', 'edge', 'live']);
    expect(view.timeline.range).toEqual({ start: 3, end: 5 });
  });

  it('decrypts the edge and every timeline after it before a newer page moves the window', async () => {
    const first = makeTimeline('first', [message('$a')]);
    const edge = makeTimeline('edge', [message('$b')], { forward: 'newer' });
    link(first, edge);
    const fresh = makeTimeline('fresh', [message('$d')]);
    const { client, paginateEventTimeline } = makeClient();
    paginateEventTimeline.mockImplementation(async () => {
      edge.events.push(message('$c'));
      link(edge, fresh);
      return true;
    });
    const decryptions = holdDecryption();
    const { view, updates } = mountPager({
      client,
      initial: windowOver([first, edge], { start: 0, end: 2 }),
    });

    let page: Promise<void> | undefined;
    await act(async () => {
      page = view.paginate(false);
    });
    expect([...decryptions.keys()].sort()).toEqual(['edge', 'fresh']);
    expect(updates).toHaveLength(0);

    await act(async () => {
      decryptions.forEach((decryption) => decryption.resolve());
      await page;
    });
    expect(view.timeline.linkedTimelines.map(nameOf)).toEqual(['first', 'edge', 'fresh']);
    expect(view.timeline.range).toEqual({ start: 0, end: 2 });
  });

  it.each(['request', 'decryption'] as const)(
    'sets no window once the view unmounted during the %s',
    async (stage) => {
      const live = makeTimeline('live', [message('$a')], { back: 'older' });
      const { client, paginateEventTimeline } = makeClient();
      const answer = defer();
      paginateEventTimeline.mockImplementation(async () => {
        if (stage === 'request') await answer.promise;
        live.events.unshift(message('$old'));
        return true;
      });
      const decryptions = holdDecryption();
      const { view, updates, unmount } = mountPager({
        client,
        initial: windowOver([live], { start: 0, end: 1 }),
      });

      let page: Promise<void> | undefined;
      await act(async () => {
        page = view.paginate(true);
      });
      unmount();
      answer.resolve();
      await Promise.resolve();
      decryptions.forEach((decryption) => decryption.resolve());

      await expect(page).resolves.toBeUndefined();
      expect(updates).toHaveLength(0);
    }
  );

  it('leaves the window after a failed request and lets the next call ask again', async () => {
    const live = makeTimeline('live', [message('$a')], { back: 'older' });
    const { client, paginateEventTimeline } = makeClient();
    paginateEventTimeline.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(false);
    const { view, updates } = mountPager({
      client,
      initial: windowOver([live], { start: 0, end: 1 }),
    });

    await act(async () => {
      await expect(view.paginate(true)).resolves.toBeUndefined();
    });
    expect(updates).toHaveLength(0);

    await act(() => view.paginate(true));
    expect(paginateEventTimeline).toHaveBeenCalledTimes(2);
  });

  it('leaves the window to the classic rows when thread replies show in the room', async () => {
    const live = makeTimeline(
      'live',
      [message('$root'), message('$reply', '$root'), message('$after')],
      { back: 'older' }
    );
    const { client, paginateEventTimeline } = makeClient();
    paginateEventTimeline.mockImplementation(async () => {
      live.events.unshift(...messages('$old', 2));
      return true;
    });
    const filterOpts: RecalibrateFilterOpts = {
      room: {} as Room,
      threadId: undefined,
      ignoredUsersSet: new Set(),
      showHiddenEvents: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      showThreadRepliesInRoom: true,
    };
    // All three rows show, the thread reply among them.
    const { view } = mountPager({
      client,
      initial: windowOver([live], { start: 0, end: 3 }),
      filterOpts,
    });

    await act(() => view.paginate(true));

    // The classic rows keep the window's first row (placeClassicWindow), replies of the page
    // included, which these room rows do not count.
    expect(view.timeline.linkedTimelines).toEqual([sdk(live)]);
    expect(view.timeline.range).toEqual({ start: 0, end: 3 });
  });
});

type LoadHandler = Parameters<typeof useEventTimelineLoader>[2];

const mountLoader = ({
  client,
  room,
  onLoad,
  onError,
  filterOpts,
}: {
  client: MatrixClient;
  room: Room;
  onLoad: LoadHandler;
  onError: () => void;
  filterOpts?: RecalibrateFilterOpts;
}) => {
  const view: { load: (eventId: string) => Promise<void> } = { load: () => Promise.resolve() };
  const filterOptsRef = { current: filterOpts };
  type HostProps = { room: Room; onLoad: typeof onLoad; onError: typeof onError };
  const Host = (props: HostProps) => {
    view.load = useEventTimelineLoader(
      client,
      props.room,
      props.onLoad,
      props.onError,
      filterOptsRef
    );
    return null;
  };
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<Host room={room} onLoad={onLoad} onError={onError} />);
  });
  return {
    view,
    rerender: (handlers: {
      room?: Room;
      onLoad: typeof onLoad;
      onError: typeof onError;
      filterOpts?: RecalibrateFilterOpts;
    }) =>
      act(() => {
        if (handlers.filterOpts) filterOptsRef.current = handlers.filterOpts;
        renderer?.update(
          <Host room={handlers.room ?? room} onLoad={handlers.onLoad} onError={handlers.onError} />
        );
      }),
  };
};

const makeRoom = (encrypted: boolean) => {
  const timelineSet = {} as EventTimelineSet;
  const room = {
    getUnfilteredTimelineSet: () => timelineSet,
    hasEncryptionStateEvent: () => encrypted,
  } as unknown as Room;
  return { room, timelineSet };
};

/** The Full view's filters: thread replies show in the room, nothing hidden is shown. */
const fullViewFilters = (room: Room): RecalibrateFilterOpts => ({
  room,
  threadId: undefined,
  ignoredUsersSet: new Set(),
  showHiddenEvents: false,
  hideMembershipEvents: false,
  hideNickAvatarEvents: false,
  showThreadRepliesInRoom: true,
});

const roomCreation = () =>
  new MatrixEvent({
    event_id: '$create',
    type: 'm.room.create',
    state_key: '',
    sender: '@alice:example.org',
    room_id: '!room:example.org',
    origin_server_ts: 1,
    content: { room_version: '11' },
  });

const loadedChain = () => {
  const older = makeTimeline('older', messages('$o', 2));
  const holder = makeTimeline('holder', [message('$h'), message('$target')]);
  link(older, holder);
  return { older, holder };
};

describe('useEventTimelineLoader', () => {
  it('decrypts only the returned timeline of an encrypted room before it reports the load', async () => {
    const { holder } = loadedChain();
    const { client, getEventTimeline } = makeClient();
    getEventTimeline.mockResolvedValue(sdk(holder));
    const { room, timelineSet } = makeRoom(true);
    const decryptions = holdDecryption();
    const onLoad = vi.fn<LoadHandler>();
    const { view } = mountLoader({ client, room, onLoad, onError: vi.fn() });

    let load: Promise<void> | undefined;
    await act(async () => {
      load = view.load('$target');
    });
    expect(getEventTimeline).toHaveBeenCalledWith(timelineSet, '$target');
    expect(decryptMock).toHaveBeenCalledTimes(1);
    expect(decryptMock).toHaveBeenCalledWith(client, sdk(holder));
    expect(onLoad).not.toHaveBeenCalled();

    await act(async () => {
      decryptions.get('holder')?.resolve();
      await load;
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
    const loaded = onLoad.mock.calls[0];
    expect(loaded?.[0]).toBe('$target');
    expect(loaded?.[1].map(nameOf)).toEqual(['older', 'holder']);
    expect(loaded?.[2]).toBe(3);
  });

  it('never decrypts in an unencrypted room', async () => {
    const { holder } = loadedChain();
    const { client, getEventTimeline } = makeClient();
    getEventTimeline.mockResolvedValue(sdk(holder));
    const onLoad = vi.fn();
    const { view } = mountLoader({ client, room: makeRoom(false).room, onLoad, onError: vi.fn() });

    await act(() => view.load('$target'));

    expect(decryptMock).not.toHaveBeenCalled();
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('reports an event missing from the returned timeline as an error', async () => {
    const { holder } = loadedChain();
    const { client, getEventTimeline } = makeClient();
    getEventTimeline.mockResolvedValue(sdk(holder));
    const onLoad = vi.fn();
    const onError = vi.fn();
    const { view } = mountLoader({ client, room: makeRoom(false).room, onLoad, onError });

    await act(() => view.load('$elsewhere'));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('reports a failed request as an error and resolves', async () => {
    const { client, getEventTimeline } = makeClient();
    getEventTimeline.mockRejectedValue(new Error('offline'));
    const onError = vi.fn();
    const { view } = mountLoader({ client, room: makeRoom(false).room, onLoad: vi.fn(), onError });

    await act(async () => {
      await expect(view.load('$target')).resolves.toBeUndefined();
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('answers with the handlers of the newest render and keeps its identity', async () => {
    const { holder } = loadedChain();
    const { client, getEventTimeline } = makeClient();
    const answer = defer();
    getEventTimeline.mockImplementation(async () => {
      await answer.promise;
      return sdk(holder);
    });
    const firstOnLoad = vi.fn();
    const { view, rerender } = mountLoader({
      client,
      room: makeRoom(false).room,
      onLoad: firstOnLoad,
      onError: vi.fn(),
    });
    const loader = view.load;

    let load: Promise<void> | undefined;
    await act(async () => {
      load = view.load('$target');
    });
    const newestOnLoad = vi.fn();
    rerender({ onLoad: newestOnLoad, onError: vi.fn() });
    expect(view.load).toBe(loader);

    await act(async () => {
      answer.resolve();
      await load;
    });
    expect(firstOnLoad).not.toHaveBeenCalled();
    expect(newestOnLoad).toHaveBeenCalledTimes(1);
  });

  it("drops a room's timeline that arrives after the view moved to another room", async () => {
    vi.mocked(paginateRoomHistory).mockClear();
    // The server sends the room's creation alone, which makes no row: a load would page around it.
    const holder = makeTimeline('holder', [roomCreation()], { back: 'before', forward: 'after' });
    const { client, getEventTimeline } = makeClient();
    const answer = defer();
    getEventTimeline.mockImplementation(async () => {
      await answer.promise;
      return sdk(holder);
    });
    const { room } = makeRoom(false);
    const { view, rerender } = mountLoader({
      client,
      room,
      onLoad: vi.fn(),
      onError: vi.fn(),
      filterOpts: fullViewFilters(room),
    });

    let load: Promise<void> | undefined;
    await act(async () => {
      load = view.load('$create');
    });
    // The reader opens another room before the first room's timeline arrives.
    const next = makeRoom(false).room;
    const nextOnLoad = vi.fn();
    const nextOnError = vi.fn();
    rerender({
      room: next,
      onLoad: nextOnLoad,
      onError: nextOnError,
      filterOpts: fullViewFilters(next),
    });

    await act(async () => {
      answer.resolve();
      await load;
    });
    expect(paginateRoomHistory).not.toHaveBeenCalled();
    expect(nextOnLoad).not.toHaveBeenCalled();
    expect(nextOnError).not.toHaveBeenCalled();
  });

  it("drops a room's load that completes after the view moved to another room", async () => {
    const holder = makeTimeline('holder', [roomCreation()], { back: 'before' });
    const { client, getEventTimeline, paginateEventTimeline } = makeClient();
    getEventTimeline.mockResolvedValue(sdk(holder));
    const page = defer();
    paginateEventTimeline.mockImplementation(async () => {
      await page.promise;
      holder.backToken = null;
      return true;
    });
    const { room } = makeRoom(false);
    const { view, rerender } = mountLoader({
      client,
      room,
      onLoad: vi.fn(),
      onError: vi.fn(),
      filterOpts: fullViewFilters(room),
    });

    let load: Promise<void> | undefined;
    await act(async () => {
      load = view.load('$create');
    });
    expect(paginateEventTimeline).toHaveBeenCalledTimes(1);
    // The reader opens another room while the page around the event is out.
    const next = makeRoom(false).room;
    const nextOnLoad = vi.fn();
    rerender({ room: next, onLoad: nextOnLoad, onError: vi.fn(), filterOpts: fullViewFilters(next) });

    await act(async () => {
      page.resolve();
      await load;
    });
    expect(nextOnLoad).not.toHaveBeenCalled();
  });

  it('brings a page on each side of an event without a row before it reports the load', async () => {
    // The server sends the room's creation alone, and it makes no row.
    const holder = makeTimeline('holder', [roomCreation()], { back: 'before', forward: 'after' });
    const { client, getEventTimeline, paginateEventTimeline } = makeClient();
    getEventTimeline.mockResolvedValue(sdk(holder));
    paginateEventTimeline.mockImplementation(async (_timeline, { backwards }) => {
      if (backwards) holder.backToken = null;
      else {
        holder.events.push(...messages('$later', 3));
        holder.forwardToken = null;
      }
      return true;
    });
    const { room } = makeRoom(false);
    const onLoad = vi.fn<LoadHandler>();
    const { view } = mountLoader({
      client,
      room,
      onLoad,
      onError: vi.fn(),
      filterOpts: fullViewFilters(room),
    });

    await act(() => view.load('$create'));

    // The Classic view's pages keep their thread replies.
    expect(paginateRoomHistory).toHaveBeenCalledWith(client, room, sdk(holder), true, 200, true);
    expect(paginateEventTimeline).toHaveBeenCalledWith(sdk(holder), {
      backwards: true,
      limit: 200,
    });
    expect(paginateEventTimeline).toHaveBeenCalledWith(sdk(holder), {
      backwards: false,
      limit: 200,
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
    const [eventId, chain, absoluteIndex] = onLoad.mock.calls[0] ?? [];
    expect(eventId).toBe('$create');
    expect(
      chain?.flatMap((timeline) => timeline.getEvents().map((event) => event.getId()))
    ).toEqual(['$create', '$later0', '$later1', '$later2']);
    expect(absoluteIndex).toBe(0);
  });

  it('brings a page on each side of a row the server sent alone before it reports the load', async () => {
    // Alone, the row would sit at the bottom of the view, and a jump to it could not aim it.
    const holder = makeTimeline('holder', [message('$target')], {
      back: 'before',
      forward: 'after',
    });
    const { client, getEventTimeline, paginateEventTimeline } = makeClient();
    getEventTimeline.mockResolvedValue(sdk(holder));
    paginateEventTimeline.mockImplementation(async (_timeline, { backwards }) => {
      if (backwards) {
        holder.events.unshift(...messages('$earlier', 2));
        holder.backToken = null;
      } else {
        holder.events.push(...messages('$later', 2));
        holder.forwardToken = null;
      }
      return true;
    });
    const { room } = makeRoom(false);
    const onLoad = vi.fn<LoadHandler>();
    const { view } = mountLoader({
      client,
      room,
      onLoad,
      onError: vi.fn(),
      filterOpts: fullViewFilters(room),
    });

    await act(() => view.load('$target'));

    expect(paginateEventTimeline).toHaveBeenCalledTimes(2);
    expect(onLoad).toHaveBeenCalledTimes(1);
    const [, chain, absoluteIndex] = onLoad.mock.calls[0] ?? [];
    expect(
      chain?.flatMap((timeline) => timeline.getEvents().map((event) => event.getId()))
    ).toEqual(['$earlier0', '$earlier1', '$target', '$later0', '$later1']);
    expect(absoluteIndex).toBe(2);
  });

  it('loads nothing more around an event that comes with rows around it', async () => {
    const { older, holder } = loadedChain();
    holder.backToken = 'before';
    older.backToken = 'before';
    const { client, getEventTimeline, paginateEventTimeline } = makeClient();
    getEventTimeline.mockResolvedValue(sdk(holder));
    const { room } = makeRoom(false);
    const onLoad = vi.fn<LoadHandler>();
    const { view } = mountLoader({
      client,
      room,
      onLoad,
      onError: vi.fn(),
      filterOpts: fullViewFilters(room),
    });

    await act(() => view.load('$target'));

    expect(paginateEventTimeline).not.toHaveBeenCalled();
    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
