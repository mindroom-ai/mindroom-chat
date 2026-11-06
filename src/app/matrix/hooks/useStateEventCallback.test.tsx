import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RoomStateEvent, type MatrixEvent, type Room, type RoomState } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { StateEvent } from '../types/room';
import { useRoomAvatar } from './useRoomMeta';

const ROWS = 200;

const avatarEvent = (roomId: string, url: string): MatrixEvent =>
  ({
    getContent: () => ({ url }),
    getRoomId: () => roomId,
    getStateKey: () => '',
    getType: () => StateEvent.RoomAvatar,
  } as unknown as MatrixEvent);

/** Rooms of one client, each reading its avatar from `avatars`. */
const makeRooms = (client: EventEmitter, avatars: Map<string, MatrixEvent>): Room[] =>
  Array.from({ length: ROWS }, (_, index) => {
    const roomId = `!room${index}:example.org`;
    return {
      client,
      roomId,
      getLiveTimeline: () => ({
        getState: () => ({ getStateEvents: () => avatars.get(roomId) }),
      }),
    } as unknown as Room;
  });

function AvatarRow({ room }: { room: Room }) {
  return <li data-room={room.roomId}>{useRoomAvatar(room) ?? 'none'}</li>;
}

describe('useStateEventCallback', () => {
  it('keeps one client listener however many rows follow room state', () => {
    const client = new EventEmitter();
    const avatars = new Map<string, MatrixEvent>();
    const rooms = makeRooms(client, avatars);

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        <ul>
          {rooms.map((room) => (
            <AvatarRow key={room.roomId} room={room} />
          ))}
        </ul>
      );
    });
    expect(renderer?.root.findAllByType('li')).toHaveLength(ROWS);
    expect(client.listenerCount(RoomStateEvent.Events)).toBe(1);

    // A state event still reaches the row of its room, and only that row changes.
    const changed = avatarEvent('!room7:example.org', 'mxc://example.org/seven');
    avatars.set('!room7:example.org', changed);
    act(() => {
      client.emit(RoomStateEvent.Events, changed, {} as RoomState, null);
    });
    const shown = renderer?.root.findAllByType('li').map((row) => row.children.join('')) ?? [];
    expect(shown.filter((text) => text !== 'none')).toEqual(['mxc://example.org/seven']);

    act(() => {
      renderer?.unmount();
    });
    expect(client.listenerCount(RoomStateEvent.Events)).toBe(0);
  });
});
