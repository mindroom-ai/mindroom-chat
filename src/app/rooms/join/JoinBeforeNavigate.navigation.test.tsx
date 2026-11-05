import React from 'react';
import { JoinRule, RoomType, type MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { JoinBeforeNavigate } from './JoinBeforeNavigate';

const mocks = vi.hoisted(() => ({
  summary: undefined as unknown,
  navigateRoom: vi.fn(),
  navigateRoomThreadDirect: vi.fn(),
  navigateSpace: vi.fn(),
}));

vi.mock('../../ui/page/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => children,
  PageHeader: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('../../avatars/room-avatar/RoomAvatar', () => ({
  RoomAvatar: () => null,
}));

vi.mock('../room-card/style.css', () => ({
  ActionButton: 'ActionButton',
  RoomCardBase: 'RoomCardBase',
  RoomCardTopic: 'RoomCardTopic',
}));

vi.mock('../RoomSummaryLoader', () => ({
  RoomSummaryLoader: ({
    children,
  }: {
    children: (state: unknown, retry: () => void) => React.ReactNode;
  }) => children({ status: AsyncStatus.Success, data: mocks.summary }, vi.fn()),
}));

// The join itself succeeded; what is left is where the app goes next.
vi.mock('../room-access/RoomAccessControl', () => ({
  RoomAccessControl: ({
    children,
  }: {
    children: (access: {
      kind: 'join';
      activate: () => void;
      loading: boolean;
      requested: boolean;
      succeeded: boolean;
    }) => React.ReactNode;
  }) =>
    children({
      kind: 'join',
      activate: vi.fn(),
      loading: false,
      requested: false,
      succeeded: true,
    }),
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: mocks.navigateRoom,
    navigateRoomThreadDirect: mocks.navigateRoomThreadDirect,
    navigateSpace: mocks.navigateSpace,
  }),
}));

const mx = {
  getRoom: () => null,
  on: () => undefined,
  removeListener: () => undefined,
} as unknown as MatrixClient;

const renderJoined = (props: React.ComponentProps<typeof JoinBeforeNavigate>) => {
  act(() => {
    create(
      <MatrixClientProvider value={mx}>
        <JoinBeforeNavigate {...props} />
      </MatrixClientProvider>
    );
  });
};

describe('JoinBeforeNavigate after a join', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.summary = {
      room_id: '!room:example.org',
      name: 'Room',
      join_rule: JoinRule.Public,
      membership: 'leave',
    };
  });

  it('opens a joined space at its space path', () => {
    mocks.summary = { ...(mocks.summary as object), room_type: RoomType.Space };
    renderJoined({ roomIdOrAlias: '#team:example.org' });

    expect(mocks.navigateSpace).toHaveBeenCalledWith('!room:example.org', { replace: true });
    expect(mocks.navigateRoom).not.toHaveBeenCalled();
  });

  it('opens a joined room at the event the link named', () => {
    renderJoined({ roomIdOrAlias: '!room:example.org', eventId: '$event' });

    expect(mocks.navigateRoom).toHaveBeenCalledWith('!room:example.org', '$event', {
      replace: true,
    });
    expect(mocks.navigateSpace).not.toHaveBeenCalled();
  });

  it('keeps the thread the link opened', () => {
    renderJoined({ roomIdOrAlias: '!room:example.org', threadId: '$root' });

    expect(mocks.navigateRoomThreadDirect).toHaveBeenCalledWith(
      '!room:example.org',
      '$root',
      undefined,
      { replace: true }
    );
    expect(mocks.navigateRoom).not.toHaveBeenCalled();
  });
});
