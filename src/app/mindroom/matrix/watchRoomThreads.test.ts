import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ClientEvent, ThreadEvent, type MatrixClient, type Room, type Thread } from 'matrix-js-sdk';
import { watchRoomThreads } from './watchRoomThreads';

const roomWith = (roomId: string, threads: Thread[] = []) =>
  Object.assign(new EventEmitter(), { roomId, getThreads: () => threads }) as unknown as Room &
    EventEmitter;

const clientWith = (rooms: Room[]) =>
  Object.assign(new EventEmitter(), { getRooms: () => rooms }) as unknown as MatrixClient &
    EventEmitter;

const thread = (id: string) => ({ id } as Thread);

describe('watchRoomThreads', () => {
  it("passes on the threads rooms hold, then each new or updated one, with the thread's room", () => {
    const first = thread('$first');
    const known = roomWith('!known', [first]);
    const mx = clientWith([known]);
    const onThread = vi.fn();
    const stop = watchRoomThreads(mx, { onThread });
    expect(onThread).toHaveBeenCalledWith(known, first);

    const later = roomWith('!later');
    mx.emit(ClientEvent.Room, later);
    const second = thread('$second');
    later.emit(ThreadEvent.New, second);
    known.emit(ThreadEvent.Update, first);

    expect(onThread.mock.calls).toEqual([
      [known, first],
      [later, second],
      [known, first],
    ]);
    stop();
  });

  it('sets up a room once, and lets go of it when the account forgets it', () => {
    const room = roomWith('!forgotten');
    const mx = clientWith([room]);
    const removeRoomListeners = vi.fn();
    const onRoom = vi.fn(() => removeRoomListeners);
    const stop = watchRoomThreads(mx, { onThread: vi.fn(), onRoom });
    mx.emit(ClientEvent.Room, room);
    expect(onRoom).toHaveBeenCalledTimes(1);

    mx.emit(ClientEvent.DeleteRoom, '!forgotten');

    expect(room.listenerCount(ThreadEvent.New)).toBe(0);
    expect(room.listenerCount(ThreadEvent.Update)).toBe(0);
    expect(removeRoomListeners).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops listening to the client and every room', () => {
    const room = roomWith('!room');
    const mx = clientWith([room]);
    const stop = watchRoomThreads(mx, { onThread: vi.fn() });

    stop();

    expect(room.listenerCount(ThreadEvent.Update)).toBe(0);
    expect(mx.listenerCount(ClientEvent.Room)).toBe(0);
    expect(mx.listenerCount(ClientEvent.DeleteRoom)).toBe(0);
  });
});
