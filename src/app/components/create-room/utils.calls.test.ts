import { describe, expect, it, vi } from 'vitest';
import type { ICreateRoomOpts, MatrixClient } from 'matrix-js-sdk';
import { RoomType } from '../../../types/matrix/room';
import { CreateRoomAccess } from './types';
import { createRoom, type CreateRoomData } from './utils';

const CALL_MEMBER = 'org.matrix.msc3401.call.member';

/** The `/createRoom` body `createRoom` sends for the form's data. */
const requestFor = async (data: Partial<CreateRoomData>): Promise<ICreateRoomOpts> => {
  const send = vi.fn().mockResolvedValue({ room_id: '!new:calls.test' });
  await createRoom({ createRoom: send } as unknown as MatrixClient, {
    name: 'Planning',
    access: CreateRoomAccess.Private,
    knock: false,
    allowFederation: true,
    version: '11',
    ...data,
  });
  return send.mock.calls[0][0];
};

describe('createRoom call membership level', () => {
  it.each([
    ['a private room', { access: CreateRoomAccess.Private }],
    ['a public room', { access: CreateRoomAccess.Public }],
    ['an encrypted room', { encryption: true }],
    ['a voice room', { type: RoomType.Call }],
  ])('lets every member of %s join its calls', async (_name, data) => {
    const request = await requestFor(data);
    const events = request.power_level_content_override?.events as Record<string, number>;
    expect(events[CALL_MEMBER]).toBe(0);
    // The override replaces the server's events map, so the pinned levels stay.
    expect(events['m.room.power_levels']).toBe(100);
    expect(events['m.room.encryption']).toBe(100);
  });

  it('keeps the upgrade level a version 12 server pins', async () => {
    const request = await requestFor({ version: '12' });
    expect(request.power_level_content_override?.events?.['m.room.tombstone']).toBe(150);
  });

  it('leaves the levels of a space to the server', async () => {
    const request = await requestFor({ type: RoomType.Space });
    expect(request.power_level_content_override).toBeUndefined();
  });
});
