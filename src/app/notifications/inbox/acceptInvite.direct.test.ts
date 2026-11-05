import {
  createClient,
  EventType,
  MatrixError,
  MatrixEvent,
  Room,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guessDmRoomUserId } from '../../matrix/matrix';
import { isDirectInvite } from '../../matrix/room';
import { acceptInvite, acceptInvites } from './acceptInvite';

// Real rooms, member events, m.direct updates and rate-limit handling; only the requests are
// stand-ins. The other test of this module replaces those collaborators instead.
const ME = '@reader:example.org';
const ALICE = '@alice:example.org';
const BOB = '@bob:example.org';
const sdk = createClient({ baseUrl: 'http://localhost:1', userId: ME, timelineSupport: true });
let serial = 0;

const memberEvent = (
  roomId: string,
  userId: string,
  sender: string,
  content: Record<string, unknown>
): MatrixEvent => {
  serial += 1;
  return new MatrixEvent({
    type: EventType.RoomMember,
    state_key: userId,
    sender,
    room_id: roomId,
    event_id: `$member${serial}`,
    origin_server_ts: serial,
    content,
  });
};

// Like a sync: the events go into the room state, then the room works out our membership again.
const applyState = async (room: Room, events: MatrixEvent[]): Promise<void> => {
  await room.addLiveEvents(events, { addToState: true });
  room.recalculate();
};

/** A room Bob and then Alice joined, to which Alice invited us; `direct` marks it `is_direct`. */
const invitedRoom = async (roomId: string, direct: boolean): Promise<Room> => {
  const room = new Room(roomId, sdk, ME, { timelineSupport: true });
  const invite = direct ? { membership: 'invite', is_direct: true } : { membership: 'invite' };
  await applyState(room, [
    memberEvent(roomId, BOB, BOB, { membership: 'join' }),
    memberEvent(roomId, ALICE, ALICE, { membership: 'join' }),
    memberEvent(roomId, ME, ALICE, invite),
  ]);
  return room;
};

const rateLimited = (retryAfterMs?: number): MatrixError =>
  new MatrixError(
    {
      errcode: 'M_LIMIT_EXCEEDED',
      error: 'Too many requests',
      ...(retryAfterMs === undefined ? {} : { retry_after_ms: retryAfterMs }),
    },
    429
  );

type Failures = { joins?: Error[]; writes?: Error[] };

/**
 * A client for `rooms`. `joinRoom` puts our join into the room as the next sync would, which
 * replaces the invite and its `is_direct` flag; `m.direct` lives in memory. The listed failures
 * answer the first requests of each kind, in order. `calls` names every request in order.
 */
const clientFor = (rooms: Room[], failures: Failures = {}) => {
  const joinFailures = [...(failures.joins ?? [])];
  const writeFailures = [...(failures.writes ?? [])];
  const calls: string[] = [];
  let direct: Record<string, string[]> = {};
  const joinRoom = vi.fn(async (roomId: string): Promise<Room> => {
    calls.push(`join ${roomId}`);
    const failure = joinFailures.shift();
    if (failure) throw failure;
    const room = rooms.find((candidate) => candidate.roomId === roomId);
    if (!room) throw new Error(`no room ${roomId}`);
    await applyState(room, [memberEvent(roomId, ME, ME, { membership: 'join' })]);
    return room;
  });
  const setAccountData = vi.fn(async (type: string, content: Record<string, string[]>) => {
    calls.push(type);
    const failure = writeFailures.shift();
    if (failure) throw failure;
    direct = content;
    return {};
  });
  const mx = {
    getSafeUserId: () => ME,
    joinRoom,
    getAccountData: () => ({ getContent: () => direct }),
    setAccountData,
  } as unknown as MatrixClient;
  return { mx, joinRoom, calls, direct: () => direct };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('acceptInvite', () => {
  it('joins a direct invite, then files it under the person read before the join', async () => {
    const room = await invitedRoom('!dm:example.org', true);
    const client = clientFor([room]);

    await acceptInvite(client.mx, room);

    expect(client.calls).toEqual(['join !dm:example.org', 'm.direct']);
    expect(client.direct()).toEqual({ [ALICE]: ['!dm:example.org'] });
    // Read after the join, the invite would no longer count as direct, and the guess would name
    // Bob, the first member who joined, instead of Alice, who invited us.
    expect(isDirectInvite(room, ME)).toBe(false);
    expect(guessDmRoomUserId(room, ME)).toBe(BOB);
  });

  it('rejects with the error of a failed join and leaves m.direct alone', async () => {
    const room = await invitedRoom('!dm:example.org', true);
    const refused = new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Not invited' }, 403);
    const client = clientFor([room], { joins: [refused] });

    await expect(acceptInvite(client.mx, room)).rejects.toBe(refused);

    expect(client.calls).toEqual(['join !dm:example.org']);
  });

  it('writes no m.direct for an invite that is not a direct chat', async () => {
    const room = await invitedRoom('!team:example.org', false);
    const client = clientFor([room]);

    await acceptInvite(client.mx, room);

    expect(client.calls).toEqual(['join !team:example.org']);
  });

  it('rejects when the m.direct write fails, although the room is joined', async () => {
    const room = await invitedRoom('!dm:example.org', true);
    const client = clientFor([room], { writes: [new Error('offline')] });

    await expect(acceptInvite(client.mx, room)).rejects.toThrow('offline');

    expect(room.getMyMembership()).toBe('join');
  });
});

describe('acceptInvites', () => {
  it('waits out a rate-limited join, retries it three times at most, then moves on', async () => {
    const busy = await invitedRoom('!busy:example.org', false);
    const next = await invitedRoom('!next:example.org', false);
    const refusals = Array.from({ length: 4 }, () => rateLimited(2_000));
    const client = clientFor([busy, next], { joins: refusals });
    vi.useFakeTimers();

    const done = acceptInvites(client.mx, [busy, next]);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(client.calls).toEqual(['join !busy:example.org']);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.calls).toEqual(['join !busy:example.org', 'join !busy:example.org']);
    await vi.advanceTimersByTimeAsync(4_000);
    await done;
    expect(client.calls).toEqual([
      'join !busy:example.org',
      'join !busy:example.org',
      'join !busy:example.org',
      'join !busy:example.org',
      'join !next:example.org',
    ]);
    expect(busy.getMyMembership()).toBe('invite');
    expect(next.getMyMembership()).toBe('join');
  });

  it('goes on to the next invite after a failed m.direct write', async () => {
    const dm = await invitedRoom('!dm:example.org', true);
    const team = await invitedRoom('!team:example.org', false);
    const client = clientFor([dm, team], { writes: [new Error('offline')] });

    await acceptInvites(client.mx, [dm, team]);

    expect(client.calls).toEqual(['join !dm:example.org', 'm.direct', 'join !team:example.org']);
    expect(team.getMyMembership()).toBe('join');
  });

  it('makes no request for an empty list', async () => {
    const client = clientFor([]);

    await acceptInvites(client.mx, []);

    expect(client.calls).toEqual([]);
  });

  it('retries a rate-limited m.direct write without joining again', async () => {
    const dm = await invitedRoom('!dm:example.org', true);
    const client = clientFor([dm], { writes: [rateLimited()] });
    vi.useFakeTimers();

    const done = acceptInvites(client.mx, [dm]);

    // The server named no delay, so the retry waits 5 seconds.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(client.calls).toEqual(['join !dm:example.org', 'm.direct']);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(client.calls).toEqual(['join !dm:example.org', 'm.direct', 'm.direct']);
    expect(client.direct()).toEqual({ [ALICE]: ['!dm:example.org'] });
  });
});
