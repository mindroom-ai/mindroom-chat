// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Badge, Icon, IconButton, Text } from 'folds';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubagentMeta, SubagentStatus } from '../matrix/protocol/subagentFrame';
import { getSubagentRunStore } from '../messages/live/subagentRunStore';
import { SubagentsIcon } from '../subagents/SubagentsIcon';
import { MenuEntry } from '../ui/MenuEntry';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';

// The Sub-agents panel's toggle in the room header: there while the room's store holds a run of
// a sub-agent started in the open conversation (the thread, or the room's timeline while none is
// open), with a badge that counts those runs still at it (running, waiting for approval or
// paused). On phones it is an entry of the room menu, and a count puts a dot on the menu's button.

const ROOM_ID = '!room:example.org';
const SENDER = '@mindroom_lead:example.org';
/** The thread the header has open unless a test says otherwise, where `run` starts its runs. */
const THREAD = '$thread:example.org';

const { screen, mx } = vi.hoisted(() => ({
  screen: { size: 'Desktop' },
  // One client, so the header reads the same run store the test feeds.
  mx: {
    getSafeUserId: () => '@me:example.org',
    getUserId: () => '@me:example.org',
    getRoom: () => null,
  },
}));

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
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => mx }));
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

const store = () => getSubagentRunStore(mx as unknown as MatrixClient);

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  store().clear();
  screen.size = 'Desktop';
});

const renderHeader = (props: RoomViewHeaderProps) => {
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(
      <Provider store={createStore()}>
        <RoomViewHeader openThreadId={THREAD} {...props} />
      </Provider>
    );
  });
};

let serial = 0;
/** A run in the thread (`null`: the room's timeline) as its first frame leaves it. */
const run = (status: SubagentStatus, threadId: string | null = THREAD) => {
  serial += 1;
  const ended = status !== 'running' && status !== 'awaiting_approval' && status !== 'paused';
  const meta: SubagentMeta = {
    agent: 'researcher',
    subagent: `run-${serial}`,
    caller: 'lead',
    root: 'lead',
    parent: null,
    threadId,
    source: 'delegate',
    status,
    startedAt: 1_762_790_000,
    endedAt: ended ? 1_762_790_060 : null,
  };
  const snapshot = { md: 'Looking.', reasoning: '', tools: [], status: 'streaming', activity: '' };
  act(() =>
    store().ingest(ROOM_ID, SENDER, { run: `run-${serial}`, sid: 's', seq: 0, meta, snapshot }, 0)
  );
};

const openMenu = () => {
  const more = renderer?.root.find(
    (node) => node.type === 'button' && node.props['aria-label'] === 'More Options'
  );
  act(() => {
    more?.props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } });
  });
};

const toggles = (): ReactTestInstance[] =>
  renderer?.root
    .findAllByType(IconButton)
    .filter((node) => 'data-subagents-toggle' in node.props) ?? [];
const toggle = (): ReactTestInstance | undefined => toggles()[0];
const menuEntries = (): ReactTestInstance[] =>
  renderer?.root.findAllByType(MenuEntry).filter((node) => 'data-subagents-toggle' in node.props) ??
  [];
/** The count on the toggle's corner, if any. */
const badgeOf = (button: ReactTestInstance | undefined) =>
  button?.findAllByType(Badge).map((badge) => String(badge.findByType(Text).props.children))[0];
const menuDots = () =>
  renderer?.root.findAll(
    (node) => typeof node.type === 'string' && 'data-room-menu-dot' in node.props
  ) ?? [];

describe("the Sub-agents panel's toggle in the room header", () => {
  it('is not there while the room has no sub-agent runs', () => {
    renderHeader({ onPanelToggle: vi.fn() });
    expect(toggles()).toHaveLength(0);
    openMenu();
    expect(menuEntries()).toHaveLength(0);
  });

  it('is there only in the conversation its runs started in', () => {
    run('running');
    renderHeader({ onPanelToggle: vi.fn(), openThreadId: undefined });
    expect(toggles()).toHaveLength(0);
    renderHeader({ onPanelToggle: vi.fn(), openThreadId: '$other:example.org' });
    expect(toggles()).toHaveLength(0);

    run('running', null);
    renderHeader({ onPanelToggle: vi.fn(), openThreadId: undefined });
    expect(toggle()?.props['aria-label']).toBe('Show sub-agents, 1 active');
    renderHeader({ onPanelToggle: vi.fn() });
    expect(toggle()?.props['aria-label']).toBe('Show sub-agents, 1 active');
    renderHeader({ onPanelToggle: vi.fn(), openThreadId: '$other:example.org' });
    expect(toggles()).toHaveLength(0);
  });

  it('counts two running runs on its badge, and toggles the panel by the room', () => {
    run('running');
    run('running');
    const onPanelToggle = vi.fn();
    renderHeader({ onPanelToggle });
    expect(toggle()?.props).toMatchObject({
      'aria-label': 'Show sub-agents, 2 active',
      'aria-pressed': false,
      variant: 'Surface',
    });
    expect(toggle()?.findByType(Icon).props.src).toBe(SubagentsIcon);
    expect(badgeOf(toggle())).toBe('2');
    act(() => {
      toggle()?.props.onClick({});
    });
    expect(onPanelToggle).toHaveBeenCalledWith('subagents');

    renderHeader({ onPanelToggle, shownPanel: 'subagents' });
    expect(toggle()?.props).toMatchObject({
      'aria-label': 'Hide sub-agents, 2 active',
      'aria-pressed': true,
      variant: 'Primary',
    });
  });

  it('counts the runs still at it, and stays without a badge while only ended runs are kept', () => {
    run('completed');
    run('failed');
    renderHeader({ onPanelToggle: vi.fn() });
    expect(toggle()?.props['aria-label']).toBe('Show sub-agents');
    expect(badgeOf(toggle())).toBeUndefined();

    run('running');
    run('awaiting_approval');
    run('paused');
    expect(toggle()?.props['aria-label']).toBe('Show sub-agents, 3 active');
    expect(badgeOf(toggle())).toBe('3');
  });

  it('stays while the panel is shown after its last run is gone, so it can hide the panel', () => {
    run('completed');
    const onPanelToggle = vi.fn();
    renderHeader({ onPanelToggle, shownPanel: 'subagents' });
    act(() => store().clear());

    expect(toggle()?.props).toMatchObject({
      'aria-label': 'Hide sub-agents',
      'aria-pressed': true,
    });
    act(() => {
      toggle()?.props.onClick({});
    });
    expect(onPanelToggle).toHaveBeenCalledWith('subagents');
  });

  it("is an entry of a phone's room menu, whose button a count marks with a dot", () => {
    screen.size = 'Mobile';
    run('running');
    const onPanelToggle = vi.fn();
    renderHeader({ onPanelToggle });
    expect(toggles()).toHaveLength(0);
    expect(menuDots()).toHaveLength(1);
    openMenu();
    expect(menuEntries()[0]?.props).toMatchObject({
      label: 'Show sub-agents, 1 active',
      role: 'menuitemcheckbox',
      'aria-checked': false,
      icon: SubagentsIcon,
    });
    act(() => {
      menuEntries()[0]?.props.onSelect();
    });
    expect(onPanelToggle).toHaveBeenCalledWith('subagents');
  });

  it("leaves a phone's menu button without a dot while only ended runs are kept", () => {
    screen.size = 'Mobile';
    run('cancelled');
    renderHeader({ onPanelToggle: vi.fn() });
    expect(menuDots()).toHaveLength(0);
    openMenu();
    expect(menuEntries()).toHaveLength(1);
  });
});
