// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultThreadFilterState } from '../event-store/threads/roomThreadOverviewModel';
import { translateFromEn } from '../../test/utils/i18n';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: translateFromEn }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? content : null,
}));
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
  FocusTrap: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../ui/page/Page', async () => {
  const { forwardRef } = await import('react');
  return {
    PageHeader: forwardRef<HTMLElement, React.PropsWithChildren>(({ children }, ref) => (
      <header ref={ref}>{children}</header>
    )),
  };
});
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
vi.mock('../event-store/threads/useThreadPinning', () => ({ usePinnedEventIds: () => [] }));
vi.mock('../messages/pins/RoomPinMenu', () => ({ RoomPinMenu: () => null }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: vi.fn() }),
}));
vi.mock('../navigation/useRoomSettingsState', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../schedules/RoomSchedulesButton', () => ({
  RoomSchedulesButton: () => null,
  RoomSchedulesMenuEntry: () => null,
  RoomSchedulesOverlay: () => null,
  usePendingRoomSchedules: () => [],
}));
vi.mock('../lib/hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hooks/useScreenSize')>()),
  useScreenSizeContext: () => 'Desktop',
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    viewMode: 'compact',
    setViewMode: vi.fn(),
    availableViewModes: ['compact', 'threaded', 'classic'],
  }),
}));

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

const renderHeader = (props: RoomViewHeaderProps = {}) => {
  const store = createStore();
  return render(
    <Provider store={store}>
      <RoomViewHeader
        hasMindroomAgents
        threadFilterState={createDefaultThreadFilterState()}
        {...props}
      />
    </Provider>
  );
};

describe('RoomViewHeader Mac Access action', () => {
  it('hides the Mac Access button when canGiveMacAccess is false', () => {
    renderHeader({ canGiveMacAccess: false });
    expect(document.querySelector('[data-mac-access-button]')).toBeNull();
  });

  it('shows Give Mac Access in the header row and invokes onOpenMacAccess when clicked', () => {
    const onOpenMacAccess = vi.fn();
    renderHeader({ canGiveMacAccess: true, macAccessActive: false, onOpenMacAccess });

    const button = screen.getByRole('button', { name: 'Give Mac Access' });
    expect(button.hasAttribute('data-mac-access-button')).toBe(true);
    expect(document.querySelector('[data-mac-access-active-dot]')).toBeNull();

    fireEvent.click(button);
    expect(onOpenMacAccess).toHaveBeenCalledTimes(1);
  });

  it('shows Mac Access with a green active dot when an agent in the room is paired and active', () => {
    const onOpenMacAccess = vi.fn();
    renderHeader({ canGiveMacAccess: true, macAccessActive: true, onOpenMacAccess });

    const button = screen.getByRole('button', { name: 'Mac Access' });
    expect(button.hasAttribute('data-mac-access-button')).toBe(true);
    expect(document.querySelector('[data-mac-access-active-dot]')).not.toBeNull();

    fireEvent.click(button);
    expect(onOpenMacAccess).toHaveBeenCalledTimes(1);
  });
});
