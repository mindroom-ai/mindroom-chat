import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { archivedRoomsAtom } from '../../matrix/state/archivedRooms';
import { useHomeRooms } from '../../matrix/state/useHomeRooms';
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

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../matrix/state/useUnread', () => ({
  useRoomsUnread: (roomIds: string[]) => {
    counted.roomIds = roomIds;
    return undefined;
  },
}));
vi.mock('../../ui/sidebar/SidebarItem', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    SidebarAvatar: passthrough,
    SidebarItem: passthrough,
    SidebarItemBadge: passthrough,
    SidebarItemTooltip: ({ children }: { children: (ref: null) => React.ReactNode }) =>
      children(null),
  };
});
vi.mock('../../routes/useNavToActivePath', async () => {
  const { atom } = await import('jotai');
  const paths = atom(new Map());
  return { useNavToActivePathAtom: () => paths };
});
vi.mock('./SidebarContextMenu', () => ({
  SidebarContextMenu: () => null,
  useSidebarContextMenu: () => ({ anchor: undefined, close: () => undefined, buttonProps: {} }),
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
