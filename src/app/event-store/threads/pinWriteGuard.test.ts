import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../matrix/types/room';
import { isThreadPinned, setRoomEventPinned } from './threadPinning';

// Two people pin at the same moment. Each client reads the room's pin list, adds its pin and
// writes the whole list back; the later write was made from a list without the earlier pin.
const me = '@me:example.org';
const other = '@other:example.org';

/** Lets a write that a sync event starts reach the server. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

let eventCount = 0;
/** A pin event from sync, with the list it replaced in `unsigned.prev_content` as the server sends it. */
const syncPins = (room: Room, sender: string, pinned: string[], before?: string[]) => {
  eventCount += 1;
  room.currentState.setStateEvents([
    new MatrixEvent({
      event_id: `$pins-${eventCount}`,
      type: StateEvent.RoomPinnedEvents,
      state_key: '',
      room_id: room.roomId,
      sender,
      content: { pinned },
      ...(before ? { unsigned: { prev_content: { pinned: before } } } : {}),
    }),
  ]);
};

/** A room both people may pin in, with no pins yet, and a server that keeps the last write. */
const makeRoom = () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: me });
  const room = new Room(`!room-${Math.random()}:example.org`, mx, me);
  room.currentState.setStateEvents([
    new MatrixEvent({
      type: StateEvent.RoomCreate,
      state_key: '',
      room_id: room.roomId,
      sender: other,
      content: { room_version: '11', creator: other },
    }),
    new MatrixEvent({
      type: StateEvent.RoomPowerLevels,
      state_key: '',
      room_id: room.roomId,
      content: { users: { [me]: 100, [other]: 100 }, state_default: 50 },
    }),
  ]);
  const server = { pins: [] as string[] };
  vi.spyOn(mx, 'getStateEvent').mockImplementation(async () => ({ pinned: server.pins }));
  const writes: string[][] = [];
  const send = vi.spyOn(mx, 'sendStateEvent').mockImplementation(async (_room, _type, content) => {
    server.pins = (content as { pinned: string[] }).pinned;
    writes.push(server.pins);
    return { event_id: `$write-${writes.length}` };
  });
  return { mx, room, server, writes, send };
};

describe('pins written at the same moment', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pins its own thread again when another write from an older list drops it', async () => {
    const { mx, room, server, writes } = makeRoom();
    await setRoomEventPinned(mx, room, '$mine', true);
    syncPins(room, me, ['$mine'], []);
    // The other person read the list before this pin landed.
    server.pins = ['$theirs'];
    syncPins(room, other, ['$theirs'], ['$mine']);
    await vi.waitFor(() => expect(writes).toEqual([['$mine'], ['$theirs', '$mine']]));
    expect(isThreadPinned(room, '$mine')).toBe(true);
    expect(isThreadPinned(room, '$theirs')).toBe(true);
  });

  it('pins the other thread again when its own write came from an older list', async () => {
    const { mx, room, server, writes, send } = makeRoom();
    let land!: () => void;
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    send.mockImplementationOnce(async (_room, _type, content) => {
      // The other pin lands and syncs between this client's read and its write.
      server.pins = ['$theirs'];
      syncPins(room, other, ['$theirs'], []);
      await landed;
      server.pins = (content as { pinned: string[] }).pinned;
      writes.push(server.pins);
      return { event_id: '$stale-write' };
    });
    const saving = setRoomEventPinned(mx, room, '$mine', true);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    land();
    await saving;
    syncPins(room, me, ['$mine'], ['$theirs']);
    await vi.waitFor(() => expect(writes).toEqual([['$mine'], ['$mine', '$theirs']]));
    expect(isThreadPinned(room, '$theirs')).toBe(true);
  });

  it('leaves an unpin of its pin alone when the other person saw the pin', async () => {
    const { mx, room, server, writes } = makeRoom();
    await setRoomEventPinned(mx, room, '$mine', true);
    syncPins(room, me, ['$mine'], []);
    server.pins = [];
    syncPins(room, other, [], ['$mine']);
    await settle();
    expect(writes).toEqual([['$mine']]);
    expect(isThreadPinned(room, '$mine')).toBe(false);
  });

  it('leaves a write that landed before its own alone when sync brings it later', async () => {
    const { mx, room, server, writes } = makeRoom();
    server.pins = ['$theirs'];
    await setRoomEventPinned(mx, room, '$mine', true);
    syncPins(room, other, ['$theirs'], []);
    syncPins(room, me, ['$theirs', '$mine'], ['$theirs']);
    await settle();
    expect(writes).toEqual([['$theirs', '$mine']]);
  });

  it('stops guarding a pin half a minute after it was saved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { mx, room, server, writes } = makeRoom();
    await setRoomEventPinned(mx, room, '$mine', true);
    syncPins(room, me, ['$mine'], []);
    vi.setSystemTime(Date.now() + 31_000);
    server.pins = ['$theirs'];
    syncPins(room, other, ['$theirs'], ['$mine']);
    await settle();
    expect(writes).toEqual([['$mine']]);
  });
});
