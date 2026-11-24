import React from 'react';
import { JoinRule, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Membership } from '../../matrix/types/room';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import type { LocalRoomSummary } from '../../rooms/useLocalRoomSummary';
import type { HierarchyItem } from '../useSpaceHierarchy';
import { SpaceItemCard } from './SpaceItem';

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ...actual,
    Overlay: ({
      open,
      children,
      backdrop,
    }: {
      open?: boolean;
      children?: React.ReactNode;
      backdrop?: React.ReactNode;
    }) => (open ? React.createElement(React.Fragment, null, backdrop, children) : null),
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
  };
});

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../avatars/RoomAvatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../rooms/RoomSummaryLoader', () => ({
  LocalRoomSummaryLoader: ({
    room,
    children,
  }: {
    room: Room;
    children: (summary: LocalRoomSummary) => React.ReactNode;
  }) =>
    children({
      roomId,
      name: 'Private space',
      topic: 'Private projects',
      avatarUrl: undefined,
      canonicalAlias: '#private-space:example.org',
      worldReadable: false,
      guestCanJoin: false,
      memberCount: 12,
      roomType: 'm.space',
      joinRule: room.getJoinRule?.() ?? JoinRule.Knock,
    }),
}));

vi.mock('../../matrix/room', async () => {
  const actual = await vi.importActual<typeof import('../../matrix/room')>('../../matrix/room');
  return {
    ...actual,
    getRoomAvatarUrl: () => undefined,
  };
});

vi.mock('../AddExistingModal', () => ({
  AddExistingModal: () => null,
}));

vi.mock('../../navigation/useCreateRoomModal', () => ({
  useOpenCreateRoomModal: () => vi.fn(),
}));

vi.mock('../../navigation/useCreateSpaceModal', () => ({
  useOpenCreateSpaceModal: () => vi.fn(),
}));

vi.mock('./SpaceItem.css', () => ({
  HeaderChip: 'HeaderChip',
  HeaderChipPlaceholder: 'HeaderChipPlaceholder',
  SpaceItemCard: () => 'SpaceItemCard',
}));

vi.mock('./style.css', () => ({
  AvatarPlaceholder: 'AvatarPlaceholder',
  LinePlaceholder: 'LinePlaceholder',
}));

vi.mock('../../ui/ScrollableMenu.css', () => ({
  ScrollableMenu: 'ScrollableMenu',
  ScrollableMenuRows: 'ScrollableMenuRows',
}));

vi.mock('../../ui/directional', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/directional')>()),
  PopOut: ({
    anchor,
    content,
    children,
  }: {
    anchor?: unknown;
    content?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <>
      {children}
      {anchor ? <div data-popout>{content}</div> : null}
    </>
  ),
}));

const roomId = '!private-space:example.org';
const item: HierarchyItem = {
  roomId,
  parentId: '!root-space:example.org',
  content: { via: ['one.example.org'] },
  ts: 1,
  space: true,
};
const summary: IHierarchyRoom = {
  room_id: roomId,
  name: 'Private space',
  topic: 'Private projects',
  canonical_alias: '#private-space:example.org',
  avatar_url: undefined,
  world_readable: false,
  guest_can_join: false,
  num_joined_members: 12,
  room_type: 'm.space',
  join_rule: JoinRule.Knock,
  children_state: [],
};
const mx = {
  getRoom: vi.fn(() => null),
  joinRoom: vi.fn(),
  knockRoom: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as MatrixClient;

describe('SpaceItemCard room access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mx.getRoom).mockReturnValue(null);
  });

  it('offers a join request for a knock-capable child space', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      getMyMembership: () => 'leave',
      getJoinRule: () => JoinRule.Invite,
    } as Room);
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={summary}
            joined={false}
            closed={false}
            canEditChild={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });

  it('keeps a synced knocked space in the pending-request state', () => {
    const knockedSpace = {
      roomId,
      getMyMembership: () => 'knock',
      getJoinRule: () => JoinRule.Knock,
    } as Room;
    vi.mocked(mx.getRoom).mockReturnValue(knockedSpace);
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={summary}
            joined={false}
            closed={false}
            canEditChild={false}
            getRoom={() => knockedSpace}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      0
    );
  });

  it('keeps an exactly joined cached space visible while the joined list catches up', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      roomId,
      getMyMembership: () => Membership.Join,
      getJoinRule: () => JoinRule.Public,
    } as Room);
    const renderer = create(<></>);

    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={summary}
            joined={false}
            closed={false}
            canEditChild={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAllByProps({ className: 'HeaderChip' })).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Private space'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      0
    );
  });

  it('asks to collapse a joined space by its room id from its heading', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      roomId,
      getMyMembership: () => Membership.Join,
      getJoinRule: () => JoinRule.Public,
    } as Room);
    const handleClose = vi.fn();
    const renderer = create(<></>);

    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={summary}
            joined
            closed={false}
            handleClose={handleClose}
            canEditChild={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });
    act(() => {
      renderer.root.findAllByProps({ className: 'HeaderChip' })[0]?.props.onClick();
    });

    expect(handleClose).toHaveBeenCalledWith(roomId);
  });

  it('starts a fresh request state when a virtualized row is reused for another space', async () => {
    vi.mocked(mx.knockRoom).mockResolvedValue({ room_id: roomId });
    const renderer = create(<></>);
    const renderCard = (nextItem: HierarchyItem, nextSummary: IHierarchyRoom) => (
      <MatrixClientProvider value={mx}>
        <SpaceItemCard
          item={nextItem}
          summary={nextSummary}
          joined={false}
          closed={false}
          canEditChild={false}
          getRoom={() => undefined}
        />
      </MatrixClientProvider>
    );

    act(() => renderer.update(renderCard(item, summary)));
    act(() => {
      renderer.root.findByProps({ className: 'HeaderChip' }).props.onClick();
    });
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({
        preventDefault: vi.fn(),
        target: { reasonInput: { value: '' } },
      });
      await Promise.resolve();
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(1);

    const nextRoomId = '!another-private-space:example.org';
    act(() => {
      renderer.update(
        renderCard(
          { ...item, roomId: nextRoomId },
          { ...summary, room_id: nextRoomId, name: 'Another private space' }
        )
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });

  it('treats an omitted child-space hierarchy rule as public', async () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={{ ...summary, join_rule: undefined }}
            joined={false}
            closed={false}
            canEditChild={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    const joinButton = renderer.root.findAll(
      (node) => node.props.className === 'HeaderChip' && typeof node.props.onClick === 'function'
    )[0];

    await act(() => joinButton?.props.onClick());

    expect(joinButton).toBeDefined();
    expect(mx.joinRoom).toHaveBeenCalledWith(roomId, { viaServers: item.content.via });
  });

  it('does not assume public access when a child-space summary has an unknown rule', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={{ ...summary, join_rule: 'custom_access' }}
            joined={false}
            closed={false}
            canEditChild={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(
      renderer.root.findAll((node) => node.children.includes('Access unavailable'))
    ).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('keeps a cached invitation joinable when child-space discovery is unavailable', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      getMyMembership: () => 'invite',
      getJoinRule: () => JoinRule.Invite,
    } as Room);
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            loading={false}
            summary={undefined}
            joined={false}
            closed={false}
            canEditChild={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(
      renderer.root.findAll(
        (node) =>
          node.props.className === 'HeaderChip' &&
          typeof node.props.onClick === 'function' &&
          node.props.disabled === false
      )
    ).toHaveLength(1);
    expect(
      renderer.root.findAll((node) => node.children.includes('Access unavailable'))
    ).toHaveLength(0);
  });

  it('uses a refreshed hierarchy rule for a cached knocked space', async () => {
    const knockedSpace = {
      roomId,
      getMyMembership: () => Membership.Knock,
      getJoinRule: () => JoinRule.Knock,
    } as Room;
    vi.mocked(mx.getRoom).mockReturnValue(knockedSpace);
    const renderer = create(<></>);

    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={{ ...summary, join_rule: JoinRule.Public }}
            joined={false}
            closed={false}
            canEditChild={false}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    const joinButton = renderer.root.findAll(
      (node) =>
        node.props.className === 'HeaderChip' &&
        typeof node.props.onClick === 'function' &&
        node.props.disabled === false
    )[0];

    await act(() => joinButton?.props.onClick());

    expect(joinButton).toBeDefined();
    expect(mx.joinRoom).toHaveBeenCalledWith(roomId, { viaServers: item.content.via });
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });

  it('renders a reactive parent prefix for joined parents, falls back to summary name when unjoined, and opens SpaceAddMenuEntries from one Add chip', () => {
    vi.mocked(mx.getRoom).mockReturnValue({
      roomId,
      getMyMembership: () => Membership.Join,
      getJoinRule: () => JoinRule.Public,
    } as Room);
    let onNameChange: ((renamed: Room) => void) | undefined;
    const joinedParent = {
      roomId: '!ops:example.org',
      name: 'Operations',
      on: vi.fn((_event: string, listener: (renamed: Room) => void) => {
        onNameChange = listener;
      }),
      removeListener: vi.fn(),
    } as unknown as Room;
    const renderer = create(<></>);
    const renderedTexts = () =>
      renderer.root
        .findAll(
          (node) => typeof node.props.children === 'string' || Array.isArray(node.props.children)
        )
        .map((node) =>
          Array.isArray(node.props.children)
            ? node.props.children.filter((child: unknown) => typeof child === 'string').join('')
            : String(node.props.children)
        );

    act(() => {
      renderer.update(
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <MatrixClientProvider value={mx}>
            <SpaceItemCard
              item={{ ...item, depth: 2 }}
              parentSpace={joinedParent}
              parentSummaryName="Stale Summary"
              summary={summary}
              joined
              closed={false}
              canEditChild
              getRoom={() => undefined}
            />
          </MatrixClientProvider>
        </ScreenSizeProvider>
      );
    });

    // Joined parentSpace drives the breadcrumb reactively (overriding summary name on live rename).
    expect(renderedTexts()).toContain('Operations /');
    expect(renderedTexts()).toContain('Private space');
    act(() => {
      joinedParent.name = 'Ops Team';
      onNameChange?.(joinedParent);
    });
    expect(renderedTexts()).toContain('Ops Team /');

    // Unjoined parentSpace falls back to parentSummaryName.
    act(() => {
      renderer.update(
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <MatrixClientProvider value={mx}>
            <SpaceItemCard
              item={{ ...item, depth: 2 }}
              parentSummaryName="Archive Ops"
              summary={summary}
              joined
              closed={false}
              canEditChild
              getRoom={() => undefined}
            />
          </MatrixClientProvider>
        </ScreenSizeProvider>
      );
    });
    expect(renderedTexts()).toContain('Archive Ops /');

    // Only one Add chip is rendered (replacing separate Add Room / Add Space chips).
    const addButtons = renderer.root.findAll(
      (node) => node.type === 'button' && node.props['aria-haspopup'] === 'menu'
    );
    expect(addButtons).toHaveLength(1);
    expect(addButtons[0]!.findAll((node) => node.children.includes('Add'))).toHaveLength(1);

    // Clicking the Add chip opens the shared 4-entry SpaceAddMenuEntries menu.
    act(() => {
      addButtons[0]!.props.onClick({
        currentTarget: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 48, height: 24 }) },
      });
    });
    const popout = renderer.root.find(
      (node) => typeof node.type === 'string' && 'data-popout' in node.props
    );
    const menuItems = popout
      .findAll((node) => node.type === 'button')
      .map((node) =>
        node
          .findAll(
            (child) => typeof child.type === 'string' && typeof child.props.children === 'string'
          )
          .map((child) => child.props.children)
          .join('')
      );
    expect(menuItems).toEqual([
      'New Room',
      'Add Existing Room',
      'New Sub-space',
      'Add Existing Sub-space',
    ]);

    // Compact mobile Add chip keeps the accessible label.
    act(() => {
      renderer.update(
        <ScreenSizeProvider value={ScreenSize.Mobile}>
          <MatrixClientProvider value={mx}>
            <SpaceItemCard
              item={{ ...item, depth: 2 }}
              parentSummaryName="Archive Ops"
              summary={summary}
              joined
              closed={false}
              canEditChild
              getRoom={() => undefined}
            />
          </MatrixClientProvider>
        </ScreenSizeProvider>
      );
    });
    const mobileAddButtons = renderer.root.findAll(
      (node) => node.type === 'button' && node.props['aria-haspopup'] === 'menu'
    );
    expect(mobileAddButtons).toHaveLength(1);
    expect(mobileAddButtons[0]!.props['aria-label']).toBe('Add');
  });
});
