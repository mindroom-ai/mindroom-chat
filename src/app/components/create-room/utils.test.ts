import { MatrixClient, Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateEvent } from '../../../types/matrix/room';
import { CreateRoomAccess } from './types';
import { CreateRoomData, createRoom } from './utils';

const makeParent = (userPower: number) => {
  const powerEvent = {
    getContent: () => ({ users: { '@me:example.org': userPower }, state_default: 50 }),
  };
  return {
    roomId: '!space:example.org',
    getMembers: () => [],
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (type: StateEvent) =>
          type === StateEvent.RoomPowerLevels ? powerEvent : undefined,
      }),
    }),
  } as unknown as Room;
};

const makeData = (parent: Room): CreateRoomData => ({
  version: '10',
  parent,
  access: CreateRoomAccess.Private,
  name: 'Project',
  knock: false,
  allowFederation: true,
});

describe('createRoom Space permission preflight', () => {
  const createRoomRequest = vi.fn();
  const sendStateEvent = vi.fn();
  let mx: MatrixClient;

  beforeEach(() => {
    createRoomRequest.mockReset();
    sendStateEvent.mockReset();
    createRoomRequest.mockResolvedValue({ room_id: '!created:example.org' });
    sendStateEvent.mockResolvedValue(undefined);
    mx = {
      getSafeUserId: () => '@me:example.org',
      getUserId: () => '@me:example.org',
      getRoom: (roomId: string) => (roomId === '!space:example.org' ? makeParent(0) : null),
      createRoom: createRoomRequest,
      sendStateEvent,
    } as unknown as MatrixClient;
  });

  it('rejects before creating when m.space.child permission is missing', async () => {
    await expect(createRoom(mx, makeData(makeParent(0)))).rejects.toThrow('Missing permission');
    expect(createRoomRequest).not.toHaveBeenCalled();
    expect(sendStateEvent).not.toHaveBeenCalled();
  });

  it('creates and links the room when permission is present', async () => {
    mx.getRoom = (roomId: string) => (roomId === '!space:example.org' ? makeParent(100) : null);
    await expect(createRoom(mx, makeData(makeParent(100)))).resolves.toBe('!created:example.org');
    expect(createRoomRequest).toHaveBeenCalledOnce();
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!space:example.org',
      StateEvent.SpaceChild,
      expect.objectContaining({ auto_join: false, suggested: false }),
      '!created:example.org'
    );
  });
});
