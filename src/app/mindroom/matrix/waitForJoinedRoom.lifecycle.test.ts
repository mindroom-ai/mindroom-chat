import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { waitForJoinedRoom } from './waitForJoinedRoom';

const fakeClient = () => {
  const rooms = new Map<string, Room>();
  const emitter = new EventEmitter();
  const mx = {
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
  } as unknown as MatrixClient;
  return { mx, rooms, emitter };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForJoinedRoom before and after sync', () => {
  it('answers at once for a room the client already has', async () => {
    const { mx, rooms, emitter } = fakeClient();
    const room = { roomId: '!call:example.org' } as Room;
    rooms.set(room.roomId, room);
    await expect(waitForJoinedRoom(mx, room.roomId)).resolves.toBe(room);
    expect(emitter.listenerCount(ClientEvent.Room)).toBe(0);
  });

  it('ignores other rooms that arrive meanwhile', async () => {
    const { mx, emitter } = fakeClient();
    const waiting = waitForJoinedRoom(mx, '!call:example.org');
    emitter.emit(ClientEvent.Room, { roomId: '!other:example.org' });
    const room = { roomId: '!call:example.org' } as Room;
    emitter.emit(ClientEvent.Room, room);
    await expect(waiting).resolves.toBe(room);
  });

  it('gives up when the room never arrives, and stops listening', async () => {
    vi.useFakeTimers();
    const { mx, emitter } = fakeClient();
    const waiting = waitForJoinedRoom(mx, '!call:example.org', 1000);
    const failed = expect(waiting).rejects.toThrow('did not become available');
    vi.advanceTimersByTime(1000);
    await failed;
    expect(emitter.listenerCount(ClientEvent.Room)).toBe(0);
  });
});
