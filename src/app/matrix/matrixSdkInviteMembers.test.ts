import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';

// An invite brings the inviter's member event as stripped state, without an event ID. After the
// join, a lazy-loading /sync names only the senders of its own timeline, often just the reader,
// so the members come from /members. The SDK kept the stripped copy as if sync had sent it: the
// loaded member did not replace it, was not marked as loaded on its own, and so was not stored.
// The next start, which has no stripped state, lost the inviter: missing from the members list,
// named by localpart, a direct chat titled with the raw user ID (live-test finding
// P2-lane5-F004). Our SDK patch lets a loaded member replace a copy without an event ID.

const ROOM = '!room:example.org';
const READER = '@reader:example.org';
const HOST = '@host:example.org';

const member = (userId: string, membership: string, displayname: string, eventId?: string) =>
  new MatrixEvent({
    ...(eventId ? { event_id: eventId, origin_server_ts: 1 } : {}),
    room_id: ROOM,
    type: 'm.room.member',
    state_key: userId,
    sender: userId === READER && membership === 'invite' ? HOST : userId,
    content: { membership, displayname },
  });

describe('SDK members of a room joined from an invite', () => {
  it('stores the inviter that /members loads in place of the stripped invite copy', async () => {
    const client = createClient({ baseUrl: 'https://example.org', userId: READER });
    const hostJoin = member(HOST, 'join', 'Ari Host', '$host-join');
    vi.spyOn(client, 'members').mockResolvedValue({
      chunk: [hostJoin.event, member(READER, 'join', 'Reader', '$reader-join').event],
    } as never);
    const stored = vi.spyOn(client.store, 'setOutOfBandMembers').mockResolvedValue();
    vi.spyOn(client.store, 'getOutOfBandMembers').mockResolvedValue(null);
    const room = new Room(ROOM, client, READER, { lazyLoadMembers: true });

    // The invite's stripped state, then the join that sync brings with only the reader's event.
    room.currentState.setStateEvents([
      member(HOST, 'join', 'Ari Host'),
      member(READER, 'invite', 'Reader'),
    ]);
    room.updateMyMembership('invite');
    room.currentState.setStateEvents([member(READER, 'join', 'Reader', '$reader-join')]);
    room.updateMyMembership('join');

    await room.loadMembersIfNeeded();

    expect(room.getMember(HOST)?.events.member?.getId()).toBe('$host-join');
    expect(room.getMember(HOST)?.isOutOfBand()).toBe(true);
    await vi.waitFor(() => expect(stored).toHaveBeenCalled());
    const [, events] = stored.mock.calls[0] ?? [];
    expect(events?.map((event) => event.state_key)).toContain(HOST);
  });
});
