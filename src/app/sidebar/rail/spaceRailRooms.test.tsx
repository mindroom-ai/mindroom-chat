import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { archivedRoomsAtom } from '../../matrix/state/archivedRooms';
import { useSpaceRailRooms } from './spaceRailRooms';

// The space page lists its joined rooms without the archived ones; its rail button counts and
// marks read the same rooms.

const SPACE = '!garden';
vi.mock('../../matrix/state/useSpaceSearchRooms', () => ({
  useSpaceNavigationRooms: () => ['!seedlings', '!old-harvest'],
}));

describe('a space on the rail', () => {
  it('counts and marks read only the rooms its page lists, not the archived ones', () => {
    const store = createStore();
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        ['!seedlings', new Set([SPACE])],
        ['!old-harvest', new Set([SPACE])],
      ]),
    });
    store.set(roomToUnreadAtom, {
      type: 'RESET',
      unreadInfos: [
        { roomId: '!seedlings', total: 2, highlight: 0 },
        { roomId: '!old-harvest', total: 5, highlight: 1 },
      ],
    });
    store.set(archivedRoomsAtom, new Set(['!old-harvest']));
    let seen: ReturnType<typeof useSpaceRailRooms> | undefined;
    function Probe() {
      seen = useSpaceRailRooms(SPACE);
      return null;
    }

    act(() => {
      create(
        <Provider store={store}>
          <Probe />
        </Provider>
      );
    });

    expect(seen?.rooms).toEqual(['!seedlings']);
    expect(seen?.unread).toMatchObject({ total: 2, highlight: 0 });
  });
});
