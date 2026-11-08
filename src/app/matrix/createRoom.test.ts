import { MatrixClient, MatrixError, MemoryStore, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { RoomType } from './types/room';
import { CreateRoomAccess } from './createRoomTypes';
import { createRoom } from './createRoom';

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
          'io.mindroom.auto_approve': 0,
          'com.mindroom.thread.tags': 0,
          'io.mindroom.thread_mode': 0,
        },
      });
    }
  );

  /**
   * A space whose server creates `!new:mindroom.test` and refuses to list it there; `leave` and
   * `forget` succeed unless `leaveFails`.
   */
  const refusingSpace = (leaveFails = false) => {
    const mx = new MatrixClient({
      baseUrl: 'https://mindroom.test',
      userId: '@me:mindroom.test',
      store: new MemoryStore(),
    });
    const refusal = new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Not allowed' }, 403);
    vi.spyOn(mx, 'createRoom').mockResolvedValue({ room_id: '!new:mindroom.test' });
    vi.spyOn(mx, 'sendStateEvent').mockRejectedValue(refusal);
    const leave = vi.spyOn(mx, 'leave');
    if (leaveFails) leave.mockRejectedValue(new Error('offline'));
    else leave.mockResolvedValue({});
    const forget = vi.spyOn(mx, 'forget').mockResolvedValue({});
    const space = new Room('!space:mindroom.test', mx, '@me:mindroom.test');
    const create = (type?: RoomType) =>
      createRoom(mx, {
        type,
        name: 'Plans',
        parent: space,
        access: CreateRoomAccess.Restricted,
        knock: false,
        allowFederation: true,
      });
    return { refusal, leave, forget, create };
  };

  it.each([
    ['a room, as Create Room makes in a space,', undefined],
    ['a space, as Create Space makes in a space,', RoomType.Space],
  ])(
    'leaves and forgets %s that the space does not list, and says it was not created',
    async (_, type) => {
      const { refusal, leave, forget, create } = refusingSpace();

      const created = create(type);

      await expect(created).rejects.toThrow(
        "Plans was not created, because it couldn't be listed under !space:mindroom.test. You don't have permission to do this."
      );
      await expect(created).rejects.toMatchObject({ cause: refusal });
      expect(leave).toHaveBeenCalledWith('!new:mindroom.test');
      expect(forget).toHaveBeenCalledWith('!new:mindroom.test');
      expect(forget.mock.invocationCallOrder[0]).toBeGreaterThan(
        leave.mock.invocationCallOrder[0]!
      );
    }
  );

  it("keeps the link's error when it cannot leave the room it could not list either", async () => {
    const { refusal, forget, create } = refusingSpace(true);

    await expect(create()).rejects.toBe(refusal);
    expect(forget).not.toHaveBeenCalled();
  });
});
