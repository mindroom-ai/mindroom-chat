// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Icons } from 'folds';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';

// A plugin's side panel's toggle in the room header: a button in its row or an entry of its room
// menu, by the panel's placement, with the panel's icon, pressed while the room shows the panel.
// The room (Room.tsx) names no panel shown while the panel is folded to its tab.

const screen = vi.hoisted(() => ({ size: 'Desktop' }));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
// The room menu renders in place of folds' portal while it has an anchor.
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? content : null,
}));
// The room menu's own rows, which need the app's providers, stay out of it.
vi.mock('../notifications/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: () => null,
}));
vi.mock('../matrix/hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => 'all_messages',
  getRoomNotificationModeIcon: () => undefined,
  useRoomsNotificationPreferencesContext: () => ({}),
}));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org', getRoom: () => null }),
}));
vi.mock('../matrix/hooks/useRoom', () => ({
  useRoom: () => ({
    roomId: '!room:example.org',
    name: 'General',
    getJoinRule: () => undefined,
    isSpaceRoom: () => false,
  }),
  useIsDirectRoom: () => false,
}));
vi.mock('../matrix/hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'General',
  useRoomTopic: () => undefined,
}));
vi.mock('../matrix/hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  usePowerLevels: () => ({}),
  usePowerLevelsContext: () => ({}),
}));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ action: () => false, event: () => false, stateEvent: () => false }),
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({ usePinnedEventIds: () => [] }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: vi.fn() }),
}));
vi.mock('../lib/hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hooks/useScreenSize')>()),
  useScreenSizeContext: () => screen.size,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    viewMode: 'classic',
    setViewMode: () => undefined,
    availableViewModes: ['classic'],
  }),
}));

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  screen.size = 'Desktop';
});

const renderHeader = (props: RoomViewHeaderProps) => {
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(
      <Provider store={createStore()}>
        <RoomViewHeader {...props} />
      </Provider>
    );
  });
};

const openMenu = () => {
  const more = renderer?.root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === 'More Options'
  );
  act(() => {
    more?.props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } });
  });
};

/** The row's button named `label`, as the header draws it (folds' `IconButton`). */
const rowButton = (label: string): ReactTestInstance | undefined =>
  renderer?.root.findAll(
    (node) =>
      typeof node.type !== 'string' && node.props['aria-label'] === label && 'variant' in node.props
  )[0];
/** The room menu's entry named `label` (`MenuEntry`). */
const menuEntry = (label: string): ReactTestInstance | undefined =>
  renderer?.root.findAll(
    (node) =>
      typeof node.type !== 'string' && node.props.label === label && 'onSelect' in node.props
  )[0];
const iconOf = (button: ReactTestInstance | undefined) =>
  button?.find((node) => typeof node.type !== 'string' && 'src' in node.props).props.src;

const BOARD = { id: 'notes/board', label: 'Board', icon: Icons.Star, placement: 'auto' } as const;

describe("a plugin's side panel's toggle in the room header", () => {
  it("is a button with its icon in a wide header's row, pressed and tinted while the room shows it", () => {
    const onPanelToggle = vi.fn();
    renderHeader({ pluginPanels: [BOARD], onPanelToggle });
    expect(rowButton('Board')?.props).toMatchObject({ 'aria-pressed': false, variant: 'Surface' });
    expect(iconOf(rowButton('Board'))).toBe(Icons.Star);
    act(() => {
      rowButton('Board')?.props.onClick({});
    });
    expect(onPanelToggle).toHaveBeenCalledWith('notes/board');
    openMenu();
    expect(menuEntry('Board')).toBeUndefined();

    renderHeader({ pluginPanels: [BOARD], shownPanel: 'notes/board', onPanelToggle });
    expect(rowButton('Board')?.props).toMatchObject({ 'aria-pressed': true, variant: 'Primary' });
    renderHeader({ pluginPanels: [BOARD], shownPanel: 'members', onPanelToggle });
    expect(rowButton('Board')?.props).toMatchObject({ 'aria-pressed': false, variant: 'Surface' });
  });

  it("is an entry with its icon in a phone's room menu, checked while the room shows it", () => {
    screen.size = 'Mobile';
    const onPanelToggle = vi.fn();
    renderHeader({ pluginPanels: [BOARD], shownPanel: 'notes/board', onPanelToggle });
    expect(rowButton('Board')).toBeUndefined();
    openMenu();
    expect(menuEntry('Board')?.props).toMatchObject({
      role: 'menuitemcheckbox',
      'aria-checked': true,
      icon: Icons.Star,
    });
    act(() => {
      menuEntry('Board')?.props.onSelect();
    });
    expect(onPanelToggle).toHaveBeenCalledWith('notes/board');
  });

  it('is an entry of the room menu under a bulb for a panel with no icon or placement', () => {
    renderHeader({ pluginPanels: [{ id: 'notes/panel', label: 'Notes' }], onPanelToggle: vi.fn() });
    expect(rowButton('Notes')).toBeUndefined();
    openMenu();
    expect(menuEntry('Notes')?.props).toMatchObject({ 'aria-checked': false, icon: Icons.Bulb });
  });
});
