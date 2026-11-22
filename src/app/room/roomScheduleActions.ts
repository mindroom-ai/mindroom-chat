import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MsgType,
  RoomEvent,
  RoomMemberEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/types';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import type { IPowerLevels } from '../matrix/hooks/usePowerLevels';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { isMindroomResponderForViewer } from '../matrix/protocol/agentIdentity';
import { discardFailedLocalEcho } from '../matrix/protocol/pendingLocalEcho';
import {
  MINDROOM_ACCOUNTS_STATE_EVENT,
  MINDROOM_ROUTER_STATE_EVENT,
  boundRoomRoster,
  trustedRoomAccountIds,
  trustedRouterUserId,
} from '../matrix/protocol/routerBinding';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { getMessageRelation } from '../matrix/send/composeMessageRelation';
import { StateEvent } from '../matrix/types/room';
import { isCommandSafeTaskId } from '../schedules/roomSchedules';

const EMPTY_IGNORED_USERS: ReadonlySet<string> = new Set();

const computeHasJoinedMindroomAgent = (
  room: Room,
  viewerUserId: string,
  boundRouterId: string | undefined,
  rosterAccountIds: ReadonlySet<string>
): boolean => {
  const joinedMembers = typeof room.getJoinedMembers === 'function' ? room.getJoinedMembers() : [];
  const joinedIds = new Set(joinedMembers.map((member) => member.userId));
  const trustedAccountIds = trustedRoomAccountIds(
    boundRouterId,
    rosterAccountIds,
    joinedIds,
    EMPTY_IGNORED_USERS
  );
  return joinedMembers.some((member) =>
    isMindroomResponderForViewer(member.userId, viewerUserId, trustedAccountIds)
  );
};

/**
 * True when the room currently has at least one joined, recognized MindRoom agent
 * (same-homeserver `mindroom_*` member, or an account trusted via `io.mindroom.router` /
 * `io.mindroom.accounts`). Invited-only accounts and unrelated federated `mindroom_*`
 * accounts do not qualify, and a bare `@mindroom_router` account is not required.
 */
export function useHasJoinedMindroomAgent(
  mx: MatrixClient,
  room: Room,
  powerLevels: IPowerLevels,
  roomCreators: ReadonlySet<string>,
  enabled = true
): boolean {
  const routerBindingEvent = useStateEvent(
    room,
    MINDROOM_ROUTER_STATE_EVENT,
    enabled ? '' : null
  );
  const routerBinding =
    typeof routerBindingEvent?.isRedacted === 'function' && !routerBindingEvent.isRedacted()
      ? routerBindingEvent
      : undefined;
  const rawPowerLevelsEvent = useStateEvent(
    room,
    StateEvent.RoomPowerLevels,
    enabled ? '' : null
  );
  const rawPowerLevels =
    typeof rawPowerLevelsEvent?.getContent === 'function'
      ? rawPowerLevelsEvent.getContent()
      : undefined;
  const boundRouterId = useMemo(
    () =>
      enabled
        ? trustedRouterUserId(routerBinding, powerLevels, roomCreators, rawPowerLevels)
        : undefined,
    [enabled, routerBinding, powerLevels, roomCreators, rawPowerLevels]
  );
  const rosterEvent = useStateEvent(
    room,
    MINDROOM_ACCOUNTS_STATE_EVENT,
    enabled ? boundRouterId ?? null : null
  );
  const roster =
    typeof rosterEvent?.isRedacted === 'function' && !rosterEvent.isRedacted()
      ? rosterEvent
      : undefined;
  const rosterAccountIds = useMemo(
    () => boundRoomRoster(boundRouterId, roster),
    [boundRouterId, roster]
  );

  const viewerUserId = mx.getSafeUserId();
  const compute = useCallback(
    () =>
      enabled
        ? computeHasJoinedMindroomAgent(room, viewerUserId, boundRouterId, rosterAccountIds)
        : false,
    [boundRouterId, enabled, room, rosterAccountIds, viewerUserId]
  );

  // Derive synchronously when inputs change; membership events only commit when the boolean flips.
  const derivedValue = useMemo(() => compute(), [compute]);
  const [override, setOverride] = useState<{ compute: () => boolean; value: boolean }>();
  const currentValue = override?.compute === compute ? override.value : derivedValue;
  const currentValueRef = useRef(currentValue);
  useLayoutEffect(() => {
    currentValueRef.current = currentValue;
  }, [currentValue]);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    const syncEligibility = () => {
      if (disposed) return;
      const next = compute();
      if (next !== currentValueRef.current) {
        currentValueRef.current = next;
        setOverride({ compute, value: next });
      }
    };
    const onMember = (
      event: MatrixEvent | undefined,
      member?: RoomMember,
      oldMembership?: string
    ) => {
      const eventRoomId = event?.getRoomId?.() ?? member?.roomId;
      if (eventRoomId !== room.roomId) return;
      const nextMembership = member?.membership ?? event?.getContent?.()?.membership;
      // Only treat the SDK's own prior local membership as unchanged; an undefined oldMembership
      // can mean a lazy-loaded member whose latest server event was a join->join profile edit.
      if (
        oldMembership !== undefined &&
        nextMembership !== undefined &&
        oldMembership === nextMembership
      ) {
        return;
      }
      if (currentValueRef.current && nextMembership === 'join') return;
      if (!currentValueRef.current && nextMembership !== undefined && nextMembership !== 'join') {
        return;
      }
      const userId = member?.userId ?? event?.getStateKey?.();
      if (
        userId &&
        userId !== boundRouterId &&
        !rosterAccountIds.has(userId) &&
        !isMindroomResponderForViewer(userId, viewerUserId, EMPTY_IGNORED_USERS)
      ) {
        return;
      }
      syncEligibility();
    };
    const hasClientListeners =
      typeof mx.on === 'function' && typeof mx.removeListener === 'function';
    const hasRoomListeners =
      typeof room.on === 'function' && typeof room.removeListener === 'function';
    if (hasClientListeners) {
      mx.on(RoomMemberEvent.Membership, onMember);
    }
    if (hasRoomListeners) {
      room.on(RoomEvent.CurrentStateUpdated, syncEligibility);
    }
    return () => {
      disposed = true;
      if (hasClientListeners) {
        mx.removeListener(RoomMemberEvent.Membership, onMember);
      }
      if (hasRoomListeners) {
        room.removeListener(RoomEvent.CurrentStateUpdated, syncEligibility);
      }
    };
  }, [boundRouterId, compute, enabled, mx, room, rosterAccountIds, viewerUserId]);

  return currentValue;
}

/**
 * Posts `!cancel_schedule <taskId>` to the task's confirmed destination (its thread or the room
 * timeline) and discards any failed local echo if sending fails.
 */
export async function sendCancelScheduledTask(
  mx: MatrixClient,
  room: Room,
  task: ParsedScheduledTask
): Promise<void> {
  if (!isCommandSafeTaskId(task.taskId)) {
    throw new Error('Unsupported task ID');
  }
  // Always post the cancel command to the task's own confirmed destination, never falling back
  // to the room timeline for a thread-bound task whose thread ID is unconfirmed.
  let cancelTargetThreadId: string | undefined;
  if (!task.newThread && task.threadId) {
    if (!isConfirmedMatrixEventId(task.threadId)) {
      throw new Error('Unconfirmed thread destination');
    }
    cancelTargetThreadId = task.threadId;
  }
  const relation = getMessageRelation(undefined, undefined, cancelTargetThreadId);
  const content = {
    msgtype: MsgType.Text,
    body: `!cancel_schedule ${task.taskId}`,
    ...(relation ? { 'm.relates_to': relation } : {}),
  } as RoomMessageEventContent;
  const txnId = mx.makeTxnId();
  try {
    await mx.sendMessage(room.roomId, cancelTargetThreadId ?? null, content, txnId);
  } catch (error) {
    discardFailedLocalEcho(mx, room.getEventForTxnId(txnId));
    throw error;
  }
}
