// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, cleanup, render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MatrixEvent, RoomEvent, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import { createSessionId } from '../matrix/session/sessions';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { allRoomsAtom } from '../matrix/state/roomList';
import { getRoomViewModeStorageKey } from '../navigation/roomViewMode';
import { markThreadAsRead } from '../notifications/readReceipts';
import {
  clearQuickCaptureRoomStore,
  getQuickCaptureRoomAtom,
} from '../preferences/quickCaptureRoom';
import { settingsAtom } from '../preferences/settings';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import type { CaptureChannel } from './captureChannel';
import type { CaptureAction, CaptureMessage, CaptureResult } from './captureProtocol';
import { QuickCaptureHost } from './QuickCaptureHost';
import { CaptureError, sendCapture, sendCaptureReply, setCaptureResolved } from './sendCapture';

const mocks = vi.hoisted(() => ({
  mx: undefined as unknown,
  navigation: { navigateRoom: vi.fn(), navigateRoomThreadDirect: vi.fn() },
  openCaptureChannel: vi.fn(),
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mocks.mx }));
vi.mock('../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => mocks.navigation }));
vi.mock('../threads/cross-room/threadSignalsReader', () => ({
  getThreadSignalsReader: () => ({
    read: () => ({ mentionedMe: false, newCount: 0, newSenderIds: [], automation: false }),
  }),
}));
vi.mock('./captureChannel', () => ({ openCaptureChannel: mocks.openCaptureChannel }));
vi.mock('../notifications/readReceipts', () => ({ markThreadAsRead: vi.fn() }));
vi.mock('./sendCapture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sendCapture')>()),
  sendCapture: vi.fn(),
  sendCaptureReply: vi.fn(),
  setCaptureResolved: vi.fn(),
}));

const USER_ID = '@me:x';
const HOMESERVER = 'https://x.org';
const OPTIONS = { markdown: true, linkSchemes: ['obsidian'] };

const makeRoom = (roomId: string, name: string, lastActiveTs: number, space = false): Room =>
  ({
    roomId,
    name,
    isSpaceRoom: () => space,
    getLastActiveTimestamp: () => lastActiveTs,
    getLiveTimeline: () => ({ getEvents: () => [] }),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    getThread: () => null,
    findEventById: () => undefined,
    getMember: () => null,
    membersLoaded: () => true,
  } as unknown as Room);

const roomA = makeRoom('!a', 'Alpha', 300);
const roomB = makeRoom('!b', 'Bob', 200);
const roomC = makeRoom('!c', 'Classic', 100);
const space = makeRoom('!space', 'Space', 400, true);
/** A room the client still has but the room list leaves out (left, archived or replaced). */
const unlisted = makeRoom('!unlisted', 'Unlisted', 500);
const ROOMS = [roomA, roomB, roomC, space, unlisted];

const makeClient = () =>
  Object.assign(new EventEmitter(), {
    getSafeUserId: () => USER_ID,
    getUserId: () => USER_ID,
    getHomeserverUrl: () => HOMESERVER,
    getRoom: (roomId: string) => ROOMS.find((room) => room.roomId === roomId) ?? null,
  });

const entry = (roomId: string, rootId: string, lastActivityTs: number): CrossRoomThreadIndexEntry =>
  ({
    key: `${roomId}:${rootId}`,
    roomId,
    threadRootId: rootId,
    summaryText: `Title ${rootId}`,
    rootPreviewText: '',
    threadRecord: { status: { isStreaming: false }, presentation: {} },
    isUnread: false,
    isResolved: false,
    isInvolved: true,
    lastActivityTs,
    generation: 1,
  } as unknown as CrossRoomThreadIndexEntry);

const setIndex = (store: ReturnType<typeof createStore>, entries: CrossRoomThreadIndexEntry[]) =>
  store.set(crossRoomThreadIndexAtom, {
    ...emptyCrossRoomThreadIndexSnapshot(),
    entries: new Map(entries.map((item) => [item.key, item])),
    bootstrapped: true,
  });

const makeChannel = () => {
  const posted: CaptureMessage[] = [];
  const listeners = new Set<(message: CaptureMessage) => void>();
  const channel: CaptureChannel = {
    post: (message) => {
      posted.push(message);
    },
    listen: (onMessage) => {
      listeners.add(onMessage);
      return () => listeners.delete(onMessage);
    },
    close: vi.fn(() => listeners.clear()),
  };
  const deliver = (message: CaptureMessage) =>
    act(() => {
      listeners.forEach((listener) => listener(message));
    });
  return { channel, posted, deliver };
};

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const statesIn = (posted: CaptureMessage[]) =>
  posted.flatMap((message) => (message.type === 'state' ? [message] : []));

const setup = (storedRoomId: string | null = '!a', withChannel = true) => {
  const mx = makeClient();
  mocks.mx = mx;
  const store = createStore();
  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: ['!a', '!b', '!c', '!space', '!gone'] });
  store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set(['!b']) });
  setIndex(store, [entry('!a', '$t1', 100), entry('!b', '$t2', 200)]);
  if (storedRoomId) store.set(getQuickCaptureRoomAtom(USER_ID), storedRoomId);
  const rig = makeChannel();
  const tree = (channel: CaptureChannel | undefined) => (
    <Provider store={store}>
      <ClientConfigProvider
        value={{ messageRendering: { additionalAllowedUriSchemes: ['obsidian'] } }}
      >
        <QuickCaptureHost channel={channel} />
      </ClientConfigProvider>
    </Provider>
  );
  const view = render(tree(withChannel ? rig.channel : undefined));
  const rerender = (channel: CaptureChannel) => view.rerender(tree(channel));
  const hello = () => rig.deliver({ v: 1, type: 'hello' });
  const hostId = () => {
    const state = statesIn(rig.posted)[0];
    if (!state) throw new Error('No state posted yet.');
    return state.hostId;
  };
  let requests = 0;
  /** Sends a request to the host and waits for its response. */
  const request = async (action: CaptureAction): Promise<CaptureResult> => {
    requests += 1;
    const id = `r${requests}`;
    rig.deliver({ v: 1, type: 'request', id, hostId: hostId(), action });
    let result: CaptureResult | undefined;
    await vi.waitFor(() => {
      const response = rig.posted.find(
        (message) => message.type === 'response' && message.id === id
      );
      if (response?.type !== 'response') throw new Error('No response yet.');
      result = response.result;
    });
    return result as CaptureResult;
  };
  return { ...rig, mx, store, view, rerender, hello, hostId, request };
};

describe('QuickCaptureHost', () => {
  beforeEach(() => {
    mocks.openCaptureChannel.mockReturnValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    clearQuickCaptureRoomStore(USER_ID);
    localStorage.clear();
  });

  it('answers hello with the rooms and the stored room with its threads', () => {
    const { hello, posted } = setup('!a');
    expect(posted).toEqual([]);

    hello();

    expect(posted).toEqual([
      {
        v: 1,
        type: 'state',
        hostId: expect.any(String),
        state: {
          userId: USER_ID,
          roomId: '!a',
          rooms: [
            { id: '!a', name: 'Alpha', direct: false },
            { id: '!b', name: 'Bob', direct: true },
            { id: '!c', name: 'Classic', direct: false },
          ],
          items: [{ threadId: '$t1', title: 'Title $t1', line: '', resolved: false, ts: 100 }],
        },
      },
    ]);
  });

  it.each([
    ['no stored room', null],
    ['a stored room the client does not have', '!gone'],
    ['a stored space, which the rooms leave out', '!space'],
  ])('gives no room and no items for %s', (_case, storedRoomId) => {
    const { hello, posted } = setup(storedRoomId);

    hello();

    expect(statesIn(posted)[0]?.state).toMatchObject({ roomId: null, items: [] });
  });

  it("ignores a request for another host's id", async () => {
    const { hello, deliver, posted } = setup();
    hello();
    const before = posted.length;

    deliver({
      v: 1,
      type: 'request',
      id: 'r',
      hostId: 'another-host',
      action: { kind: 'send', roomId: '!a', text: 'x', images: [], open: false },
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendCapture).not.toHaveBeenCalled();
    expect(posted).toHaveLength(before);
  });

  it('stores the picked room and posts a fresh state', async () => {
    const { hello, request, posted, store } = setup();
    hello();

    expect(await request({ kind: 'selectRoom', roomId: '!b' })).toEqual({ ok: true });

    expect(store.get(getQuickCaptureRoomAtom(USER_ID))).toBe('!b');
    const latest = statesIn(posted).at(-1)?.state;
    expect(latest?.roomId).toBe('!b');
    expect(latest?.items.map((item) => item.threadId)).toEqual(['$t2']);
  });

  it('refuses to store a room it does not list', async () => {
    const { hello, request, store } = setup();
    hello();

    expect(await request({ kind: 'selectRoom', roomId: '!space' })).toEqual({
      ok: false,
      error: 'no-room',
    });
    expect(store.get(getQuickCaptureRoomAtom(USER_ID))).toBe('!a');
  });

  it('answers no-room to every action for a room the client has but does not list', async () => {
    const { hello, request, store } = setup();
    hello();
    const roomId = '!unlisted';
    const actions: CaptureAction[] = [
      { kind: 'send', roomId, text: 'x', images: [], open: true },
      { kind: 'reply', roomId, threadId: '$t', text: 'x' },
      { kind: 'resolve', roomId, threadId: '$t', resolved: true },
      { kind: 'selectRoom', roomId },
      { kind: 'open', roomId, threadId: '$t' },
      { kind: 'read', roomId, threadId: '$t' },
    ];

    for (const action of actions) {
      expect(await request(action)).toEqual({ ok: false, error: 'no-room' });
    }
    expect(sendCapture).not.toHaveBeenCalled();
    expect(sendCaptureReply).not.toHaveBeenCalled();
    expect(setCaptureResolved).not.toHaveBeenCalled();
    expect(markThreadAsRead).not.toHaveBeenCalled();
    expect(mocks.navigation.navigateRoom).not.toHaveBeenCalled();
    expect(mocks.navigation.navigateRoomThreadDirect).not.toHaveBeenCalled();
    expect(store.get(getQuickCaptureRoomAtom(USER_ID))).toBe('!a');
  });

  it('answers a picked room even when the state cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { hello, request, posted, store } = setup();
    hello();
    vi.spyOn(roomB, 'getLiveTimeline').mockImplementation(() => {
      throw new Error('broken timeline');
    });

    expect(await request({ kind: 'selectRoom', roomId: '!b' })).toEqual({ ok: true });
    expect(store.get(getQuickCaptureRoomAtom(USER_ID))).toBe('!b');
    expect(statesIn(posted)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      '[quick-capture] could not read the state',
      expect.any(Error)
    );
  });

  it('sends an entry and answers with its thread, opening it when asked', async () => {
    const { hello, request, mx } = setup();
    vi.mocked(sendCapture).mockResolvedValue({ threadId: '$new' });
    const images = [new File(['a'], 'a.png', { type: 'image/png' })];
    hello();

    expect(
      await request({ kind: 'send', roomId: '!a', text: 'Note', images, open: false })
    ).toEqual({ ok: true, threadId: '$new' });
    expect(sendCapture).toHaveBeenCalledWith(mx, roomA, { text: 'Note', images }, OPTIONS);
    expect(mocks.navigation.navigateRoomThreadDirect).not.toHaveBeenCalled();

    expect(
      await request({ kind: 'send', roomId: '!a', text: 'Open it', images: [], open: true })
    ).toEqual({ ok: true, threadId: '$new' });
    expect(mocks.navigation.navigateRoomThreadDirect).toHaveBeenCalledWith('!a', '$new');
  });

  it('answers a posted entry as sent when its thread does not open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { hello, request } = setup();
    vi.mocked(sendCapture).mockResolvedValue({ threadId: '$new' });
    mocks.navigation.navigateRoomThreadDirect.mockImplementationOnce(() => {
      throw new Error('no route');
    });
    hello();

    expect(
      await request({ kind: 'send', roomId: '!a', text: 'Open it', images: [], open: true })
    ).toEqual({ ok: true, threadId: '$new' });
    expect(warn).toHaveBeenCalledWith(
      '[quick-capture] could not open the new thread',
      expect.any(Error)
    );
  });

  it('answers each failed send with its code', async () => {
    const { hello, request } = setup();
    hello();
    const send: CaptureAction = { kind: 'send', roomId: '!a', text: 'x', images: [], open: true };

    expect(await request({ ...send, roomId: '!gone' })).toEqual({ ok: false, error: 'no-room' });
    expect(sendCapture).not.toHaveBeenCalled();

    vi.mocked(sendCapture).mockRejectedValueOnce(new CaptureError('upload-failed'));
    expect(await request(send)).toEqual({ ok: false, error: 'upload-failed' });

    vi.mocked(sendCapture).mockRejectedValueOnce(new Error('network'));
    expect(await request(send)).toEqual({ ok: false, error: 'send-failed' });
    expect(mocks.navigation.navigateRoomThreadDirect).not.toHaveBeenCalled();
  });

  it('replies and resolves in the thread', async () => {
    const { hello, request, mx } = setup();
    vi.mocked(sendCaptureReply).mockResolvedValue(undefined);
    vi.mocked(setCaptureResolved).mockResolvedValue(undefined);
    hello();

    expect(await request({ kind: 'reply', roomId: '!a', threadId: '$t1', text: 'Thanks' })).toEqual(
      { ok: true }
    );
    expect(sendCaptureReply).toHaveBeenCalledWith(mx, roomA, '$t1', 'Thanks', OPTIONS);

    expect(
      await request({ kind: 'resolve', roomId: '!a', threadId: '$t1', resolved: true })
    ).toEqual({ ok: true });
    expect(setCaptureResolved).toHaveBeenCalledWith(mx, roomA, '$t1', true);

    vi.mocked(setCaptureResolved).mockRejectedValueOnce(new CaptureError('forbidden'));
    expect(
      await request({ kind: 'resolve', roomId: '!a', threadId: '$t1', resolved: false })
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('marks a thread read as the hideActivity setting says, and answers a failure', async () => {
    const { hello, request, mx, store } = setup();
    act(() => store.set(settingsAtom, { ...store.get(settingsAtom), hideActivity: true }));
    vi.mocked(markThreadAsRead).mockResolvedValue(undefined);
    hello();

    expect(await request({ kind: 'read', roomId: '!a', threadId: '$t1' })).toEqual({ ok: true });
    expect(markThreadAsRead).toHaveBeenCalledWith(mx, '!a', '$t1', true);

    vi.mocked(markThreadAsRead).mockRejectedValueOnce(new Error('network'));
    expect(await request({ kind: 'read', roomId: '!a', threadId: '$t1' })).toEqual({
      ok: false,
      error: 'send-failed',
    });
  });

  it('opens a room or a thread, in the room itself when the room shows Classic', async () => {
    const sessionId = createSessionId(HOMESERVER, USER_ID);
    localStorage.setItem(getRoomViewModeStorageKey(sessionId, '!c'), JSON.stringify('classic'));
    const { hello, request } = setup();
    hello();

    expect(await request({ kind: 'open', roomId: '!a', threadId: '$t1' })).toEqual({ ok: true });
    expect(mocks.navigation.navigateRoomThreadDirect).toHaveBeenCalledWith('!a', '$t1');

    expect(await request({ kind: 'open', roomId: '!c', threadId: '$t3' })).toEqual({ ok: true });
    expect(mocks.navigation.navigateRoom).toHaveBeenCalledWith('!c', '$t3');

    expect(await request({ kind: 'open', roomId: '!b' })).toEqual({ ok: true });
    expect(mocks.navigation.navigateRoom).toHaveBeenLastCalledWith('!b');
    expect(mocks.navigation.navigateRoomThreadDirect).toHaveBeenCalledTimes(1);
  });

  it('pushes a state on a change while a widget listens, at most every 250 ms', () => {
    vi.useFakeTimers();
    const { hello, posted, store } = setup();
    hello();
    expect(statesIn(posted)).toHaveLength(1);

    // Within 250 ms of the last state: the change waits for the 250 ms mark.
    act(() => setIndex(store, [entry('!a', '$t1', 100), entry('!a', '$t9', 900)]));
    advance(249);
    expect(statesIn(posted)).toHaveLength(1);
    advance(1);
    expect(statesIn(posted)).toHaveLength(2);
    expect(statesIn(posted)[1]?.state.items.map((item) => item.threadId)).toEqual(['$t9', '$t1']);

    act(() => {
      setIndex(store, [entry('!a', '$t1', 100)]);
      setIndex(store, [entry('!a', '$t1', 110)]);
    });
    advance(100);
    act(() => setIndex(store, [entry('!a', '$t1', 120)]));
    advance(150);
    expect(statesIn(posted)).toHaveLength(3);
    advance(1000);
    expect(statesIn(posted)).toHaveLength(3);
    expect(statesIn(posted)[2]?.state.items).toMatchObject([{ threadId: '$t1', ts: 120 }]);
  });

  it('pushes a change at once when the last state is 250 ms old or more, and the next at the mark', () => {
    vi.useFakeTimers();
    const { hello, posted, store } = setup();
    hello();
    advance(250);

    act(() => setIndex(store, [entry('!a', '$t1', 130)]));
    expect(statesIn(posted)).toHaveLength(2);
    expect(statesIn(posted)[1]?.state.items).toMatchObject([{ threadId: '$t1', ts: 130 }]);

    act(() => setIndex(store, [entry('!a', '$t1', 140)]));
    advance(249);
    expect(statesIn(posted)).toHaveLength(2);
    advance(1);
    expect(statesIn(posted)).toHaveLength(3);
    expect(statesIn(posted)[2]?.state.items).toMatchObject([{ threadId: '$t1', ts: 140 }]);
  });

  it('warns and goes on when a pushed state cannot be read', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { hello, posted, store } = setup();
    hello();
    advance(250);
    vi.spyOn(roomA, 'getLiveTimeline').mockImplementationOnce(() => {
      throw new Error('broken timeline');
    });

    act(() => setIndex(store, [entry('!a', '$t1', 130)]));

    expect(statesIn(posted)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      '[quick-capture] could not read the state',
      expect.any(Error)
    );
    advance(250);
    act(() => setIndex(store, [entry('!a', '$t1', 140)]));
    expect(statesIn(posted)).toHaveLength(2);
  });

  it("pushes a state when the stored room's timeline changes", () => {
    vi.useFakeTimers();
    const { hello, posted, mx } = setup();
    hello();
    const event = new MatrixEvent({ event_id: '$e', room_id: '!b', type: 'm.room.message' });

    act(() => {
      mx.emit(RoomEvent.Timeline, event, roomB);
    });
    advance(1000);
    expect(statesIn(posted)).toHaveLength(1);

    // The last state is a second old: the change goes at once.
    act(() => {
      mx.emit(RoomEvent.Timeline, event, roomA);
    });
    expect(statesIn(posted)).toHaveLength(2);

    advance(250);
    act(() => {
      mx.emit(RoomEvent.LocalEchoUpdated, event, roomA);
    });
    expect(statesIn(posted)).toHaveLength(3);
  });

  it('stops pushing 30 s after the last hello', () => {
    vi.useFakeTimers();
    const { hello, posted, store } = setup();
    hello();
    advance(20_000);
    hello();
    advance(20_000);

    act(() => setIndex(store, [entry('!a', '$t1', 130)]));
    expect(statesIn(posted)).toHaveLength(3);

    advance(10_000);
    act(() => setIndex(store, [entry('!a', '$t1', 140)]));
    advance(60_000);
    expect(statesIn(posted)).toHaveLength(3);
  });

  it('says it is gone when it unmounts', () => {
    const { hello, posted, view, hostId, channel } = setup();
    hello();

    view.unmount();

    expect(posted.at(-1)).toEqual({ v: 1, type: 'gone', hostId: hostId() });
    // The channel belongs to whoever passed it in.
    expect(channel.close).not.toHaveBeenCalled();
  });

  it('says it is gone when its page goes away, as on a reload or a sign-out', () => {
    const { hello, posted, view, hostId } = setup();
    hello();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(posted.at(-1)).toEqual({ v: 1, type: 'gone', hostId: hostId() });

    view.unmount();
    const count = posted.length;
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(posted).toHaveLength(count);
  });

  it('serves under a fresh id after it said it is gone', () => {
    const { hello, posted, hostId, rerender } = setup();
    hello();
    const first = hostId();
    const next = makeChannel();

    rerender(next.channel);
    next.deliver({ v: 1, type: 'hello' });

    expect(posted.at(-1)).toEqual({ v: 1, type: 'gone', hostId: first });
    const second = statesIn(next.posted)[0]?.hostId;
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it('serves without crypto.randomUUID, as outside a secure context', async () => {
    vi.stubGlobal('crypto', {});
    const { hello, request, posted } = setup();

    hello();

    expect(statesIn(posted)[0]?.hostId).toMatch(/\S/);
    expect(await request({ kind: 'open', roomId: '!a' })).toEqual({ ok: true });
  });

  it('opens its own channel when given none, and closes it when it unmounts', () => {
    const own = makeChannel();
    mocks.openCaptureChannel.mockReturnValue(own.channel);
    const { view } = setup('!a', false);

    own.deliver({ v: 1, type: 'hello' });
    expect(statesIn(own.posted)).toHaveLength(1);
    view.unmount();

    expect(own.posted.at(-1)?.type).toBe('gone');
    expect(own.channel.close).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a channel', () => {
    const { view } = setup('!a', false);

    expect(mocks.openCaptureChannel).toHaveBeenCalled();
    expect(view.container.innerHTML).toBe('');
    view.unmount();
  });
});
