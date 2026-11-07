import { describe, expect, it, vi } from 'vitest';
import type { ICreateRoomOpts, MatrixClient } from 'matrix-js-sdk';
import { CreateRoomAccess } from './createRoomTypes';
import { createDirectRoom, createRoom } from './createRoom';
import { defined } from '../../test/utils/defined';

// The room state MindRoom's agents and router publish in the rooms they join (backend
// `matrix/event_types.py`, `thread_tags.py` and `matrix/room_thread_mode.py`). They join a room
// with no power of their own, so each type needs level 0.
const AGENT_STATE = [
  'com.mindroom.thread.tags',
  'io.mindroom.auto_approve',
  'io.mindroom.background_jobs',
  'io.mindroom.server',
  'io.mindroom.thread_mode',
];
const CALL_MEMBER = 'org.matrix.msc3401.call.member';

/** The `/createRoom` body the client sends for a room made one way. */
const requestOf = async (
  create: (client: MatrixClient) => Promise<string>
): Promise<ICreateRoomOpts> => {
  const send = vi.fn().mockResolvedValue({ room_id: '!new:agents.test' });
  const client = {
    createRoom: send,
    getAccountData: () => undefined,
    setAccountData: vi.fn().mockResolvedValue({}),
  } as unknown as MatrixClient;
  await create(client);
  return defined(send.mock.calls[0], 'a createRoom call')[0];
};

const formRoom = (access: CreateRoomAccess) => (client: MatrixClient) =>
  createRoom(client, { name: 'Planning', access, knock: false, allowFederation: true });

const ROOMS: Array<[string, (client: MatrixClient) => Promise<string>]> = [
  ['a private room from the Create Room form', formRoom(CreateRoomAccess.Private)],
  ['a public room from the Create Room form', formRoom(CreateRoomAccess.Public)],
  ['a direct chat', (client) => createDirectRoom(client, '@friend:agents.test')],
];

describe('createRoom agent state levels', () => {
  it.each(ROOMS)('lets agents without power publish their state in %s', async (_name, create) => {
    const events = (await requestOf(create)).power_level_content_override?.events ?? {};
    expect(AGENT_STATE.filter((type) => events[type] !== 0)).toEqual([]);
  });

  it.each(ROOMS)('opens no other state to members without power in %s', async (_name, create) => {
    const { power_level_content_override: override } = await requestOf(create);
    const { events = {}, ...rest } = override ?? {};
    expect(rest).toEqual({});
    const open = Object.keys(events).filter((type) => events[type] === 0);
    expect(open.sort()).toEqual([...AGENT_STATE, CALL_MEMBER].sort());
  });
});
