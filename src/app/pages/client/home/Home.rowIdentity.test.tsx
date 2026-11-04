import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home } from './Home';

// A room row keeps state of its own, such as an open Leave prompt. When the list changes under
// it, that state must stay with its room, not with the row's position.

const { listed, passthrough } = vi.hoisted(() => ({
  listed: { roomIds: [] as string[] },
  passthrough: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('focus-trap-react', () => ({ default: passthrough }));
vi.mock('../../../components/glass/GlassPrimitives', () => ({ Menu: passthrough }));
vi.mock('../../../components/page', () => ({
  PageNav: passthrough,
  PageNavContent: passthrough,
  PageNavHeader: passthrough,
}));
vi.mock('../../../components/nav', () => ({
  NavButton: passthrough,
  NavCategory: passthrough,
  NavCategoryHeader: passthrough,
  NavEmptyLayout: passthrough,
  NavItem: passthrough,
  NavItemContent: passthrough,
  NavLink: passthrough,
}));
vi.mock('../../../components/virtualizer', () => ({ VirtualTile: passthrough }));
vi.mock('../../../components/join-address-prompt', () => ({ JoinAddressPrompt: () => null }));
vi.mock('../../../features/room-nav', () => ({
  RoomNavCategoryButton: passthrough,
  // Remembers the room it first showed, as RoomNavItem remembers which prompt is open.
  RoomNavItem: ({ room }: { room: { roomId: string } }) => {
    const [firstRoomId] = useState(room.roomId);
    return <div data-row-room={room.roomId} data-first-room={firstRoomId} />;
  },
}));
vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRoom: (roomId: string) => ({
      roomId,
      name: roomId.slice(1),
      getCanonicalAlias: () => null,
    }),
    getSafeUserId: () => '@alice:example.org',
  }),
}));
vi.mock('../../../hooks/router/useSelectedRoom', () => ({ useSelectedRoom: () => undefined }));
vi.mock('../../../hooks/router/useHomeSelected', () => ({
  useHomeCreateSelected: () => false,
  useHomeSearchSelected: () => false,
}));
vi.mock('../../../hooks/useCategoryHandler', () => ({ useCategoryHandler: () => vi.fn() }));
vi.mock('../../../hooks/useNavToActivePathMapper', () => ({
  useNavToActivePathMapper: () => undefined,
}));
vi.mock('../../../mindroom/sidebar/navScrollMemory', () => ({
  makeNavScrollMemoryKey: () => 'home',
  // Every row is on screen.
  useNavVirtualizer: (_key: string, { count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 36 })),
    measureElement: () => undefined,
  }),
}));
vi.mock('../../../hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => undefined,
  useRoomsNotificationPreferencesContext: () => ({}),
}));
vi.mock('../../../state/hooks/closedNavCategories', async () => {
  const { atom } = await import('jotai');
  const closed = atom(new Set<string>());
  return { useClosedNavCategoriesAtom: () => closed };
});
vi.mock('../../../mindroom/rooms/archivedRooms', () => ({
  useVisibleRooms: (roomIds: string[]) => roomIds,
}));
vi.mock('../../../mindroom/recent-threads/ThreadNavCategory', () => ({
  ThreadNavCategory: () => null,
}));
vi.mock('../../../mindroom/recent-threads/RecentlyOpenedNavCategory', () => ({
  RecentlyOpenedNavCategory: () => null,
}));
vi.mock('../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem', () => ({
  MindroomMarkRoomsReadMenuItem: () => null,
}));
vi.mock('./useHomeRooms', () => ({ useHomeRooms: () => listed.roomIds }));

const rows = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type === 'string' && 'data-row-room' in node.props)
    .map((node) => ({
      room: node.props['data-row-room'] as string,
      first: node.props['data-first-room'] as string,
    }));

describe('Home room rows', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('keep their state with their room when a room joins above them', () => {
    listed.roomIds = ['!bees', '!compost'];
    act(() => {
      renderer = create(<Home />);
    });
    expect(rows(renderer!).map((row) => row.room)).toEqual(['!bees', '!compost']);

    listed.roomIds = ['!bees', '!compost', '!apples'];
    act(() => renderer?.update(<Home />));

    const shown = rows(renderer!);
    expect(shown.map((row) => row.room)).toEqual(['!apples', '!bees', '!compost']);
    shown.forEach((row) => expect(row.first).toBe(row.room));
  });
});
