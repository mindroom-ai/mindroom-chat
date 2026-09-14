import { useTranslation } from 'react-i18next';
import React from 'react';
import { ApprovalArguments } from './ApprovalArguments';
import { ApprovalDecisionControls } from './ApprovalDecisionControls';
import { ApprovalControlProps, isApprovalPending } from './approvalActions';
import * as css from './ThreadApprovals.css';

export function ApprovalReviewCall({
  index,
  ...controls
}: ApprovalControlProps & { index: number }) {
  const { t } = useTranslation();
  const { record, action, now } = controls;
  const pending = isApprovalPending(record, action, now);
  const status = pending ? action?.status ?? 'pending' : record.approval.status;
  const statusLabel = t(`mindroomUi.messages.approvalReviewCall.status.${status}`);
  return (
    <div className={css.Call} data-approval-id={record.eventId}>
      <small>
        {t('mindroomUi.messages.approvalReviewCall.callStatus', {
          number: index + 1,
          status: statusLabel,
        })}
      </small>
      <ApprovalArguments approval={record.approval} />
      <ApprovalDecisionControls {...controls} index={index} />
    </div>
  );
}
