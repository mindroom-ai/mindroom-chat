import React from 'react';
import { ClientEvent, JoinRule, SyncState, type MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { AsyncStatus } from '../../lib/hooks/useAsyncCallback';
import { JoinBeforeNavigate } from './JoinBeforeNavigate';

const summaryLoaderMock = vi.hoisted(() => ({
  state: undefined as unknown,
  props: undefined as unknown,
  retry: vi.fn(),
  resolvedViaServers: undefined as string[] | undefined,
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

vi.mock('../../ui/page/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => children,
  PageHeader: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('../../avatars/RoomAvatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
}));

vi.mock('../RoomCard.css', () => ({
  ActionButton: 'ActionButton',
  CardGrid: 'CardGrid',
  RoomCardBase: 'RoomCardBase',
  RoomCardTopic: 'RoomCardTopic',
}));

vi.mock('../RoomSummaryLoader', () => ({
  RoomSummaryLoader: ({
    children,
    ...props
  }: {
    children: (state: unknown, retry: () => void, viaServers?: string[]) => React.ReactNode;
    roomIdOrAlias: string;
    viaServers?: string[];
  }) => {
    summaryLoaderMock.props = props;
    return children(
      summaryLoaderMock.state,
      summaryLoaderMock.retry,
      summaryLoaderMock.resolvedViaServers
    );
  },
}));

vi.mock('../../room/RoomTopicViewer', () => ({
  RoomTopicViewer: () => null,
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: vi.fn(),
    navigateSpace: vi.fn(),
  }),
}));

vi.mock('../../lib/hooks/useScreenSize', () => ({
  ScreenSize: { Mobile: 'Mobile' },
  useScreenSizeContext: () => 'Desktop',
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

describe('JoinBeforeNavigate names the room it knows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    summaryLoaderMock.resolvedViaServers = undefined;
  });

  const inviteState = new Map<string, { getContent: () => Record<string, unknown> }>([
    ['m.room.topic', { getContent: () => ({ topic: 'Planning notes' }) }],
  ]);
  const invitedRoom = {
    roomId: '!invited:example.org',
    name: 'Invited planning room',
    myUserId: '@me:example.org',
    getMyMembership: () => 'invite',
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: (type: string) => inviteState.get(type) }),
    }),
    getMxcAvatarUrl: () => null,
    getCanonicalAlias: () => null,
    getJoinedMemberCount: () => 0,
    getType: () => undefined,
    getJoinRule: () => JoinRule.Invite,
    getMember: (userId: string) =>
      userId === '@me:example.org'
        ? { events: { member: { getSender: () => '@host:example.org' } } }
        : { name: 'Room Host' },
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const roomClient = {
    ...mx,
    getRoom: vi.fn((roomId: string) => (roomId === invitedRoom.roomId ? invitedRoom : null)),
    getSafeUserId: () => '@me:example.org',
  } as unknown as MatrixClient;

  const renderPage = (roomIdOrAlias: string, client: MatrixClient) => {
    const renderer = create(<></>);
    act(() => {
      renderer.update(
        <MatrixClientProvider value={client}>
          <JoinBeforeNavigate roomIdOrAlias={roomIdOrAlias} />
        </MatrixClientProvider>
      );
    });
    return renderer;
  };
  const headerText = (renderer: ReturnType<typeof create>) =>
    renderer.root.findByType('h1').children.join('');
  const textOf = (node: unknown): string =>
    typeof node === 'string'
      ? node
      : ((node as { children?: unknown[] }).children ?? []).map(textOf).join('');
  const hasText = (renderer: ReturnType<typeof create>, text: string) =>
    renderer.root.findAll((node) => node.children.includes(text)).length > 0;

  it('titles the page with the summary name, not the ID it was opened with', () => {
    summaryLoaderMock.state = {
      status: AsyncStatus.Success,
      data: { room_id: '!private:example.org', name: 'Private room', join_rule: JoinRule.Public },
    };
    expect(headerText(renderPage('!private:example.org', mx))).toBe('Private room');
  });

  it('shows an invite from its own state while the summary cannot be loaded', () => {
    summaryLoaderMock.state = { status: AsyncStatus.Error, error: new Error('offline') };
    const renderer = renderPage(invitedRoom.roomId, roomClient);

    expect(headerText(renderer)).toBe('Invited planning room');
    expect(hasText(renderer, 'Invited planning room')).toBe(true);
    expect(hasText(renderer, 'Planning notes')).toBe(true);
    expect(hasText(renderer, 'Join')).toBe(true);
    expect(hasText(renderer, 'Decline')).toBe(true);
    expect(hasText(renderer, 'Retry room info')).toBe(false);
  });

  it('shows the cached invite while the summary is still loading', () => {
    summaryLoaderMock.state = { status: AsyncStatus.Loading };
    const renderer = renderPage(invitedRoom.roomId, roomClient);

    expect(hasText(renderer, 'Checking access')).toBe(false);
    expect(hasText(renderer, 'Decline')).toBe(true);
  });

  it('keeps the ID for a room the client does not know', () => {
    summaryLoaderMock.state = { status: AsyncStatus.Error, error: new Error('offline') };
    expect(headerText(renderPage('!unknown:example.org', roomClient))).toBe('!unknown:example.org');
  });

  it('shows a ban reason with its direction controls as code points, and names as text', () => {
    summaryLoaderMock.state = { status: AsyncStatus.Error, error: new Error('forbidden') };
    const members = [
      { userId: '@morgan:example.org', rawDisplayName: 'Morgan <i>Lee</i>', membership: 'join' },
      {
        userId: '@me:example.org',
        membership: 'ban',
        events: {
          member: {
            getSender: () => '@morgan:example.org',
            getContent: () => ({ membership: 'ban', reason: 'Posted a \u202ekcilc\u202c link' }),
          },
        },
      },
    ];
    const bannedRoom = {
      ...invitedRoom,
      roomId: '!banned:example.org',
      name: 'Banned planning room',
      getMyMembership: () => 'ban',
      getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
      getMembers: () => members,
    };
    const client = {
      ...roomClient,
      getRoom: vi.fn((roomId: string) => (roomId === bannedRoom.roomId ? bannedRoom : null)),
    } as unknown as MatrixClient;
    const renderer = renderPage(bannedRoom.roomId, client);
    const lines = renderer.root
      .findAll((node) => node.type === 'p' || node.type === 'span')
      .map((node) => textOf(node));

    expect(lines).toContain('Banned by: Morgan <i>Lee</i>');
    expect(lines).toContain('Reason: Posted a <U+202E>kcilc<U+202C> link');
  });

  it('asks for a failed summary again once sync recovers', () => {
    summaryLoaderMock.state = { status: AsyncStatus.Error, error: new Error('offline') };
    renderPage(invitedRoom.roomId, roomClient);
    const onSync = vi
      .mocked(roomClient.on)
      .mock.calls.filter(([event]) => event === ClientEvent.Sync)
      .at(-1)?.[1] as unknown as (state: SyncState, previous: SyncState | null) => void;

    act(() => onSync(SyncState.Error, SyncState.Syncing));
    expect(summaryLoaderMock.retry).not.toHaveBeenCalled();
    act(() => onSync(SyncState.Syncing, SyncState.Error));
    expect(summaryLoaderMock.retry).toHaveBeenCalledOnce();
  });
});
