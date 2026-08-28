import React from 'react';
import { JoinRule, type MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { AsyncStatus } from '../../hooks/useAsyncCallback';
import { JoinBeforeNavigate } from './JoinBeforeNavigate';

const summaryLoaderMock = vi.hoisted(() => ({
  state: undefined as unknown,
  props: undefined as unknown,
  retry: vi.fn(),
}));

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
    Scroll: Wrapper,
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../components/page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => children,
  PageHeader: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('../../components/room-avatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

vi.mock('../../components/room-card/style.css', () => ({
  ActionButton: 'ActionButton',
  CardGrid: 'CardGrid',
  RoomCardBase: 'RoomCardBase',
  RoomCardTopic: 'RoomCardTopic',
}));

vi.mock('../../components/RoomSummaryLoader', () => ({
  RoomSummaryLoader: ({
    children,
    ...props
  }: {
    children: (state: unknown, retry: () => void) => React.ReactNode;
    roomIdOrAlias: string;
    viaServers?: string[];
  }) => {
    summaryLoaderMock.props = props;
    return children(summaryLoaderMock.state, summaryLoaderMock.retry);
  },
}));

vi.mock('../../components/room-topic-viewer', () => ({
  RoomTopicViewer: () => null,
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: vi.fn(),
    navigateSpace: vi.fn(),
  }),
}));

vi.mock('../../hooks/useScreenSize', () => ({
  ScreenSize: { Mobile: 'Mobile' },
  useScreenSizeContext: () => 'Desktop',
}));

vi.mock('../../mindroom/native/MindroomBackRouteHandler', () => ({
  MindroomBackRouteHandler: ({ children }: { children: (onBack: () => void) => React.ReactNode }) =>
    children(vi.fn()),
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');
  return {
    ...actual,
    useAtomValue: () => [],
  };
});

const mx = {
  getRoom: vi.fn(() => null),
  joinRoom: vi.fn(),
  knockRoom: vi.fn(),
  mxcUrlToHttp: vi.fn(() => 'https://example.org/media/private'),
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as MatrixClient;

describe('JoinBeforeNavigate room access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    summaryLoaderMock.state = {
      status: AsyncStatus.Success,
      data: {
        room_id: '!private:example.org',
        name: 'Private room',
        avatar_url: 'mxc://example.org/private',
        topic: 'Private discussion',
        canonical_alias: '#private:example.org',
        world_readable: false,
        guest_can_join: false,
        num_joined_members: 12,
        join_rule: JoinRule.Knock,
        membership: 'leave',
      },
    };
  });

  it('offers a join request from a knock-capable room summary', () => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate
            roomIdOrAlias="!private:example.org"
            viaServers={['one.example.org']}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Request to join'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
    expect(summaryLoaderMock.props).toEqual({
      roomIdOrAlias: '!private:example.org',
      viaServers: ['one.example.org'],
    });
  });

  it('does not expose Join while room access discovery is pending', () => {
    summaryLoaderMock.state = { status: AsyncStatus.Loading };
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate roomIdOrAlias="!private:example.org" />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findAll((node) => node.children.includes('Checking access'))).toHaveLength(
      1
    );
    expect(renderer.root.findAll((node) => node.children.includes('Join'))).toHaveLength(0);
  });

  it('retries failed room access discovery without attempting to join', () => {
    summaryLoaderMock.state = {
      status: AsyncStatus.Error,
      error: new Error('Summary unavailable'),
    };
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={mx}>
          <JoinBeforeNavigate roomIdOrAlias="!private:example.org" />
        </MatrixClientProvider>
      );
    });
    const retryButton = renderer.root
      .findAllByType('button')
      .find(
        (button) => button.findAll((node) => node.children.includes('Retry room info')).length > 0
      );

    act(() => retryButton?.props.onClick());

    expect(summaryLoaderMock.retry).toHaveBeenCalledOnce();
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });
});
