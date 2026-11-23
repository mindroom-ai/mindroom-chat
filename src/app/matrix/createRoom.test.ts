import {
  createClient,
  MatrixClient,
  MatrixError,
  MatrixEvent,
  MemoryStore,
  Room,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { RoomType } from './types/room';
import { CreateRoomAccess } from './createRoomTypes';
import { createRoom, ensureActiveRunsPowerLevel, type CreateRoomData } from './createRoom';

describe('createRoom', () => {
  it.each([
    ['11', 100],
    ['12', 150],
  ])(
    'keeps the server pinned power levels in a version %s voice room',
    async (version, tombstone) => {
      const mx = {
        createRoom: vi.fn().mockResolvedValue({ room_id: '!voice:mindroom.test' }),
      } as any;

      await createRoom(mx, {
        version,
        type: RoomType.Call,
        access: CreateRoomAccess.Private,
        name: 'Voice',
        knock: false,
        allowFederation: true,
      });

      expect(mx.createRoom.mock.calls[0][0].power_level_content_override).toEqual({
        events: {
          'm.room.power_levels': 100,
          'm.room.server_acl': 100,
          'm.room.encryption': 100,
          'm.room.history_visibility': 100,
          'm.room.tombstone': tombstone,
          'org.matrix.msc3401.call.member': 0,
          'io.mindroom.server': 0,
          'io.mindroom.background_jobs': 0,
          'io.mindroom.active_runs': 0,
          'io.mindroom.auto_approve': 0,
          'io.mindroom.accounts': 0,
          'com.mindroom.thread.tags': 0,
          'io.mindroom.thread_mode': 0,
        },
      });
    }
  );

  const NEW_ROOM = '!new:mindroom.test';

  /**
   * A space whose server creates `NEW_ROOM` and fails to list it there with `failure`, by default a
   * refusal; leaving and forgetting the room succeed.
   */
  const linkFailing = (
    failure: Error = new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Not allowed' }, 403)
  ) => {
    const mx = new MatrixClient({
      baseUrl: 'https://mindroom.test',
      userId: '@me:mindroom.test',
      store: new MemoryStore(),
    });
    vi.spyOn(mx, 'createRoom').mockResolvedValue({ room_id: NEW_ROOM });
    vi.spyOn(mx, 'sendStateEvent').mockRejectedValue(failure);
    const leave = vi.spyOn(mx, 'leave').mockResolvedValue({});
    const forget = vi.spyOn(mx, 'forget').mockResolvedValue({});
    const space = new Room('!space:mindroom.test', mx, '@me:mindroom.test');
    const create = (data: Partial<CreateRoomData> = {}) =>
      createRoom(mx, {
        name: 'Plans',
        parent: space,
        access: CreateRoomAccess.Restricted,
        knock: false,
        allowFederation: true,
        ...data,
      });
    return { failure, leave, forget, create };
  };

  it.each([
    ['a room, as Create Room makes in a space,', undefined],
    ['a space, as Create Space makes in a space,', RoomType.Space],
  ])(
    'leaves and forgets %s that the space does not list, and rejects with the failure',
    async (_, type) => {
      const { failure, leave, forget, create } = linkFailing();

      await expect(create({ type })).rejects.toBe(failure);

      expect(leave).toHaveBeenCalledWith(NEW_ROOM);
      expect(forget).toHaveBeenCalledWith(NEW_ROOM);
      expect(forget.mock.invocationCallOrder[0]).toBeGreaterThan(
        leave.mock.invocationCallOrder[0]!
      );
    }
  );

  it.each<[string, Error | undefined, Partial<CreateRoomData>]>([
    // After any of the first three, the server may still list the room.
    ['no answer came', new Error('Failed to fetch'), {}],
    ['the error has no status', new MatrixError({ errcode: 'M_UNKNOWN', error: 'Unknown' }), {}],
    [
      'the server failed',
      new MatrixError({ errcode: 'M_UNKNOWN', error: 'Gateway timeout' }, 504),
      {},
    ],
    [
      'it is public, where anyone finds it and its address would stay taken',
      undefined,
      { access: CreateRoomAccess.Public, aliasLocalPart: 'plans' },
    ],
  ])('keeps the room, and rejects with the failure, when %s', async (_, linkFailure, data) => {
    const { failure, leave, create } = linkFailing(linkFailure);

    await expect(create(data)).rejects.toBe(failure);
    expect(leave).not.toHaveBeenCalled();
  });

  it('rejects with the failure, forgetting nothing, when it cannot leave the room either', async () => {
    const { failure, leave, forget, create } = linkFailing();
    leave.mockRejectedValue(new Error('offline'));

    await expect(create()).rejects.toBe(failure);
    expect(forget).not.toHaveBeenCalled();
  });

  it('rejects with the failure when it cannot forget the room it left', async () => {
    const { failure, forget, create } = linkFailing();
    forget.mockRejectedValue(new Error('offline'));

    await expect(create()).rejects.toBe(failure);
    expect(forget).toHaveBeenCalledWith(NEW_ROOM);
  });
});

describe('ensureActiveRunsPowerLevel', () => {
  const ME = '@me:example.org';
  const makeRoomWithLevels = async (
    roomId: string,
    powerLevels: Record<string, unknown>,
    mx: ReturnType<typeof createClient>
  ) => {
    const room = new Room(roomId, mx, ME, { timelineSupport: true });
    await room.addLiveEvents(
      [
        new MatrixEvent({
          event_id: `$pl_${roomId}`,
          room_id: roomId,
          sender: ME,
          state_key: '',
          type: 'm.room.power_levels',
          origin_server_ts: 1_000,
          content: powerLevels,
        }),
      ],
      { addToState: true }
    );
    return room;
  };

  it('upgrades an existing MindRoom room once per session when the viewer can edit power levels', async () => {
    const mx = createClient({ baseUrl: 'https://example.org', userId: ME });
    const sendStateEvent = vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$ok' });
    const room = await makeRoomWithLevels(
      '!upgrade:example.org',
      {
        users: { [ME]: 100 },
        events: { 'io.mindroom.background_jobs': 0, 'm.room.power_levels': 100 },
      },
      mx
    );

    await expect(ensureActiveRunsPowerLevel(mx, room)).resolves.toBe(true);
    expect(sendStateEvent).toHaveBeenCalledTimes(1);
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!upgrade:example.org',
      'm.room.power_levels',
      {
        users: { [ME]: 100 },
        events: {
          'io.mindroom.background_jobs': 0,
          'm.room.power_levels': 100,
          'io.mindroom.active_runs': 0,
        },
      },
      ''
    );

    // Second call in the same client session is a no-op.
    await expect(ensureActiveRunsPowerLevel(mx, room)).resolves.toBe(false);
    expect(sendStateEvent).toHaveBeenCalledTimes(1);
  });

  it('preserves explicit active_runs overrides, skips non-MindRoom rooms, and skips without permission', async () => {
    const mx = createClient({ baseUrl: 'https://example.org', userId: ME });
    const sendStateEvent = vi.spyOn(mx, 'sendStateEvent').mockResolvedValue({ event_id: '$ok' });

    const overridden = await makeRoomWithLevels(
      '!override:example.org',
      {
        users: { [ME]: 100 },
        events: { 'io.mindroom.background_jobs': 0, 'io.mindroom.active_runs': 50 },
      },
      mx
    );
    const nonMindroom = await makeRoomWithLevels(
      '!plain:example.org',
      { users: { [ME]: 100 }, events: { 'm.room.power_levels': 100 } },
      mx
    );
    const noPermission = await makeRoomWithLevels(
      '!noperm:example.org',
      {
        users: { [ME]: 0, '@admin:example.org': 100 },
        events: { 'io.mindroom.background_jobs': 0, 'm.room.power_levels': 100 },
      },
      mx
    );

    await expect(ensureActiveRunsPowerLevel(mx, overridden)).resolves.toBe(false);
    await expect(ensureActiveRunsPowerLevel(mx, nonMindroom)).resolves.toBe(false);
    await expect(ensureActiveRunsPowerLevel(mx, noPermission)).resolves.toBe(false);
    expect(sendStateEvent).not.toHaveBeenCalled();
  });
});
