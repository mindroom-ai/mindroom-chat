import { EventEmitter } from 'events';
import { Provider, createStore } from 'jotai';
import {
  ClientEvent,
  KnownMembership,
  RoomEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { createRoomListAtom } from './utils';
import { useBindAllRoomsAtom } from './roomList';

const roomsAtom = createRoomListAtom();

function Bind({ mx }: { mx: MatrixClient }) {
  useBindAllRoomsAtom(mx, roomsAtom);
  return null;
}

/** A client whose store holds the rooms in `stored`. */
const makeClient = () => {
  const stored = new Map<string, Room>();
  const emitter = new EventEmitter();
  const mx = Object.assign(emitter, {
    getRooms: () => [...stored.values()],
    getRoom: (roomId: string) => stored.get(roomId) ?? null,
  }) as unknown as MatrixClient;
  return { mx, emitter, stored };
};

const joinedRoom = (roomId: string) =>
  ({ roomId, getMyMembership: () => KnownMembership.Join } as unknown as Room);

describe('useBindAllRoomsAtom', () => {
  it('lists a room the first sync brings once the client has stored it', async () => {
    const { mx, emitter, stored } = makeClient();
    const store = createStore();
    await act(async () => {
      create(
        <Provider store={store}>
          <Bind mx={mx} />
        </Provider>
      );
    });

    // The sync works out the membership of a new room before it stores the room, and may wait
    // for the server in between: a listed room the client cannot give yet shows as an empty row.
    const room = joinedRoom('!shared:example.org');
    await act(async () => {
      emitter.emit(RoomEvent.MyMembership, room, KnownMembership.Join);
    });
    expect(store.get(roomsAtom)).toEqual([]);

    stored.set(room.roomId, room);
    await act(async () => {
      emitter.emit(ClientEvent.Room, room);
    });
    expect(store.get(roomsAtom)).toEqual(['!shared:example.org']);
  });
});
