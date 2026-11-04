import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { mDirectAtom } from '../../../state/mDirectList';
import { archivedRoomsAtom } from '../../../mindroom/rooms/archivedRooms';
import { useHomeRooms } from '../home/useHomeRooms';
import { DirectTab } from './DirectTab';

// The rail's Home and Direct Messages buttons count and mark read the rooms their pages list:
// joined and not archived. A room the page hides adds nothing to the badge.

const { counted, client } = vi.hoisted(() => ({
  counted: { roomIds: [] as string[] },
  client: {
    getRoom: (roomId: string) => ({
      roomId,
      getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => undefined }) }),
    }),
    getRooms: () => [],
  },
}));

vi.mock('../../../hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../../state/hooks/unread', () => ({
  useRoomsUnread: (roomIds: string[]) => {
    counted.roomIds = roomIds;
    return undefined;
  },
}));
vi.mock('../../../components/sidebar', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    SidebarAvatar: passthrough,
    SidebarItem: passthrough,
    SidebarItemBadge: passthrough,
    SidebarItemTooltip: ({ children }: { children: (ref: null) => React.ReactNode }) =>
      children(null),
  };
});
vi.mock('../../../state/hooks/navToActivePath', async () => {
  const { atom } = await import('jotai');
  const paths = atom(new Map());
  return { useNavToActivePathAtom: () => paths };
});
vi.mock('./SidebarContextMenu', () => ({
  SidebarContextMenu: () => null,
  toggleContextMenu: () => () => undefined,
}));

const seededStore = () => {
  const store = createStore();
  store.set(allRoomsAtom, {
    type: 'INITIALIZE',
    rooms: ['!garden', '!archived-room', '!ada', '!archived-dm'],
  });
  store.set(mDirectAtom, {
    type: 'INITIALIZE',
    // `!left-dm` is still in m.direct after the user left it.
    rooms: new Set(['!ada', '!archived-dm', '!left-dm']),
  });
  store.set(archivedRoomsAtom, new Set(['!archived-room', '!archived-dm']));
  return store;
};

describe('rail section rooms', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('Home covers the joined Home rooms the user has not archived', () => {
    let homeRooms: string[] = [];
    function Probe() {
      homeRooms = useHomeRooms();
      return null;
    }
    act(() => {
      renderer = create(
        <Provider store={seededStore()}>
          <Probe />
        </Provider>
      );
    });

    expect(homeRooms).toEqual(['!garden']);
  });

  it('Direct Messages counts the joined conversations the user has not archived', () => {
    act(() => {
      renderer = create(
        <Provider store={seededStore()}>
          <MemoryRouter>
            <DirectTab />
          </MemoryRouter>
        </Provider>
      );
    });

    expect(counted.roomIds).toEqual(['!ada']);
  });
});
