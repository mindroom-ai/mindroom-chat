import { MsgType, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/types';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { discardFailedLocalEcho } from '../matrix/protocol/pendingLocalEcho';
import type { ParsedScheduledTask } from '../matrix/protocol/scheduledTaskContract';
import { getMessageRelation } from '../matrix/send/composeMessageRelation';
import { isCommandSafeTaskId } from '../schedules/roomSchedules';

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
