import type { MatrixClient } from 'matrix-js-sdk';
import { canSubmitApprovalDecision } from '../approvals/approvalActions';
import { markThreadAsRead } from '../notifications/readReceipts';
import type { ThreadApprovalRecord } from '../matrix/protocol/threadApprovalModel';
import {
  buildToolApprovalResponseContent,
  MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
} from '../matrix/protocol/toolApproval';
import { needsYou, type ActivityRow } from './activityRows';

/**
 * Approves or denies a tool approval from its Activity row, as the approval card in the thread
 * does. Rejects without sending when the user may not answer it, or may not approve it.
 */
export const answerApproval = async (
  mx: MatrixClient,
  roomId: string,
  record: ThreadApprovalRecord,
  status: 'approved' | 'denied'
): Promise<void> => {
  if (!canSubmitApprovalDecision(record, mx.getUserId(), undefined)) {
    throw new Error('This approval is not yours to answer.');
  }
  if (status === 'approved' && !record.approval.approvable) {
    throw new Error('This call cannot be approved.');
  }
  const threadId = record.approval.threadId ?? record.eventId;
  await mx.sendEvent(
    roomId,
    MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT as never,
    buildToolApprovalResponseContent(status, threadId, record.eventId) as never
  );
};

/** Mark all read: sends a read receipt for each unread thread row that waits for no answer. */
export const markActivityRowsRead = async (
  mx: MatrixClient,
  rows: ActivityRow[],
  hideActivity: boolean
): Promise<void> => {
  const reads = rows.flatMap((row) =>
    row.type === 'thread' && row.unread && !needsYou(row)
      ? [markThreadAsRead(mx, row.entry.roomId, row.entry.threadRootId, hideActivity)]
      : []
  );
  await Promise.all(reads);
};
