// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { MatrixEvent, type IEvent } from 'matrix-js-sdk';
import { CallRow } from './CallRow';
import { activeCallAtom, callPanelRoomAtom, type ActiveCall } from '../callStore';
import type { CallMember } from '../callMemberships';
import { liveTranscriptAtom } from './transcriptionState';
import { transcriptPanelAtom } from './transcriptPanel';
import type { CallRowContent } from '../../matrix/protocol/callRow';
import type { TranscriptCall } from './api';

const ROOM_ID = '!room:example.org';
const VIEWER = '@ann:example.org';
const ROUTER = '@mindroom_router:example.org';
const BOB = '@bob:example.org';

const state = vi.hoisted(() => ({
  callMembers: [] as CallMember[],
  selectedRoom: '!room:example.org' as string | undefined,
  navigateRoom: vi.fn(),
  navigateRoomThread: vi.fn(),
}));

vi.mock('../callStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../callStore')>()),
  useRoomCallMembers: () => state.callMembers,
}));
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

const member = (userId: string): CallMember => ({ userId, deviceId: 'DEVICE', createdTs: 1 });

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
  state.callMembers = [];
  state.selectedRoom = ROOM_ID;
  state.navigateRoom.mockReset();
  state.navigateRoomThread.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('CallRow', () => {
  it('shows who is in the call, Join and Transcript while the row is unedited', () => {
    state.callMembers = [member(BOB), member(VIEWER)];
    const store = render(LIVE);

    expect(container.textContent).toContain('Call in progress');
    expect(
      [...container.querySelectorAll('[data-call-row-member]')].map((face) =>
        face.getAttribute('aria-label')
      )
    ).toEqual(['Bob', 'Ann']);

    act(() => button('Join')?.click());
    expect(store.get(callPanelRoomAtom)).toBe(ROOM_ID);

    act(() => button('Transcript')?.click());
    expect(store.get(transcriptPanelAtom)?.roomId).toBe(ROOM_ID);
    expect(state.navigateRoom).not.toHaveBeenCalled();
  });

  it("names who is in the call as MindRoom's live call has them, where this device follows it", () => {
    const store = createStore();
    const call: TranscriptCall = {
      id: 'call-1',
      roomId: ROOM_ID,
      rowEventId: '$row',
      startedAt: '2026-11-07T09:29:00Z',
      endedAt: null,
      members: [BOB],
      holds: [],
      transcribedBy: [BOB],
    };
    store.set(liveTranscriptAtom, { roomId: ROOM_ID, call, lines: [], names: {} });
    render(LIVE, store);
    expect(
      [...container.querySelectorAll('[data-call-row-member]')].map((face) =>
        face.getAttribute('aria-label')
      )
    ).toEqual(['Bob']);
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
    // People may still be in a newer call in the room: the edit decides.
    state.callMembers = [member(BOB)];
    render(ENDED);

    expect(container.textContent).toContain('Call ended');
    expect(container.textContent).toContain('12 min');
    expect(button('Join')).toBeUndefined();
    expect(button('Transcript')).toBeUndefined();
    expect(button('Notes and transcript')).toBeUndefined();
  });

  it('links to the transcript message in its thread once the router names it', () => {
    render(TRANSCRIBED);
    act(() => button('Notes and transcript')?.click());
    expect(state.navigateRoomThread).toHaveBeenCalledWith(ROOM_ID, '$row', '$notes');
  });
});
