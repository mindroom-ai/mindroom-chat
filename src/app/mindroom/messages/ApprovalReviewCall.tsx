import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { canSubmitApprovalDecision } from './approvalActions';
import { ApprovalArguments } from './ApprovalArguments';
import { ThreadApprovalRecord } from './threadApprovalModel';
import { useThreadApprovals } from './ThreadApprovalProvider';
import * as css from './ThreadApprovals.css';

export function ApprovalReviewCall({
  record,
  index,
}: {
  record: ThreadApprovalRecord;
  index: number;
}) {
  const context = useThreadApprovals();
  const user = useMatrixClient().getUserId();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const reasonInput = useRef<HTMLInputElement>(null);
  const denyTrigger = useRef<HTMLButtonElement>(null);
  const restoreDenyFocus = useRef(false);
  const action = context?.actions.get(record.eventId);
  const available = !!context && canSubmitApprovalDecision(record, user, action, context.now);
  useEffect(() => {
    if (!available) return;
    if (denying) reasonInput.current?.focus();
    else if (restoreDenyFocus.current) {
      restoreDenyFocus.current = false;
      denyTrigger.current?.focus();
    }
  }, [available, denying]);
  if (!context) return null;
  const pending = context.pendingEventIds.has(record.eventId);
  return (
    <div className={css.Call} data-approval-id={record.eventId}>
      <div className={css.CallHeader}>
        <small>
          Call {index + 1} · {pending ? action?.status ?? 'pending' : record.approval.status}
        </small>
        {available && !denying && (
          <div className={css.Actions}>
            {record.approval.approvable && (
              <Button
                size="300"
                variant="Success"
                outlined
                onClick={() => {
                  void context.submit(record, { status: 'approved' });
                }}
              >
                <Text size="B300">Approve</Text>
              </Button>
            )}
            <Button
              ref={denyTrigger}
              size="300"
              variant="Critical"
              outlined
              onClick={() => setDenying(true)}
            >
              <Text size="B300">Deny</Text>
            </Button>
          </div>
        )}
      </div>
      <ApprovalArguments approval={record.approval} />
      {available && denying && (
        <form
          className={css.Stack}
          onSubmit={(event) => {
            event.preventDefault();
            void context.submit(record, { status: 'denied', reason });
          }}
        >
          <Input
            ref={reasonInput}
            aria-label={`Reason for denying call ${index + 1} (optional)`}
            placeholder="Denial reason (optional)"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <div className={css.Actions}>
            <Button type="submit" size="300" variant="Critical">
              <Text size="B300">Confirm deny</Text>
            </Button>
            <Button
              type="button"
              size="300"
              outlined
              onClick={() => {
                restoreDenyFocus.current = true;
                setDenying(false);
              }}
            >
              <Text size="B300">Cancel</Text>
            </Button>
          </div>
        </form>
      )}
      {action?.error && <p role="alert">{action.error} Retry this call using its buttons.</p>}
      {!record.approval.approvable && pending && <p>This call cannot be approved here.</p>}
    </div>
  );
}
