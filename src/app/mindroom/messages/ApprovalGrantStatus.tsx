import React from 'react';
import { Button, Text } from 'folds';
import {
  ApprovalControlProps,
  getApprovalCapabilities,
  getApprovalGrantState,
} from './approvalActions';
import { parseToolApprovalExpiryTimestamp } from './toolApproval';

export function ApprovalGrantStatus({
  record,
  userId,
  action,
  submit,
  now,
  canSend = true,
}: ApprovalControlProps) {
  const grant = record.approval.autoApproval;
  const state = getApprovalGrantState(record.approval, now);
  if (!grant || !state) return null;
  const expiry = parseToolApprovalExpiryTimestamp(grant.expiresAt) ?? 0;
  const canRevoke = canSend && getApprovalCapabilities(record, userId, undefined, now).revoke;
  return (
    <>
      <p>
        {state === 'active'
          ? 'Auto-approval active'
          : state === 'revoked'
          ? 'Auto-approval stopped'
          : 'Auto-approval expired'}
        <br />
        Fixed expiry: {new Date(expiry).toLocaleString()}
      </p>
      {state === 'active' && (
        <p>Expires in {Math.max(1, Math.ceil((expiry - now) / 60_000))} min</p>
      )}
      <small>Arguments may differ between calls.</small>
      {canRevoke && (
        <Button
          size="300"
          variant="Critical"
          outlined
          disabled={!!action && action.status !== 'error'}
          onClick={() => {
            if (canSend) void submit(record, { revoke: true });
          }}
        >
          <Text size="B300">Stop auto-approval</Text>
        </Button>
      )}
      {action?.status === 'submitted' && <p role="status">Submitted. Waiting for room update.</p>}
      {action?.error && <p role="alert">{action.error}</p>}
    </>
  );
}
