import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClient, MatrixError, Room } from 'matrix-js-sdk';
import {
  CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS,
  CALL_MEMBERSHIP_RESIDUAL_READ_TIMEOUT_MS,
  acquireCallCleanupGeneration,
  clearDeviceCallMemberships,
  currentCallCleanupGeneration,
  expectedDeviceCallMembershipStateKey,
  fetchDeviceCallMembershipsFromServer,
  findDeviceCallMemberships,
  isCallRoomRetired,
  membershipCleanupRetryDelayMs,
  retireCallRoom,
  roomCallMembershipWritesSettled,
  subscribeCallRoomRetirement,
  trackRoomCallMembershipWrite,
} from './rtcMembershipCleanup';

const USER_ID = '@alice:mindroom.test';
const DEVICE_ID = 'HOSTDEV';
const ROOM_ID = '!call:mindroom.test';
const EXPECTED_KEY = `_${USER_ID}_${DEVICE_ID}_m.call`;

type FakeEvent = {
  getSender: () => string;
  getStateKey: () => string;
  getContent: () => Record<string, unknown>;
};

const memberEvent = (
  sender: string,
  stateKey: string,
  content: Record<string, unknown>
): FakeEvent => ({
  getSender: () => sender,
  getStateKey: () => stateKey,
  getContent: () => content,
});

const activeRoomCallContent = (deviceId = DEVICE_ID): Record<string, unknown> => ({
  application: 'm.call',
  call_id: '',
  scope: 'm.room',
  device_id: deviceId,
  focus_active: { type: 'livekit', focus_selection: 'oldest_membership' },
  membershipID: `${USER_ID}:${deviceId}`,
});

const makeRoom = (events: FakeEvent[], version = '12'): Room =>
  ({
    roomId: ROOM_ID,
    getVersion: () => version,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (type: string, stateKey?: string) => {
          if (type !== 'org.matrix.msc3401.call.member') {
            return stateKey === undefined ? [] : null;
          }
          return stateKey === undefined ? events : null;
        },
      }),
    }),
  } as unknown as Room);

const makeClient = (deviceId: string | null = DEVICE_ID): MatrixClient =>
  ({
    getUserId: () => USER_ID,
    getDeviceId: () => deviceId,
    sendStateEvent: vi.fn().mockResolvedValue({}),
  } as unknown as MatrixClient);

describe('expectedDeviceCallMembershipStateKey', () => {
  it('prefixes an underscore on ordinary room versions', () => {
    expect(expectedDeviceCallMembershipStateKey(makeRoom([]), USER_ID, DEVICE_ID)).toBe(
      EXPECTED_KEY
    );
  });

  it('uses the unprefixed key on msc3757/msc3779 room versions', () => {
    expect(
      expectedDeviceCallMembershipStateKey(
        makeRoom([], 'org.matrix.msc3757.10'),
        USER_ID,
        DEVICE_ID
      )
    ).toBe(`${USER_ID}_${DEVICE_ID}_m.call`);
    expect(
      expectedDeviceCallMembershipStateKey(makeRoom([], 'org.matrix.msc3779'), USER_ID, DEVICE_ID)
    ).toBe(`${USER_ID}_${DEVICE_ID}_m.call`);
  });
});

describe('findDeviceCallMemberships', () => {
  it('selects only the observed current-user current-device active room-call slot event', () => {
    const room = makeRoom([
      memberEvent(USER_ID, EXPECTED_KEY, activeRoomCallContent()),
      // Another device of the same user must survive.
      memberEvent(USER_ID, `_${USER_ID}_OTHERDEV_m.call`, activeRoomCallContent('OTHERDEV')),
      // Another participant must survive.
      memberEvent(
        '@bob:mindroom.test',
        `_@bob:mindroom.test_BOBDEV_m.call`,
        activeRoomCallContent('BOBDEV')
      ),
    ]);

    expect(findDeviceCallMemberships(makeClient(), room)).toEqual([
      { roomId: ROOM_ID, stateKey: EXPECTED_KEY },
    ]);
  });

  it('never selects another same-device call slot, another scope, or another application', () => {
    const room = makeRoom([
      // Different call slot of this same device.
      memberEvent(USER_ID, `_${USER_ID}_${DEVICE_ID}_m.callbreakout`, {
        ...activeRoomCallContent(),
        call_id: 'breakout',
      }),
      // Same expected key but a non-room scope.
      memberEvent(USER_ID, EXPECTED_KEY, { ...activeRoomCallContent(), scope: 'm.user' }),
      // Same expected key but a different application.
      memberEvent(USER_ID, EXPECTED_KEY, { ...activeRoomCallContent(), application: 'm.board' }),
      // Same expected key but a non-room call id.
      memberEvent(USER_ID, EXPECTED_KEY, { ...activeRoomCallContent(), call_id: 'abc' }),
    ]);

    expect(findDeviceCallMemberships(makeClient(), room)).toEqual([]);
  });

  it('never selects malformed keys, bare-user legacy aggregates, or already-empty events', () => {
    const room = makeRoom([
      // Missing the underscore prefix required on this room version.
      memberEvent(USER_ID, `${USER_ID}_${DEVICE_ID}_m.call`, activeRoomCallContent()),
      // Legacy bare-user aggregate event.
      memberEvent(USER_ID, USER_ID, { memberships: [{ device_id: DEVICE_ID }] }),
      // Correct key but already-left (empty) content.
      memberEvent(USER_ID, EXPECTED_KEY, {}),
      // Correct key but content that identifies a different device.
      memberEvent(USER_ID, EXPECTED_KEY, activeRoomCallContent('OTHERDEV')),
      // Correct key shape sent by a different user.
      memberEvent('@mallory:mindroom.test', EXPECTED_KEY, activeRoomCallContent()),
    ]);

    expect(findDeviceCallMemberships(makeClient(), room)).toEqual([]);
  });

  it('selects the unprefixed key only on msc3757-style room versions', () => {
    const unprefixedKey = `${USER_ID}_${DEVICE_ID}_m.call`;
    const events = [memberEvent(USER_ID, unprefixedKey, activeRoomCallContent())];

    expect(findDeviceCallMemberships(makeClient(), makeRoom(events))).toEqual([]);
    expect(
      findDeviceCallMemberships(makeClient(), makeRoom(events, 'org.matrix.msc3757.10'))
    ).toEqual([{ roomId: ROOM_ID, stateKey: unprefixedKey }]);
  });

  it('returns nothing without a device id or without observed membership events', () => {
    expect(findDeviceCallMemberships(makeClient(null), makeRoom([]))).toEqual([]);
    expect(findDeviceCallMemberships(makeClient(), makeRoom([]))).toEqual([]);
  });
});

describe('fetchDeviceCallMembershipsFromServer', () => {
  const withServerRead = (impl: () => Promise<unknown>): MatrixClient =>
    ({
      getUserId: () => USER_ID,
      getDeviceId: () => DEVICE_ID,
      getStateEvent: vi.fn(impl),
    } as unknown as MatrixClient);

  it('returns the exact expected key when the server reports an active own-device slot', async () => {
    const mx = withServerRead(async () => activeRoomCallContent());

    const targets = await fetchDeviceCallMembershipsFromServer(mx, makeRoom([]));

    expect(targets).toEqual([{ roomId: ROOM_ID, stateKey: EXPECTED_KEY }]);
    expect(mx.getStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'org.matrix.msc3401.call.member',
      EXPECTED_KEY
    );
  });

  it('reports verifiably empty for `{}` content, another device, and M_NOT_FOUND', async () => {
    expect(
      await fetchDeviceCallMembershipsFromServer(
        withServerRead(async () => ({})),
        makeRoom([])
      )
    ).toEqual([]);
    expect(
      await fetchDeviceCallMembershipsFromServer(
        withServerRead(async () => activeRoomCallContent('OTHERDEV')),
        makeRoom([])
      )
    ).toEqual([]);
    expect(
      await fetchDeviceCallMembershipsFromServer(
        withServerRead(async () => {
          throw new MatrixError({ errcode: 'M_NOT_FOUND', error: 'Event not found.' }, 404);
        }),
        makeRoom([])
      )
    ).toEqual([]);
  });

  it('reports failure (null) for other errors so the caller can fall back to the local cache', async () => {
    const targets = await fetchDeviceCallMembershipsFromServer(
      withServerRead(async () => {
        throw new Error('fetch failed');
      }),
      makeRoom([])
    );

    expect(targets).toBeNull();
  });

  it('bounds a blackholed read and reports failure at the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const mx = withServerRead(
        () =>
          new Promise(() => {
            // never settles
          })
      );
      const read = fetchDeviceCallMembershipsFromServer(mx, makeRoom([]));

      await vi.advanceTimersByTimeAsync(CALL_MEMBERSHIP_RESIDUAL_READ_TIMEOUT_MS);

      expect(await read).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('selects nothing without a known user or device identity', async () => {
    const mx = {
      getUserId: () => USER_ID,
      getDeviceId: () => null,
      getStateEvent: vi.fn(),
    } as unknown as MatrixClient;

    expect(await fetchDeviceCallMembershipsFromServer(mx, makeRoom([]))).toEqual([]);
    expect(mx.getStateEvent).not.toHaveBeenCalled();
  });
});

describe('membershipCleanupRetryDelayMs', () => {
  const rateLimited = (retryAfterMs: unknown): MatrixError =>
    new MatrixError(
      { errcode: 'M_LIMIT_EXCEEDED', error: 'Too Many Requests', retry_after_ms: retryAfterMs },
      429
    );

  it('uses the base delay for non-Matrix and no-retry-after errors', () => {
    expect(membershipCleanupRetryDelayMs(new Error('fetch failed'), 1000)).toBe(1000);
    expect(
      membershipCleanupRetryDelayMs(new MatrixError({ errcode: 'M_UNKNOWN' }, 502), 1000)
    ).toBe(1000);
  });

  it('honors a server retry_after_ms, clamped up to the 30s server bound', () => {
    expect(membershipCleanupRetryDelayMs(rateLimited(3000), 1000)).toBe(3000);
    // Never below the base delay…
    expect(membershipCleanupRetryDelayMs(rateLimited(200), 1000)).toBe(1000);
    // A server ask above the old 5s cap is honored — retrying sooner than
    // the server asked would guarantee re-hitting the same rate limit…
    expect(membershipCleanupRetryDelayMs(rateLimited(12_000), 1000)).toBe(12_000);
    // …but never long enough to keep the detached task alive indefinitely.
    expect(membershipCleanupRetryDelayMs(rateLimited(120_000), 1000)).toBe(30_000);
  });

  it('falls back to the base delay on a malformed retry_after_ms', () => {
    expect(membershipCleanupRetryDelayMs(rateLimited('soon'), 1000)).toBe(1000);
  });
});

describe('clearDeviceCallMemberships', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const currentGeneration = () => currentCallCleanupGeneration(ROOM_ID);

  it('sends {} to the exact observed state key', async () => {
    const mx = makeClient();

    await clearDeviceCallMemberships(
      mx,
      [{ roomId: ROOM_ID, stateKey: EXPECTED_KEY }],
      currentGeneration(),
      0
    );

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    // Every cleanup PUT carries a finite local timeout: a blackholed
    // request must not block the detached cleanup chain forever.
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      ROOM_ID,
      'org.matrix.msc3401.call.member',
      {},
      EXPECTED_KEY,
      { localTimeoutMs: CALL_MEMBERSHIP_CLEANUP_WRITE_TIMEOUT_MS }
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('retries one transient network failure once and stays quiet on success', async () => {
    const mx = makeClient();
    (mx.sendStateEvent as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({});

    await clearDeviceCallMemberships(
      mx,
      [{ roomId: ROOM_ID, stateKey: EXPECTED_KEY }],
      currentGeneration(),
      0
    );

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('retries a 5xx once and reports a single redacted diagnostic when exhausted', async () => {
    const mx = makeClient();
    (mx.sendStateEvent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new MatrixError({ errcode: 'M_UNKNOWN', error: 'proxy exploded' }, 502)
    );

    await expect(
      clearDeviceCallMemberships(
        mx,
        [{ roomId: ROOM_ID, stateKey: EXPECTED_KEY }],
        currentGeneration(),
        0
      )
    ).resolves.toBeUndefined();

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain('M_UNKNOWN');
    expect(message).not.toContain('proxy exploded');
  });

  it('retries rate limiting (429) once instead of treating it as permanent', async () => {
    const mx = makeClient();
    (mx.sendStateEvent as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new MatrixError({ errcode: 'M_LIMIT_EXCEEDED' }, 429))
      .mockResolvedValueOnce({});

    await clearDeviceCallMemberships(
      mx,
      [{ roomId: ROOM_ID, stateKey: EXPECTED_KEY }],
      currentGeneration(),
      0
    );

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('retries a request timeout (408) once instead of treating it as permanent', async () => {
    const mx = makeClient();
    (mx.sendStateEvent as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new MatrixError({ errcode: 'M_UNKNOWN' }, 408))
      .mockResolvedValueOnce({});

    await clearDeviceCallMemberships(
      mx,
      [{ roomId: ROOM_ID, stateKey: EXPECTED_KEY }],
      currentGeneration(),
      0
    );

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never retries a permanent Matrix authorization error and consumes it silently', async () => {
    const mx = makeClient();
    (mx.sendStateEvent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new MatrixError({ errcode: 'M_FORBIDDEN', error: 'not allowed' }, 403)
    );

    await expect(
      clearDeviceCallMemberships(
        mx,
        [{ roomId: ROOM_ID, stateKey: EXPECTED_KEY }],
        currentGeneration(),
        0
      )
    ).resolves.toBeUndefined();

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('names the error class for an exhausted non-Matrix failure without leaking its message', async () => {
    const mx = makeClient();
    (mx.sendStateEvent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('secret internals')
    );

    await clearDeviceCallMemberships(
      mx,
      [{ roomId: ROOM_ID, stateKey: EXPECTED_KEY }],
      currentGeneration(),
      0
    );

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain('TypeError');
    expect(message).not.toContain('secret internals');
  });

  it('writes nothing when a successor call already claimed the room', async () => {
    const staleRoom = '!stale-claim:mindroom.test';
    const mx = makeClient();
    const staleGeneration = currentCallCleanupGeneration(staleRoom);
    acquireCallCleanupGeneration(staleRoom);

    await clearDeviceCallMemberships(
      mx,
      [{ roomId: staleRoom, stateKey: EXPECTED_KEY }],
      staleGeneration,
      0
    );

    expect(mx.sendStateEvent).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops the delayed retry when a successor claims the room mid-delay', async () => {
    const retryRoom = '!retry-claim:mindroom.test';
    const mx = makeClient();
    (mx.sendStateEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('fetch failed')
    );

    const pending = clearDeviceCallMemberships(
      mx,
      [{ roomId: retryRoom, stateKey: EXPECTED_KEY }],
      currentCallCleanupGeneration(retryRoom),
      0
    );
    // The replacement call embed claims the room while the first attempt is
    // still settling; the pending retry must never clobber its membership.
    acquireCallCleanupGeneration(retryRoom);
    await pending;

    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is a no-op without targets', async () => {
    const mx = makeClient();

    await clearDeviceCallMemberships(mx, [], currentGeneration(), 0);

    expect(mx.sendStateEvent).not.toHaveBeenCalled();
  });
});

describe('in-flight cleanup write fencing', () => {
  const flushMicrotasks = () =>
    new Promise<void>((resolve) => {
      process.nextTick(resolve);
    });

  it('resolves the successor gate immediately when nothing is in flight', async () => {
    await expect(roomCallMembershipWritesSettled('!gate-idle:mindroom.test')).resolves.toBe(
      'settled'
    );
  });

  it('reports a timeout instead of waiting forever on a blackholed cleanup write', async () => {
    // A hung predecessor request must never wedge a successor call's
    // membership publish indefinitely; past the bound the caller proceeds.
    const gateRoom = '!gate-blackhole:mindroom.test';
    trackRoomCallMembershipWrite(
      gateRoom,
      new Promise<void>(() => {
        // never settles: models a blackholed request with no local timeout
      })
    );

    await expect(roomCallMembershipWritesSettled(gateRoom, 5)).resolves.toBe('timed-out');
  });

  it('resolves settled within the bound when the write completes in time', async () => {
    const gateRoom = '!gate-in-time:mindroom.test';
    let settle!: () => void;
    trackRoomCallMembershipWrite(
      gateRoom,
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );

    const gate = roomCallMembershipWritesSettled(gateRoom, 60_000);
    settle();
    await expect(gate).resolves.toBe('settled');
  });

  it('a successor claim during a dispatched PUT holds the gate and suppresses the retry', async () => {
    // The generation fence stops writes before dispatch; this pins the other
    // half of the ownership barrier — a `{}` PUT already on the wire keeps
    // the successor's membership publish gated until it settles, and the
    // transient retry never dispatches after the claim.
    const gateRoom = '!gate-midflight:mindroom.test';
    const mx = makeClient();
    let rejectPut!: (reason: unknown) => void;
    (mx.sendStateEvent as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPut = reject;
        })
    );

    const clearing = clearDeviceCallMemberships(
      mx,
      [{ roomId: gateRoom, stateKey: EXPECTED_KEY }],
      currentCallCleanupGeneration(gateRoom),
      0
    );
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);

    // The replacement call claims the room while the PUT is in flight.
    acquireCallCleanupGeneration(gateRoom);
    let publishUnblocked = false;
    const gate = roomCallMembershipWritesSettled(gateRoom).then(() => {
      publishUnblocked = true;
    });
    await flushMicrotasks();
    expect(publishUnblocked).toBe(false);

    rejectPut(new Error('fetch failed'));
    await clearing;
    await gate;
    expect(publishUnblocked).toBe(true);
    // The transient retry is fenced by the successor's claim.
    expect(mx.sendStateEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps the gate pending across writes dispatched while waiting', async () => {
    const gateRoom = '!gate-chained:mindroom.test';
    let settleFirst!: () => void;
    let settleSecond!: () => void;
    trackRoomCallMembershipWrite(
      gateRoom,
      new Promise<void>((resolve) => {
        settleFirst = resolve;
      })
    );

    let publishUnblocked = false;
    const gate = roomCallMembershipWritesSettled(gateRoom).then(() => {
      publishUnblocked = true;
    });
    // A second write starts while the gate is already waiting on the first.
    trackRoomCallMembershipWrite(
      gateRoom,
      new Promise<void>((resolve) => {
        settleSecond = resolve;
      })
    );

    settleFirst();
    await flushMicrotasks();
    expect(publishUnblocked).toBe(false);

    settleSecond();
    await gate;
    expect(publishUnblocked).toBe(true);
  });

  it('returns the tracked write untouched, including its rejection', async () => {
    const gateRoom = '!gate-outcome:mindroom.test';
    const failure = new Error('boom');
    await expect(trackRoomCallMembershipWrite(gateRoom, Promise.reject(failure))).rejects.toBe(
      failure
    );
    await expect(roomCallMembershipWritesSettled(gateRoom)).resolves.toBe('settled');
  });

  it('evicts a write that outlived a full bounded wait so later waits stop paying for it', async () => {
    // Without eviction, one blackholed request would make EVERY future
    // publish gate and cleanup drain for the room wait out the full bound
    // again, forever (review A3, round 4).
    const gateRoom = '!gate-evict:mindroom.test';
    trackRoomCallMembershipWrite(
      gateRoom,
      new Promise<void>(() => {
        // never settles
      })
    );

    await expect(roomCallMembershipWritesSettled(gateRoom, 5)).resolves.toBe('timed-out');
    // The abandoned entry no longer blocks anyone.
    await expect(roomCallMembershipWritesSettled(gateRoom, 5)).resolves.toBe('settled');
  });

  it('keeps writes tracked after a timed-out wait began inside their own safety window', async () => {
    const gateRoom = '!gate-evict-young:mindroom.test';
    trackRoomCallMembershipWrite(
      gateRoom,
      new Promise<void>(() => {
        // never settles: pending for the wait's whole window, evicted
      })
    );
    const expiring = roomCallMembershipWritesSettled(gateRoom, 5);
    let settleYoung!: () => void;
    trackRoomCallMembershipWrite(
      gateRoom,
      new Promise<void>((resolve) => {
        settleYoung = resolve;
      })
    );
    await expect(expiring).resolves.toBe('timed-out');

    // The young write was tracked after the expired wait began: it has not
    // used up a full window yet, so it still gates until it settles.
    let unblocked = false;
    const next = roomCallMembershipWritesSettled(gateRoom).then((result) => {
      unblocked = true;
      return result;
    });
    await flushMicrotasks();
    expect(unblocked).toBe(false);

    settleYoung();
    await expect(next).resolves.toBe('settled');
  });
});

describe('call room retirement', () => {
  it('is permanent and scoped to the exact room', () => {
    const retired = '!retired:mindroom.test';
    const untouched = '!not-retired:mindroom.test';

    expect(isCallRoomRetired(retired)).toBe(false);
    retireCallRoom(retired);
    retireCallRoom(retired); // idempotent

    expect(isCallRoomRetired(retired)).toBe(true);
    expect(isCallRoomRetired(untouched)).toBe(false);
  });

  it('notifies exact-room subscribers once without letting one broken listener block another', () => {
    const retired = '!retirement-subscribers:mindroom.test';
    const untouched = '!retirement-subscribers-other:mindroom.test';
    const first = vi.fn();
    const broken = vi.fn(() => {
      throw new Error('broken subscriber');
    });
    const other = vi.fn();
    const unsubscribeFirst = subscribeCallRoomRetirement(retired, first);
    const unsubscribeBroken = subscribeCallRoomRetirement(retired, broken);
    const unsubscribeOther = subscribeCallRoomRetirement(untouched, other);

    retireCallRoom(retired);
    retireCallRoom(retired);

    expect(first).toHaveBeenCalledTimes(1);
    expect(broken).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    unsubscribeFirst();
    unsubscribeBroken();
    unsubscribeOther();
  });

  it('stops notifying after unsubscribe', () => {
    const retired = '!retirement-unsubscribed:mindroom.test';
    const listener = vi.fn();
    const unsubscribe = subscribeCallRoomRetirement(retired, listener);

    unsubscribe();
    retireCallRoom(retired);

    expect(listener).not.toHaveBeenCalled();
  });
});
