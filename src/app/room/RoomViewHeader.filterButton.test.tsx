// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettings, settingsAtom } from '../preferences/settings';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';
import { edgeSwipeBackCountAtom } from '../navigation/useEdgeSwipeBack';
import type { RoomViewMode } from '../navigation/roomViewMode';
import { createDefaultThreadFilterState } from '../event-store/threads/roomThreadOverviewModel';
import { Icons } from 'folds';
import { clearToolCallOverrides } from '../messages/toolCallVisibility';

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

    // Hiding snoozed threads is the default, not a filter the reader chose.
    renderHeader({
      hidden: true,
      threadFilterState: { ...createDefaultThreadFilterState(), snoozed: 'exclude' },
    });
    expect(byData('data-hidden-filters-dot')).toHaveLength(0);
  });
});

describe("the room menu's tool calls switch", () => {
  const SESSION = 'me-session';
  const toolCallsEntry = () =>
    byData('data-tool-calls-toggle').find((node) => node.type === 'button');
  const choose = () =>
    act(() => {
      toolCallsEntry()?.props.onClick();
    });
  const stored = () => localStorage.getItem(`toolCallsShown:${SESSION}`);
  afterEach(() => clearToolCallOverrides(SESSION));

  it.each(['Desktop', 'Mobile'])(
    'shows or hides the tool calls of this room only on %s, leaving the default as it is',
    (size) => {
      screen.size = size;
      const store = renderHeader({ toolCallsShown: false });
      // Only the room menu offers it, never the header's row.
      expect(toolCallsEntry()).toBeUndefined();

      openMenu();
      expect(toolCallsEntry()?.props).toMatchObject({
        role: 'menuitemcheckbox',
        'aria-checked': false,
      });
      expect(textOf(toolCallsEntry() as ReactTestInstance)).toBe('Show tool calls');
      choose();
      expect(JSON.parse(stored() ?? 'null')).toEqual({ '!room:example.org': { room: true } });
      expect(store.get(settingsAtom).showToolCalls).toBe(false);
      // Choosing it closes the menu.
      expect(toolCallsEntry()).toBeUndefined();

      openMenu();
      expect(toolCallsEntry()?.props['aria-checked']).toBe(true);
      // Back to what Settings gives: the room follows the default again.
      choose();
      expect(stored()).toBeNull();
      openMenu();
      expect(toolCallsEntry()?.props['aria-checked']).toBe(false);
    }
  );

  it('is left out of rooms without agents, which have no tool calls', () => {
    renderHeader({ hasMindroomAgents: false });
    openMenu();
    expect(toolCallsEntry()).toBeUndefined();
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

  it('tints the switch while the room shows Compact', () => {
    const tint = () =>
      renderer?.root.findAll(
        (node) => node.props['aria-label'] === 'Compact view' && 'variant' in node.props
      )[0]?.props.variant;
    renderHeader({ mode: 'compact' });
    expect(tint()).toBe('Primary');
    renderHeader({ mode: 'threaded' });
    expect(tint()).toBe('Surface');
  });

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

const buttons = (match: (node: ReactTestInstance) => boolean): ReactTestInstance[] =>
  renderer?.root.findAll((node) => node.type === 'button' && match(node)) ?? [];
const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

const openMenu = () => {
  const [more] = buttons((node) => node.props['aria-label'] === 'More Options');
  if (!more) throw new Error('no More Options button');
  act(() => {
    more.props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } });
  });
};

describe("a phone's room header", () => {
  const entry = (name: string): ReactTestInstance | undefined =>
    byData(name).find((node) => node.type === 'button');

  it('offers the view switch and the filter bar in the room menu, not beside the name', () => {
    screen.size = 'Mobile';
    const setViewMode = vi.fn();
    view.setViewMode = setViewMode;
    const store = renderHeader();
    expect(byData('data-room-view-switch')).toHaveLength(0);
    expect(filterButtons()).toHaveLength(0);

    openMenu();
    expect(entry('data-room-view-switch')?.props).toMatchObject({
      role: 'menuitemcheckbox',
      'aria-checked': true,
    });
    expect(entry('data-thread-filter-bar-toggle')?.props).toMatchObject({
      role: 'menuitemcheckbox',
      'aria-checked': true,
    });
    act(() => {
      entry('data-thread-filter-bar-toggle')?.props.onClick();
    });
    expect(store.get(settingsAtom).hideThreadFilterBar).toBe(true);
    // Choosing an entry closes the menu.
    expect(entry('data-room-view-switch')).toBeUndefined();

    openMenu();
    act(() => {
      entry('data-room-view-switch')?.props.onClick();
    });
    expect(setViewMode).toHaveBeenCalledWith('threaded');
  });

  it('marks hidden active filters with a dot on the room menu button', () => {
    screen.size = 'Mobile';
    const filtered = { ...createDefaultThreadFilterState(), resolved: 'exclude' as const };
    renderHeader({ hidden: true, threadFilterState: filtered });
    expect(byData('data-room-menu-dot')).toHaveLength(1);
    openMenu();
    expect(entry('data-thread-filter-bar-toggle')?.props['aria-checked']).toBe(false);

    renderHeader({ hidden: true });
    expect(byData('data-room-menu-dot')).toHaveLength(0);
  });

  /** A finger from the screen's left edge toward the middle, lifted there, on the window. */
  const swipeFromLeftEdge = () => {
    const fire = (type: string, x?: number) => {
      const event = new Event(type, { cancelable: true });
      const touches = x === undefined ? [] : [{ clientX: x, clientY: 400 }];
      Object.defineProperty(event, 'touches', { value: touches });
      window.dispatchEvent(event);
    };
    act(() => {
      fire('touchstart', 4);
      for (const x of [40, 80, 120, 160]) fire('touchmove', x);
      fire('touchend');
    });
  };

  it("leaves a phone's swipe from the left edge to the navigation drawer, staying in the room", () => {
    screen.size = 'Mobile';
    const store = renderHeader();
    // No back swipe of the room's own, so the drawer's swipe brings it out (PhoneNavDrawer).
    expect(store.get(edgeSwipeBackCountAtom)).toBe(0);
    swipeFromLeftEdge();
    expect(navigate).not.toHaveBeenCalled();

    // The back chevron still leaves the room.
    const [back] =
      renderer?.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Back'
      ) ?? [];
    if (!back) throw new Error('no Back button');
    act(() => {
      back.props.onClick();
    });
    expect(navigate).toHaveBeenCalledOnce();
  });
});

describe("the room header's side panel controls", () => {
  const PLUGIN_PANELS = [
    { id: 'notes/panel', label: 'Notes' },
    { id: 'tasks/panel', label: 'Tasks' },
  ];
  /** The room menu's plugin panel entries: label and whether each is checked. */
  const panelEntries = () =>
    buttons(
      (node) =>
        node.props.role === 'menuitemcheckbox' &&
        PLUGIN_PANELS.some(({ label }) => textOf(node) === label)
    ).map((node) => [textOf(node), node.props['aria-checked'] as boolean]);

  it.each(['Desktop', 'Mobile'])(
    "offers the plugins' panels in the room menu on %s, marking the one shown",
    (size) => {
      screen.size = size;
      const onPanelToggle = vi.fn();
      renderHeader({ pluginPanels: PLUGIN_PANELS, shownPanel: 'tasks/panel', onPanelToggle });
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

describe("the room header's actions", () => {
  /** Every action on: an agent room in Compact with a canvas, the computer, calls, pins, a plugin panel. */
  const renderEverything = () => {
    pins.ids = ['$pinned'];
    renderHeader({
      computerAvailable: true,
      computerShown: true,
      onComputerToggle: vi.fn(),
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
      onCanvasOpen: vi.fn(),
      onCanvasClose: vi.fn(),
      // A call is on: a phone's row keeps its button, the menu offers the rest.
      calls: (placement) =>
        placement.at === 'menu' ? (
          <button type="button">Call Helper</button>
        ) : (
          <button type="button" aria-label={placement.phone ? 'Join the call' : 'Start a call'} />
        ),
      pluginPanels: [{ id: 'notes/panel', label: 'Notes' }],
      onPanelToggle: vi.fn(),
    });
  };
  const rowLabels = () =>
    buttons((node) => typeof node.props['aria-label'] === 'string').map(
      (node) => node.props['aria-label'] as string
    );
  /** The room menu's entries before the ones every room menu shares (Invite first among them). */
  const roomEntries = () => {
    const entries = buttons((node) => !node.props['aria-label']).map(textOf);
    return entries.slice(
      0,
      entries.findIndex((entry) => entry.startsWith('Invite'))
    );
  };

  it('puts every action in the row of a wide header, in order', () => {
    renderEverything();
    expect(rowLabels()).toEqual([
      'Compact view',
      'Thread filters',
      'Show Canvas',
      'Show Computer',
      'Start a call',
      'Pinned Messages',
      'Show Members',
      'More Options',
    ]);
    openMenu();
    expect(roomEntries()).toEqual(['Show tool calls', 'Notes']);
  });

  it("folds a phone's actions into the room menu, in the row's order", () => {
    screen.size = 'Mobile';
    renderEverything();
    expect(rowLabels()).toEqual(['Back', 'Join the call', 'More Options']);
    openMenu();
    expect(roomEntries()).toEqual([
      'Compact view',
      'Thread filters',
      'Show tool calls',
      'Show Canvas',
      'Show Computer',
      'Pinned Messages',
      'Show Members',
      'Notes',
      'Call Helper',
    ]);
  });

  it("places the plugins' actions by their placement and runs them in the open room", () => {
    const run = vi.fn();
    const pluginActions = (['auto', 'menu'] as const).map((placement) => ({
      id: `demo/${placement}`,
      label: `Demo ${placement}`,
      icon: Icons.Smile,
      placement,
      run,
    }));
    const runFromRow = () =>
      act(() => {
        buttons((node) => node.props['aria-label'] === 'Demo auto')[0]?.props.onClick();
      });
    renderHeader({ pluginActions, threadId: '$thread' });
    expect(rowLabels().slice(-2)).toEqual(['Demo auto', 'More Options']);
    runFromRow();
    expect(run).toHaveBeenLastCalledWith({ roomId: '!room:example.org', threadId: '$thread' });
    openMenu();
    expect(roomEntries()).toEqual(['Show tool calls', 'Demo menu']);
    // Beside the room's messages, the header is the room's, and its actions run in the thread.
    renderHeader({ pluginActions, openThreadId: '$beside' });
    runFromRow();
    expect(run).toHaveBeenLastCalledWith({ roomId: '!room:example.org', threadId: '$beside' });
    // A thread whose root the server has not confirmed yet is left out.
    renderHeader({ pluginActions, threadId: '~local' });
    runFromRow();
    expect(run).toHaveBeenLastCalledWith({ roomId: '!room:example.org', threadId: undefined });

    screen.size = 'Mobile';
    renderHeader({ pluginActions });
    expect(rowLabels()).toEqual(['Back', 'More Options']);
    openMenu();
    expect(roomEntries().slice(-3)).toEqual(['Show Members', 'Demo auto', 'Demo menu']);
    run.mockClear();
    act(() => {
      buttons((node) => textOf(node) === 'Demo auto')[0]?.props.onClick();
    });
    expect(run).toHaveBeenCalledWith({ roomId: '!room:example.org', threadId: undefined });
    // Choosing the entry closed the menu.
    expect(roomEntries()).toEqual([]);
  });

  it('announces what the buttons open, the members shortcut, and a check on a shown panel', () => {
    renderEverything();
    const button = (label: string) =>
      buttons((node) => node.props['aria-label'] === label)[0]?.props ?? {};
    expect(button('Pinned Messages')['aria-haspopup']).toBe('dialog');
    expect(button('Show Members')['aria-keyshortcuts']).toBeTruthy();
    expect(button('More Options')).toMatchObject({
      'aria-haspopup': 'menu',
      'aria-expanded': false,
    });
    openMenu();
    expect(button('More Options')['aria-expanded']).toBe(true);
    const checks = () =>
      renderer?.root
        .findAll(
          (node) =>
            node.props.role === 'menuitemcheckbox' && 'label' in node.props && 'after' in node.props
        )
        .map((node) => !!node.props.after);
    // This header's room shows its tool calls (renderHeader's toolCallsShown).
    expect(checks()).toEqual([true, false]);

    renderHeader({
      pluginPanels: [{ id: 'notes/panel', label: 'Notes' }],
      shownPanel: 'notes/panel',
    });
    openMenu();
    expect(checks()).toEqual([true, true]);
  });

  it('opens the pinned messages from the row and from the room menu', () => {
    pins.ids = ['$pinned'];
    renderHeader();
    const [pinsButton] = buttons((node) => node.props['aria-label'] === 'Pinned Messages');
    expect(pinsButton?.props['aria-expanded']).toBe(false);
    act(() => {
      pinsButton?.props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } });
    });
    expect(byData('data-pin-list')).toHaveLength(1);
    expect(
      buttons((node) => node.props['aria-label'] === 'Pinned Messages')[0]?.props['aria-expanded']
    ).toBe(true);

    screen.size = 'Mobile';
    renderHeader();
    expect(byData('data-pin-list')).toHaveLength(0);
    openMenu();
    const [entry] = buttons((node) => textOf(node) === 'Pinned Messages');
    expect(entry?.props['aria-haspopup']).toBe('dialog');
    act(() => {
      entry?.props.onClick();
    });
    expect(byData('data-pin-list')).toHaveLength(1);
    // Choosing the entry closed the menu.
    expect(buttons((node) => textOf(node) === 'Pinned Messages')).toHaveLength(0);
  });
});
