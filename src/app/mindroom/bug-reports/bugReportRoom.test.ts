import { describe, expect, it, vi } from 'vitest';
import { ensureBugReportRoom } from './bugReportRoom';

const room = (roomId: string, myMembership: string, members: Record<string, string> = {}) => ({
  roomId,
  getMyMembership: () => myMembership,
  getMember: (userId: string) => (members[userId] ? { membership: members[userId] } : null),
});

const client = (opts: {
  storedRoomId?: string;
  rooms?: Record<string, ReturnType<typeof room>>;
}) => {
  const rooms = { ...(opts.rooms ?? {}) };
  const mx = {
    getSafeUserId: () => '@alice:example.com',
    getUserId: () => '@alice:example.com',
    getUser: () => ({ displayName: 'Alice' }),
    getAccountData: vi.fn(() =>
      opts.storedRoomId ? { getContent: () => ({ room_id: opts.storedRoomId }) } : undefined
    ),
    setAccountData: vi.fn(async () => ({})),
    getRoom: vi.fn((roomId: string) => rooms[roomId] ?? null),
    invite: vi.fn(async () => ({})),
    createRoom: vi.fn(async () => {
      rooms['!new:example.com'] = room('!new:example.com', 'join');
      return { room_id: '!new:example.com' };
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return mx;
};

describe('ensureBugReportRoom', () => {
  it('reuses the stored room and invites only admins who are not already there', async () => {
    const stored = room('!stored:example.com', 'join', {
      '@admin:example.com': 'join',
      '@ops:example.com': 'leave',
    });
    const mx = client({
      storedRoomId: '!stored:example.com',
      rooms: { '!stored:example.com': stored },
    });
    const result = await ensureBugReportRoom(mx as never, [
      '@admin:example.com',
      '@ops:example.com',
    ]);
    expect(result).toBe(stored);
    expect(mx.createRoom).not.toHaveBeenCalled();
    expect(mx.invite).toHaveBeenCalledTimes(1);
    expect(mx.invite).toHaveBeenCalledWith('!stored:example.com', '@ops:example.com');
  });

  it('creates a private, typed, unencrypted room when the stored room was left', async () => {
    const mx = client({
      storedRoomId: '!old:example.com',
      rooms: { '!old:example.com': room('!old:example.com', 'leave') },
    });
    const result = await ensureBugReportRoom(mx as never, [
      '@admin:example.com',
      '@alice:example.com',
    ]);
    expect(result.roomId).toBe('!new:example.com');
    const request = mx.createRoom.mock.calls[0][0] as Record<string, unknown>;
    expect(request).toMatchObject({
      name: 'Bug reports · Alice',
      preset: 'private_chat',
      visibility: 'private',
      invite: ['@admin:example.com'],
      creation_content: { type: 'io.mindroom.bug_reports' },
    });
    expect(JSON.stringify(request)).not.toContain('m.room.encryption');
    expect(mx.setAccountData).toHaveBeenCalledWith('io.mindroom.bug_reports', {
      room_id: '!new:example.com',
    });
  });

  it('shares one in-flight lookup so concurrent reports create one room', async () => {
    const mx = client({});
    const [first, second] = await Promise.all([
      ensureBugReportRoom(mx as never, ['@admin:example.com']),
      ensureBugReportRoom(mx as never, ['@admin:example.com']),
    ]);
    expect(first).toBe(second);
    expect(mx.createRoom).toHaveBeenCalledTimes(1);
  });
});
