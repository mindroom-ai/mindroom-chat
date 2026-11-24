// @vitest-environment jsdom
import React, { type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { SpaceTabs } from './SpaceTabs';

const { mockSpace, sortableListeners } = vi.hoisted(() => ({
  mockSpace: {
    roomId: '!space-alpha:example.org',
    name: 'Alpha Space',
    isSpaceRoom: () => true,
  } as unknown as Room,
  sortableListeners: {
    onMouseDown: vi.fn(),
    onPointerDown: vi.fn(),
    onTouchStart: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('folds', () => ({
  Icon: () => null,
  Icons: { ChevronTop: 'ChevronTop' },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children?: ReactNode }) => <>{children}</>,
  MouseSensor: class {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    setNodeRef: vi.fn(),
    listeners: sortableListeners,
    transform: null,
    isDragging: false,
  }),
}));

vi.mock('../../lib/longPressTouchSensor', () => ({
  LongPressTouchSensor: class {},
}));

vi.mock('./SpaceTabs.css', () => ({
  SpaceDragSource: 'space-drag-source',
  SpaceDragging: 'space-dragging',
  DropHint: () => 'drop-hint',
  FolderGroup: 'folder-group',
  FolderFace: 'folder-face',
  FolderFaceTile: 'folder-face-tile',
  HiddenName: 'hidden-name',
}));

vi.mock('../../ui/sidebar/SidebarItem', () => ({
  SidebarStack: React.forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children, ...props }, ref) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    )
  ),
  SidebarStackSeparator: () => <hr />,
  SidebarItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SidebarItemBadge: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SidebarItemTooltip: ({ children }: { children: (ref: () => void) => ReactNode }) =>
    children(() => undefined),
  SidebarAvatar: React.forwardRef<
    HTMLButtonElement,
    Omit<React.HTMLAttributes<HTMLElement>, 'children'> & {
      as?: 'button' | 'div';
      size?: string;
      children?: ReactNode;
      'data-id'?: string;
      'data-folder-id'?: string;
    }
  >(({ as = 'div', size: _size, children, ...props }, ref) =>
    React.createElement(as, { ...props, ref }, children)
  ),
}));

vi.mock('../../avatars/RoomAvatar', () => ({
  RoomAvatar: () => null,
}));

vi.mock('../../ui/UnreadBadge', () => ({
  UnreadBadge: () => null,
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@tester:example.org',
    getRoom: (roomId: string) => (roomId === mockSpace.roomId ? mockSpace : null),
  }),
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../navigation/useSelectedSpace', () => ({
  useSelectedSpace: () => undefined,
}));

vi.mock('../../lib/hooks/useScreenSize', () => ({
  ScreenSize: { Mobile: 'Mobile', Tablet: 'Tablet', Desktop: 'Desktop' },
  useScreenSizeContext: () => 'Desktop',
}));

vi.mock('../../routes/useNavToActivePath', async () => {
  const { atom } = await import('jotai');
  const paths = atom(new Map());
  return { useNavToActivePathAtom: () => paths };
});

vi.mock('../../matrix/room', () => ({
  getRoomAvatarUrl: () => undefined,
  isSpace: (room: Room) => room.isSpaceRoom(),
}));

vi.mock('./spaceRailRooms', () => ({
  useSpaceRailRooms: () => ({ unread: undefined, rooms: [] }),
}));

vi.mock('./RailScrollArea', () => ({
  revealRailEntry: vi.fn(),
}));

vi.mock('../../spaces/sidebarSpaces', () => ({
  useShownSidebarItems: () => ({
    items: [mockSpace.roomId],
    saved: [],
    topLevelSpaces: [mockSpace.roomId],
    joinedSpaces: new Map([[mockSpace.roomId, mockSpace]]),
    localOrder: [],
    setLocalOrder: vi.fn(),
  }),
}));

vi.mock('./SidebarContextMenu', async () => {
  const actual =
    await vi.importActual<typeof import('./SidebarContextMenu')>('./SidebarContextMenu');
  return {
    ...actual,
    SidebarContextMenu: ({ anchor, children }: { anchor?: unknown; children?: ReactNode }) =>
      anchor ? createPortal(<div role="menu">{children}</div>, document.body) : null,
  };
});

vi.mock('../../spaces/SpaceActions', () => ({
  useSpaceQuickPermissions: () => ({ canAdd: true, canInvite: true }),
  useSpaceQuickDialogs: () => {
    const [open, setOpen] = useState(false);
    return {
      openAddRooms: () => setOpen(true),
      openAddSpaces: () => setOpen(true),
      openInvite: () => setOpen(true),
      openLeave: () => setOpen(true),
      dialog: open
        ? createPortal(
            <div role="dialog" aria-label="Space Quick Dialog">
              <button type="button">Dialog Action</button>
            </div>,
            document.body
          )
        : null,
    };
  },
  SpaceMenuGroups: ({
    dialogs,
    onClose,
  }: {
    dialogs: { openInvite: () => void };
    onClose: () => void;
  }) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClose();
        dialogs.openInvite();
      }}
    >
      Invite
    </button>
  ),
}));

describe('SpaceTabs portaled dialog and menu isolation from sortable listeners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderSpaceTabs = () => {
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [mockSpace.roomId] });
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map<string, Set<string>>(),
      chatRooms: new Set<string>(),
    });
    return render(
      <Provider store={store}>
        <MemoryRouter>
          <SpaceTabs />
        </MemoryRouter>
      </Provider>
    );
  };

  it('does not bubble pointer, mouse, or touch events from a SpaceTab dialog or menu to sortable listeners', () => {
    const { container } = renderSpaceTabs();

    const spaceButton = container.querySelector<HTMLButtonElement>(
      `button[data-id="${mockSpace.roomId}"]`
    );
    expect(spaceButton).not.toBeNull();

    // Sanity check: pointer/mouse/touch presses on the rail button itself reach sortable listeners.
    fireEvent.mouseDown(spaceButton!);
    fireEvent.pointerDown(spaceButton!);
    fireEvent.touchStart(spaceButton!);
    expect(sortableListeners.onMouseDown).toHaveBeenCalledTimes(1);
    expect(sortableListeners.onPointerDown).toHaveBeenCalledTimes(1);
    expect(sortableListeners.onTouchStart).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();

    // Open the rail context menu and interact with it via pointer/mouse/touch.
    fireEvent.contextMenu(spaceButton!);
    const inviteMenuItem = screen.getByRole('menuitem', { name: 'Invite' });
    fireEvent.mouseDown(inviteMenuItem);
    fireEvent.mouseMove(inviteMenuItem, { clientX: 20, clientY: 20 });
    fireEvent.pointerDown(inviteMenuItem);
    fireEvent.pointerMove(inviteMenuItem, { clientX: 20, clientY: 20 });
    fireEvent.touchStart(inviteMenuItem);
    expect(sortableListeners.onMouseDown).not.toHaveBeenCalled();
    expect(sortableListeners.onPointerDown).not.toHaveBeenCalled();
    expect(sortableListeners.onTouchStart).not.toHaveBeenCalled();

    // Open a dialog from the context menu and verify drags inside the portaled dialog never reach
    // the sortable wrapper's listeners.
    fireEvent.click(inviteMenuItem);
    const dialog = screen.getByRole('dialog', { name: 'Space Quick Dialog' });
    const dialogButton = screen.getByRole('button', { name: 'Dialog Action' });
    expect(container.querySelector('.space-drag-source')?.contains(dialog)).toBe(false);

    fireEvent.mouseDown(dialogButton);
    fireEvent.mouseMove(dialogButton, { clientX: 50, clientY: 50 });
    fireEvent.pointerDown(dialogButton);
    fireEvent.pointerMove(dialogButton, { clientX: 50, clientY: 50 });
    fireEvent.touchStart(dialogButton);
    fireEvent.touchMove(dialogButton);

    expect(sortableListeners.onMouseDown).not.toHaveBeenCalled();
    expect(sortableListeners.onPointerDown).not.toHaveBeenCalled();
    expect(sortableListeners.onTouchStart).not.toHaveBeenCalled();
  });
});
