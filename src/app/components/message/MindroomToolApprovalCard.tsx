import classNames from 'classnames';
import { Box, Button, Icon, Icons, Input, Spinner, Text } from 'folds';
import React, { FormEventHandler, useEffect, useMemo, useRef, useState } from 'react';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { approveRequest, denyRequest } from '../../features/approvals/api';
import { ToolApprovalData } from './mindroomToolApproval';
import * as css from './MindroomToolApprovalCard.css';

type MindroomToolApprovalCardProps = {
  approval: ToolApprovalData;
};

const getTimestamp = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getActionErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Request failed. Please try again.';

const isResolvedApprovalStatus = (status: ToolApprovalData['status']): boolean =>
  status === 'approved' || status === 'denied' || status === 'expired';

const getStatusText = (status: ToolApprovalData['status'] | 'submitted'): string => {
  switch (status) {
    case 'approved':
      return 'Approved';
    case 'denied':
      return 'Denied';
    case 'expired':
      return 'Expired';
    case 'submitted':
      return 'Submitted';
    case 'pending':
    default:
      return 'Pending approval';
  }
};

const getStatusIcon = (status: ToolApprovalData['status'] | 'submitted') => {
  switch (status) {
    case 'approved':
      return Icons.CheckTwice;
    case 'denied':
      return Icons.Cross;
    case 'expired':
      return Icons.Warning;
    case 'submitted':
      return Icons.Check;
    case 'pending':
    default:
      return Icons.Code;
  }
};

export function MindroomToolApprovalCard({ approval }: MindroomToolApprovalCardProps) {
  const mx = useMatrixClient();
  const [showDenyForm, setShowDenyForm] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>();
  const submittingRef = useRef(false);
  const denyTriggerRef = useRef<HTMLButtonElement>(null);
  const denyReasonInputRef = useRef<HTMLInputElement>(null);
  const confirmDenyButtonRef = useRef<HTMLButtonElement>(null);
  const restoreDenyTriggerFocusRef = useRef(false);
  const createdTs = getTimestamp(approval.createdAt);
  const resolvedTs = getTimestamp(approval.resolvedAt);
  const createdRelative = useRelativeTime(createdTs);
  const resolvedRelative = useRelativeTime(resolvedTs);
  const accessToken = mx.getAccessToken() ?? undefined;
  const argumentsText = useMemo(
    () => JSON.stringify(approval.arguments, null, 2) ?? '{}',
    [approval.arguments]
  );

  const [requestState, submitAction] = useAsyncCallback<void, Error, ['approve' | 'deny', string?]>(
    async (action, reason) => {
      if (action === 'approve') {
        await approveRequest(approval.approvalId, accessToken);
        return;
      }

      await denyRequest(approval.approvalId, reason, accessToken);
    }
  );

  const submitting = requestState.status === AsyncStatus.Loading;
  const submitted = requestState.status === AsyncStatus.Success;
  const disableActions = submitting || submitted;
  const displayStatus = approval.status === 'pending' && submitted ? 'submitted' : approval.status;

  useEffect(() => {
    if (requestState.status === AsyncStatus.Error) {
      setErrorMessage(getActionErrorMessage(requestState.error));
      return;
    }

    setErrorMessage(undefined);
  }, [requestState]);

  useEffect(() => {
    if (requestState.status !== AsyncStatus.Loading) {
      submittingRef.current = false;
    }
  }, [requestState.status]);

  useEffect(() => {
    if (isResolvedApprovalStatus(approval.status)) {
      setErrorMessage(undefined);
    }
  }, [approval.status]);

  useEffect(() => {
    if (!showDenyForm || approval.status !== 'pending' || submitted) return;

    if (denyReasonInputRef.current) {
      denyReasonInputRef.current.focus();
      return;
    }

    confirmDenyButtonRef.current?.focus();
  }, [approval.status, showDenyForm, submitted]);

  useEffect(() => {
    if (showDenyForm || !restoreDenyTriggerFocusRef.current) return;

    restoreDenyTriggerFocusRef.current = false;
    denyTriggerRef.current?.focus();
  }, [showDenyForm]);

  const cardClassName = classNames(css.Card, {
    [css.CardApproved]: approval.status === 'approved',
    [css.CardDenied]: approval.status === 'denied',
    [css.CardExpired]: approval.status === 'expired',
  });

  const submitApprovalAction = (action: 'approve' | 'deny', reason?: string) => {
    if (approval.status !== 'pending' || submitted || submittingRef.current) return;

    submittingRef.current = true;
    void submitAction(action, reason).catch(() => undefined);
  };

  const handleApprove = () => {
    submitApprovalAction('approve');
  };

  const handleStartDeny = () => {
    if (disableActions) return;
    restoreDenyTriggerFocusRef.current = false;
    setShowDenyForm(true);
  };

  const handleCancelDeny = () => {
    if (disableActions) return;
    restoreDenyTriggerFocusRef.current = true;
    setShowDenyForm(false);
    setDenyReason('');
  };

  const handleConfirmDeny: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    submitApprovalAction('deny', denyReason);
  };

  const resolvedMeta =
    approval.status === 'approved'
      ? `Approved by ${approval.resolvedBy ?? 'unknown'}`
      : approval.status === 'denied'
        ? `Denied by ${approval.resolvedBy ?? 'unknown'}`
        : approval.status === 'expired'
          ? 'Approval expired'
          : undefined;

  return (
    <Box className={cardClassName} direction="Column" gap="200" aria-label="Tool approval request">
      <Box className={css.Header}>
        <Text size="T300" className={css.ToolName}>
          {approval.toolName}
        </Text>
        <Box as="span" className={css.StatusLabel}>
          <Icon size="50" src={getStatusIcon(displayStatus)} />
          <Text size="T200">{getStatusText(displayStatus)}</Text>
        </Box>
      </Box>

      {approval.status === 'pending' ? (
        <Box className={css.Meta}>
          <Text size="T200">{approval.agentName}</Text>
          {createdRelative && <Text className={css.MetaDot}>•</Text>}
          {createdRelative && <Text size="T200">{createdRelative}</Text>}
          {!createdRelative && approval.createdAt && (
            <>
              <Text className={css.MetaDot}>•</Text>
              <Text size="T200">{approval.createdAt}</Text>
            </>
          )}
        </Box>
      ) : (
        resolvedMeta && (
          <Box className={css.Meta}>
            <Text size="T200">{resolvedMeta}</Text>
            {resolvedRelative && <Text className={css.MetaDot}>•</Text>}
            {resolvedRelative && <Text size="T200">{resolvedRelative}</Text>}
          </Box>
        )
      )}

      <details className={css.Details}>
        <summary className={css.DetailsSummary}>
          <span className={css.DetailsSummaryLabel}>
            <Icon size="50" src={Icons.ChevronBottom} />
            <Text size="T200">Arguments</Text>
          </span>
        </summary>
        <pre className={css.JsonBlock}>{argumentsText}</pre>
      </details>

      {approval.status === 'denied' && approval.resolutionReason && (
        <Box direction="Column" gap="100">
          <Text size="T200">
            <b>Reason</b>
          </Text>
          <Text size="T200" className={css.ReasonText}>
            {approval.resolutionReason}
          </Text>
        </Box>
      )}

      {approval.status === 'pending' && submitted && (
        <Text size="T200">Submitted. Waiting for room update.</Text>
      )}

      {approval.status === 'pending' && !showDenyForm && !submitted && (
        <Box className={css.Actions}>
          <Button
            size="300"
            variant="Success"
            fill="Solid"
            radii="300"
            onClick={handleApprove}
            disabled={disableActions}
            before={
              submitting ? <Spinner size="100" variant="Success" fill="Solid" /> : <Icon src={Icons.Check} />
            }
          >
            <Text size="B300">Approve</Text>
          </Button>
          <Button
            size="300"
            variant="Critical"
            outlined
            radii="300"
            ref={denyTriggerRef}
            onClick={handleStartDeny}
            disabled={disableActions}
            before={<Icon src={Icons.Cross} />}
          >
            <Text size="B300">Deny</Text>
          </Button>
        </Box>
      )}

      {approval.status === 'pending' && showDenyForm && !submitted && (
        <Box as="form" className={css.DenyForm} onSubmit={handleConfirmDeny}>
          <Text size="T200">
            <b>Deny reason</b>{' '}
            <Text as="span" size="T200">
              (optional)
            </Text>
          </Text>
          <Input
            ref={denyReasonInputRef}
            value={denyReason}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setDenyReason(event.currentTarget.value)
            }
            aria-label="Deny reason (optional)"
            placeholder="Why should this tool call be denied?"
            variant="Background"
          />
          <Box className={css.Actions}>
            <Button
              ref={confirmDenyButtonRef}
              type="submit"
              size="300"
              variant="Critical"
              fill="Solid"
              radii="300"
              disabled={disableActions}
              before={
                submitting ? (
                  <Spinner size="100" variant="Critical" fill="Solid" />
                ) : (
                  <Icon src={Icons.Cross} />
                )
              }
            >
              <Text size="B300">Confirm Deny</Text>
            </Button>
            <Button
              type="button"
              size="300"
              outlined
              radii="300"
              onClick={handleCancelDeny}
              disabled={disableActions}
            >
              <Text size="B300">Cancel</Text>
            </Button>
          </Box>
        </Box>
      )}

      {errorMessage && (
        <Text size="T200" style={{ color: 'inherit' }}>
          {errorMessage}
        </Text>
      )}
    </Box>
  );
}
