// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { MatrixEvent, type IEvent, type Room } from 'matrix-js-sdk';
import { CallRow } from './CallRow';
import { useLiveTranscript, type LiveTranscriptView } from './useLiveTranscript';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from '../callStore';
import { callTranscriptionAtom, liveTranscriptAtom } from './transcriptionState';
import { transcriptPanelAtom } from './transcriptPanel';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import {
  clearCallWindowStore,
  getCallWindowSettingsAtom,
  minimizedSettings,
} from '../window/callWindowState';
import type { CallRowContent } from '../../matrix/protocol/callRow';
import type { LiveCall, TranscriptCall, TranscriptLine } from './api';

const ROOM_ID = '!room:example.org';
const VIEWER = '@ann:example.org';
const ROUTER = '@mindroom_router:example.org';
const BOB = '@bob:example.org';

const state = vi.hoisted(() => ({
  /** The room's MindRoom server, as the device knows it; none it can find. */
  apiUrl: 'https://mindroom.example.org' as string | undefined,
  selectedRoom: '!room:example.org' as string | undefined,
  navigateRoom: vi.fn(),
  navigateRoomThread: vi.fn(),
  /** Each time the row reads the live call. */
  polls: [] as Array<{
    client: unknown;
    everyMs: number;
    signal: AbortSignal;
    onLive: (live: LiveCall) => void;
    /** Ends the reads, as MindRoom saying the room is not transcribed does. */
    finish: (outcome: 'not-transcribed') => void;
    /** The line the first read asks for the lines after. */
    after?: string;
  }>,
}));

vi.mock('./useTranscriptionServer', () => ({
  useTranscriptionServer: () => ({ apiUrl: state.apiUrl, discovered: true }),
}));
vi.mock('./liveCallPoll', () => ({
  pollLiveCall: (
    client: unknown,
    _roomId: string,
    everyMs: number,
    signal: AbortSignal,
    onLive: (live: LiveCall) => void,
    _onFailure?: unknown,
    after?: string
  ) =>
    new Promise((finish) => {
      state.polls.push({ client, everyMs, signal, onLive, finish, after });
    }),
}));
vi.mock('../../matrix/openidAudience', () => ({ requestAudienceOpenIdToken: vi.fn() }));
vi.mock('../../navigation/useSelectedRoom', () => ({
  useSelectedRoom: () => state.selectedRoom,
}));
vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: state.navigateRoom,
    navigateRoomThread: state.navigateRoomThread,
  }),
}));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

const NAMES: Record<string, string> = { [VIEWER]: 'Ann', [BOB]: 'Bob' };
/** Whether the room has loaded its member list; until it has, names carry their user ID. */
let membersLoaded = true;
const room = {
  roomId: ROOM_ID,
  getMember: (userId: string) =>
    NAMES[userId]
      ? { userId, name: NAMES[userId], rawDisplayName: NAMES[userId], getMxcAvatarUrl: () => null }
      : null,
  membersLoaded: () => membersLoaded,
  // The list stays unloaded for as long as a test wants it so.
  loadMembersIfNeeded: () => new Promise(() => undefined),
};
const mx = {
  getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
  getSafeUserId: () => VIEWER,
  getUserId: () => VIEWER,
  mxcUrlToHttp: () => null,
};
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));

const ROW = new MatrixEvent({
  type: 'm.room.message',
  room_id: ROOM_ID,
  event_id: '$row',
  sender: ROUTER,
  origin_server_ts: 1,
  content: { msgtype: 'm.notice', body: 'Call started', 'io.mindroom.call': { call_id: 'call-1' } },
} as Partial<IEvent>);

const LIVE: CallRowContent = { callId: 'call-1' };
const ENDED: CallRowContent = { callId: 'call-1', ended: { durationSeconds: 720 } };
const TRANSCRIBED: CallRowContent = {
  callId: 'call-1',
  ended: { durationSeconds: 720, transcriptEventId: '$notes' },
};

const CALL: TranscriptCall = {
  id: 'call-1',
  roomId: ROOM_ID,
  rowEventId: '$row',
  startedAt: '2026-11-07T09:29:00Z',
  endedAt: null,
  members: [BOB, VIEWER],
  pausedBy: null,
};

/** The browser's word on whether the row is in view. */
let observed: { callback: IntersectionObserverCallback; target?: Element } | undefined;
class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observed = { callback };
  }

  observe(target: Element) {
    if (observed) observed.target = target;
  }

  disconnect() {
    observed = undefined;
  }
}
const inView = (isIntersecting: boolean) =>
  act(() => {
    const { callback, target } = observed ?? {};
    if (!callback || !target) throw new Error('nothing observed');
    callback([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  });

const faces = () =>
  [...container.querySelectorAll('[data-call-row-member]')].map((face) =>
    face.getAttribute('aria-label')
  );

let container: HTMLDivElement;
let root: Root;

const render = (row: CallRowContent, store = createStore(), size: ScreenSize = 'Desktop') => {
  act(() => {
    root.render(
      <Provider store={store}>
        <ScreenSizeProvider value={size}>
          <CallRow mEvent={ROW} row={row} />
        </ScreenSizeProvider>
      </Provider>
    );
  });
  return store;
};

// Read anew each time: the registry makes a new atom after each test clears it.
const settings = () => getCallWindowSettingsAtom(VIEWER);

/** This device is in a call, in `roomId`, transcribed. */
const inCall = (roomId = ROOM_ID) => {
  const store = createStore();
  store.set(activeCallAtom, { kind: 'room', call: { room: { roomId } } } as unknown as ActiveCall);
  store.set(callTranscriptionAtom, { roomId, status: 'transcribing' });
  return store;
};

const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === name
  );

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  state.polls = [];
  state.apiUrl = 'https://mindroom.example.org';
  state.selectedRoom = ROOM_ID;
  state.navigateRoom.mockReset();
  state.navigateRoomThread.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  clearCallWindowStore(VIEWER);
});

describe('CallRow', () => {
  it('shows who is in the call, Join and Transcript while the row is unedited', () => {
    const store = render(LIVE);
    inView(true);
    act(() => state.polls[0]?.onLive({ call: CALL, lines: [], names: {} }));

    expect(container.textContent).toContain('Call in progress');
    expect(faces()).toEqual(['Bob', 'Ann']);

    act(() => button('Join')?.click());
    expect(store.get(callPanelRoomAtom)).toBe(ROOM_ID);

    act(() => button('Transcript')?.click());
    expect(store.get(transcriptPanelAtom)?.roomId).toBe(ROOM_ID);
    expect(state.navigateRoom).not.toHaveBeenCalled();
  });

  it('reads who is in the call every 5 seconds while it is in view', () => {
    render(LIVE);
    expect(state.polls).toHaveLength(0);

    inView(true);
    expect(state.polls).toHaveLength(1);
    expect(state.polls[0]?.everyMs).toBe(5_000);
    act(() => state.polls[0]?.onLive({ call: CALL, lines: [], names: {} }));
    expect(faces()).toEqual(['Bob', 'Ann']);

    // Out of view it stops, and what it read stays.
    inView(false);
    expect(state.polls[0]?.signal.aborted).toBe(true);
    expect(faces()).toEqual(['Bob', 'Ann']);
    inView(true);
    expect(state.polls).toHaveLength(2);

    // Another call in the room is not this row's.
    act(() => state.polls[1]?.onLive({ call: { ...CALL, id: 'call-2' }, lines: [], names: {} }));
    expect(faces()).toEqual([]);
  });

  it("names who is in the call with their user ID until the room's members are loaded", () => {
    membersLoaded = false;
    const MALLORY = '@mallory:example.org';
    try {
      render(LIVE);
      inView(true);
      act(() =>
        state.polls[0]?.onLive({
          call: { ...CALL, members: [MALLORY] },
          lines: [],
          names: { [MALLORY]: 'Bob' },
        })
      );
      expect(faces()).toEqual([MALLORY]);
    } finally {
      membersLoaded = true;
    }
  });

  it('reads only the lines after the last one read when it reads again', () => {
    const line = (id: string, saidAt: string): TranscriptLine => ({
      id,
      callId: 'call-1',
      userId: BOB,
      saidAt,
      seconds: 1,
      kind: 'speech',
      text: id,
    });
    render(LIVE);
    inView(true);
    expect(state.polls[0]?.after).toBeUndefined();
    // MindRoom's order, not the order they were said in, tells the last line read.
    const lines = [line('line-1', '2026-11-07T09:29:40Z'), line('line-2', '2026-11-07T09:29:30Z')];
    act(() => state.polls[0]?.onLive({ call: CALL, lines, names: {} }));

    inView(false);
    inView(true);
    expect(state.polls[1]?.after).toBe('line-2');
  });

  it('shares one sign-in to the server among rows, and after a remount', () => {
    render(LIVE);
    inView(true);
    act(() => root.unmount());
    root = createRoot(container);
    render(LIVE);
    inView(true);

    expect(state.polls).toHaveLength(2);
    expect(state.polls[1]?.client).toBe(state.polls[0]?.client);
  });

  it('stops reading while the page is hidden, and reads at once when it shows again', () => {
    let visibility: DocumentVisibilityState = 'visible';
    const shown = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const turn = (next: DocumentVisibilityState) =>
      act(() => {
        visibility = next;
        document.dispatchEvent(new Event('visibilitychange'));
      });
    try {
      render(LIVE);
      inView(true);
      expect(state.polls).toHaveLength(1);

      turn('hidden');
      expect(state.polls[0]?.signal.aborted).toBe(true);
      expect(state.polls).toHaveLength(1);
      turn('visible');
      expect(state.polls).toHaveLength(2);
      expect(state.polls[1]?.signal.aborted).toBe(false);
    } finally {
      shown.mockRestore();
    }
  });

  it('shows who is in the call this device is in as its transcriber reads it', () => {
    const store = createStore();
    store.set(activeCallAtom, {
      kind: 'room',
      call: { room: { roomId: ROOM_ID } },
    } as unknown as ActiveCall);
    store.set(callTranscriptionAtom, { roomId: ROOM_ID, status: 'transcribing' });
    store.set(liveTranscriptAtom, {
      roomId: ROOM_ID,
      call: { ...CALL, members: [BOB] },
      lines: [],
      names: {},
    });
    render(LIVE, store);
    inView(true);
    expect(faces()).toEqual(['Bob']);
    expect(state.polls).toHaveLength(0);
  });

  it('opens its room for Join and Transcript from elsewhere, such as search', () => {
    state.selectedRoom = undefined;
    render(LIVE);
    act(() => button('Transcript')?.click());
    expect(state.navigateRoom).toHaveBeenCalledWith(ROOM_ID);
  });

  it('offers no Join for the call this device is in', () => {
    const store = createStore();
    store.set(activeCallAtom, {
      kind: 'room',
      call: { room: { roomId: ROOM_ID } },
    } as unknown as ActiveCall);
    render(LIVE, store);
    expect(button('Join')).toBeUndefined();
    expect(button('Transcript')).toBeDefined();
  });

  it("opens the live transcript of this device's call inside the floating window, from anywhere", () => {
    state.selectedRoom = undefined;
    const store = inCall();
    // The window was closed, and minimized to its bar before that.
    const rect = { x: 600, y: 200, width: 400, height: 480 };
    store.set(settings(), minimizedSettings({ mode: 'floating', rect }, rect));
    render(LIVE, store);

    act(() => button('Transcript')?.click());
    expect(store.get(settings())).toMatchObject({ transcript: true, rect });
    expect(store.get(callPanelRoomAtom)).toBe(ROOM_ID);
    expect(store.get(transcriptPanelAtom)).toBeUndefined();
    // The window floats over every page, so the person stays where they are.
    expect(state.navigateRoom).not.toHaveBeenCalled();

    // Pressed again, it keeps the transcript open.
    act(() => button('Transcript')?.click());
    expect(store.get(settings()).transcript).toBe(true);
  });

  it.each([
    ["another room's call", '!other:example.org', 'floating', 'Desktop'],
    ['a docked call view', ROOM_ID, 'docked', 'Desktop'],
    ['a phone', ROOM_ID, 'floating', 'Mobile'],
  ] as const)('opens the side panel for %s, as before', (_case, callRoomId, mode, size) => {
    const store = inCall(callRoomId);
    store.set(settings(), { mode });
    render(LIVE, store, size);

    act(() => button('Transcript')?.click());
    expect(store.get(transcriptPanelAtom)?.roomId).toBe(ROOM_ID);
    expect(store.get(settings()).transcript).toBeUndefined();
  });

  it.each([
    ['floats', 'floating', ROOM_ID, false],
    ['is docked', 'docked', undefined, true],
  ] as const)(
    'opens the side transcript of a call to join while its view %s, leaving the floating one',
    (_case, mode, callView, replacedCall) => {
      const store = createStore();
      store.set(settings(), { mode });
      render(LIVE, store);

      act(() => button('Join')?.click());
      act(() => button('Transcript')?.click());
      // The floating window's prescreen stays; the docked panel gives the transcript its place.
      expect(store.get(transcriptPanelAtom)).toEqual({ roomId: ROOM_ID, replacedCall });
      expect(store.get(callPanelRoomAtom)).toBe(callView);
    }
  );

  it('says how long the call lasted once the router edited it for the end', () => {
    render(ENDED);

    expect(container.textContent).toContain('Call ended');
    expect(container.textContent).toContain('12 min');
    expect(button('Join')).toBeUndefined();
    expect(button('Transcript')).toBeUndefined();
    expect(button('Notes and transcript')).toBeUndefined();
  });

  it.each([
    ['names no live call', () => state.polls.at(-1)?.onLive({ call: null, lines: [], names: {} })],
    [
      'names another call',
      () => state.polls.at(-1)?.onLive({ call: { ...CALL, id: 'call-2' }, lines: [], names: {} }),
    ],
    ['says the room is not transcribed', () => state.polls.at(-1)?.finish('not-transcribed')],
  ])(
    'stays live, without who is in the call, when the read %s, also once reading starts again',
    async (_case, answer) => {
      const live = () => {
        expect(container.textContent).toContain('Call in progress');
        expect(faces()).toEqual([]);
        expect(button('Join')).toBeDefined();
        expect(button('Transcript')).toBeDefined();
      };
      render(LIVE);
      inView(true);
      act(() => state.polls[0]?.onLive({ call: CALL, lines: [], names: {} }));
      expect(faces()).toEqual(['Bob', 'Ann']);

      await act(async () => answer());
      live();
      inView(false);
      inView(true);
      live();
      await act(async () => answer());
      live();
    }
  );

  it.each([
    ['names no live call', () => state.polls[0]?.onLive({ call: null, lines: [], names: {} })],
    ['says the room is not transcribed', () => state.polls[0]?.finish('not-transcribed')],
  ])(
    "follows the room's own server once it is known, after the deployment's %s",
    async (_case, answer) => {
      state.apiUrl = 'https://deployment.example.org';
      const store = render(LIVE);
      inView(true);
      await act(async () => answer());
      expect(container.textContent).toContain('Call in progress');

      // What another server said goes with it; reads start over on the room's own.
      state.apiUrl = 'https://published.example.org';
      render(LIVE, store);
      expect(state.polls).toHaveLength(2);
      expect(state.polls[1]?.after).toBeUndefined();
      expect(container.textContent).toContain('Call in progress');
      act(() => state.polls[1]?.onLive({ call: CALL, lines: [], names: {} }));
      expect(container.textContent).toContain('Call in progress');
      expect(faces()).toEqual(['Bob', 'Ann']);
      expect(button('Join')).toBeDefined();
      expect(button('Transcript')).toBeDefined();
    }
  );

  it('stays live, as posted, without Transcript, on a device that knows no MindRoom server for the room', () => {
    state.apiUrl = undefined;
    render(LIVE);
    inView(true);

    expect(state.polls).toHaveLength(0);
    expect(container.textContent).toContain('Call in progress');
    expect(button('Join')).toBeDefined();
    expect(button('Transcript')).toBeUndefined();
  });

  it('tells, with the live call, whether this device knows a MindRoom server for the room', () => {
    const views: LiveTranscriptView[] = [];
    function Probe() {
      views.push(useLiveTranscript(room as unknown as Room, 5_000, false));
      return null;
    }
    act(() => root.render(<Probe />));
    expect(views.at(-1)?.serverKnown).toBe(true);
    state.apiUrl = undefined;
    act(() => root.render(<Probe key="again" />));
    expect(views.at(-1)?.serverKnown).toBe(false);
  });

  it('links to the transcript message in its thread once the router names it', () => {
    render(TRANSCRIBED);
    act(() => button('Notes and transcript')?.click());
    expect(state.navigateRoomThread).toHaveBeenCalledWith(ROOM_ID, '$row', '$notes');
  });
});
