// Temporary diagnostic trace for call ring delivery, to be removed after the iPhone repro.
import {
  EventStatus,
  EventType,
  RelationType,
  RoomEvent,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import {
  MatrixRTCSessionEvent,
  type CallMembership,
  type MatrixRTCSession,
} from 'matrix-js-sdk/lib/matrixrtc';
import { recordDeepTraceEvent } from '../diagnostics/deepTrace';
import { matchesEnum } from '../lib/matchesEnum';
import type { CallNotifyInputs } from './callRings';

export const RING_ECHO_TIMEOUT_MS = 3_000;

export type CallRingTraceOptions = {
  room: Room;
  session: MatrixRTCSession;
  ownMembership: { userId: string; deviceId: string; memberId: string };
  encrypted: boolean;
  notify?: 'ring' | 'notification';
  notifyInputs?: CallNotifyInputs;
};

const emit = (name: string, data: Record<string, boolean | number>, warn = false): void => {
  // eslint-disable-next-line no-console
  (warn ? console.warn : console.info)(`[call-ring] ${name}`, data);
  recordDeepTraceEvent(name, data, { flush: true });
};

type WithRelatesTo = { 'm.relates_to'?: { rel_type?: unknown; event_id?: unknown } };

const refId = (content: WithRelatesTo): string | undefined => {
  const rel = content['m.relates_to'];
  return rel?.rel_type === RelationType.Reference && typeof rel.event_id === 'string'
    ? rel.event_id
    : undefined;
};

export const startCallRingTrace = ({
  room,
  session,
  ownMembership: own,
  encrypted,
  notify,
  notifyInputs,
}: CallRingTraceOptions): (() => void) => {
  emit(`calls.ring.join.${notify ?? 'none'}`, {
    encrypted,
    ...(notifyInputs
      ? {
          people_in_call: notifyInputs.peopleInCall,
          direct: notifyInputs.direct,
          joined_members: notifyInputs.joinedMembers,
        }
      : {}),
  });

  let stopped = false;
  let sawRing = false;
  let recordedOwn = false;
  let ownEventId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lastStatus = new WeakMap<MatrixEvent, EventStatus>();
  const findOwn = (list: readonly CallMembership[]) =>
    list.find(
      (m) => m.sender === own.userId && m.deviceId === own.deviceId && m.memberId === own.memberId
    );

  let latestMemberships: readonly CallMembership[] = session.memberships;

  const onMemberships = (oldList: CallMembership[], newList: CallMembership[]) => {
    if (stopped) return;
    latestMemberships = newList;
    const mine = findOwn(newList);
    if (!mine) return;
    if (!recordedOwn || mine.eventId !== ownEventId) {
      recordedOwn = true;
      ownEventId = mine.eventId;
      emit('calls.ring.membership_echo', {
        has_event_id: Boolean(mine.eventId),
        old_member_count: oldList.length,
        member_count: newList.length,
      });
    }
    if (notify && newList.length === 1 && !sawRing && timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        if (stopped || sawRing) return;
        const hasId = Boolean(findOwn(latestMemberships)?.eventId ?? ownEventId);
        emit(
          'calls.ring.missing_echo',
          {
            has_membership_event_id: hasId,
            member_count: latestMemberships.length,
            timeout_ms: RING_ECHO_TIMEOUT_MS,
          },
          true
        );
      }, RING_ECHO_TIMEOUT_MS);
    }
  };

  const onLocalEcho = (event: MatrixEvent) => {
    const status = event.status;
    if (stopped || !ownEventId || status === null || lastStatus.get(event) === status) return;
    if (
      !matchesEnum(event.getType(), EventType.RTCNotification) ||
      event.getSender() !== own.userId
    )
      return;
    if (refId(event.getContent()) !== ownEventId) return;
    lastStatus.set(event, status);
    sawRing = true;
    clearTimeout(timer);
    timer = undefined;
    const http = (event.error as { httpStatus?: unknown } | null)?.httpStatus;
    const failed = status === EventStatus.NOT_SENT;
    const data: Record<string, boolean | number> = {
      encrypted: matchesEnum(event.getWireType(), EventType.RoomMessageEncrypted),
    };
    if (failed) data.has_error = Boolean(event.error);
    if (typeof http === 'number' && Number.isFinite(http)) data.http_status = http;
    emit(`calls.ring.local_echo.${status}`, data, failed);
  };

  const onDidSend = (result: WithRelatesTo & { event_id?: string; notification_type?: string }) => {
    if (stopped || !ownEventId || refId(result) !== ownEventId) return;
    sawRing = true;
    clearTimeout(timer);
    timer = undefined;
    emit(`calls.ring.sent.${result.notification_type === 'ring' ? 'ring' : 'notification'}`, {
      has_event_id: Boolean(result.event_id),
    });
  };

  session.on(MatrixRTCSessionEvent.MembershipsChanged, onMemberships);
  session.on(MatrixRTCSessionEvent.DidSendCallNotification, onDidSend);
  room.on(RoomEvent.LocalEchoUpdated, onLocalEcho);
  return () => {
    stopped = true;
    clearTimeout(timer);
    session.off(MatrixRTCSessionEvent.MembershipsChanged, onMemberships);
    session.off(MatrixRTCSessionEvent.DidSendCallNotification, onDidSend);
    room.off(RoomEvent.LocalEchoUpdated, onLocalEcho);
  };
};
