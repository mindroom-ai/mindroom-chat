import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home } from './Home';
import { getHomeRoomPath } from '../../routes/pathUtils';

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
vi.mock('../../ui/glass/GlassPrimitives', () => ({ Menu: passthrough }));
vi.mock('../../ui/page/Page', () => ({
  PageNav: passthrough,
  PageNavContent: passthrough,
  PageNavHeader: passthrough,
}));
vi.mock('../../ui/nav/NavItem', () => ({
  NavButton: passthrough,
  NavCategory: passthrough,
  NavEmptyLayout: passthrough,
  NavItem: passthrough,
  NavItemContent: passthrough,
  NavLink: passthrough,
}));
vi.mock('../../ui/nav/NavCategoryHeader', () => ({
  NavCategoryHeader: passthrough,
}));
vi.mock('../../ui/VirtualTile', () => ({ VirtualTile: passthrough }));
vi.mock('../../rooms/join/JoinAddressPrompt', () => ({ JoinAddressPrompt: () => null }));
vi.mock('../room-nav/RoomNavCategoryButton', () => ({ RoomNavCategoryButton: passthrough }));
// The rows under a room read its state, which these rooms do not have.
vi.mock('../room-nav/SubRoomRows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../room-nav/SubRoomRows')>()),
  SubRoomRows: () => null,
}));
vi.mock('../room-nav/SortableRoomList', () => ({
  SortableRoomList: passthrough,
  // Remembers the room it first showed, as RoomNavItem remembers which prompt is open.
  SortableRoomRow: ({ room, linkPath }: { room: { roomId: string }; linkPath: string }) => {
    const [firstRoomId] = useState(room.roomId);
    return <div data-row-room={room.roomId} data-first-room={firstRoomId} data-link={linkPath} />;
  },
}));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRoom: (roomId: string) => ({
      roomId,
      name: roomId.slice(1),
      getCanonicalAlias: () => null,
    }),
    getSafeUserId: () => '@alice:example.org',
    // No room order saved: the list is A to Z.
    getAccountData: () => undefined,
    on: () => undefined,
    off: () => undefined,
  }),
}));
vi.mock('../../navigation/useSelectedRoom', () => ({ useSelectedRoom: () => undefined }));
vi.mock('../../routes/useHomeSelected', () => ({
  useHomeCreateSelected: () => false,
  useHomeSearchSelected: () => false,
}));
vi.mock('../../ui/nav/useCategoryHandler', () => ({ useCategoryHandler: () => vi.fn() }));
vi.mock('../../routes/useNavToActivePathMapper', () => ({
  useNavToActivePathMapper: () => undefined,
}));
vi.mock('../../ui/nav/navScrollMemory', () => ({
  makeNavScrollMemoryKey: () => 'home',
  // Every row is on screen.
  useNavVirtualizer: (_key: string, { count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 36 })),
    measureElement: () => undefined,
  }),
}));
vi.mock('../../matrix/hooks/useRoomsNotificationPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/useRoomsNotificationPreferences')>()),
  getRoomNotificationMode: () => undefined,
  useRoomsNotificationPreferencesContext: () => ({}),
}));
vi.mock('../../ui/nav/useClosedNavCategories', async () => {
  const { atom } = await import('jotai');
  const closed = atom(new Set<string>());
  return { useClosedNavCategoriesAtom: () => closed };
});
vi.mock('../../matrix/state/archivedRooms', () => ({
  useVisibleRooms: (roomIds: string[]) => roomIds,
}));
vi.mock('../threads/ThreadNavCategory', () => ({
  ThreadNavCategory: () => null,
}));
vi.mock('../threads/RecentlyOpenedNavCategory', () => ({
  RecentlyOpenedNavCategory: () => null,
}));
vi.mock('../../notifications/MarkRoomsReadMenuItem', () => ({
  MarkRoomsReadMenuItem: () => null,
}));
vi.mock('../../matrix/state/useHomeRooms', () => ({ useHomeRooms: () => listed.roomIds }));

const rows = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type === 'string' && 'data-row-room' in node.props)
    .map((node) => ({
      room: node.props['data-row-room'] as string,
      first: node.props['data-first-room'] as string,
      link: node.props['data-link'] as string,
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
    shown.forEach((row) => expect(row.link).toBe(getHomeRoomPath(row.room)));
  });
});
