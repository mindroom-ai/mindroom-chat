import {
  EventStatus,
  EventType,
  RoomEvent,
  type MatrixEvent,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
import {
  MatrixRTCSessionEvent,
  type CallMembership,
  type MatrixRTCSession,
  type MatrixRTCSessionEventHandlerMap,
} from 'matrix-js-sdk/lib/matrixrtc';
import { recordDeepTraceEvent } from '../diagnostics/deepTrace';
import { matchesEnum } from '../lib/matchesEnum';

/** Rooms with at most this many joined members ring on call start, even outside `m.direct`. */
export const MAX_RING_JOINED_MEMBERS = 3;

/** How long after our own membership echo while alone a missing ring echo is reported. */
export const RING_ECHO_TIMEOUT_MS = 3_000;

export type CallNotifyInputs = {
  peopleInCall: number;
  direct: boolean;
  joinedMembers: number;
};

export type CallNotifyChoice = 'ring' | 'notification' | undefined;

/**
 * Picks whether starting a call rings the room (`ring`), notifies a group (`notification`), or
 * sends nothing (`undefined`, when somebody is already in the call).
 */
export const chooseCallNotify = ({
  peopleInCall,
  direct,
  joinedMembers,
}: CallNotifyInputs): CallNotifyChoice => {
  if (peopleInCall > 0) return undefined;
  return direct || (joinedMembers >= 2 && joinedMembers <= MAX_RING_JOINED_MEMBERS)
    ? 'ring'
    : 'notification';
};

export type CallRingTraceOptions = {
  room: Room;
  session: MatrixRTCSession;
  ownMembership: { userId: string; deviceId: string; memberId: string };
  encrypted: boolean;
  notify?: 'ring' | 'notification';
  notifyInputs?: CallNotifyInputs;
  timeoutMs?: number;
};

type LocalEchoStatusKey =
  | 'encrypting'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'not_sent'
  | 'cancelled'
  | 'unknown';

const STATUS_KEYS: Record<EventStatus, LocalEchoStatusKey> = {
  [EventStatus.ENCRYPTING]: 'encrypting',
  [EventStatus.QUEUED]: 'queued',
  [EventStatus.SENDING]: 'sending',
  [EventStatus.SENT]: 'sent',
  [EventStatus.NOT_SENT]: 'not_sent',
  [EventStatus.CANCELLED]: 'cancelled',
};

const toStatusKey = (status: EventStatus | null): LocalEchoStatusKey =>
  status && status in STATUS_KEYS ? STATUS_KEYS[status] : 'unknown';

const readErrorSummary = (
  error: unknown
): {
  name?: string;
  errcode?: string;
  httpStatus?: number;
  message?: string;
} => {
  if (!error || typeof error !== 'object') {
    return typeof error === 'string' ? { message: error } : {};
  }
  const record = error as {
    name?: unknown;
    errcode?: unknown;
    httpStatus?: unknown;
    message?: unknown;
  };
  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    errcode: typeof record.errcode === 'string' ? record.errcode : undefined,
    httpStatus:
      typeof record.httpStatus === 'number' && Number.isFinite(record.httpStatus)
        ? record.httpStatus
        : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
};

const findOwnMembership = (
  memberships: readonly CallMembership[],
  own: { userId: string; deviceId: string; memberId: string }
): CallMembership | undefined =>
  memberships.find(
    (membership) =>
      membership.sender === own.userId &&
      membership.deviceId === own.deviceId &&
      membership.memberId === own.memberId
  ) ??
  memberships.find(
    (membership) => membership.sender === own.userId && membership.deviceId === own.deviceId
  );

const logInfo = (step: string, details: Record<string, unknown>) => {
  // eslint-disable-next-line no-console
  console.info(`[call-ring] ${step}`, details);
};

const logWarn = (step: string, details: Record<string, unknown>) => {
  // eslint-disable-next-line no-console
  console.warn(`[call-ring] ${step}`, details);
};

/**
 * Traces one call join's ring lifecycle to the console and deep diagnostics without modifying the
 * SDK's send path: the `notify` choice and its inputs, the own membership echo (including whether
 * it carries an event ID), every ring local echo status change, `DidSendCallNotification`, and a
 * warning if no ring local echo appears within 3 s of our own membership arriving while alone.
 */
export const startCallRingTrace = ({
  room,
  session,
  ownMembership,
  encrypted,
  notify,
  notifyInputs,
  timeoutMs = RING_ECHO_TIMEOUT_MS,
}: CallRingTraceOptions): (() => void) => {
  const inputs: CallNotifyInputs = notifyInputs ?? {
    peopleInCall: session.memberships.length,
    direct: false,
    joinedMembers: room.getJoinedMemberCount(),
  };
  const choice = notify ?? 'none';

  logInfo('join', {
    roomId: room.roomId,
    notify: choice,
    encrypted,
    peopleInCall: inputs.peopleInCall,
    direct: inputs.direct,
    joinedMembers: inputs.joinedMembers,
  });
  recordDeepTraceEvent(
    `calls.ring.join.${choice}`,
    {
      encrypted,
      people_in_call: inputs.peopleInCall,
      direct: inputs.direct,
      joined_members: inputs.joinedMembers,
    },
    { flush: true }
  );

  let stopped = false;
  let sawRingEcho = false;
  let sawDidSend = false;
  let recordedOwnMembership = false;
  let lastOwnEventId: string | undefined;
  let missingTimer: ReturnType<typeof setTimeout> | undefined;
  const lastStatusByEvent = new WeakMap<MatrixEvent, EventStatus | null>();

  const clearMissingTimer = () => {
    if (missingTimer !== undefined) {
      clearTimeout(missingTimer);
      missingTimer = undefined;
    }
  };

  const onMembershipsChanged: MatrixRTCSessionEventHandlerMap[MatrixRTCSessionEvent.MembershipsChanged] =
    (oldMemberships, newMemberships) => {
      if (stopped) return;
      // Read from `session.memberships` directly so `eventId` is preserved.
      const current = session.memberships.length > 0 ? session.memberships : newMemberships;
      const own = findOwnMembership(current, ownMembership);
      if (!own) return;
      const hasEventId = Boolean(own.eventId);
      if (!recordedOwnMembership || own.eventId !== lastOwnEventId) {
        recordedOwnMembership = true;
        lastOwnEventId = own.eventId;
        logInfo('membership_echo', {
          roomId: room.roomId,
          hasEventId,
          membershipEventId: own.eventId,
          oldMemberCount: oldMemberships.length,
          memberCount: current.length,
        });
        recordDeepTraceEvent(
          'calls.ring.membership_echo',
          {
            has_event_id: hasEventId,
            old_member_count: oldMemberships.length,
            member_count: current.length,
          },
          { flush: true }
        );
      }
      if (
        notify &&
        current.length === 1 &&
        !sawRingEcho &&
        !sawDidSend &&
        missingTimer === undefined
      ) {
        missingTimer = setTimeout(() => {
          missingTimer = undefined;
          if (stopped || sawRingEcho || sawDidSend) return;
          const latestOwn = findOwnMembership(session.memberships, ownMembership);
          const latestHasEventId = Boolean(latestOwn?.eventId ?? lastOwnEventId);
          logWarn('missing_echo', {
            roomId: room.roomId,
            notify,
            hasMembershipEventId: latestHasEventId,
            membershipEventId: latestOwn?.eventId ?? lastOwnEventId,
            memberCount: session.memberships.length,
            timeoutMs,
          });
          recordDeepTraceEvent(
            'calls.ring.missing_echo',
            {
              has_membership_event_id: latestHasEventId,
              member_count: session.memberships.length,
              timeout_ms: timeoutMs,
            },
            { flush: true }
          );
        }, timeoutMs);
      }
    };

  const onLocalEchoUpdated: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event) => {
    if (stopped) return;
    if (!matchesEnum(event.getType(), EventType.RTCNotification)) return;
    if (event.getSender() !== ownMembership.userId) return;
    const status = event.status;
    if (status === null) return;
    if (lastStatusByEvent.has(event) && lastStatusByEvent.get(event) === status) return;
    lastStatusByEvent.set(event, status);

    sawRingEcho = true;
    clearMissingTimer();

    const statusKey = toStatusKey(status);
    const wireEncrypted = matchesEnum(event.getWireType(), EventType.RoomMessageEncrypted);
    const error = status === EventStatus.NOT_SENT ? readErrorSummary(event.error) : undefined;
    const details: Record<string, unknown> = {
      roomId: room.roomId,
      status,
      eventId: event.getId(),
      txnId: event.getTxnId(),
      wireType: event.getWireType(),
      ...(error ? { error } : {}),
    };
    if (status === EventStatus.NOT_SENT) logWarn('local_echo', details);
    else logInfo('local_echo', details);

    recordDeepTraceEvent(
      `calls.ring.local_echo.${statusKey}`,
      {
        encrypted: wireEncrypted,
        ...(error?.httpStatus !== undefined ? { http_status: error.httpStatus } : {}),
        ...(status === EventStatus.NOT_SENT ? { has_error: Boolean(event.error) } : {}),
      },
      { flush: true }
    );
  };

  const onDidSendNotification: MatrixRTCSessionEventHandlerMap[MatrixRTCSessionEvent.DidSendCallNotification] =
    (result) => {
      if (stopped) return;
      sawDidSend = true;
      clearMissingTimer();
      const sentType = result.notification_type === 'ring' ? 'ring' : 'notification';
      const hasEventId = Boolean(result.event_id);
      logInfo('sent', {
        roomId: room.roomId,
        notificationType: sentType,
        eventId: result.event_id,
      });
      recordDeepTraceEvent(
        `calls.ring.sent.${sentType}`,
        { has_event_id: hasEventId },
        { flush: true }
      );
    };

  session.on(MatrixRTCSessionEvent.MembershipsChanged, onMembershipsChanged);
  session.on(MatrixRTCSessionEvent.DidSendCallNotification, onDidSendNotification);
  room.on(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated);

  return () => {
    stopped = true;
    clearMissingTimer();
    session.off(MatrixRTCSessionEvent.MembershipsChanged, onMembershipsChanged);
    session.off(MatrixRTCSessionEvent.DidSendCallNotification, onDidSendNotification);
    room.off(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated);
  };
};
