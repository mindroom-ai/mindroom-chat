// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings, settingsAtom } from '../preferences/settings';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';
import type { RoomViewMode } from '../navigation/roomViewMode';
import { createDefaultThreadFilterState } from '../event-store/threads/roomThreadOverviewModel';
import { getRoomCommands } from '../navigation/roomCommands';

const { view, screen, navigate, pins } = vi.hoisted(() => ({
  view: {
    mode: 'compact' as RoomViewMode,
    setViewMode: (() => undefined) as (mode: string) => void,
  },
  screen: { size: 'Desktop' },
  navigate: vi.fn(),
  pins: { ids: [] as string[] },
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
vi.mock('../matrix/session/useSessionStore', async (original) => ({
  ...(await original<typeof import('../matrix/session/useSessionStore')>()),
  useActiveSession: () => ({ sessionId: 'me-session' }),
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
  useRoomPermissions: () => ({ action: () => false, event: () => false, stateEvent: () => false }),
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({ usePinnedEventIds: () => pins.ids }));
vi.mock('../messages/pins/RoomPinMenu', () => ({ RoomPinMenu: () => <div data-pin-list="" /> }));
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
  navigate.mockReset();
  pins.ids = [];
});

const renderHeader = ({
  mode = 'compact',
  hidden = false,
  hasMindroomAgents = true,
  threadFilterState = createDefaultThreadFilterState(),
  toolCallsShown = true,
  ...props
}: RoomViewHeaderProps & {
  mode?: RoomViewMode;
  hidden?: boolean;
  toolCallsShown?: boolean;
} = {}) => {
  act(() => renderer?.unmount());
  view.mode = mode;
  const store = createStore();
  store.set(settingsAtom, {
    ...getSettings(),
    hideThreadFilterBar: hidden,
    showToolCalls: toolCallsShown,
  });
  act(() => {
    renderer = create(
      <Provider store={store}>
        <RoomViewHeader
          hasMindroomAgents={hasMindroomAgents}
          threadFilterState={threadFilterState}
          {...props}
        />
      </Provider>
    );
  });
  return store;
};

const commandById = (id: string) => getRoomCommands().find((command) => command.id === id);

describe("the room header's commands", () => {
  it('offers the actions the header draws, bar those that need their button', () => {
    pins.ids = ['$pinned'];
    renderHeader({
      calls: <button type="button">Call</button>,
      canvases: [
        {
          canvasId: '$canvas',
          roomId: '!room:example.org',
          threadId: '$thread',
          agentUserId: '@mindroom_helper:example.org',
          title: 'Plans',
          createdTs: 1,
          revisionId: '$canvas',
          updatedTs: 1,
          shared: false,
        },
      ],
    });
    const ids = getRoomCommands().map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining(['filterBar', 'toolCalls', 'members']));
    expect(commandById('filterBar')?.pressed).toBe(true);
    expect(commandById('toolCalls')?.pressed).toBe(true);
    expect(commandById('members')?.shortcut).toBe('members');
    for (const id of ['pins', 'schedules', 'canvas', 'call']) {
      expect(ids).not.toContain(id);
    }
  });

  it('runs an action as the header does', () => {
    const store = renderHeader();
    expect(getSettings().hideThreadFilterBar).toBe(false);
    act(() => commandById('filterBar')?.run());
    expect(store.get(settingsAtom).hideThreadFilterBar).toBe(true);
    expect(commandById('filterBar')?.pressed).toBe(false);
  });

  it('are none once the header unmounts', () => {
    renderHeader();
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(getRoomCommands()).toEqual([]);
  });
});
