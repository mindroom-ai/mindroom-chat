import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventStatus,
  EventType,
  MatrixEvent,
  RelationType,
  RoomEvent,
  type Room,
} from 'matrix-js-sdk';
import {
  MatrixRTCSessionEvent,
  type CallMembership,
  type MatrixRTCSession,
} from 'matrix-js-sdk/lib/matrixrtc';
import { RING_ECHO_TIMEOUT_MS, startCallRingTrace } from './callRingTrace';

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
  options: {
    refEventId?: string;
    encrypted?: boolean;
    error?: unknown;
    id?: string;
    txnId?: string;
  } = {}
): MatrixEvent => {
  const event = new MatrixEvent({
    type: EventType.RTCNotification,
    room_id: ROOM_ID,
    sender: ME,
    event_id: options.id ?? '~local-1',
    content: {
      notification_type: 'ring',
      lifetime: 30_000,
      sender_ts: 1_000_000,
      'm.relates_to': {
        rel_type: RelationType.Reference,
        event_id: options.refEventId ?? '$membership-1',
      },
    },
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

describe('startCallRingTrace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deepTraceMocks.recordDeepTraceEvent.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records sanitized join, membership echo, local echo transitions, and send completion without identifiers', () => {
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
      'm.relates_to': { rel_type: RelationType.Reference, event_id: '$membership-1' },
    });

    vi.advanceTimersByTime(RING_ECHO_TIMEOUT_MS + 1000);
    stop();

    expect(warn).not.toHaveBeenCalled();
    expect(deepTraceMocks.recordDeepTraceEvent.mock.calls.map(([name]) => name)).toEqual([
      'calls.ring.join.ring',
      'calls.ring.membership_echo',
      'calls.ring.local_echo.encrypting',
      'calls.ring.local_echo.sending',
      'calls.ring.local_echo.queued',
      'calls.ring.local_echo.sent',
      'calls.ring.sent.ring',
    ]);
    const serializedConsole = JSON.stringify(info.mock.calls);
    expect(serializedConsole).not.toContain(ROOM_ID);
    expect(serializedConsole).not.toContain('$membership-1');
    expect(serializedConsole).not.toContain('txn-ring-1');
    expect(serializedConsole).not.toContain('$ring-sent');
  });

  it('records NOT_SENT with sanitized fields only and cancels missing_echo', () => {
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

    const error = Object.assign(new Error('sensitive error text'), { httpStatus: 500 });
    room.emit(
      RoomEvent.LocalEchoUpdated,
      makeRingEvent(EventStatus.NOT_SENT, { encrypted: false, error }),
      room
    );

    vi.advanceTimersByTime(RING_ECHO_TIMEOUT_MS + 1000);
    stop();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[call-ring] calls.ring.local_echo.not_sent', {
      encrypted: false,
      has_error: true,
      http_status: 500,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive error text');
    expect(deepTraceMocks.recordDeepTraceEvent).toHaveBeenCalledWith(
      'calls.ring.local_echo.not_sent',
      { encrypted: false, has_error: true, http_status: 500 },
      { flush: true }
    );
  });

  it('ignores stale ring echoes and sends referencing an older membership on rejoin', () => {
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

    // Another memberId on the same device must not match our own membership.
    const foreign = makeMembership({ memberId: 'other-member', eventId: '$old-membership' });
    session.memberships = [foreign];
    session.emit(MatrixRTCSessionEvent.MembershipsChanged, [], [foreign]);

    const current = makeMembership({ eventId: '$current-membership' });
    session.memberships = [current];
    session.emit(MatrixRTCSessionEvent.MembershipsChanged, [], [current]);

    // Stale ring from an earlier call references $old-membership: must not count as sent.
    room.emit(
      RoomEvent.LocalEchoUpdated,
      makeRingEvent(EventStatus.SENT, { refEventId: '$old-membership' }),
      room
    );
    session.emit(MatrixRTCSessionEvent.DidSendCallNotification, {
      event_id: '$old-ring',
      notification_type: 'ring',
      'm.relates_to': { rel_type: RelationType.Reference, event_id: '$old-membership' },
    });

    vi.advanceTimersByTime(RING_ECHO_TIMEOUT_MS);
    stop();

    expect(warn).toHaveBeenCalledWith('[call-ring] calls.ring.missing_echo', {
      has_membership_event_id: true,
      member_count: 1,
      timeout_ms: RING_ECHO_TIMEOUT_MS,
    });
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

    expect(warn).toHaveBeenCalledWith('[call-ring] calls.ring.missing_echo', {
      has_membership_event_id: false,
      member_count: 1,
      timeout_ms: RING_ECHO_TIMEOUT_MS,
    });
  });

  it('omits notify decision inputs when no notify decision was made', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const session = new FakeSession();
    const room = new FakeRoom(2);

    const stop = startCallRingTrace({
      room: room as unknown as Room,
      session: session as unknown as MatrixRTCSession,
      ownMembership: { userId: ME, deviceId: DEVICE, memberId: MEMBER_ID },
      encrypted: true,
    });
    stop();

    expect(info).toHaveBeenCalledWith('[call-ring] calls.ring.join.none', { encrypted: true });
    expect(deepTraceMocks.recordDeepTraceEvent).toHaveBeenCalledWith(
      'calls.ring.join.none',
      { encrypted: true },
      { flush: true }
    );
  });
});
