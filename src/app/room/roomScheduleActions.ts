import { useEffect, useMemo, useState } from 'react';
import {
  MsgType,
  RoomMemberEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/types';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import type { IPowerLevels } from '../matrix/hooks/usePowerLevels';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
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
  const routerBindingEvent = useStateEvent(room, MINDROOM_ROUTER_STATE_EVENT);
  const routerBinding =
    typeof routerBindingEvent?.isRedacted === 'function' && !routerBindingEvent.isRedacted()
      ? routerBindingEvent
      : undefined;
  const rawPowerLevelsEvent = useStateEvent(room, StateEvent.RoomPowerLevels);
  const rawPowerLevels =
    typeof rawPowerLevelsEvent?.getContent === 'function'
      ? rawPowerLevelsEvent.getContent()
      : undefined;
  const boundRouterId = useMemo(
    () => trustedRouterUserId(routerBinding, powerLevels, roomCreators, rawPowerLevels),
    [routerBinding, powerLevels, roomCreators, rawPowerLevels]
  );
  const rosterEvent = useStateEvent(room, MINDROOM_ACCOUNTS_STATE_EVENT, boundRouterId ?? null);
  const roster =
    typeof rosterEvent?.isRedacted === 'function' && !rosterEvent.isRedacted()
      ? rosterEvent
      : undefined;
  const rosterAccountIds = useMemo(
    () => boundRoomRoster(boundRouterId, roster),
    [boundRouterId, roster]
  );

  const [membershipRevision, setMembershipRevision] = useState(0);
  useEffect(() => {
    if (!enabled || typeof mx.on !== 'function' || typeof mx.removeListener !== 'function') {
      return undefined;
    }
    let disposed = false;
    const refresh = () => {
      if (!disposed) setMembershipRevision((rev) => rev + 1);
    };
    const onMember = (event: MatrixEvent | undefined, member?: RoomMember) => {
      const eventRoomId = event?.getRoomId?.() ?? member?.roomId;
      if (eventRoomId === room.roomId) refresh();
    };
    const onStateMembers = (_event: MatrixEvent, state: { roomId?: string }) => {
      if (state?.roomId === room.roomId) refresh();
    };
    mx.on(RoomMemberEvent.Membership, onMember);
    mx.on(RoomStateEvent.Members, onStateMembers);
    return () => {
      disposed = true;
      mx.removeListener(RoomMemberEvent.Membership, onMember);
      mx.removeListener(RoomStateEvent.Members, onStateMembers);
    };
  }, [enabled, mx, room]);

  const viewerUserId = mx.getSafeUserId();
  return useMemo(() => {
    if (!enabled) return false;
    void membershipRevision;
    const joinedMembers =
      typeof room.getJoinedMembers === 'function' ? room.getJoinedMembers() : [];
    const joinedIds = new Set(joinedMembers.map((member) => member.userId));
    const trustedAccountIds = trustedRoomAccountIds(
      boundRouterId,
      rosterAccountIds,
      joinedIds,
      EMPTY_IGNORED_USERS
    );
    return joinedMembers.some(
      (member) =>
        isMindroomAgentUserIdForViewer(member.userId, viewerUserId) ||
        trustedAccountIds.has(member.userId)
    );
  }, [boundRouterId, enabled, membershipRevision, room, rosterAccountIds, viewerUserId]);
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
  if (!isCommandSafeTaskId(task.taskId)) return;
  // Always post the cancel command to the task's own destination (never an unrelated or local thread).
  const cancelTargetThreadId =
    !task.newThread && task.threadId
      ? isConfirmedMatrixEventId(task.threadId)
        ? task.threadId
        : undefined
      : undefined;
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
