// @vitest-environment jsdom

import React from 'react';
import { JoinRule, type MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { MatrixClientProvider } from '../../../hooks/useMatrixClient';
import { FeaturedRooms } from './Featured';
import { PublicRooms } from './Server';

const mocks = vi.hoisted(() => ({
  roomCardProps: [] as Array<Record<string, unknown>>,
  publicRooms: {
    chunk: [
      {
        room_id: '!server-room:example.org',
        canonical_alias: '#server-room:example.org',
        name: 'Server room',
        topic: 'Server discussion',
        num_joined_members: 12,
        world_readable: false,
        guest_can_join: false,
        join_rule: 'knock',
      },
    ],
    total_room_count_estimate: 1,
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.publicRooms, isLoading: false, error: null }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ server: 'example.org' }),
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');
  return { ...actual, useAtomValue: () => [] };
});

vi.mock('../../../components/page', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => children;
  return {
    Page: Wrapper,
    PageContent: Wrapper,
    PageContentCenter: Wrapper,
    PageHeader: Wrapper,
    PageHeroSection: Wrapper,
    PageHero: () => null,
  };
});

vi.mock('../../../components/room-card', () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => children;
  return {
    RoomCardGrid: Wrapper,
    RoomCardBase: () => null,
    RoomCard: ({ roomIdOrAlias, ...props }: Record<string, unknown>) => {
      mocks.roomCardProps.push({ roomIdOrAlias, ...props });
      return React.createElement('div', { 'data-room-card': roomIdOrAlias as string });
    },
  };
});

vi.mock('../../../components/RoomSummaryLoader', () => ({
  RoomSummaryLoader: ({
    roomIdOrAlias,
    children,
  }: {
    roomIdOrAlias: string;
    children: (state: unknown, retry: () => void) => React.ReactNode;
  }) =>
    children(
      {
        status: AsyncStatus.Success,
        data: {
          room_id: roomIdOrAlias,
          name: roomIdOrAlias,
          topic: 'Featured discussion',
          num_joined_members: 5,
          join_rule: JoinRule.Knock,
        },
      },
      vi.fn()
    ),
}));

vi.mock('../../../components/room-topic-viewer', () => ({
  RoomTopicViewer: () => null,
}));

vi.mock('../../../hooks/useClientConfig', () => ({
  useClientConfig: () => ({
    featuredCommunities: {
      spaces: ['!featured-space:example.org'],
      rooms: ['!featured-room:example.org'],
    },
  }),
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoom: vi.fn(), navigateSpace: vi.fn() }),
}));

vi.mock('../../../hooks/useScreenSize', () => ({
  ScreenSize: { Mobile: 'Mobile' },
  useScreenSizeContext: () => 'Desktop',
}));

vi.mock('../../../mindroom/native/MindroomBackRouteHandler', () => ({
  MindroomBackRouteHandler: ({ children }: { children: (onBack: () => void) => React.ReactNode }) =>
    children(vi.fn()),
}));

vi.mock('./style.css', () => ({
  PublicRoomsError: 'PublicRoomsError',
  RoomsInfoCard: 'RoomsInfoCard',
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));

describe('Explore room access wiring', () => {
  beforeEach(() => {
    mocks.roomCardProps.length = 0;
  });

  it('passes discovered knock rules and access status through Featured cards', () => {
    act(() => {
      create(<FeaturedRooms />);
    });

    expect(mocks.roomCardProps).toHaveLength(2);
    expect(mocks.roomCardProps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomIdOrAlias: '!featured-space:example.org',
          joinRule: JoinRule.Knock,
          accessStatus: AsyncStatus.Success,
        }),
        expect.objectContaining({
          roomIdOrAlias: '!featured-room:example.org',
          joinRule: JoinRule.Knock,
          accessStatus: AsyncStatus.Success,
        }),
      ])
    );
  });

  it('passes knock rules from server Explore results into room cards', () => {
    const mx = {
      getUserId: vi.fn(() => null),
      http: { authedRequest: vi.fn() },
    } as unknown as MatrixClient;

    act(() => {
      create(
        <MatrixClientProvider value={mx}>
          <PublicRooms />
        </MatrixClientProvider>
      );
    });

    expect(mocks.roomCardProps).toHaveLength(1);
    expect(mocks.roomCardProps[0]).toEqual(
      expect.objectContaining({
        roomIdOrAlias: '#server-room:example.org',
        roomId: '!server-room:example.org',
        joinRule: JoinRule.Knock,
      })
    );
  });
});
