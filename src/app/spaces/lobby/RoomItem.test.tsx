import React from 'react';
import { JoinRule, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import type { HierarchyItem } from '../useSpaceHierarchy';
import { RoomItemCard } from './RoomItem';

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

vi.mock('../../ui/SequenceCard', () => ({
  SequenceCard: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
}));

vi.mock('../../avatars/RoomAvatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
  RoomIcon: () => React.createElement('i'),
}));

vi.mock('../../room/RoomTopicViewer', () => ({
  RoomTopicViewer: () => null,
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../matrix/room', async () => {
  const actual = await vi.importActual<typeof import('../../matrix/room')>('../../matrix/room');
  return {
    ...actual,
    getRoomAvatarUrl: () => undefined,
  };
});

vi.mock('./RoomItem.css', () => ({
  CardOpener: 'CardOpener',
  RoomName: 'RoomName',
  RoomNameRow: 'RoomNameRow',
  RoomItemCard: 'RoomItemCard',
  RoomProfileTopic: 'RoomProfileTopic',
}));

vi.mock('./style.css', () => ({
  AvatarPlaceholder: 'AvatarPlaceholder',
  LinePlaceholder: 'LinePlaceholder',
}));

const roomId = '!private:example.org';
const item: HierarchyItem = {
  roomId,
  parentId: '!space:example.org',
  content: { via: ['one.example.org'] },
  ts: 1,
};
const summary: IHierarchyRoom = {
  room_id: roomId,
  name: 'Private room',
  topic: 'Private discussion',
  canonical_alias: '#private:example.org',
  avatar_url: undefined,
  world_readable: false,
  guest_can_join: false,
  num_joined_members: 12,
  room_type: undefined,
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

const cachedRoom = (membership: string, joinRule: JoinRule): Room =>
  ({
    roomId,
    name: 'Private room',
    getMyMembership: () => membership,
    getJoinRule: () => joinRule,
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: () => undefined }),
    }),
    getGuestAccess: () => 'forbidden',
    getMxcAvatarUrl: () => null,
    getCanonicalAlias: () => null,
    getJoinedMemberCount: () => 12,
    getType: () => undefined,
  } as Room);

describe('RoomItemCard room access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mx.getRoom).mockReturnValue(null);
  });

  it('offers a join request for a knock-capable child room', () => {
    vi.mocked(mx.getRoom).mockReturnValue(cachedRoom('leave', JoinRule.Invite));
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            summary={summary}
            onOpen={vi.fn()}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('treats an omitted child-room hierarchy rule as public', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            summary={{ ...summary, join_rule: undefined }}
            onOpen={vi.fn()}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    const joinButton = renderer.root
      .findAllByType('button')
      .find((button) => button.findAll((node) => node.children.includes('Join')).length > 0);

    act(() => joinButton?.props.onClick());

    expect(joinButton).toBeDefined();
    expect(mx.joinRoom).toHaveBeenCalledWith(roomId, { viaServers: item.content.via });
  });

  it('does not assume public access when a child-room summary has an unknown rule', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            summary={{ ...summary, join_rule: 'custom_access' as JoinRule }}
            onOpen={vi.fn()}
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

  it('offers no Join for a public room the person is banned from', () => {
    vi.mocked(mx.getRoom).mockReturnValue(cachedRoom('ban', JoinRule.Public));
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            summary={{ ...summary, join_rule: JoinRule.Public }}
            onOpen={vi.fn()}
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

  it('uses a refreshed hierarchy rule for a cached knocked room', () => {
    vi.mocked(mx.getRoom).mockReturnValue(cachedRoom('knock', JoinRule.Knock));
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <RoomItemCard
            item={item}
            loading={false}
            summary={{ ...summary, join_rule: JoinRule.Public }}
            onOpen={vi.fn()}
            getRoom={() => undefined}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(1);
    expect(renderer.root.findAll((node) => node.children.includes('Request sent'))).toHaveLength(0);
  });
});

describe('RoomItemCard opening a joined room', () => {
  const joinedCard = (screenSize: ScreenSize, onOpen: (id: string) => void) => {
    vi.mocked(mx.getRoom).mockReturnValue(cachedRoom('join', JoinRule.Invite));
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <ScreenSizeProvider value={screenSize}>
          <MatrixClientProvider value={mx}>
            <RoomItemCard
              item={item}
              loading={false}
              summary={summary}
              onOpen={onOpen}
              getRoom={() => undefined}
            />
          </MatrixClientProvider>
        </ScreenSizeProvider>
      );
    });
    return renderer;
  };
  const openRoomButtons = (renderer: ReturnType<typeof create>) =>
    renderer.root.findAll((node) => node.children.includes('Open Room'));

  it('opens on a phone by a tap anywhere on the card, or by its name button', () => {
    const onOpen = vi.fn();
    const renderer = joinedCard(ScreenSize.Mobile, onOpen);
    expect(openRoomButtons(renderer)).toHaveLength(0);
    const opener = renderer.root.findByProps({ className: 'CardOpener' });
    expect(opener.type).toBe('button');
    expect(opener.findAll((node) => node.children.includes('Private room')).length).toBeGreaterThan(
      0
    );
    const card = renderer.root.findByProps({ className: 'RoomItemCard' });
    const click = (closest: Element | null) =>
      act(() =>
        card.props.onClick({
          currentTarget: { contains: () => true },
          target: { closest: () => closest },
        })
      );
    // The card's topic, then the name's button, then the card's menu button.
    click(null);
    click({ hasAttribute: (name: string) => name === 'data-card-opener' } as unknown as Element);
    click({ hasAttribute: () => false } as unknown as Element);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith(roomId);
  });

  it('keeps the Open Room button on wider screens', () => {
    const renderer = joinedCard(ScreenSize.Desktop, vi.fn());
    expect(openRoomButtons(renderer).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ className: 'CardOpener' })).toHaveLength(0);
    expect(renderer.root.findByProps({ className: 'RoomItemCard' }).props.onClick).toBeUndefined();
  });
});
