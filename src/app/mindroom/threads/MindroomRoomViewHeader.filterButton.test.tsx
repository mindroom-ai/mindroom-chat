// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings, settingsAtom } from '../../state/settings';
import { RoomViewHeader } from './MindroomRoomViewHeader';
import type { RoomViewMode } from './roomViewMode';
import { createDefaultThreadFilterState, type ThreadFilterState } from './roomThreadOverviewModel';

const { view } = vi.hoisted(() => ({ view: { mode: 'compact' as RoomViewMode } }));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/page', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../components/room-avatar', () => ({ RoomAvatar: () => null, RoomIcon: () => null }));
vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org' }),
}));
vi.mock('../../hooks/useRoom', () => ({
  useRoom: () => ({ roomId: '!room:example.org', getJoinRule: () => undefined }),
  useIsDirectRoom: () => false,
}));
vi.mock('../../hooks/useSpace', () => ({ useSpaceOptionally: () => undefined }));
vi.mock('../../hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../../hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'General',
  useRoomTopic: () => undefined,
}));
vi.mock('../../hooks/useStateEvent', () => ({ useStateEvent: () => undefined }));
vi.mock('../../hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../../hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ action: () => false, event: () => false }),
}));
vi.mock('../../hooks/useRoomPinnedEvents', () => ({ useRoomPinnedEvents: () => [] }));
vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: vi.fn() }),
}));
vi.mock('../../state/hooks/roomSettings', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../../features/calls/callStore', () => ({ useCallPanel: () => [false, vi.fn()] }));
vi.mock('../sidebar/useMembersDrawer', () => ({ useMembersDrawer: () => [false, vi.fn()] }));
vi.mock('../schedules/RoomSchedulesButton', () => ({ RoomSchedulesButton: () => null }));
vi.mock('./useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    viewMode: view.mode,
    setViewMode: vi.fn(),
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
