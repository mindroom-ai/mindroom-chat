import React from 'react';
import { JoinRule, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import type { LocalRoomSummary } from '../../hooks/useLocalRoomSummary';
import type { HierarchyItem } from '../../hooks/useSpaceHierarchy';
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
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../components/room-avatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../components/RoomSummaryLoader', () => ({
  LocalRoomSummaryLoader: ({
    children,
  }: {
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
      joinRule: JoinRule.Knock,
    }),
}));

vi.mock('../../utils/room', async () => {
  const actual = await vi.importActual<typeof import('../../utils/room')>('../../utils/room');
  return {
    ...actual,
    getRoomAvatarUrl: () => undefined,
  };
});

vi.mock('./DnD', () => ({
  useDraggableItem: () => undefined,
}));

vi.mock('../add-existing', () => ({
  AddExistingModal: () => null,
}));

vi.mock('../../state/hooks/createRoomModal', () => ({
  useOpenCreateRoomModal: () => vi.fn(),
}));

vi.mock('../../state/hooks/createSpaceModal', () => ({
  useOpenCreateSpaceModal: () => vi.fn(),
}));

vi.mock('../../components/BetaNoticeBadge', () => ({
  BetaNoticeBadge: () => null,
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
  it('offers a join request for a knock-capable child space', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <SpaceItemCard
            item={item}
            summary={summary}
            joined={false}
            categoryId={roomId}
            closed={false}
            canEditChild={false}
            canReorder={false}
            onDragging={vi.fn()}
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
            categoryId={roomId}
            closed={false}
            canEditChild={false}
            canReorder={false}
            onDragging={vi.fn()}
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
});
