import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Text } from 'folds';
import {
  ApprovalControlProps,
  getApprovalCapabilities,
  isApprovalPending,
} from './approvalActions';
import * as css from './ThreadApprovals.css';

export function ApprovalDecisionControls({
  record,
  userId,
  action,
  submit,
  now,
  canSend = true,
  showDurations = false,
  index,
}: ApprovalControlProps & { showDurations?: boolean; index?: number }) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const reasonInput = useRef<HTMLInputElement>(null);
  const denyTrigger = useRef<HTMLButtonElement>(null);
  const restoreDenyFocus = useRef(false);
  const eligibility = getApprovalCapabilities(record, userId, undefined, now);
  const capabilities = getApprovalCapabilities(record, userId, action, now);
  const pending = isApprovalPending(record, action, now);
  const submitted = action?.status === 'submitted';
  const disabled = !canSend || !capabilities.deny;
  const durations = canSend && showDurations ? eligibility.durations : [];
  useEffect(() => {
    if (!eligibility.deny) {
      setDenying(false);
      setReason('');
      return;
    }
    if (denying) reasonInput.current?.focus();
    else if (restoreDenyFocus.current) {
      restoreDenyFocus.current = false;
      denyTrigger.current?.focus();
    }
  }, [eligibility.deny, denying]);
  if (!pending) return null;
  return (
    <>
      {!record.approval.approvable && <p>This request cannot be approved here.</p>}
      {submitted && <p role="status">Submitted. Waiting for room update.</p>}
      {eligibility.deny && !submitted && !denying && (
        <>
          <div className={css.Actions}>
            {eligibility.approve && (
              <Button
                size="300"
                variant="Success"
                outlined
                disabled={disabled}
                onClick={() => {
                  if (canSend) void submit(record, { status: 'approved' });
                }}
              >
                <Text size="B300">{durations.length > 0 ? 'Approve once' : 'Approve'}</Text>
              </Button>
            )}
            <Button
              ref={denyTrigger}
              size="300"
              variant="Critical"
              outlined
              disabled={disabled}
              onClick={() => {
                if (!disabled) {
                  setReason('');
                  setDenying(true);
                }
              }}
            >
              <Text size="B300">Deny</Text>
            </Button>
          </div>
          {durations.length > 0 && (
            <div className={css.Actions} role="group" aria-label="Auto-approval duration">
              {durations.map((duration) => (
                <Button
                  key={duration}
                  type="button"
                  size="300"
                  outlined
                  disabled={disabled}
                  onClick={() => {
                    if (canSend) void submit(record, { status: 'approved', duration });
                  }}
                >
                  <Text size="B300">Auto-approve {duration / 60} min</Text>
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      {eligibility.deny && !submitted && denying && (
        <form
          className={css.Stack}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend) void submit(record, { status: 'denied', reason });
          }}
        >
          <Input
            ref={reasonInput}
            aria-label={
              index === undefined
                ? 'Deny reason (optional)'
                : `Reason for denying call ${index + 1} (optional)`
            }
            placeholder="Denial reason (optional)"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <div className={css.Actions}>
            <Button type="submit" size="300" variant="Critical" disabled={disabled}>
              <Text size="B300">{index === undefined ? 'Confirm Deny' : 'Confirm deny'}</Text>
            </Button>
            <Button
              type="button"
              size="300"
              outlined
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                restoreDenyFocus.current = true;
                setDenying(false);
                setReason('');
              }}
            >
              <Text size="B300">Cancel</Text>
            </Button>
          </div>
        </form>
      )}
      {action?.error && <p role="alert">{action.error}</p>}
    </>
  );
}
