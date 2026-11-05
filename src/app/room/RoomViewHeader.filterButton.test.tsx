// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings, settingsAtom } from '../preferences/settings';
import { RoomViewHeader } from './RoomViewHeader';
import type { RoomViewMode } from '../navigation/roomViewMode';
import { createDefaultThreadFilterState, type ThreadFilterState } from '../event-store/threads/roomThreadOverviewModel';

const { view } = vi.hoisted(() => ({
  view: {
    mode: 'compact' as RoomViewMode,
    setViewMode: (() => undefined) as (mode: string) => void,
  },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../ui/page/Page', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../avatars/room-avatar/RoomAvatar', () => ({ RoomAvatar: () => null, RoomIcon: () => null }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org' }),
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
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ action: () => false, event: () => false }),
}));
vi.mock('../event-store/threads/useThreadPinning', () => ({ usePinnedEventIds: () => [] }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: vi.fn() }),
}));
vi.mock('../navigation/useRoomSettingsState', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../calls/callStore', () => ({ useCallPanel: () => [false, vi.fn()] }));
vi.mock('../members/useMembersDrawer', () => ({ useMembersDrawer: () => [false, vi.fn()] }));
vi.mock('../schedules/RoomSchedulesButton', () => ({ RoomSchedulesButton: () => null }));
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
});

const renderHeader = ({
  mode = 'compact',
  hidden = false,
  hasMindroomAgents = true,
  threadId,
  threadFilterState = createDefaultThreadFilterState(),
}: {
  mode?: RoomViewMode;
  hidden?: boolean;
  hasMindroomAgents?: boolean;
  threadId?: string;
  threadFilterState?: ThreadFilterState;
} = {}) => {
  act(() => renderer?.unmount());
  view.mode = mode;
  const store = createStore();
  store.set(settingsAtom, { ...getSettings(), hideThreadFilterBar: hidden });
  act(() => {
    renderer = create(
      <Provider store={store}>
        <RoomViewHeader
          hasMindroomAgents={hasMindroomAgents}
          threadId={threadId}
          threadFilterState={threadFilterState}
        />
      </Provider>
    );
  });
  return store;
};

const byData = (name: string): ReactTestInstance[] =>
  renderer?.root.findAll((node) => typeof node.type === 'string' && name in node.props) ?? [];
const filterButtons = () => byData('data-thread-filter-bar-toggle');
const filterButton = (): ReactTestInstance => {
  const [node] = filterButtons();
  if (!node) throw new Error('no filter button');
  return node;
};

describe('the room header filter button', () => {
  it('shows the bar by default and hides it on click, as a stored setting', () => {
    const store = renderHeader();
    expect(getSettings().hideThreadFilterBar).toBe(false);
    expect(filterButton().props['aria-pressed']).toBe(true);
    expect(filterButton().props['aria-label']).toBe('Thread filters');

    act(() => {
      filterButton().props.onClick();
    });

    expect(store.get(settingsAtom).hideThreadFilterBar).toBe(true);
    expect(filterButton().props['aria-pressed']).toBe(false);
  });

  it('appears only in the views with a filter bar', () => {
    renderHeader({ mode: 'compact', hasMindroomAgents: false });
    expect(filterButtons()).toHaveLength(1);
    renderHeader({ mode: 'threaded' });
    expect(filterButtons()).toHaveLength(1);
    renderHeader({ mode: 'threaded', hasMindroomAgents: false });
    expect(filterButtons()).toHaveLength(0);
    renderHeader({ mode: 'classic' });
    expect(filterButtons()).toHaveLength(0);
    renderHeader({ mode: 'compact', threadId: '$thread' });
    expect(filterButtons()).toHaveLength(0);
  });

  it('marks filters that apply while the bar is hidden', () => {
    const filtered = { ...createDefaultThreadFilterState(), resolved: 'exclude' as const };
    renderHeader({ threadFilterState: filtered });
    expect(byData('data-hidden-filters-dot')).toHaveLength(0);

    renderHeader({ hidden: true });
    expect(byData('data-hidden-filters-dot')).toHaveLength(0);
    expect(filterButton().props['aria-label']).toBe('Thread filters');

    renderHeader({ hidden: true, threadFilterState: filtered });
    expect(byData('data-hidden-filters-dot')).toHaveLength(1);
    expect(filterButton().props['aria-label']).toBe('Thread filters (active)');
  });
});

describe('the room header view switch', () => {
  const switchTo = (mode: RoomViewMode, hasMindroomAgents: boolean) => {
    const setViewMode = vi.fn();
    view.setViewMode = setViewMode;
    renderHeader({ mode, hasMindroomAgents });
    const [viewSwitch] = byData('data-room-view-switch');
    if (!viewSwitch) throw new Error('no view switch');
    act(() => {
      viewSwitch.props.onClick();
    });
    return { pressed: viewSwitch.props['aria-pressed'], next: setViewMode.mock.calls[0]?.[0] };
  };

  it('goes between Compact and Threads in rooms with and without agents', () => {
    expect(switchTo('compact', true)).toEqual({ pressed: true, next: 'threaded' });
    expect(switchTo('threaded', true)).toEqual({ pressed: false, next: 'compact' });
    expect(switchTo('compact', false)).toEqual({ pressed: true, next: 'threaded' });
    expect(switchTo('threaded', false)).toEqual({ pressed: false, next: 'compact' });
  });

  it('goes from a stored Classic view to Compact', () => {
    expect(switchTo('classic', true)).toEqual({ pressed: false, next: 'compact' });
  });
});
