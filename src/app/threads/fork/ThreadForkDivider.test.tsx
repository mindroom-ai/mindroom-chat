import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ThreadForkDivider } from './ThreadForkDivider';

const navigation = vi.hoisted(() => ({ navigateRoomThread: vi.fn() }));
vi.mock('../../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
// The parent's root is in the room; nothing is read from the event cache.
vi.mock('../../event-store/sdk/cachedThreadRoots', () => ({ useCachedThreadRoot: () => undefined }));

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
