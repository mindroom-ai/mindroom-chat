// @vitest-environment jsdom
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { createStore, Provider } from 'jotai';
import { createRoot } from 'react-dom/client';
import { act as actInDom } from 'react-dom/test-utils';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Badge, Icon, IconButton, Icons, Text } from 'folds';
import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { MINDROOM_SCHEDULED_TASK_EVENT } from '../matrix/protocol/scheduledTaskContract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubagentMeta, SubagentStatus } from '../matrix/protocol/subagentFrame';
import { getSubagentRunStore } from '../messages/live/subagentRunStore';
import { SubagentsIcon } from '../subagents/SubagentsIcon';
import { MenuEntry } from '../ui/MenuEntry';
import { installOverlayFocus, observeLayerHost } from '../lib/overlayFocus';
import { PhoneMembersSheet } from '../members/PhoneMembersSheet';
import { RoomViewHeader, type RoomViewHeaderProps } from './RoomViewHeader';

// The Sub-agents panel's toggle in the room header: there while the room's store holds a run of
// a sub-agent started in the conversation on screen (the open thread, else the room's timeline,
// which in Classic holds every thread's replies), with a badge that counts those runs still at it
// (running, waiting for approval or paused). On phones it is an entry of the room menu, and a
// count puts a dot on the menu's button.

const ROOM_ID = '!room:example.org';
const SENDER = '@mindroom_lead:example.org';
/** The thread the header has open unless a test says otherwise, where `run` starts its runs. */
const THREAD = '$thread:example.org';

const { screen, view, mx, schedules, pins } = vi.hoisted(() => ({
  screen: { size: 'Desktop' },
  view: { mode: 'compact' },
  schedules: { events: [] as MatrixEvent[] },
  pins: { ids: [] as string[] },
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
    myUserId: '@me:example.org',
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
vi.mock('../matrix/hooks/useStateEvents', () => ({ useStateEvents: () => schedules.events }));
vi.mock('../messages/useMentionClickHandler', () => ({ useMentionClickHandler: () => vi.fn() }));
vi.mock('../matrix/hooks/usePowerLevels', () => ({
  usePowerLevels: () => ({}),
  usePowerLevelsContext: () => ({}),
}));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ action: () => false, event: () => false, stateEvent: () => false }),
}));
vi.mock('../event-store/cache/useRoomEvent', () => ({ useRoomEvent: () => undefined }));
vi.mock('../event-store/threads/useThreadPinning', () => ({
  usePinnedEventIds: () => pins.ids,
  useThreadPinning: () => ({
    pinnedEventIds: pins.ids,
    canPin: true,
    updating: false,
    setPinned: (eventId: string, pinned: boolean) => {
      if (!pinned) pins.ids = pins.ids.filter((id) => id !== eventId);
      return Promise.resolve(true);
    },
  }),
}));
vi.mock('../navigation/useRoomRouteParams', () => ({ useRoomRouteParams: () => ({}) }));
vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: vi.fn() }),
}));
vi.mock('../lib/hooks/useScreenSize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hooks/useScreenSize')>()),
  useScreenSizeContext: () => screen.size,
}));
vi.mock('../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({
    viewMode: view.mode,
    setViewMode: () => undefined,
    availableViewModes: [view.mode],
  }),
}));

const store = () => getSubagentRunStore(mx as unknown as MatrixClient);

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  store().clear();
  screen.size = 'Desktop';
  view.mode = 'compact';
  schedules.events = [];
  pins.ids = [];
  vi.unstubAllGlobals();
});

const renderHeader = (
  props: RoomViewHeaderProps,
  createNodeMock?: (element: React.ReactElement) => Element | null
) => {
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(
      <Provider store={createStore()}>
        <RoomViewHeader openThreadId={THREAD} {...props} />
      </Provider>,
      createNodeMock ? { createNodeMock } : undefined
    );
  });
};

// Computed CSS sizes at 100% page zoom: a 40 px button, 4 px gap and 24 px of header padding.
const phoneLayout = (viewportWidth = 390, initialCalls = 1, rowPlugins = 0) => {
  const header = document.createElement('header');
  header.style.paddingInlineStart = '16px';
  header.style.paddingInlineEnd = '8px';
  Object.defineProperty(header, 'clientWidth', { value: viewportWidth });
  const tail = document.createElement('div');
  tail.style.columnGap = '4px';
  const more = document.createElement('button');
  more.dataset.roomMoreOptions = '';
  tail.append(more);
  const calls = document.createElement('div');
  let count = initialCalls;
  const box = (width: number) => new DOMRect(0, 0, width, 40);
  vi.spyOn(more, 'getBoundingClientRect').mockImplementation(() => box(40));
  vi.spyOn(tail, 'getBoundingClientRect').mockImplementation(() => box(40 + 44 * rowPlugins));
  vi.spyOn(calls, 'getBoundingClientRect').mockImplementation(() =>
    box(Math.max(0, 44 * count - 4))
  );
  let resized: ResizeObserverCallback | undefined;
  const observe = vi.fn<(element: Element) => void>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe = observe;
      disconnect() {}
    }
  );
  return {
    createNodeMock: (element: React.ReactElement) => {
      if (element.type === 'header') return header;
      const props = element.props as Record<string, unknown>;
      if ('data-room-header-mandatory-tail' in props) return tail;
      if ('data-room-header-call-group' in props) return calls;
      return null;
    },
    setCalls: (next: number) => {
      count = next;
      expect(observe).toHaveBeenCalledWith(calls);
      act(() => resized?.([], {} as ResizeObserver));
    },
  };
};

// jsdom does not lay out controls, including the buttons checked by the real focus trap.
const renderDomHeader = (props: RoomViewHeaderProps, viewport = 390, extra?: () => ReactNode) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const headerObservers = new Set<() => void>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly resize: () => void) {}
      observe(element: Element) {
        if (element.tagName === 'HEADER') headerObservers.add(this.resize);
      }
      disconnect() {
        headerObservers.delete(this.resize);
      }
    }
  );
  const box = new DOMRect(0, 0, 40, 40);
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(viewport);
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(box);
  const rects = vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([box] as unknown as DOMRectList);
  const host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  const root = createRoot(host);
  const rerender = () =>
    actInDom(() =>
      root.render(
        <Provider>
          <RoomViewHeader openThreadId={THREAD} {...props} />
          {extra?.()}
        </Provider>
      )
    );
  rerender();
  return {
    host,
    rerender,
    resize: (next: number) => {
      width.mockReturnValue(next);
      actInDom(() => headerObservers.forEach((resize) => resize()));
    },
    unmount: () => {
      actInDom(() => root.unmount());
      host.remove();
      rects.mockRestore();
      bounds.mockRestore();
      width.mockRestore();
    },
  };
};

const pressEscape = (from: HTMLElement) =>
  actInDom(() => {
    from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

const schedule = (taskId: string, threadId: string | null, newThread = false, status = 'pending') =>
  new MatrixEvent({
    type: MINDROOM_SCHEDULED_TASK_EVENT,
    state_key: taskId,
    sender: SENDER,
    content: {
      status,
      workflow: JSON.stringify({ thread_id: threadId, new_thread: newThread }),
    },
  });

const canvases = ['Orchard map', 'Garden map'].map((title, index) => ({
  canvasId: `$drawing-${index}:example.org`,
  roomId: ROOM_ID,
  threadId: THREAD,
  agentUserId: SENDER,
  title,
  createdTs: 1,
  revisionId: `$drawing-${index}:example.org`,
  updatedTs: 1,
  shared: false,
}));

const rowLabels = () =>
  renderer?.root.findAllByType('button').map((node) => node.props['aria-label']);

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
  const snapshot = {
    md: 'Looking.',
    reasoning: '',
    tools: [],
    status: 'streaming',
    activity: '',
    segments: [],
  };
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
    // The same header, moved to another thread and back.
    act(() =>
      renderer?.update(
        <Provider store={createStore()}>
          <RoomViewHeader onPanelToggle={vi.fn()} openThreadId={THREAD} />
        </Provider>
      )
    );
    expect(toggles()).toHaveLength(1);
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

  it("counts every thread's runs on the room's Classic timeline, which shows their replies", () => {
    view.mode = 'classic';
    run('running');
    run('running', '$other:example.org');
    renderHeader({ onPanelToggle: vi.fn(), openThreadId: undefined });
    expect(toggle()?.props['aria-label']).toBe('Show sub-agents, 2 active');
    renderHeader({ onPanelToggle: vi.fn() });
    expect(toggle()?.props['aria-label']).toBe('Show sub-agents, 1 active');
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

  it('promotes the three highest-priority eligible buttons in existing row order', () => {
    screen.size = 'Mobile';
    run('running');
    run('running', '$elsewhere:example.org');
    schedules.events = [schedule('orchard', THREAD), schedule('seeds', THREAD, true)];
    pins.ids = ['$pinned:example.org'];
    const { createNodeMock } = phoneLayout(430, 1);
    renderHeader(
      {
        hasMindroomAgents: true,
        calls: <IconButton aria-label="Call" />,
        computerAvailable: true,
        computerShown: true,
        onComputerToggle: vi.fn(),
        pluginPanels: [{ id: 'toolkit', label: 'Toolkit', placement: 'auto', icon: Icons.Bulb }],
      },
      createNodeMock
    );
    expect(rowLabels()).toEqual([
      'Scheduled tasks (1)',
      'Show sub-agents, 1 active',
      'Call',
      'Show Members',
      'More Options',
    ]);
    expect(menuDots()).toHaveLength(0);
    openMenu();
    expect(menuEntries()).toHaveLength(0);
    expect(renderer?.root.findAllByType(MenuEntry).map((entry) => entry.props.label)).toEqual(
      expect.arrayContaining(['Pinned Messages', 'Show Computer', 'Toolkit'])
    );
  });

  it('keeps schedules in a thread’s phone menu at the room-wide count when all tasks are elsewhere', () => {
    screen.size = 'Mobile';
    schedules.events = [schedule('orchard', null), schedule('seeds', THREAD, true)];
    const { createNodeMock } = phoneLayout(390, 0);
    renderHeader({ hasMindroomAgents: true }, createNodeMock);
    expect(rowLabels()).toEqual(['Show Members', 'More Options']);
    openMenu();
    expect(renderer?.root.findAllByType(MenuEntry).map((entry) => entry.props.label)).toContain(
      'Scheduled tasks (2)'
    );
  });

  it.each([
    { size: 'Mobile', scope: 'room timeline', keepsEmptyClock: false },
    { size: 'Desktop', scope: 'open thread', keepsEmptyClock: true },
    { size: 'Tablet', scope: 'open thread', keepsEmptyClock: true },
  ])(
    '$size counts all room tasks on the $scope (empty clock visible: $keepsEmptyClock)',
    ({ size, keepsEmptyClock }) => {
      screen.size = size;
      schedules.events = [schedule('orchard', null), schedule('seeds', THREAD, true)];
      const props = {
        hasMindroomAgents: true,
        openThreadId: size === 'Mobile' ? undefined : THREAD,
      };
      const { createNodeMock } = phoneLayout(390, 0);
      renderHeader(props, createNodeMock);
      expect(rowLabels()).toContain('Scheduled tasks (2)');
      schedules.events = [];
      renderHeader(props, createNodeMock);
      expect(rowLabels()?.includes('Scheduled tasks (0)')).toBe(keepsEmptyClock);
    }
  );

  it('groups the room schedules when opened from a desktop thread', () => {
    schedules.events = [schedule('orchard', THREAD), schedule('seeds', null)];
    const { host, unmount } = renderDomHeader({ hasMindroomAgents: true, threadId: THREAD });
    try {
      const clock = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Scheduled tasks (2)"]'
      )!;
      actInDom(() => clock.click());
      const headings = document.querySelectorAll('[role="dialog"] h3');
      expect(Array.from(headings, (heading) => heading.textContent)).toEqual([
        'This thread',
        'Elsewhere in this room',
      ]);
    } finally {
      unmount();
    }
  });

  it('keeps the same call child mounted across the phone breakpoint both ways', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    function CallControl() {
      useEffect(() => {
        mount();
        return () => {
          unmount();
        };
      }, []);
      return <IconButton aria-label="Call" />;
    }
    const { createNodeMock } = phoneLayout();
    const draw = () => (
      <Provider>
        <RoomViewHeader calls={<CallControl />} />
      </Provider>
    );
    act(() => {
      renderer = create(draw(), { createNodeMock });
    });
    for (const size of ['Mobile', 'Desktop']) {
      screen.size = size;
      act(() => renderer?.update(draw()));
      expect(rowLabels()).toContain('Call');
    }
    expect(mount).toHaveBeenCalledOnce();
    expect(unmount).not.toHaveBeenCalled();
  });

  it('remeasures the room for optional buttons after two call controls finish loading', async () => {
    screen.size = 'Mobile';
    run('running');
    schedules.events = [schedule('orchard', THREAD)];
    const layout = phoneLayout(430, 0, 1);
    const calls = Promise.withResolvers<{ default: () => React.ReactElement }>();
    const CallButtons = lazy(() => calls.promise);
    renderHeader(
      {
        hasMindroomAgents: true,
        calls: (
          <Suspense fallback={null}>
            <CallButtons />
          </Suspense>
        ),
        pluginPanels: [{ id: 'toolkit', label: 'Toolkit', placement: 'row', icon: Icons.Bulb }],
      },
      layout.createNodeMock
    );
    expect(rowLabels()).toEqual([
      'Scheduled tasks (1)',
      'Show sub-agents, 1 active',
      'Show Members',
      'Toolkit',
      'More Options',
    ]);
    await act(async () => {
      calls.resolve({
        default: () => (
          <>
            <IconButton aria-label="Room call" />
            <IconButton aria-label="Agent call" />
          </>
        ),
      });
    });
    layout.setCalls(2);
    expect(rowLabels()).toEqual([
      'Scheduled tasks (1)',
      'Show sub-agents, 1 active',
      'Room call',
      'Agent call',
      'Toolkit',
      'More Options',
    ]);
  });

  it('promotes only the canvas supplied for the open conversation', () => {
    screen.size = 'Mobile';
    const { createNodeMock } = phoneLayout();
    const canvas = {
      canvasId: '$drawing:example.org',
      roomId: ROOM_ID,
      threadId: THREAD,
      agentUserId: SENDER,
      title: 'Orchard map',
      createdTs: 1,
      revisionId: '$drawing:example.org',
      updatedTs: 1,
      shared: false,
    };
    const props = { onCanvasOpen: vi.fn(), onCanvasClose: vi.fn() };
    renderHeader({ ...props, canvases: [canvas] }, createNodeMock);
    expect(rowLabels()).toEqual(['Show Canvas', 'Show Members', 'More Options']);
    renderHeader(
      { ...props, openThreadId: '$elsewhere:example.org', canvases: [] },
      createNodeMock
    );
    expect(rowLabels()).toEqual(['Show Members', 'More Options']);
  });

  it('keeps the canvas chooser open when an active sub-agent takes its slot', () => {
    screen.size = 'Mobile';
    const { createNodeMock } = phoneLayout(390, 2);
    const onCanvasOpen = vi.fn();
    renderHeader({ canvases, onCanvasOpen, onCanvasClose: vi.fn() }, createNodeMock);
    const chooserTrigger = renderer!.root.findByProps({ 'aria-label': 'Canvases' });
    act(() => {
      chooserTrigger.props.onClick({ currentTarget: document.createElement('button') });
    });
    const garden = () =>
      renderer!.root
        .findAllByType('button')
        .find((node) =>
          node.findAllByType(Text).some((text) => text.props.children === 'Garden map')
        );
    expect(garden()).toBeDefined();
    run('running');
    expect(rowLabels()).not.toContain('Canvases');
    expect(garden()).toBeDefined();
    act(() => {
      garden()?.props.onClick();
    });
    expect(onCanvasOpen).toHaveBeenCalledWith('$drawing-1:example.org');
  });

  it.each([
    { demote: false, dismiss: 'Escape' },
    { demote: true, dismiss: 'Escape' },
    { demote: true, dismiss: 'Close' },
  ])('restores clock focus on $dismiss (clock demoted: $demote)', async ({ demote, dismiss }) => {
    screen.size = 'Mobile';
    schedules.events = [schedule('orchard', THREAD), schedule('seeds', null)];
    const { host, rerender, unmount } = renderDomHeader({ hasMindroomAgents: true });
    try {
      const clock = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Scheduled tasks (1)"]'
      )!;
      clock.focus();
      actInDom(() => clock.click());
      const close = document.querySelector<HTMLButtonElement>(
        '[role="dialog"] button[aria-label="Close"]'
      )!;
      expect(close).toBeInstanceOf(HTMLButtonElement);
      close.focus();
      if (demote) {
        schedules.events = [
          schedule('orchard', THREAD, false, 'cancelled'),
          schedule('seeds', null),
        ];
        rerender();
        expect(clock.isConnected).toBe(false);
        expect(close.isConnected).toBe(true);
      }
      if (dismiss === 'Escape') pressEscape(close);
      else actInDom(() => close.click());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      const target = demote ? host.querySelector('[data-room-more-options]') : clock;
      await vi.waitFor(() => expect(document.activeElement).toBe(target));
    } finally {
      unmount();
    }
  });

  it.each([
    { demote: false, dismiss: 'Escape' },
    { demote: true, dismiss: 'Escape' },
    { demote: true, dismiss: 'choosing a canvas' },
  ])(
    'restores chooser focus on $dismiss (canvas demoted: $demote)',
    async ({ demote, dismiss }) => {
      screen.size = 'Mobile';
      const { host, unmount } = renderDomHeader(
        { canvases, onCanvasOpen: vi.fn(), onCanvasClose: vi.fn() },
        280
      );
      try {
        const opener = host.querySelector<HTMLButtonElement>('button[aria-label="Canvases"]')!;
        opener.focus();
        actInDom(() => opener.click());
        const item = Array.from(host.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('Garden map')
        )!;
        item.focus();
        if (demote) actInDom(() => run('running'));
        expect(opener.isConnected).toBe(!demote);
        expect(item.isConnected).toBe(true);
        if (dismiss === 'Escape') pressEscape(item);
        else actInDom(() => item.click());
        expect(item.isConnected).toBe(false);
        const target = demote ? host.querySelector('[data-room-more-options]') : opener;
        await vi.waitFor(() => expect(document.activeElement).toBe(target));
      } finally {
        unmount();
      }
    }
  );

  it.each(['Escape', 'Close'])(
    'returns focus to More Options on %s after unpinning the last message',
    async (dismiss) => {
      screen.size = 'Mobile';
      pins.ids = ['$pinned:example.org'];
      const { host, rerender, unmount } = renderDomHeader({});
      try {
        const opener = host.querySelector<HTMLButtonElement>(
          'button[aria-label="Pinned Messages"]'
        )!;
        opener.focus();
        actInDom(() => opener.click());
        const unpin = host.querySelector<HTMLButtonElement>(
          '[role="dialog"] button[aria-label="Unpin Message"]'
        )!;
        unpin.focus();
        await actInDom(async () => {
          unpin.click();
        });
        rerender();
        expect(opener.isConnected).toBe(false);
        const close = host.querySelector<HTMLButtonElement>(
          '[role="dialog"] button[aria-label="Close"]'
        )!;
        expect(document.activeElement).toBe(close);
        if (dismiss === 'Escape') pressEscape(close);
        else actInDom(() => close.click());
        expect(close.isConnected).toBe(false);
        await vi.waitFor(() =>
          expect(document.activeElement).toBe(host.querySelector('[data-room-more-options]'))
        );
      } finally {
        unmount();
      }
    }
  );

  it.each(['Escape', 'scrim click'])(
    'only restores sheet focus on explicit dismissal (%s) after the Members opener is lost',
    async (dismiss) => {
      screen.size = 'Mobile';
      let opened = false;
      const slot = document.createElement('div');
      document.body.append(slot);
      const stopFocus = installOverlayFocus();
      observeLayerHost(slot);
      const header = renderDomHeader(
        {
          onPanelToggle: () => {
            opened = true;
            header.rerender();
          },
        },
        250,
        () =>
          opened && (
            <PhoneMembersSheet
              slot={slot}
              onClose={() => {
                opened = false;
                header.rerender();
              }}
            >
              <button type="button">View member</button>
            </PhoneMembersSheet>
          )
      );
      try {
        const opener = header.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Show Members"]'
        )!;
        opener.focus();
        actInDom(() => {
          opener.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          opener.click();
        });
        const member = slot.querySelector<HTMLButtonElement>('button')!;
        await vi.waitFor(() => expect(document.activeElement).toBe(member));
        actInDom(() => run('running'));
        expect(opener.isConnected).toBe(false);
        const outside = document.createElement('button');
        header.host.append(outside);
        if (dismiss === 'Escape') pressEscape(member);
        else {
          outside.focus();
          const scrim = slot.querySelector<HTMLElement>('[aria-hidden="true"]')!;
          actInDom(() => scrim.click());
        }
        expect(member.isConnected).toBe(false);
        const target =
          dismiss === 'Escape' ? header.host.querySelector('[data-room-more-options]') : outside;
        await vi.waitFor(() => expect(document.activeElement).toBe(target));
      } finally {
        stopFocus();
        header.unmount();
        slot.remove();
      }
    }
  );

  it('keeps More Options and plugin row buttons mounted while the room menu crosses the breakpoint', async () => {
    const { host, rerender, unmount } = renderDomHeader({
      pluginPanels: [
        { id: 'notes', label: 'Notes', placement: 'auto', icon: Icons.Bulb },
        { id: 'toolkit', label: 'Toolkit', placement: 'row', icon: Icons.Bulb },
      ],
    });
    const more = host.querySelector<HTMLButtonElement>('[data-room-more-options]')!;
    const plugin = host.querySelector<HTMLButtonElement>('button[aria-label="Toolkit"]')!;
    try {
      more.focus();
      actInDom(() => more.click());
      expect(more.getAttribute('aria-expanded')).toBe('true');
      screen.size = 'Mobile';
      rerender();
      expect(host.querySelector('[data-room-more-options]')).toBe(more);
      expect(host.querySelector('button[aria-label="Toolkit"]')).toBe(plugin);
      const leave = Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'Leave Room'
      )!;
      leave.focus();
      pressEscape(leave);
      expect(more.getAttribute('aria-expanded')).toBe('false');
      await vi.waitFor(() => expect(document.activeElement).toBe(more));
    } finally {
      unmount();
    }
  });

  it.each(['Desktop', 'Mobile'])(
    'closes the %s canvas chooser on rotation without reopening it',
    async (start) => {
      screen.size = start;
      const { host, rerender, unmount } = renderDomHeader({
        canvases,
        onCanvasOpen: vi.fn(),
        onCanvasClose: vi.fn(),
      });
      const menuItem = () =>
        Array.from(host.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('Garden map')
        );
      try {
        const opener = host.querySelector<HTMLButtonElement>('button[aria-label="Canvases"]')!;
        actInDom(() => opener.click());
        const item = menuItem();
        expect(item).toBeDefined();
        item!.focus();
        screen.size = start === 'Mobile' ? 'Desktop' : 'Mobile';
        rerender();
        expect(menuItem()).toBeUndefined();
        const target = opener.isConnected ? opener : host.querySelector('[data-room-more-options]');
        await vi.waitFor(() => expect(document.activeElement).toBe(target));
        screen.size = start;
        rerender();
        expect(menuItem()).toBeUndefined();
        expect(
          host.querySelector('button[aria-label="Canvases"]')?.getAttribute('aria-expanded')
        ).toBe('false');
      } finally {
        unmount();
      }
    }
  );

  it('focuses More Options when a focused Members button loses its slot', async () => {
    screen.size = 'Mobile';
    const { host, unmount } = renderDomHeader({}, 250);
    try {
      const members = host.querySelector<HTMLButtonElement>('button[aria-label="Show Members"]')!;
      members.focus();
      expect(document.activeElement).toBe(members);
      actInDom(() => run('running'));
      expect(members.isConnected).toBe(false);
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(host.querySelector('[data-room-more-options]'))
      );
    } finally {
      unmount();
    }
  });

  it('closes the canvas chooser when the measured width changes within Mobile', async () => {
    screen.size = 'Mobile';
    const { host, resize, unmount } = renderDomHeader(
      {
        canvases,
        onCanvasOpen: vi.fn(),
        onCanvasClose: vi.fn(),
      },
      375
    );
    const menuItem = () =>
      Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Garden map')
      );
    try {
      const opener = host.querySelector<HTMLButtonElement>('button[aria-label="Canvases"]')!;
      actInDom(() => opener.click());
      expect(menuItem()).toBeDefined();
      resize(375);
      const item = menuItem();
      expect(item).toBeDefined();
      item!.focus();
      resize(667);
      expect(menuItem()).toBeUndefined();
      await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    } finally {
      unmount();
    }
  });

  it('does not reopen the chooser when two canvases become one and then two again', () => {
    const props = { canvases, onCanvasOpen: vi.fn(), onCanvasClose: vi.fn() };
    const { host, rerender, unmount } = renderDomHeader(props);
    const chooser = () => host.querySelector<HTMLButtonElement>('button[aria-label="Canvases"]');
    const item = () =>
      Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Garden map')
      );
    try {
      actInDom(() => chooser()!.click());
      expect(item()).toBeDefined();
      props.canvases = canvases.slice(0, 1);
      rerender();
      expect(item()).toBeUndefined();
      expect(host.querySelector('button[aria-label="Show Canvas"]')).not.toBeNull();
      props.canvases = canvases;
      rerender();
      expect(item()).toBeUndefined();
      expect(chooser()?.getAttribute('aria-expanded')).toBe('false');
    } finally {
      unmount();
    }
  });

  it("leaves a phone's menu button without a dot while only ended runs are kept", () => {
    screen.size = 'Mobile';
    run('cancelled');
    const { createNodeMock } = phoneLayout();
    renderHeader({ onPanelToggle: vi.fn() }, createNodeMock);
    expect(toggles()).toHaveLength(0);
    expect(menuDots()).toHaveLength(0);
    openMenu();
    expect(menuEntries()).toHaveLength(1);
  });
});
