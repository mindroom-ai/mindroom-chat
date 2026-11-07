// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { CallRow } from './CallRow';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from '../callStore';
import { callTranscriptionAtom, liveTranscriptAtom } from './transcriptionState';
import { transcriptPanelAtom } from './transcriptPanel';
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
const room = {
  roomId: ROOM_ID,
  getMember: (userId: string) =>
    NAMES[userId]
      ? { userId, name: NAMES[userId], rawDisplayName: NAMES[userId], getMxcAvatarUrl: () => null }
      : null,
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

const render = (row: CallRowContent, store = createStore()) => {
  act(() => {
    root.render(
      <Provider store={store}>
        <CallRow mEvent={ROW} row={row} />
      </Provider>
    );
  });
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

  it('says how long the call lasted once the router edited it for the end', () => {
    render(ENDED);

    expect(container.textContent).toContain('Call ended');
    expect(container.textContent).toContain('12 min');
    expect(button('Join')).toBeUndefined();
    expect(button('Transcript')).toBeUndefined();
    expect(button('Notes and transcript')).toBeUndefined();
  });

  it.each([
    ['names no live call', () => state.polls[0]?.onLive({ call: null, lines: [], names: {} })],
    [
      'names another call',
      () => state.polls[0]?.onLive({ call: { ...CALL, id: 'call-2' }, lines: [], names: {} }),
    ],
    ['says the room is not transcribed', () => state.polls[0]?.finish('not-transcribed')],
  ])('shows an unedited row as ended when the read %s', async (_case, answer) => {
    render(LIVE);
    inView(true);
    act(() => state.polls[0]?.onLive({ call: CALL, lines: [], names: {} }));
    expect(container.textContent).toContain('Call in progress');

    await act(async () => answer());
    expect(container.textContent).toContain('Call ended');
    expect(container.textContent).not.toContain('Call in progress');
    expect(container.textContent).not.toContain('min');
    expect(faces()).toEqual([]);
    expect(button('Join')).toBeUndefined();
    expect(button('Transcript')).toBeUndefined();
  });

  it('stays live, as posted, on a device that knows no MindRoom server for the room', () => {
    state.apiUrl = undefined;
    render(LIVE);
    inView(true);

    expect(state.polls).toHaveLength(0);
    expect(container.textContent).toContain('Call in progress');
    expect(button('Join')).toBeDefined();
    expect(button('Transcript')).toBeDefined();
  });

  it('links to the transcript message in its thread once the router names it', () => {
    render(TRANSCRIBED);
    act(() => button('Notes and transcript')?.click());
    expect(state.navigateRoomThread).toHaveBeenCalledWith(ROOM_ID, '$row', '$notes');
  });
});
