import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createStore, Provider } from 'jotai';
import { RoomEvent } from 'matrix-js-sdk';
import { useDirectRooms } from './useDirectRooms';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { mDirectAtom } from '../../../state/mDirectList';

const { client } = vi.hoisted(() => ({ client: { current: undefined as unknown } }));
vi.mock('../../../hooks/useMatrixClient', () => ({ useMatrixClient: () => client.current }));

type FakeRoom = { roomId: string; lastActive: number; getLastActiveTimestamp: () => number };

const fakeRoom = (roomId: string, lastActive: number): FakeRoom => {
  const room: FakeRoom = { roomId, lastActive, getLastActiveTimestamp: () => room.lastActive };
  return room;
};

describe('useDirectRooms', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const setup = () => {
    const rooms = new Map(
      [fakeRoom('!ada', 3000), fakeRoom('!bo', 2000), fakeRoom('!cy', 1000)].map((room) => [
        room.roomId,
        room,
      ])
    );
    const emitter = new EventEmitter();
    client.current = Object.assign(emitter, { getRoom: (roomId: string) => rooms.get(roomId) });
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: ['!ada', '!bo', '!cy', '!group'] });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set(['!ada', '!bo', '!cy']) });

    const orders: string[][] = [];
    function Probe() {
      orders.push(useDirectRooms().map((room) => room.roomId));
      return null;
    }
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Probe />
        </Provider>
      );
    });
    const message = (roomId: string, ts: number, live = true) =>
      act(() => {
        const room = rooms.get(roomId)!;
        room.lastActive = ts;
        emitter.emit(RoomEvent.Timeline, {}, room, false, false, { liveEvent: live });
      });
    return { orders, message };
  };

  it('moves a conversation to the top when a new message arrives in it', () => {
    const { orders, message } = setup();
    expect(orders.at(-1)).toEqual(['!ada', '!bo', '!cy']);

    message('!cy', 4000);

    expect(orders.at(-1)).toEqual(['!cy', '!ada', '!bo']);
  });

  it('does not re-render for messages that leave the order as it is', () => {
    const { orders, message } = setup();
    const renders = orders.length;

    message('!ada', 5000);
    message('!ada', 5001);

    expect(orders).toHaveLength(renders);
  });

  it('ignores older messages loaded from history', () => {
    const { orders, message } = setup();
    const renders = orders.length;

    message('!cy', 9000, false);

    expect(orders).toHaveLength(renders);
  });
});
