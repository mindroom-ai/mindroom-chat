import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { categorizeInvite } from './inviteFilter';

type FakeRoom = { membership: string; members: Record<string, string> };

const clientWith = (rooms: FakeRoom[], direct: Record<string, string[]> = {}): MatrixClient =>
  ({
    getAccountData: (type: string) =>
      type === 'm.direct' ? { getContent: () => direct } : undefined,
    getRooms: () =>
      rooms.map((room) => ({
        getMyMembership: () => room.membership,
        getMember: (userId: string) =>
          room.members[userId] ? { membership: room.members[userId] } : null,
      })),
  } as unknown as MatrixClient);

describe('categorizeInvite', () => {
  it('puts spam first, whoever sent it', () => {
    const mx = clientWith([], { '@maya:example.org': ['!dm:example.org'] });
    expect(categorizeInvite(mx, { senderId: '@maya:example.org' }, true)).toBe('spam');
  });

  it('counts an inviter with a direct chat as known', () => {
    const mx = clientWith([], { '@maya:example.org': ['!dm:example.org'] });
    expect(categorizeInvite(mx, { senderId: '@maya:example.org' }, false)).toBe('primary');
  });

  it('counts an inviter who shares a joined room as known', () => {
    const mx = clientWith([{ membership: 'join', members: { '@maya:example.org': 'join' } }]);
    expect(categorizeInvite(mx, { senderId: '@maya:example.org' }, false)).toBe('primary');
  });

  it('treats anyone else as public, including members of rooms the user only was invited to', () => {
    const mx = clientWith([
      { membership: 'invite', members: { '@mallory:evil.example': 'join' } },
      { membership: 'join', members: { '@mallory:evil.example': 'leave' } },
    ]);
    expect(categorizeInvite(mx, { senderId: '@mallory:evil.example' }, false)).toBe('public');
    expect(categorizeInvite(mx, {}, false)).toBe('public');
  });
});
