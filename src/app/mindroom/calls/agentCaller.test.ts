// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { waitForJoinedRoom } from './agentCaller';

const joinedRoom = (roomId: string) =>
  ({ roomId, getMyMembership: () => 'join' } as unknown as Room);

const fakeClient = () => {
  const rooms = new Map<string, Room>();
  const emitter = new EventEmitter();
  const mx = {
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
  } as unknown as MatrixClient;
  return { mx, rooms, emitter };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForJoinedRoom', () => {
  it('answers at once for a room the client already joined', async () => {
    const { mx, rooms } = fakeClient();
    rooms.set('!call:example.org', joinedRoom('!call:example.org'));
    await expect(waitForJoinedRoom(mx, '!call:example.org')).resolves.toMatchObject({
      roomId: '!call:example.org',
    });
  });

  it('waits for sync to bring the new call room, then stops listening', async () => {
    const { mx, rooms, emitter } = fakeClient();
    const waiting = waitForJoinedRoom(mx, '!call:example.org');
    emitter.emit(ClientEvent.Sync);
    rooms.set('!call:example.org', joinedRoom('!call:example.org'));
    emitter.emit(ClientEvent.Room);
    await expect(waiting).resolves.toMatchObject({ roomId: '!call:example.org' });
    expect(emitter.listenerCount(ClientEvent.Room)).toBe(0);
    expect(emitter.listenerCount(ClientEvent.Sync)).toBe(0);
  });

  it('gives up when the room never arrives', async () => {
    vi.useFakeTimers();
    const { mx, emitter } = fakeClient();
    const waiting = waitForJoinedRoom(mx, '!call:example.org', 1000);
    const failed = expect(waiting).rejects.toThrow('did not arrive');
    vi.advanceTimersByTime(1000);
    await failed;
    expect(emitter.listenerCount(ClientEvent.Room)).toBe(0);
  });
});
