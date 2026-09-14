import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      {!record.approval.approvable && (
        <p>{t('mindroomUi.messages.approvalDecisionControls.thisRequestCannotBeApprovedHere')}</p>
      )}
      {submitted && (
        <p role="status">
          {t('mindroomUi.messages.approvalDecisionControls.submittedWaitingForRoomUpdate')}
        </p>
      )}
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
                <Text size="B300">
                  {durations.length > 0
                    ? t('mindroomUi.messages.approvalDecisionControls.approveOnce')
                    : t('mindroomUi.messages.approvalDecisionControls.approve')}
                </Text>
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
              <Text size="B300">{t('mindroomUi.messages.approvalDecisionControls.deny')}</Text>
            </Button>
          </div>
          {durations.length > 0 && (
            <div
              className={css.Actions}
              role="group"
              aria-label={t('mindroomUi.messages.approvalDecisionControls.autoApprovalDuration')}
            >
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
                  <Text size="B300">
                    {t('mindroomUi.messages.approvalDecisionControls.autoApproveMinutes', {
                      count: duration / 60,
                    })}
                  </Text>
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
                ? t('mindroomUi.messages.approvalDecisionControls.denyReasonOptional')
                : t('mindroomUi.messages.approvalDecisionControls.denyCallReasonOptional', {
                    number: index + 1,
                  })
            }
            placeholder={t('mindroomUi.messages.approvalDecisionControls.denialReasonOptional')}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <div className={css.Actions}>
            <Button type="submit" size="300" variant="Critical" disabled={disabled}>
              <Text size="B300">
                {index === undefined
                  ? t('mindroomUi.messages.approvalDecisionControls.confirmDeny')
                  : t('mindroomUi.messages.approvalDecisionControls.confirmDeny2')}
              </Text>
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
              <Text size="B300">{t('mindroomUi.messages.approvalDecisionControls.cancel')}</Text>
            </Button>
          </div>
        </form>
      )}
      {action?.error && <p role="alert">{action.error}</p>}
    </>
  );
}
