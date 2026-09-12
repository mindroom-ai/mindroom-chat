import classNames from 'classnames';
import { Box, Button, Icon, Icons, Input, Spinner, Text } from 'folds';
import React, { FormEventHandler, useEffect, useMemo, useRef, useState } from 'react';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import {
  buildToolApprovalResponseContent,
  buildToolApprovalRevocationContent,
  getEffectiveToolApprovalStatus,
  MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT,
  parseToolApprovalExpiryTimestamp,
  ToolApprovalDuration,
  ToolApprovalData,
} from './toolApproval';
import * as css from './MindroomToolApprovalCard.css';

type MindroomToolApprovalCardProps = {
  approval: ToolApprovalData;
  roomId?: string;
  eventId?: string;
  threadId?: string;
};

const getTimestamp = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const MAX_TIMEOUT_DELAY = 2_147_483_647;

const formatExpiryCountdown = (expiresTs: number, currentTime = Date.now()): string => {
  const remainingSeconds = Math.max(0, Math.ceil((expiresTs - currentTime) / 1000));
  if (remainingSeconds < 60) {
    return `${remainingSeconds} sec`;
  }
  return `${Math.ceil(remainingSeconds / 60)} min`;
};

const getActionErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : 'Unable to send response. Please try again.';

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

type ApprovalActionKind = 'approve' | 'deny' | 'timed' | 'revoke';

type ApprovalActionResult = {
  cardKey: string;
  kind: ApprovalActionKind;
};

class ApprovalActionError extends Error {
  readonly cardKey: string;

  readonly kind: ApprovalActionKind;

  constructor(cardKey: string, kind: ApprovalActionKind, error: unknown) {
    super(getActionErrorMessage(error));
    this.name = 'ApprovalActionError';
    this.cardKey = cardKey;
    this.kind = kind;
  }
}

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

export function MindroomToolApprovalCard({
  approval,
  roomId,
  eventId,
  threadId,
}: MindroomToolApprovalCardProps) {
  const mx = useMatrixClient();
  const [denyCardKey, setDenyCardKey] = useState<string>();
  const [denyReason, setDenyReason] = useState('');
  const submittingActionRef = useRef<ApprovalActionResult>();
  const denyTriggerRef = useRef<HTMLButtonElement>(null);
  const denyReasonInputRef = useRef<HTMLInputElement>(null);
  const confirmDenyButtonRef = useRef<HTMLButtonElement>(null);
  const restoreDenyTriggerFocusRef = useRef(false);
  const requestedTs = getTimestamp(approval.requestedAt);
  const expiresTs = parseToolApprovalExpiryTimestamp(approval.expiresAt);
  const resolvedTs = getTimestamp(approval.resolvedAt);
  const effectiveStatus = getEffectiveToolApprovalStatus(approval.status, expiresTs);
  const grant = effectiveStatus === 'approved' ? approval.autoApproval : null;
  const grantExpiresTs = grant ? parseToolApprovalExpiryTimestamp(grant.expiresAt) : undefined;
  const requestedRelative = useRelativeTime(requestedTs);
  const resolvedRelative = useRelativeTime(resolvedTs);
  const [expiryCheckVersion, setExpiryCheckVersion] = useState(0);
  const responseThreadId = threadId ?? approval.threadId ?? eventId;
  const canonicalThreadId = threadId ?? approval.threadId;
  const cardKey = `${approval.approvalId}\u0000${eventId ?? ''}`;
  const canSendResponse = !!roomId && !!eventId && !!responseThreadId;
  const currentUserId = mx.getUserId();
  const isOriginalApprover = !!approval.approverUserId && currentUserId === approval.approverUserId;
  const canActOnApproval = approval.approverUserId === null || isOriginalApprover;
  const showDenyForm = denyCardKey === cardKey && canActOnApproval;
  const canUseTimedApproval =
    canSendResponse &&
    effectiveStatus === 'pending' &&
    !!canonicalThreadId &&
    isOriginalApprover &&
    approval.approvable &&
    approval.autoApproveOptions.length > 0;
  const grantState = grant?.revokedAt
    ? 'revoked'
    : grantExpiresTs !== undefined && grantExpiresTs <= Date.now()
    ? 'expired'
    : grant
    ? 'active'
    : undefined;
  const canRevokeAutoApproval =
    canSendResponse && !!canonicalThreadId && isOriginalApprover && grantState === 'active';
  const grantExpiresCountdown =
    grantState === 'active' && grantExpiresTs !== undefined
      ? formatExpiryCountdown(grantExpiresTs)
      : undefined;
  const argumentsText = useMemo(
    () => JSON.stringify(approval.arguments, null, 2) ?? '{}',
    [approval.arguments]
  );

  const [requestState, submitAction] = useAsyncCallback<
    ApprovalActionResult,
    ApprovalActionError,
    [ApprovalActionKind, string, string?, ToolApprovalDuration?, string?]
  >(async (kind, actionCardKey, reason, duration, grantId) => {
    if (!roomId || !eventId || !responseThreadId) {
      throw new Error('Approval responses are unavailable here.');
    }

    try {
      await mx.sendEvent(
        roomId,
        MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT as any,
        kind === 'revoke'
          ? buildToolApprovalRevocationContent(grantId ?? '', responseThreadId, eventId)
          : buildToolApprovalResponseContent(
              kind === 'deny' ? 'denied' : 'approved',
              responseThreadId,
              eventId,
              reason,
              kind === 'timed' ? duration : undefined
            )
      );
    } catch (error) {
      throw new ApprovalActionError(actionCardKey, kind, error);
    }

    return { cardKey: actionCardKey, kind };
  });

  const submittingAction = submittingActionRef.current;
  const isActionStillRelevant = (action: ApprovalActionResult | undefined) =>
    action?.cardKey === cardKey &&
    (action.kind === 'revoke' ? grantState === 'active' : effectiveStatus === 'pending');
  const submittingActionStillRelevant = isActionStillRelevant(submittingAction);
  const submitting = requestState.status === AsyncStatus.Loading && submittingActionStillRelevant;
  const submitted =
    requestState.status === AsyncStatus.Success &&
    requestState.data.cardKey === cardKey &&
    (requestState.data.kind === 'revoke' ? grantState === 'active' : effectiveStatus === 'pending');
  const errorMessage =
    requestState.status === AsyncStatus.Error &&
    requestState.error.cardKey === cardKey &&
    (requestState.error.kind === 'revoke' ? grantState === 'active' : effectiveStatus === 'pending')
      ? requestState.error.message
      : undefined;
  const disableActions =
    effectiveStatus !== 'pending' ||
    submitting ||
    submitted ||
    !canSendResponse ||
    !canActOnApproval;
  const displayStatus = effectiveStatus === 'pending' && submitted ? 'submitted' : effectiveStatus;

  useEffect(() => {
    const pendingDeadline = approval.status === 'pending' ? expiresTs : undefined;
    const grantDeadline = grantState === 'active' ? grantExpiresTs : undefined;
    const nextDeadline = [pendingDeadline, grantDeadline]
      .filter((deadline): deadline is number => deadline !== undefined)
      .sort((left, right) => left - right)[0];
    if (nextDeadline === undefined) return undefined;

    const timeUntilExpiry = nextDeadline - Date.now();
    if (timeUntilExpiry <= 0) return undefined;

    const timeoutId = setTimeout(
      () => setExpiryCheckVersion((version) => version + 1),
      Math.min(timeUntilExpiry, grantDeadline === undefined ? MAX_TIMEOUT_DELAY : 1000)
    );

    return () => clearTimeout(timeoutId);
  }, [approval.status, expiresTs, expiryCheckVersion, grantExpiresTs, grantState]);

  useEffect(() => {
    if (requestState.status !== AsyncStatus.Loading) {
      submittingActionRef.current = undefined;
    }
  }, [requestState.status]);

  useEffect(() => {
    if (denyCardKey !== cardKey || canActOnApproval) return;

    setDenyCardKey(undefined);
    setDenyReason('');
  }, [canActOnApproval, cardKey, denyCardKey]);

  useEffect(() => {
    if (!showDenyForm || effectiveStatus !== 'pending' || submitted) return;

    if (denyReasonInputRef.current) {
      denyReasonInputRef.current.focus();
      return;
    }

    confirmDenyButtonRef.current?.focus();
  }, [effectiveStatus, showDenyForm, submitted]);

  useEffect(() => {
    if (showDenyForm || !restoreDenyTriggerFocusRef.current) return;

    restoreDenyTriggerFocusRef.current = false;
    denyTriggerRef.current?.focus();
  }, [showDenyForm]);

  const cardClassName = classNames(css.Card, {
    [css.CardApproved]: effectiveStatus === 'approved',
    [css.CardDenied]: effectiveStatus === 'denied',
    [css.CardExpired]: effectiveStatus === 'expired',
  });

  const submitApprovalAction = (
    kind: ApprovalActionKind,
    reason?: string,
    duration?: ToolApprovalDuration,
    grantId?: string
  ) => {
    const isRevoke = kind === 'revoke';
    const grantIsCurrentlyActive =
      !!grant && !grant.revokedAt && grantExpiresTs !== undefined && grantExpiresTs > Date.now();
    if (
      !canActOnApproval ||
      (isRevoke
        ? !canRevokeAutoApproval || !grantIsCurrentlyActive
        : getEffectiveToolApprovalStatus(approval.status, expiresTs) !== 'pending' ||
          (kind !== 'deny' && !approval.approvable)) ||
      submitted ||
      isActionStillRelevant(submittingActionRef.current)
    ) {
      return;
    }

    submittingActionRef.current = { cardKey, kind };
    void submitAction(kind, cardKey, reason, duration, grantId).catch(() => undefined);
  };

  const handleApprove = () => {
    submitApprovalAction('approve');
  };

  const handleTimedApprove = (duration: ToolApprovalDuration) => {
    if (!canUseTimedApproval || !approval.autoApproveOptions.includes(duration)) return;
    submitApprovalAction('timed', undefined, duration);
  };

  const handleRevoke = () => {
    if (!grant) return;
    submitApprovalAction('revoke', undefined, undefined, grant.grantId);
  };

  const handleStartDeny = () => {
    if (
      !canActOnApproval ||
      getEffectiveToolApprovalStatus(approval.status, expiresTs) !== 'pending' ||
      disableActions
    ) {
      return;
    }

    restoreDenyTriggerFocusRef.current = false;
    setDenyReason('');
    setDenyCardKey(cardKey);
  };

  const handleCancelDeny = () => {
    if (disableActions) return;
    restoreDenyTriggerFocusRef.current = true;
    setDenyCardKey(undefined);
    setDenyReason('');
  };

  const handleConfirmDeny: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    submitApprovalAction('deny', denyReason);
  };

  const resolvedMeta =
    effectiveStatus === 'approved'
      ? `Approved by ${approval.resolvedBy ?? 'unknown'}`
      : effectiveStatus === 'denied'
      ? `Denied by ${approval.resolvedBy ?? 'unknown'}`
      : effectiveStatus === 'expired'
      ? 'Approval expired'
      : undefined;

  if (isResolvedApprovalStatus(effectiveStatus) && !grant) {
    const resolvedClassName = classNames(css.ResolvedInline, {
      [css.ResolvedInlineApproved]: effectiveStatus === 'approved',
      [css.ResolvedInlineDenied]: effectiveStatus === 'denied',
      [css.ResolvedInlineExpired]: effectiveStatus === 'expired',
    });
    const resolvedTooltip =
      effectiveStatus === 'denied' && approval.resolutionReason
        ? `Reason: ${approval.resolutionReason}`
        : undefined;

    return (
      <Box
        as="span"
        className={resolvedClassName}
        aria-label="Resolved tool approval request"
        title={resolvedTooltip}
      >
        <Icon size="50" src={getStatusIcon(effectiveStatus)} />
        <Text size="T200" className={css.ResolvedToolName}>
          {approval.toolName}
        </Text>
        {resolvedMeta && (
          <>
            <Text className={css.MetaDot}>-</Text>
            <Text size="T200">{resolvedMeta}</Text>
          </>
        )}
        {resolvedRelative && <Text className={css.MetaDot}>•</Text>}
        {resolvedRelative && <Text size="T200">{resolvedRelative}</Text>}
        {!resolvedRelative && approval.resolvedAt && (
          <>
            <Text className={css.MetaDot}>•</Text>
            <Text size="T200">{approval.resolvedAt}</Text>
          </>
        )}
      </Box>
    );
  }

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

      <Box className={css.Meta}>
        <Text size="T200">{approval.agentName}</Text>
        {approval.requesterId && <Text className={css.MetaDot}>•</Text>}
        {approval.requesterId && <Text size="T200">Requested by {approval.requesterId}</Text>}
        {requestedRelative && <Text className={css.MetaDot}>•</Text>}
        {requestedRelative && <Text size="T200">{requestedRelative}</Text>}
        {!requestedRelative && approval.requestedAt && (
          <>
            <Text className={css.MetaDot}>•</Text>
            <Text size="T200">{approval.requestedAt}</Text>
          </>
        )}
      </Box>

      {(canUseTimedApproval || grant) && (
        <Box className={css.Scope} direction="Column" gap="100">
          <Text size="T200">Auto-approval applies to this thread, requester, agent, and tool.</Text>
          <Text size="T200">Arguments may differ between calls.</Text>
        </Box>
      )}

      {grant && (
        <Box className={css.GrantPanel} direction="Column" gap="100">
          <Text size="B300">
            {grantState === 'revoked'
              ? 'Auto-approval stopped'
              : grantState === 'expired'
              ? 'Auto-approval expired'
              : 'Auto-approval active'}
          </Text>
          {grantExpiresCountdown && <Text size="T200">Expires in {grantExpiresCountdown}</Text>}
          <Text size="T200">
            Fixed expiry{' '}
            <time dateTime={grant.expiresAt}>
              {grantExpiresTs === undefined
                ? grant.expiresAt
                : new Date(grantExpiresTs).toLocaleString()}
            </time>
          </Text>
          {grant.revokedAt && <Text size="T200">Stopped {grant.revokedAt}</Text>}
        </Box>
      )}

      {effectiveStatus === 'pending' && !approval.approvable && (
        <Text size="T200">This request cannot be approved here.</Text>
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

      {effectiveStatus === 'pending' && submitted && (
        <Text size="T200">Submitted. Waiting for room update.</Text>
      )}

      {effectiveStatus === 'pending' && canActOnApproval && !showDenyForm && !submitted && (
        <Box direction="Column" gap="200">
          <Box className={css.Actions}>
            {approval.approvable && (
              <Button
                size="300"
                variant="Success"
                fill="Solid"
                radii="300"
                onClick={handleApprove}
                disabled={disableActions}
                before={
                  submitting ? (
                    <Spinner size="100" variant="Success" fill="Solid" />
                  ) : (
                    <Icon src={Icons.Check} />
                  )
                }
              >
                <Text size="B300">{canUseTimedApproval ? 'Approve once' : 'Approve'}</Text>
              </Button>
            )}
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
          {canUseTimedApproval && (
            <Box className={css.DurationActions} role="group" aria-label="Auto-approval duration">
              {approval.autoApproveOptions.map((duration) => (
                <Button
                  key={duration}
                  type="button"
                  size="300"
                  outlined
                  radii="300"
                  onClick={() => handleTimedApprove(duration)}
                  disabled={disableActions}
                >
                  <Text size="B300">Auto-approve {duration / 60} min</Text>
                </Button>
              ))}
            </Box>
          )}
        </Box>
      )}

      {grant && submitted && <Text size="T200">Submitted. Waiting for room update.</Text>}

      {canRevokeAutoApproval && !submitted && (
        <Button
          type="button"
          size="300"
          variant="Critical"
          outlined
          radii="300"
          onClick={handleRevoke}
          disabled={submitting}
          before={
            submitting ? (
              <Spinner size="100" variant="Critical" fill="Solid" />
            ) : (
              <Icon src={Icons.Cross} />
            )
          }
        >
          <Text size="B300">Stop auto-approval</Text>
        </Button>
      )}

      {effectiveStatus === 'pending' && showDenyForm && !submitted && (
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
