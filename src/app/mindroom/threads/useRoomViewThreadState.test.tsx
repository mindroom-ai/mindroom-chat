// @vitest-environment jsdom
import React from 'react';
import { createStore, Provider } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRoomThreadFilterStorageKey, roomThreadFilterAtomFamily } from './roomThreadFilterState';
import {
  createDefaultThreadFilterState,
  serializeThreadFilterState,
  type ThreadFilterState,
} from './roomThreadOverviewModel';
import { useRoomViewThreadState, type RoomViewThreadState } from './useRoomViewThreadState';

const USER_ID = '@alice:example.org';
const ROOM_ID = '!room:example.org';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => USER_ID,
    getHomeserverUrl: () => 'https://example.org',
  }),
}));
vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigatePath: vi.fn(),
    navigateRoom: vi.fn(),
    navigateRoomFocusEvent: vi.fn(),
    navigateRoomThread: vi.fn(),
  }),
}));
vi.mock('../native/useEdgeSwipeBack', () => ({ useEdgeSwipeBack: vi.fn() }));
vi.mock('../native/useEdgeSwipeForward', () => ({ useEdgeSwipeForward: vi.fn() }));
vi.mock('../recent-threads/recentThreads', () => ({ bumpRecentThread: vi.fn() }));
vi.mock('./threadSummaryStore', () => ({
  useRoomThreadSummaryState: () => ({ summaryMap: new Map(), storeThreadSummary: vi.fn() }),
}));
vi.mock('./useThreadRootEvent', () => ({ useThreadRootEvent: () => undefined }));
vi.mock('./useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'compact', setViewMode: vi.fn() }),
}));

const room = {
  roomId: ROOM_ID,
  getThread: () => undefined,
  findEventById: () => undefined,
} as unknown as Room;

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  localStorage.clear();
});

describe('useRoomViewThreadState', () => {
  it('ignores a thread filter stored for the room', () => {
    const stored: ThreadFilterState = { ...createDefaultThreadFilterState(), resolved: 'exclude' };
    localStorage.setItem(
      getRoomThreadFilterStorageKey(USER_ID, ROOM_ID),
      JSON.stringify(serializeThreadFilterState(stored))
    );
    const store = createStore();
    // The stored entry is a real filter: the persisted atom still reads it back.
    expect(store.get(roomThreadFilterAtomFamily(USER_ID, ROOM_ID)).resolved).toBe('exclude');

    let state: RoomViewThreadState | undefined;
    function Probe() {
      state = useRoomViewThreadState({ room });
      return null;
    }
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Probe />
        </Provider>
      );
    });

    expect(state?.threadFilterState).toEqual(createDefaultThreadFilterState());
  });
});
