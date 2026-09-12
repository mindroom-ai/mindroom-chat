import React from 'react';
import { ApprovalArguments } from './ApprovalArguments';
import { ApprovalDecisionControls } from './ApprovalDecisionControls';
import { ApprovalControlProps, isApprovalPending } from './approvalActions';
import * as css from './ThreadApprovals.css';

export function ApprovalReviewCall({
  index,
  ...controls
}: ApprovalControlProps & { index: number }) {
  const { record, action, now } = controls;
  const pending = isApprovalPending(record, action, now);
  return (
    <div className={css.Call} data-approval-id={record.eventId}>
      <small>
        Call {index + 1} · {pending ? action?.status ?? 'pending' : record.approval.status}
      </small>
      <ApprovalArguments approval={record.approval} />
      <ApprovalDecisionControls {...controls} index={index} />
    </div>
  );
}
