import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { HomeAgentsSection, HomeDirectSection } from './HomeDirectAndAgentSections';
import { selectRenderedDirectRooms, type HomeSidebarAgent } from './homeDirectSections';
import { useHomeAddRoomsMenu } from './HomeSectionChrome';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  startDirectChat: vi.fn(),
  activeRunsByRoom: new Map<string, Array<{ agentId: string }>>(),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('../../ui/directional', async () => {
  const reactModule = await import('react');
  return {
    ownDirectionLine: {},
    PopOut: ({ anchor, content }: { anchor?: unknown; content?: React.ReactNode }) =>
      anchor ? reactModule.createElement('div', { 'data-popout': 'true' }, content) : null,
  };
});

vi.mock('../../ui/glass/GlassPrimitives', async () => {
  const reactModule = await import('react');
  return {
    Menu: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', { role: 'menu' }, children),
    MenuItem: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', { role: 'menuitem', onClick, ...props }, children),
  };
});

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const box = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    reactModule.createElement('div', props, children);
  return {
    Avatar: box,
    Box: box,
    Icon: (props: Record<string, unknown>) => reactModule.createElement('i', props),
    IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    Icons: {
      Category: 'Category',
      ChevronBottom: 'ChevronBottom',
      ChevronRight: 'ChevronRight',
      ChevronTop: 'ChevronTop',
      Link: 'Link',
      Message: 'Message',
      Plus: 'Plus',
    },
    Spinner: () => reactModule.createElement('span', { 'data-spinner': 'true' }),
    Text: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      reactModule.createElement('span', props, children),
    color: {
      Critical: { Main: '#f00' },
      Primary: { Main: '#00f' },
      Success: { Main: '#0f0' },
      Background: { Container: '#fff' },
      SurfaceVariant: { Container: '#eee', OnContainer: '#111' },
    },
    config: {
      opacity: { P300: 0.3, P500: 0.5 },
      fontWeight: { W400: 400 },
      radii: { Pill: '999px' },
      space: { S100: '4px', S200: '8px' },
    },
    toRem: (v: number) => `${v}rem`,
  };
});

vi.mock('../../ui/nav/NavItem', async () => {
  const reactModule = await import('react');
  const box = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    reactModule.createElement('div', props, children);
  return {
    NavButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    NavCategory: box,
    NavItem: box,
    NavItemContent: box,
    NavLink: ({ children, to, ...props }: { children?: React.ReactNode; to?: string }) =>
      reactModule.createElement('a', { href: to, ...props }, children),
  };
});

vi.mock('../../ui/nav/NavCategoryHeader', async () => {
  const reactModule = await import('react');
  return {
    NavCategoryHeader: ({ children, ...props }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', props, children),
  };
});

vi.mock('../room-nav/RoomNavCategoryButton', async () => {
  const reactModule = await import('react');
  return {
    RoomNavCategoryButton: ({
      children,
      before,
      after,
      closed,
      ...props
    }: {
      children?: React.ReactNode;
      before?: React.ReactNode;
      after?: React.ReactNode;
      closed?: boolean;
      [key: string]: unknown;
    }) =>
      reactModule.createElement(
        'button',
        { 'aria-expanded': !closed, ...props },
        before,
        children,
        after
      ),
  };
});

vi.mock('../room-nav/RoomNavItem', async () => {
  const reactModule = await import('react');
  return {
    RoomNavItem: ({
      room,
      linkPath,
      nameOverride,
      avatarBadge,
    }: {
      room: { roomId: string };
      linkPath: string;
      nameOverride?: string;
      avatarBadge?: React.ReactNode | ((descriptionId: string) => React.ReactNode);
    }) => {
      const descId = `badge-desc-${room.roomId}`;
      const badge = typeof avatarBadge === 'function' ? avatarBadge(descId) : avatarBadge;
      return reactModule.createElement(
        'div',
        { 'data-room-row': room.roomId, 'data-link': linkPath, 'data-name': nameOverride },
        badge
      );
    },
  };
});

vi.mock('../../avatars/UserAvatar', async () => {
  const reactModule = await import('react');
  return {
    UserAvatar: ({ alt }: { alt?: string }) => reactModule.createElement('span', null, alt),
  };
});

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@maya:example.org' }),
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../matrix/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ 'm.room_versions': { default: '11' } }),
}));

vi.mock('../../matrix/hooks/useRoomActiveRuns', () => ({
  useRoomActiveRuns: (room: Room | null) => ({
    runs: room ? (state.activeRunsByRoom.get(room.roomId) ?? []) : [],
    threads: new Set<string>(),
  }),
}));

vi.mock('./homeAgents', () => ({
  startDirectChat: (...args: unknown[]) => state.startDirectChat(...args),
  agentNameIn: (_room: unknown, userId: string) => userId,
}));

const makeRoom = (roomId: string): Room => ({ roomId }) as unknown as Room;

const makeUnreadStore = (entries: Array<[string, { total: number; highlight: number }]> = []) => {
  const store = createStore();
  store.set(roomToUnreadAtom, {
    type: 'RESET',
    unreadInfos: entries.map(([roomId, info]) => ({ roomId, ...info })),
  });
  return store;
};

describe('HomeDirectSection', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    state.navigate.mockReset();
    state.startDirectChat.mockReset();
    state.activeRunsByRoom.clear();
  });

  it('caps at 5 + selected when > 6 DMs, toggles Show all / Show less, and wires header + button', () => {
    const rooms = Array.from({ length: 8 }, (_, index) => makeRoom(`!dm-${index + 1}:example.org`));
    const allRoomIds = rooms.map((r) => r.roomId);
    const store = makeUnreadStore();

    function Wrapper() {
      const [showAll, setShowAll] = useState(false);
      const visibleRooms = selectRenderedDirectRooms(rooms, '!dm-8:example.org', false, showAll);
      return (
        <Provider store={store}>
          <HomeDirectSection
            visibleRooms={visibleRooms}
            allRoomIds={allRoomIds}
            closed={false}
            selectedRoomId="!dm-8:example.org"
            showAll={showAll}
            onToggleShowAll={() => setShowAll((prev) => !prev)}
            onCategoryClick={vi.fn()}
            homeRoomPath={(id) => `/home/${id}`}
            notificationPreferences={new Map()}
          />
        </Provider>
      );
    }

    act(() => {
      renderer = create(<Wrapper />);
    });

    const rowIds = () =>
      renderer!.root
        .findAll((n) => typeof n.type === 'string' && 'data-room-row' in n.props)
        .map((n) => n.props['data-room-row']);

    expect(rowIds()).toEqual([
      '!dm-1:example.org',
      '!dm-2:example.org',
      '!dm-3:example.org',
      '!dm-4:example.org',
      '!dm-5:example.org',
      '!dm-8:example.org',
    ]);

    const toggle = () =>
      renderer!.root.find(
        (n) => n.type === 'button' && n.props['data-home-dm-action'] === 'toggle-all'
      );
    expect(toggle().findByType('span').children).toEqual(['Show all (8)']);

    act(() => {
      toggle().props.onClick();
    });
    expect(rowIds()).toHaveLength(8);
    expect(toggle().findByType('span').children).toEqual(['Show less']);

    act(() => {
      toggle().props.onClick();
    });
    expect(rowIds()).toHaveLength(6);

    const headerPlus = renderer!.root.find(
      (n) => n.type === 'button' && n.props['aria-label'] === 'New direct message'
    );
    act(() => {
      headerPlus.props.onClick();
    });
    expect(state.navigate).toHaveBeenCalledWith('/direct/create/');
  });

  it('shows a quiet unread or highlight dot only while collapsed with hidden unread DMs', () => {
    const rooms = [makeRoom('!dm-1:example.org'), makeRoom('!dm-2:example.org')];
    const allRoomIds = rooms.map((r) => r.roomId);
    const store = makeUnreadStore([['!dm-2:example.org', { total: 2, highlight: 1 }]]);

    act(() => {
      renderer = create(
        <Provider store={store}>
          <HomeDirectSection
            visibleRooms={[rooms[0]!]}
            allRoomIds={allRoomIds}
            closed
            selectedRoomId="!dm-1:example.org"
            showAll={false}
            onToggleShowAll={vi.fn()}
            onCategoryClick={vi.fn()}
            homeRoomPath={(id) => `/home/${id}`}
            notificationPreferences={new Map()}
          />
        </Provider>
      );
    });

    const unreadMarkers = renderer!.root.findAll(
      (n) => typeof n.type === 'string' && 'data-unread' in n.props
    );
    expect(unreadMarkers).toHaveLength(1);
    expect(unreadMarkers[0]!.props['data-highlight']).toBe('true');

    // Selecting the only unread DM shows it as the lone visible row and clears the collapsed dot.
    act(() => {
      renderer!.update(
        <Provider store={store}>
          <HomeDirectSection
            visibleRooms={[rooms[1]!]}
            allRoomIds={allRoomIds}
            closed
            selectedRoomId="!dm-2:example.org"
            showAll={false}
            onToggleShowAll={vi.fn()}
            onCategoryClick={vi.fn()}
            homeRoomPath={(id) => `/home/${id}`}
            notificationPreferences={new Map()}
          />
        </Provider>
      );
    });
    expect(
      renderer!.root.findAll((n) => typeof n.type === 'string' && 'data-unread' in n.props)
    ).toHaveLength(0);
  });
});

describe('HomeAgentsSection', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    state.navigate.mockReset();
    state.startDirectChat.mockReset();
    state.activeRunsByRoom.clear();
  });

  it('shows the active-run green dot and accessible description only when the agent has an active run', () => {
    const devRoom = makeRoom('!dm-dev:example.org');
    const researcherRoom = makeRoom('!dm-researcher:example.org');
    state.activeRunsByRoom.set(devRoom.roomId, [{ agentId: '@mindroom_dev:example.org' }]);
    state.activeRunsByRoom.set(researcherRoom.roomId, [{ agentId: '@mindroom_other:example.org' }]);

    const agents: HomeSidebarAgent[] = [
      {
        userId: '@mindroom_dev:example.org',
        name: 'DevAgent',
        dmRoom: devRoom,
        directRoomId: devRoom.roomId,
        lastActivityTs: 2000,
      },
      {
        userId: '@mindroom_researcher:example.org',
        name: 'Researcher',
        dmRoom: researcherRoom,
        directRoomId: researcherRoom.roomId,
        lastActivityTs: 1000,
      },
    ];

    act(() => {
      renderer = create(
        <Provider store={makeUnreadStore()}>
          <HomeAgentsSection
            visibleAgents={agents}
            agentDmRoomIds={[devRoom.roomId, researcherRoom.roomId]}
            closed={false}
            selectedRoomId={undefined}
            onCategoryClick={vi.fn()}
            homeRoomPath={(id) => `/home/${id}`}
            notificationPreferences={new Map()}
          />
        </Provider>
      );
    });

    const devRow = renderer!.root.find(
      (n) => typeof n.type === 'string' && n.props['data-room-row'] === '!dm-dev:example.org'
    );
    const researcherRow = renderer!.root.find(
      (n) => typeof n.type === 'string' && n.props['data-room-row'] === '!dm-researcher:example.org'
    );

    expect(
      devRow.findAll(
        (n) => typeof n.type === 'string' && n.props['data-agent-active-run'] === 'true'
      )
    ).toHaveLength(1);
    const devDesc = devRow.find(
      (n) => n.type === 'span' && n.props.id === 'badge-desc-!dm-dev:example.org'
    );
    expect(devDesc.props.hidden).toBe(true);
    expect(devDesc.children).toEqual(['Agent active']);

    expect(
      researcherRow.findAll(
        (n) => typeof n.type === 'string' && n.props['data-agent-active-run'] === 'true'
      )
    ).toHaveLength(0);
    const researcherDesc = researcherRow.find(
      (n) => n.type === 'span' && n.props.id === 'badge-desc-!dm-researcher:example.org'
    );
    expect(researcherDesc.props.hidden).toBe(true);
    expect(researcherDesc.children).toEqual([]);
  });

  it('guards double-clicks without disabling the button, navigates existing directRoomId, and shows retryable alert on error', async () => {
    let resolveChat!: (roomId: string) => void;
    let rejectChat!: (err: Error) => void;
    state.startDirectChat
      .mockReturnValueOnce(
        new Promise<string>((_resolve, reject) => {
          rejectChat = reject;
        })
      )
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveChat = resolve;
        })
      );

    const agents: HomeSidebarAgent[] = [
      {
        userId: '@mindroom_dev:example.org',
        name: 'DevAgent',
        lastActivityTs: 2000,
      },
      {
        userId: '@mindroom_researcher:example.org',
        name: 'Researcher',
        directRoomId: '!dm-existing:example.org',
        lastActivityTs: 1000,
      },
    ];

    act(() => {
      renderer = create(
        <Provider store={makeUnreadStore()}>
          <HomeAgentsSection
            visibleAgents={agents}
            agentDmRoomIds={[]}
            closed={false}
            selectedRoomId={undefined}
            onCategoryClick={vi.fn()}
            homeRoomPath={(id) => `/home/${id}`}
            notificationPreferences={new Map()}
          />
        </Provider>
      );
    });

    const getDevButton = () =>
      renderer!.root.find(
        (n) => n.type === 'button' && n.props['data-home-agent-id'] === '@mindroom_dev:example.org'
      );
    const researcherButton = renderer!.root.find(
      (n) =>
        n.type === 'button' && n.props['data-home-agent-id'] === '@mindroom_researcher:example.org'
    );

    // Existing directRoomId navigates directly without calling startDirectChat.
    act(() => {
      researcherButton.props.onClick();
    });
    expect(state.startDirectChat).not.toHaveBeenCalled();
    expect(state.navigate).toHaveBeenCalledWith('/home/!dm-existing:example.org');
    state.navigate.mockReset();

    // Double-clicking calls startDirectChat once; button stays enabled with aria-busy.
    act(() => {
      getDevButton().props.onClick();
      getDevButton().props.onClick();
    });
    expect(state.startDirectChat).toHaveBeenCalledTimes(1);
    expect(getDevButton().props.disabled).toBeUndefined();
    expect(getDevButton().props['aria-busy']).toBe(true);
    expect(
      renderer!.root.findAll(
        (n) => typeof n.type === 'string' && n.props['data-spinner'] === 'true'
      )
    ).toHaveLength(1);

    // Rejection surfaces an inline role="alert" message and clears aria-busy so user can retry.
    await act(async () => {
      rejectChat(new Error('network'));
    });
    expect(getDevButton().props['aria-busy']).toBeUndefined();
    const alerts = renderer!.root.findAll(
      (n) => typeof n.type === 'string' && n.props.role === 'alert'
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.children).toEqual(['Could not start a chat with DevAgent. Try again.']);

    // Retrying clears the error and navigates on success.
    act(() => {
      getDevButton().props.onClick();
    });
    expect(state.startDirectChat).toHaveBeenCalledTimes(2);
    expect(
      renderer!.root.findAll((n) => typeof n.type === 'string' && n.props.role === 'alert')
    ).toHaveLength(0);

    await act(async () => {
      resolveChat('!dm-started:example.org');
    });
    expect(state.navigate).toHaveBeenCalledWith('/home/!dm-started:example.org');
    expect(
      renderer!.root.findAll(
        (n) => typeof n.type === 'string' && n.props['data-spinner'] === 'true'
      )
    ).toHaveLength(0);
  });

  it('still navigates when m.direct sync swaps HomeAgentStartRow for RoomNavItem before startDirectChat resolves', async () => {
    let resolveChat!: (roomId: string) => void;
    state.startDirectChat.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveChat = resolve;
      })
    );

    const store = makeUnreadStore();
    const pendingAgent: HomeSidebarAgent = {
      userId: '@mindroom_dev:example.org',
      name: 'DevAgent',
      lastActivityTs: 2000,
    };

    act(() => {
      renderer = create(
        <Provider store={store}>
          <HomeAgentsSection
            visibleAgents={[pendingAgent]}
            agentDmRoomIds={[]}
            closed={false}
            selectedRoomId={undefined}
            onCategoryClick={vi.fn()}
            homeRoomPath={(id) => `/home/${id}`}
            notificationPreferences={new Map()}
          />
        </Provider>
      );
    });

    const startButton = renderer!.root.find(
      (n) => n.type === 'button' && n.props['data-home-agent-id'] === '@mindroom_dev:example.org'
    );
    act(() => {
      startButton.props.onClick();
    });
    expect(state.startDirectChat).toHaveBeenCalledTimes(1);

    // Live m.direct sync arrives before startDirectChat resolves, swapping the start button for RoomNavItem.
    const liveRoom = makeRoom('!dm-synced:example.org');
    act(() => {
      renderer!.update(
        <Provider store={store}>
          <HomeAgentsSection
            visibleAgents={[
              {
                ...pendingAgent,
                dmRoom: liveRoom,
                directRoomId: liveRoom.roomId,
              },
            ]}
            agentDmRoomIds={[liveRoom.roomId]}
            closed={false}
            selectedRoomId={undefined}
            onCategoryClick={vi.fn()}
            homeRoomPath={(id) => `/home/${id}`}
            notificationPreferences={new Map()}
          />
        </Provider>
      );
    });
    expect(
      renderer!.root.findAll(
        (n) => n.type === 'button' && n.props['data-home-agent-id'] === '@mindroom_dev:example.org'
      )
    ).toHaveLength(0);
    expect(
      renderer!.root.findAll(
        (n) => typeof n.type === 'string' && n.props['data-room-row'] === '!dm-synced:example.org'
      )
    ).toHaveLength(1);

    await act(async () => {
      resolveChat('!dm-synced:example.org');
    });
    expect(state.navigate).toHaveBeenCalledWith('/home/!dm-synced:example.org');
  });
});

describe('useHomeAddRoomsMenu', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('passes the opener element to onJoin so the Join dialog can return focus to it', () => {
    const onCreate = vi.fn();
    const onJoin = vi.fn();

    function Harness() {
      const menu = useHomeAddRoomsMenu({ onCreate, onJoin });
      return (
        <div>
          <button data-testid="opener" onClick={menu.openFromRow}>
            Add rooms
          </button>
          {menu.popover}
        </div>
      );
    }

    act(() => {
      renderer = create(<Harness />);
    });

    const openerEl = {
      focus: vi.fn(),
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 32 }),
    } as unknown as HTMLButtonElement;

    const openerButton = renderer!.root.findByProps({ 'data-testid': 'opener' });
    act(() => {
      openerButton.props.onClick({ currentTarget: openerEl });
    });

    const joinItem = renderer!.root.find(
      (n) => n.type === 'button' && n.props['data-home-room-action'] === 'join'
    );
    act(() => {
      joinItem.props.onClick();
    });

    expect(onJoin).toHaveBeenCalledWith(openerEl);
    expect(renderer!.root.findAllByProps({ 'data-popout': 'true' })).toHaveLength(0);
  });
});
