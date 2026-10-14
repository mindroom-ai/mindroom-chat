import { MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { acceptInvites } from './acceptInvite';

vi.mock('../../../utils/room', () => ({
  isDirectInvite: (room: { direct?: boolean }) => room.direct === true,
}));

vi.mock('../../../utils/matrix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/matrix')>()),
  guessDmRoomUserId: () => '@friend:example.org',
  addRoomIdToMDirect: vi.fn(),
}));

const { addRoomIdToMDirect } = vi.mocked(await import('../../../utils/matrix'));

const room = (roomId: string, direct = false) => ({ roomId, direct } as unknown as Room);

describe('acceptInvites', () => {
  it('joins every invite, records DMs, and keeps going after a failed join', async () => {
    const joinRoom = vi.fn(async (roomId: string) => {
      if (roomId === '!broken:example.org') throw new Error('join failed');
    });
    const mx = { getSafeUserId: () => '@me:example.org', joinRoom } as unknown as MatrixClient;

    await acceptInvites(mx, [
      room('!a:example.org'),
      room('!broken:example.org'),
      room('!dm:example.org', true),
    ]);

    expect(joinRoom.mock.calls.map(([roomId]) => roomId)).toEqual([
      '!a:example.org',
      '!broken:example.org',
      '!dm:example.org',
    ]);
    expect(addRoomIdToMDirect).toHaveBeenCalledTimes(1);
    expect(addRoomIdToMDirect).toHaveBeenCalledWith(mx, '!dm:example.org', '@friend:example.org');
  });
});
