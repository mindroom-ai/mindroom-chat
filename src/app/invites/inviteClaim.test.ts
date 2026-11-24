import { EventEmitter } from 'events';
import { ClientEvent, RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAIM_EVENT, RESULT_EVENT, inviterOf, startClaim, type ClaimOutcome } from './inviteClaim';

const ROUTER = '@router:example.org';
const ME = '@alice:example.org';
const ROOM = '!room:example.org';
const link = { routerId: ROUTER, code: 'secret-code' };

type FakeRoom = {
  roomId: string;
  getMyMembership: () => string;
  getMember: (id: string) => unknown;
};

const fakeRoom = (roomId: string, membership: string, inviter?: string): FakeRoom => ({
  roomId,
  getMyMembership: () => membership,
  getMember: (id: string) =>
    id === ME && inviter ? { events: { member: { getSender: () => inviter } } } : null,
});

class FakeClient extends EventEmitter {
  rooms: FakeRoom[] = [];

  sendToDevice = vi.fn(async () => ({}));

  getSafeUserId = () => ME;

  getRooms = () => this.rooms;
}

let mx: FakeClient;
let outcomes: ClaimOutcome[];
let stop: (() => void) | undefined;

const start = () => {
  stop = startClaim(mx as unknown as MatrixClient, link, (outcome) => outcomes.push(outcome));
};

const sentContent = (call: number) => {
  const [type, map] = mx.sendToDevice.mock.calls[call] as unknown as [
    string,
    Map<string, Map<string, Record<string, unknown>>>,
  ];
  expect(type).toBe(CLAIM_EVENT);
  expect([...map.keys()]).toEqual([ROUTER]);
  expect([...(map.get(ROUTER)?.keys() ?? [])]).toEqual(['*']);
  return map.get(ROUTER)?.get('*') ?? {};
};

const requestId = () => sentContent(0).request_id;

const result = (content: Record<string, unknown>, sender = ROUTER, type = RESULT_EVENT) =>
  mx.emit(ClientEvent.ReceivedToDeviceMessage, {
    message: { type, sender, content },
    encryptionInfo: null,
  });

const invite = (room: FakeRoom) => {
  mx.rooms.push(room);
  mx.emit(RoomEvent.MyMembership, room, 'invite', undefined);
};

beforeEach(() => {
  vi.useFakeTimers();
  mx = new FakeClient();
  outcomes = [];
  stop = undefined;
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

describe('startClaim', () => {
  it("sends the claim to the router's devices exactly once", () => {
    start();
    const first = sentContent(0);
    expect(first).toEqual({ version: 1, request_id: first.request_id, code: 'secret-code' });
    expect(typeof first.request_id).toBe('string');
    vi.advanceTimersByTime(30_000);
    expect(mx.sendToDevice).toHaveBeenCalledTimes(1);
  });

  it("reports the router's result", () => {
    start();
    result({ version: 1, request_id: requestId(), status: 'invited', room_id: ROOM });
    expect(outcomes).toEqual([{ status: 'invited', roomId: ROOM }]);
    vi.advanceTimersByTime(30_000);
    expect(mx.sendToDevice).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
  });

  it('ignores a result from another sender', () => {
    start();
    result({ version: 1, request_id: requestId(), status: 'invited', room_id: ROOM }, ME);
    result({ version: 1, request_id: requestId(), status: 'rejected' }, ROUTER, 'm.other');
    expect(outcomes).toEqual([]);
  });

  it('ignores another request_id', () => {
    start();
    result({ version: 1, request_id: 'other', status: 'invited', room_id: ROOM });
    result({ version: 2, request_id: requestId(), status: 'rejected' });
    expect(outcomes).toEqual([]);
  });

  it('ignores an invited result without room_id', () => {
    start();
    result({ version: 1, request_id: requestId(), status: 'invited' });
    expect(outcomes).toEqual([]);
  });

  it.each(['rejected', 'retry'] as const)('reports %s', (status) => {
    start();
    result({ version: 1, request_id: requestId(), status });
    expect(outcomes).toEqual([{ status }]);
    vi.advanceTimersByTime(30_000);
    expect(outcomes).toHaveLength(1);
    expect(mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(0);
  });

  it('reports offline after 20 seconds and still reports a late result', () => {
    start();
    vi.advanceTimersByTime(19_999);
    expect(outcomes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(outcomes).toEqual([{ status: 'offline' }]);
    vi.advanceTimersByTime(60_000);
    expect(outcomes).toEqual([{ status: 'offline' }]);
    result({ version: 1, request_id: requestId(), status: 'invited', room_id: ROOM });
    expect(outcomes).toEqual([{ status: 'offline' }, { status: 'invited', roomId: ROOM }]);
  });

  it('counts a new invitation from the router as invited', () => {
    start();
    invite(fakeRoom(ROOM, 'invite', ROUTER));
    expect(outcomes).toEqual([{ status: 'invited', roomId: ROOM }]);
    expect(mx.listenerCount(RoomEvent.MyMembership)).toBe(0);
  });

  it('ignores an invitation that was pending before the claim', () => {
    const old = fakeRoom('!old:example.org', 'invite', ROUTER);
    mx.rooms.push(old);
    start();
    mx.emit(RoomEvent.MyMembership, old, 'invite', 'invite');
    expect(outcomes).toEqual([]);
  });

  it('ignores an invitation from someone else', () => {
    start();
    invite(fakeRoom(ROOM, 'invite', '@bas:example.org'));
    expect(outcomes).toEqual([]);
  });

  it('reports retry when the send does not reach the homeserver', async () => {
    mx.sendToDevice.mockRejectedValueOnce(new Error('offline'));
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(outcomes).toEqual([{ status: 'retry' }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(outcomes).toEqual([{ status: 'retry' }]);
    expect(mx.sendToDevice).toHaveBeenCalledTimes(1);
  });

  it('stop removes listeners and timers', () => {
    start();
    stop?.();
    vi.advanceTimersByTime(30_000);
    result({ version: 1, request_id: requestId(), status: 'rejected' });
    invite(fakeRoom(ROOM, 'invite', ROUTER));
    expect(mx.sendToDevice).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([]);
    expect(mx.listenerCount(ClientEvent.ReceivedToDeviceMessage)).toBe(0);
    expect(mx.listenerCount(RoomEvent.MyMembership)).toBe(0);
  });
});

describe('inviterOf', () => {
  it('names who invited this account to a room while the invitation is pending', () => {
    const client = mx as unknown as MatrixClient;
    const of = (room: FakeRoom) => inviterOf(client, room as unknown as Room);
    expect(of(fakeRoom(ROOM, 'invite', ROUTER))).toBe(ROUTER);
    expect(of(fakeRoom(ROOM, 'invite', '@bas:example.org'))).toBe('@bas:example.org');
    expect(of(fakeRoom(ROOM, 'join', ROUTER))).toBeUndefined();
  });
});
