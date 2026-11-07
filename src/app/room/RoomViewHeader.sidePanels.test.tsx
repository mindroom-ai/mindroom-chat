// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';
import type { RoomViewMode } from '../navigation/roomViewMode';

// The header's side panel controls: the members button and the room menu's entries for the
// plugins' panels, which the room opens and closes by its rule (src/app/ui/panels/roomPanels.ts).

const { view, screen, navigate } = vi.hoisted(() => ({
  view: {
    mode: 'compact' as RoomViewMode,
    setViewMode: (() => undefined) as (mode: string) => void,
  },
  screen: { size: 'Desktop' },
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
// The room menu renders in place of folds' portal while it has an anchor, without a focus trap.
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? content : null,
}));
// The room menu's own rows, which need the app's providers, stay out of it.
vi.mock('../notifications/MarkRoomReadMenuItem', () => ({ MarkRoomReadMenuItem: () => null }));
vi.mock('../rooms/archive/ArchiveRoomMenuItem', () => ({ ArchiveRoomMenuItem: () => null }));
vi.mock('../notifications/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: () => null,
}));
vi.mock('../matrix/hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => 'all_messages',
  getRoomNotificationModeIcon: () => undefined,
  useRoomsNotificationPreferencesContext: () => ({}),
}));
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../ui/page/Page', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../avatars/RoomAvatar', () => ({ RoomAvatar: () => null, RoomIcon: () => null }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org', getRoom: () => null }),
}));
vi.mock('../matrix/hooks/useRoom', () => ({
  useRoom: () => ({ roomId: '!room:example.org', getJoinRule: () => undefined }),
  useIsDirectRoom: () => false,
}));
vi.mock('../matrix/hooks/useSpace', () => ({ useSpaceOptionally: () => undefined }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
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
  useRoomPermissions: () => ({ action: () => false, event: () => false }),
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({ usePinnedEventIds: () => [] }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: vi.fn() }),
}));
vi.mock('../navigation/useRoomSettingsState', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../schedules/RoomSchedulesButton', () => ({
  RoomSchedulesButton: () => null,
  RoomSchedulesMenuEntry: () => null,
  RoomSchedulesOverlay: () => null,
}));
vi.mock('../lib/hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hooks/useScreenSize')>()),
  useScreenSizeContext: () => screen.size,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    viewMode: view.mode,
    setViewMode: view.setViewMode,
    availableViewModes: ['compact', 'threaded', 'classic'],
  }),
}));

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  screen.size = 'Desktop';
});

const PLUGIN_PANELS = [
  { id: 'notes/panel', label: 'Notes' },
  { id: 'tasks/panel', label: 'Tasks' },
];

const renderHeader = (props: Partial<RoomViewHeaderProps>) => {
  act(() => {
    renderer = create(
      <Provider store={createStore()}>
        <RoomViewHeader hasMindroomAgents pluginPanels={PLUGIN_PANELS} {...props} />
      </Provider>
    );
  });
};

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const buttons = (match: (node: ReactTestInstance) => boolean): ReactTestInstance[] =>
  renderer?.root.findAll((node) => node.type === 'button' && match(node)) ?? [];

const openMenu = () => {
  const [more] = buttons((node) => node.props['aria-label'] === 'More Options');
  if (!more) throw new Error('no More Options button');
  act(() => {
    more.props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } });
  });
};

/** The room menu's plugin panel entries: label and whether each is checked. */
const panelEntries = () =>
  buttons(
    (node) =>
      node.props.role === 'menuitemcheckbox' &&
      PLUGIN_PANELS.some(({ label }) => textOf(node) === label)
  ).map((node) => [textOf(node), node.props['aria-checked'] as boolean]);

describe("the room header's side panel controls", () => {
  it.each(['Desktop', 'Mobile'])(
    "offers the plugins' panels in the room menu on %s, marking the one shown",
    (size) => {
      screen.size = size;
      const onPanelToggle = vi.fn();
      renderHeader({ shownPanel: 'tasks/panel', onPanelToggle });
      expect(panelEntries()).toEqual([]);

      openMenu();
      expect(panelEntries()).toEqual([
        ['Notes', false],
        ['Tasks', true],
      ]);
      const [notes] = buttons((node) => textOf(node) === 'Notes');
      act(() => {
        notes?.props.onClick();
      });
      expect(onPanelToggle).toHaveBeenCalledWith('notes/panel');
      // Choosing an entry closes the menu.
      expect(panelEntries()).toEqual([]);
    }
  );

  it('names the members button after whether the members show', () => {
    const onPanelToggle = vi.fn();
    renderHeader({ shownPanel: 'members', onPanelToggle });
    const [hide] = buttons((node) => node.props['aria-label'] === 'Hide Members');
    act(() => {
      hide?.props.onClick();
    });
    expect(onPanelToggle).toHaveBeenCalledWith('members');

    renderHeader({ shownPanel: 'call', onPanelToggle });
    expect(buttons((node) => node.props['aria-label'] === 'Show Members')).toHaveLength(1);
  });
});
