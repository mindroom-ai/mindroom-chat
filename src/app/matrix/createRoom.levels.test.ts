import { describe, expect, it, vi } from 'vitest';
import type { ICreateRoomOpts, MatrixClient } from 'matrix-js-sdk';
import { RoomType } from './types/room';
import { CreateRoomAccess } from './createRoomTypes';
import { createDirectRoom, createRoom, type CreateRoomData } from './createRoom';
import { defined } from '../../test/utils/defined';

const CALL_MEMBER = 'org.matrix.msc3401.call.member';

/** The `/createRoom` body the client sends for a room made one way. */
const requestOf = async (
  create: (client: MatrixClient) => Promise<string>
): Promise<ICreateRoomOpts> => {
  const send = vi.fn().mockResolvedValue({ room_id: '!new:calls.test' });
  const client = {
    createRoom: send,
    getAccountData: () => undefined,
    setAccountData: vi.fn().mockResolvedValue({}),
  } as unknown as MatrixClient;
  await create(client);
  return defined(send.mock.calls[0], 'a createRoom call')[0];
};

/** The `/createRoom` body `createRoom` sends for the form's data. */
const requestFor = (data: Partial<CreateRoomData>): Promise<ICreateRoomOpts> =>
  requestOf((client) =>
    createRoom(client, {
      name: 'Planning',
      access: CreateRoomAccess.Private,
      knock: false,
      allowFederation: true,
      version: '11',
      ...data,
    })
  );

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

// The room state MindRoom's agents and router publish in the rooms they join (backend
// `matrix/event_types.py`, `thread_tags.py` and `matrix/room_thread_mode.py`). They join a room
// with no power of their own, so each type needs level 0.
const AGENT_STATE = [
  'com.mindroom.thread.tags',
  'io.mindroom.accounts',
  'io.mindroom.auto_approve',
  'io.mindroom.background_jobs',
  'io.mindroom.server',
  'io.mindroom.thread_mode',
];

describe('createRoom agent state levels', () => {
  it.each([
    ['a private room from the Create Room form', () => requestFor({})],
    [
      'a public room from the Create Room form',
      () => requestFor({ access: CreateRoomAccess.Public }),
    ],
    ['a direct chat', () => requestOf((client) => createDirectRoom(client, '@friend:calls.test'))],
  ])(
    'opens only the agent state and call membership to members without power in %s',
    async (_name, request) => {
      const { events = {}, ...rest } = (await request()).power_level_content_override ?? {};
      expect(rest).toEqual({});
      const open = Object.keys(events).filter((type) => events[type] === 0);
      expect(open.sort()).toEqual([...AGENT_STATE, CALL_MEMBER].sort());
    }
  );
});
