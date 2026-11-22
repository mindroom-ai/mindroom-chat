import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventStatus, EventType, MatrixEvent, RoomEvent, type Room } from 'matrix-js-sdk';
import {
  MatrixRTCSessionEvent,
  type CallMembership,
  type MatrixRTCSession,
} from 'matrix-js-sdk/lib/matrixrtc';
import {
  chooseCallNotify,
  MAX_RING_JOINED_MEMBERS,
  RING_ECHO_TIMEOUT_MS,
  startCallRingTrace,
} from './callRingTrace';

const deepTraceMocks = vi.hoisted(() => ({
  recordDeepTraceEvent: vi.fn(),
}));

vi.mock('../diagnostics/deepTrace', () => ({
  recordDeepTraceEvent: deepTraceMocks.recordDeepTraceEvent,
}));

const ME = '@alice:example.org';
const DEVICE = 'DEV1';
const MEMBER_ID = 'member-1';
const ROOM_ID = '!dm:example.org';

class FakeSession extends EventEmitter {
  memberships: CallMembership[] = [];
}

class FakeRoom extends EventEmitter {
  roomId = ROOM_ID;

  constructor(private joinedMembers = 2) {
    super();
  }

  getJoinedMemberCount() {
    return this.joinedMembers;
  }
}

const makeMembership = (overrides: Partial<CallMembership> = {}): CallMembership =>
  ({
    sender: ME,
    deviceId: DEVICE,
    memberId: MEMBER_ID,
    eventId: '$membership-1',
    ...overrides,
  } as unknown as CallMembership);

const makeRingEvent = (
  status: EventStatus | null,
  options: { encrypted?: boolean; error?: unknown; id?: string; txnId?: string } = {}
): MatrixEvent => {
  const event = new MatrixEvent({
    type: EventType.RTCNotification,
    room_id: ROOM_ID,
    sender: ME,
    event_id: options.id ?? '~local-1',
    content: { notification_type: 'ring', lifetime: 30_000, sender_ts: 1_000_000 },
  });
  event.setTxnId(options.txnId ?? 'txn-ring-1');
  if (options.encrypted) {
    event.makeEncrypted(EventType.RoomMessageEncrypted, { ciphertext: 'opaque' }, 'curve', 'ed');
  }
  event.setStatus(status);
  if (options.error !== undefined) {
    event.error = options.error as MatrixEvent['error'];
  }
  return event;
};

describe('chooseCallNotify', () => {
  it('rings direct rooms and rooms with two or three joined members, and notifies larger ones', () => {
    expect(MAX_RING_JOINED_MEMBERS).toBe(3);
    expect(chooseCallNotify({ peopleInCall: 0, direct: true, joinedMembers: 2 })).toBe('ring');
    expect(chooseCallNotify({ peopleInCall: 0, direct: true, joinedMembers: 5 })).toBe('ring');
    expect(chooseCallNotify({ peopleInCall: 0, direct: false, joinedMembers: 2 })).toBe('ring');
    expect(chooseCallNotify({ peopleInCall: 0, direct: false, joinedMembers: 3 })).toBe('ring');
    expect(chooseCallNotify({ peopleInCall: 0, direct: false, joinedMembers: 4 })).toBe(
      'notification'
    );
    expect(chooseCallNotify({ peopleInCall: 0, direct: false, joinedMembers: 1 })).toBe(
      'notification'
    );
    expect(chooseCallNotify({ peopleInCall: 1, direct: true, joinedMembers: 2 })).toBeUndefined();
  });
});

describe('startCallRingTrace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deepTraceMocks.recordDeepTraceEvent.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records join inputs, own membership echo, local echo transitions and DidSendCallNotification', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = new FakeSession();
    const room = new FakeRoom(3);

    const stop = startCallRingTrace({
      room: room as unknown as Room,
      session: session as unknown as MatrixRTCSession,
      ownMembership: { userId: ME, deviceId: DEVICE, memberId: MEMBER_ID },
      encrypted: true,
      notify: 'ring',
      notifyInputs: { peopleInCall: 0, direct: false, joinedMembers: 3 },
    });

    const own = makeMembership();
    session.memberships = [own];
    session.emit(MatrixRTCSessionEvent.MembershipsChanged, [], [own]);

    const ringEvent = makeRingEvent(EventStatus.ENCRYPTING);
    room.emit(RoomEvent.LocalEchoUpdated, ringEvent, room);
    ringEvent.makeEncrypted(EventType.RoomMessageEncrypted, { ciphertext: 'x' }, 'c', 'e');
    ringEvent.setStatus(EventStatus.SENDING);
    room.emit(RoomEvent.LocalEchoUpdated, ringEvent, room);
    ringEvent.setStatus(EventStatus.QUEUED);
    room.emit(RoomEvent.LocalEchoUpdated, ringEvent, room);
    ringEvent.setStatus(EventStatus.SENT);
    room.emit(RoomEvent.LocalEchoUpdated, ringEvent, room);
    session.emit(MatrixRTCSessionEvent.DidSendCallNotification, {
      event_id: '$ring-sent',
      notification_type: 'ring',
    });

    vi.advanceTimersByTime(RING_ECHO_TIMEOUT_MS + 1000);
    stop();

    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      '[call-ring] join',
      expect.objectContaining({
        roomId: ROOM_ID,
        notify: 'ring',
        encrypted: true,
        peopleInCall: 0,
        direct: false,
        joinedMembers: 3,
      })
    );
    expect(info).toHaveBeenCalledWith(
      '[call-ring] membership_echo',
      expect.objectContaining({
        hasEventId: true,
        membershipEventId: '$membership-1',
        oldMemberCount: 0,
        memberCount: 1,
      })
    );
    expect(deepTraceMocks.recordDeepTraceEvent.mock.calls.map(([name]) => name)).toEqual([
      'calls.ring.join.ring',
      'calls.ring.membership_echo',
      'calls.ring.local_echo.encrypting',
      'calls.ring.local_echo.sending',
      'calls.ring.local_echo.queued',
      'calls.ring.local_echo.sent',
      'calls.ring.sent.ring',
    ]);
  });

  it('records NOT_SENT with error details and cancels the missing-echo warning', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = new FakeSession();
    const room = new FakeRoom(2);

    const stop = startCallRingTrace({
      room: room as unknown as Room,
      session: session as unknown as MatrixRTCSession,
      ownMembership: { userId: ME, deviceId: DEVICE, memberId: MEMBER_ID },
      encrypted: true,
      notify: 'ring',
      notifyInputs: { peopleInCall: 0, direct: true, joinedMembers: 2 },
    });

    const own = makeMembership();
    session.memberships = [own];
    session.emit(MatrixRTCSessionEvent.MembershipsChanged, [], [own]);

    const error = Object.assign(new Error('encrypt failed'), {
      name: 'MatrixError',
      errcode: 'M_UNKNOWN',
      httpStatus: 500,
    });
    const failedEvent = makeRingEvent(EventStatus.NOT_SENT, { encrypted: false, error });
    room.emit(RoomEvent.LocalEchoUpdated, failedEvent, room);

    vi.advanceTimersByTime(RING_ECHO_TIMEOUT_MS + 1000);
    stop();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[call-ring] local_echo',
      expect.objectContaining({
        status: EventStatus.NOT_SENT,
        error: expect.objectContaining({
          name: 'MatrixError',
          errcode: 'M_UNKNOWN',
          httpStatus: 500,
          message: 'encrypt failed',
        }),
      })
    );
    expect(deepTraceMocks.recordDeepTraceEvent).toHaveBeenCalledWith(
      'calls.ring.local_echo.not_sent',
      { encrypted: false, http_status: 500, has_error: true },
      { flush: true }
    );
    expect(deepTraceMocks.recordDeepTraceEvent).not.toHaveBeenCalledWith(
      'calls.ring.missing_echo',
      expect.anything(),
      expect.anything()
    );
  });

  it('warns when no ring echo appears within 3 s of our own membership while alone', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = new FakeSession();
    const room = new FakeRoom(2);

    const stop = startCallRingTrace({
      room: room as unknown as Room,
      session: session as unknown as MatrixRTCSession,
      ownMembership: { userId: ME, deviceId: DEVICE, memberId: MEMBER_ID },
      encrypted: true,
      notify: 'ring',
      notifyInputs: { peopleInCall: 0, direct: true, joinedMembers: 2 },
    });

    const ownWithoutId = makeMembership({ eventId: undefined });
    session.memberships = [ownWithoutId];
    session.emit(MatrixRTCSessionEvent.MembershipsChanged, [], [ownWithoutId]);

    vi.advanceTimersByTime(RING_ECHO_TIMEOUT_MS - 1);
    expect(warn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    stop();

    expect(warn).toHaveBeenCalledWith(
      '[call-ring] missing_echo',
      expect.objectContaining({
        notify: 'ring',
        hasMembershipEventId: false,
        memberCount: 1,
        timeoutMs: RING_ECHO_TIMEOUT_MS,
      })
    );
    expect(deepTraceMocks.recordDeepTraceEvent).toHaveBeenCalledWith(
      'calls.ring.membership_echo',
      { has_event_id: false, old_member_count: 0, member_count: 1 },
      { flush: true }
    );
    expect(deepTraceMocks.recordDeepTraceEvent).toHaveBeenCalledWith(
      'calls.ring.missing_echo',
      { has_membership_event_id: false, member_count: 1, timeout_ms: RING_ECHO_TIMEOUT_MS },
      { flush: true }
    );
  });
});
