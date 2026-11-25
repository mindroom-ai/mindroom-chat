import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ThreadForkDivider } from './ThreadForkDivider';

const navigation = vi.hoisted(() => ({ navigateRoomThread: vi.fn() }));
vi.mock('../../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
import { EventEmitter } from 'events';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';

const cachedRootSpy = vi.hoisted(() => vi.fn(() => undefined));
vi.mock('../../event-store/sdk/cachedThreadRoots', () => ({
  useCachedThreadRoot: cachedRootSpy,
}));

const ROOM = '!room:example.org';

const parentRoot = new MatrixEvent({
  event_id: '$parent',
  room_id: ROOM,
  sender: '@maya:example.org',
  type: 'm.room.message',
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body: 'Plan the trip to Lisbon' },
});

const room = {
  roomId: ROOM,
  getThread: () => null,
  findEventById: (eventId: string) => (eventId === '$parent' ? parentRoot : undefined),
  getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
  hasEncryptionStateEvent: () => false,
  getMember: () => null,
} as unknown as Room;

const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('');

describe('ThreadForkDivider', () => {
  it('names the parent thread and opens it at the fork point', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ThreadForkDivider room={room} parent={{ threadId: '$parent', eventId: '$p2' }} />
      );
    });

    const wrapper = renderer.root.findByProps({ 'data-fork-divider-variant': 'forked' });
    expect(wrapper).toBeDefined();
    const button = renderer.root.findByType('button');
    expect(text(button)).toBe('Forked from Plan the trip to Lisbon');

    act(() => {
      button.props.onClick();
    });
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(ROOM, '$parent', '$p2');
  });

  it("prefers the parent thread's AI title", () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ThreadForkDivider
          room={room}
          parent={{ threadId: '$parent', eventId: '$p2' }}
          summaryInfo={{ summaryText: 'Lisbon trip' }}
        />
      );
    });

    expect(text(renderer.root.findByType('button'))).toBe('Forked from Lisbon trip');
  });
});

describe('ThreadForkDivider in a fork draft', () => {
  it('names the thread being forked under its fork point, and goes nowhere', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ThreadForkDivider
          room={room}
          parent={{ threadId: '$parent', eventId: '$p2' }}
          variant="forking"
        />
      );
    });

    expect(renderer.root.findByProps({ 'data-fork-divider-variant': 'forking' })).toBeDefined();
    expect(text(renderer.root)).toBe('Draft · send a message below to start this fork');
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
  });

  it('names the destination room in a cross-room fork draft', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ThreadForkDivider
          room={room}
          parent={{ threadId: '$parent', eventId: '$p2' }}
          variant="forking"
          targetRoomName="Project Beta"
        />
      );
    });

    expect(renderer.root.findByProps({ 'data-fork-divider-variant': 'forking' })).toBeDefined();
    expect(text(renderer.root)).toBe('Draft · send a message below to fork into Project Beta');
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
  });
});

describe('ThreadForkDivider for cross-room forks', () => {
  const alphaRoomId = '!alpha:example.org';
  const alphaRoot = new MatrixEvent({
    event_id: '$alphaRoot',
    room_id: alphaRoomId,
    sender: '@maya:example.org',
    type: 'm.room.message',
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'Architecture RFC' },
  });
  const makeJoinedAlpha = (membership = 'join') =>
    ({
      roomId: alphaRoomId,
      name: 'Project Alpha',
      getMyMembership: () => membership,
      getThread: () => null,
      findEventById: (eventId: string) => (eventId === '$alphaRoot' ? alphaRoot : undefined),
      getUnfilteredTimelineSet: () => ({
        relations: { getChildEventsForEvent: () => undefined },
      }),
      hasEncryptionStateEvent: () => false,
      getMember: () => null,
    }) as unknown as Room;

  it('shows "Forked from <title> in <room>" and navigates to the parent room when joined', () => {
    navigation.navigateRoomThread.mockClear();
    const alphaRoom = makeJoinedAlpha('join');
    const mx = Object.assign(new EventEmitter(), {
      getRoom: (id: string) => (id === alphaRoomId ? alphaRoom : null),
    }) as unknown as MatrixClient;

    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ThreadForkDivider
            room={room}
            parent={{ roomId: alphaRoomId, threadId: '$alphaRoot', eventId: '$a2' }}
          />
        </MatrixClientProvider>
      );
    });

    const button = renderer.root.findByType('button');
    expect(text(button)).toBe('Forked from Architecture RFC in Project Alpha');
    act(() => {
      button.props.onClick();
    });
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(alphaRoomId, '$alphaRoot', '$a2');
  });

  it('shows static "Forked from another room" with no cache fetch when parent room is not joined', () => {
    cachedRootSpy.mockClear();
    const mx = Object.assign(new EventEmitter(), {
      getRoom: () => null,
    }) as unknown as MatrixClient;

    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ThreadForkDivider
            room={room}
            parent={{ roomId: alphaRoomId, threadId: '$alphaRoot', eventId: '$a2' }}
          />
        </MatrixClientProvider>
      );
    });

    expect(renderer.root.findByProps({ 'data-fork-divider-variant': 'forked' })).toBeDefined();
    expect(text(renderer.root)).toBe('Forked from another room');
    expect(renderer.root.findAllByType('button')).toHaveLength(0);
    expect(cachedRootSpy).not.toHaveBeenCalled();
  });
});
