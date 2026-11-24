import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { matchesEnum } from '../../lib/matchesEnum';
import { StateEvent } from '../../matrix/types/room';
import { addSpaceChild, moveSpaceRoom } from './spaceChildren';

type StateMap = Record<string, Record<string, Record<string, unknown>>>;

const makeRoom = (roomId: string, stateEvents: StateMap = {}, membership = 'join'): Room =>
  ({
    roomId,
    getMyMembership: () => membership,
    getLiveTimeline: () => ({
      getState: () => ({
        getMembers: () => [],
        getStateEvents: (type: string, stateKey?: string) => {
          const byKey = stateEvents[type];
          if (!byKey) return stateKey === undefined ? [] : null;
          if (stateKey !== undefined) {
            const content = byKey[stateKey];
            return content
              ? { getContent: () => content, getSender: () => '@alice:example.org' }
              : null;
          }
          return Object.entries(byKey).map(([key, content]) => ({
            getStateKey: () => key,
            getContent: () => content,
            getSender: () => '@alice:example.org',
          }));
        },
      }),
    }),
  } as unknown as Room);

const makeClient = (
  rooms: Record<string, Room>,
  sendStateEvent: (
    roomId: string,
    type: string,
    content: Record<string, unknown>,
    key: string
  ) => Promise<unknown> = vi.fn(async () => ({}))
) =>
  ({
    getRoom: (roomId: string) => rooms[roomId] ?? null,
    getSafeUserId: () => '@alice:example.org',
    getDomain: () => 'example.org',
    sendStateEvent,
  } as unknown as MatrixClient);

const powerLevels = {
  [StateEvent.RoomPowerLevels]: {
    '': { users: { '@alice:example.org': 100 }, state_default: 50 },
  },
};

describe('addSpaceChild and moveSpaceRoom', () => {
  it('defaults suggested to false in addSpaceChild and honors explicit suggested: true', async () => {
    const sendStateEvent = vi.fn(async () => ({}));
    const space = makeRoom('!space:example.org', powerLevels);
    const room = makeRoom('!room:example.org', powerLevels);
    const client = makeClient({ [space.roomId]: space, [room.roomId]: room }, sendStateEvent);

    await addSpaceChild(client, space, room.roomId);
    expect(sendStateEvent).toHaveBeenCalledWith(
      space.roomId,
      StateEvent.SpaceChild,
      { via: ['example.org'], suggested: false },
      room.roomId
    );

    sendStateEvent.mockClear();
    await addSpaceChild(client, space, room.roomId, { suggested: true });
    expect(sendStateEvent).toHaveBeenCalledWith(
      space.roomId,
      StateEvent.SpaceChild,
      { via: ['example.org'], suggested: true },
      room.roomId
    );
  });

  it('adds to target before removing from source, preserves suggested, and never touches join_rules', async () => {
    const calls: Array<{
      roomId: string;
      type: string;
      content: Record<string, unknown>;
      key: string;
    }> = [];
    const sendStateEvent = vi.fn(
      async (roomId: string, type: string, content: Record<string, unknown>, key: string) => {
        calls.push({ roomId, type, content, key });
      }
    );
    const source = makeRoom('!source:example.org', {
      ...powerLevels,
      [StateEvent.SpaceChild]: {
        '!room:example.org': { via: ['example.org'], suggested: true },
      },
    });
    const target = makeRoom('!target:example.org', powerLevels);
    const room = makeRoom('!room:example.org', {
      ...powerLevels,
      [StateEvent.SpaceParent]: { '!source:example.org': { via: ['example.org'] } },
    });
    const client = makeClient(
      { [source.roomId]: source, [target.roomId]: target, [room.roomId]: room },
      sendStateEvent
    );

    await moveSpaceRoom(client, source.roomId, target, room.roomId);

    const addIndex = calls.findIndex(
      (call) => call.roomId === target.roomId && matchesEnum(call.type, StateEvent.SpaceChild)
    );
    const removeIndex = calls.findIndex(
      (call) => call.roomId === source.roomId && matchesEnum(call.type, StateEvent.SpaceChild)
    );
    expect(addIndex).toBeGreaterThanOrEqual(0);
    expect(removeIndex).toBeGreaterThan(addIndex);
    expect(calls[addIndex]).toEqual({
      roomId: target.roomId,
      type: StateEvent.SpaceChild,
      content: { via: ['example.org'], suggested: true },
      key: room.roomId,
    });
    expect(calls[removeIndex]).toEqual({
      roomId: source.roomId,
      type: StateEvent.SpaceChild,
      content: {},
      key: room.roomId,
    });
    expect(calls.some((call) => matchesEnum(call.type, StateEvent.RoomJoinRules))).toBe(false);
  });

  it('does not remove from source when adding to target fails', async () => {
    const sendStateEvent = vi.fn(async () => {
      throw new Error('M_FORBIDDEN');
    });
    const source = makeRoom('!source:example.org', {
      [StateEvent.SpaceChild]: {
        '!room:example.org': { via: ['example.org'], suggested: false },
      },
    });
    const target = makeRoom('!target:example.org');
    const room = makeRoom('!room:example.org');
    const client = makeClient(
      { [source.roomId]: source, [target.roomId]: target, [room.roomId]: room },
      sendStateEvent
    );

    await expect(moveSpaceRoom(client, source.roomId, target, room.roomId)).rejects.toThrow(
      'M_FORBIDDEN'
    );
    expect(sendStateEvent).toHaveBeenCalledTimes(1);
    expect(sendStateEvent).toHaveBeenCalledWith(
      target.roomId,
      StateEvent.SpaceChild,
      { via: ['example.org'], suggested: false },
      room.roomId
    );
  });

  it('skips addSpaceChild if target already lists the room as a live child', async () => {
    const sendStateEvent = vi.fn(async () => ({}));
    const source = makeRoom('!source:example.org', {
      [StateEvent.SpaceChild]: {
        '!room:example.org': { via: ['example.org'], suggested: false },
      },
    });
    const target = makeRoom('!target:example.org', {
      [StateEvent.SpaceChild]: {
        '!room:example.org': { via: ['example.org'], suggested: false },
      },
    });
    const room = makeRoom('!room:example.org');
    const client = makeClient(
      { [source.roomId]: source, [target.roomId]: target, [room.roomId]: room },
      sendStateEvent
    );

    await moveSpaceRoom(client, source.roomId, target, room.roomId);

    expect(sendStateEvent).toHaveBeenCalledTimes(1);
    expect(sendStateEvent).toHaveBeenCalledWith(
      source.roomId,
      StateEvent.SpaceChild,
      {},
      room.roomId
    );
  });
});
