import React from 'react';
import { ApprovalArguments } from './ApprovalArguments';
import { getToolApprovalOperationLabel, ToolApprovalData } from './toolApproval';
import * as css from './ThreadApprovals.css';

export function ApprovalReceipt({
  approval,
  children,
}: {
  approval: ToolApprovalData;
  children?: React.ReactNode;
}) {
  const provenance = approval.provenance;
  const statusLabel =
    approval.status === 'expired'
      ? 'Approval expired'
      : approval.status === 'approved'
      ? 'Approved'
      : 'Denied';
  return (
    <details className={css.Receipt} aria-label="Resolved tool approval request">
      <summary>
        <span className={css.ReceiptTool}>
          {approval.status === 'approved' ? '✓' : '–'} {getToolApprovalOperationLabel(approval)}
        </span>
        <span>{statusLabel}</span>
      </summary>
      <div className={css.ReceiptBody}>
        <p>
          {approval.agentName} · Requested by {approval.requesterId ?? 'unknown'}
        </p>
        <p>
          {statusLabel} {approval.resolvedBy ? `by ${approval.resolvedBy}` : ''}
          {approval.resolvedAt ? ` · ${new Date(approval.resolvedAt).toLocaleString()}` : ''}
        </p>
        {provenance?.kind === 'timed_grant' ? (
          <p>
            Timed permission
            {provenance.durationSeconds ? ` · ${provenance.durationSeconds / 60} minutes` : ''} ·
            Granted by {provenance.grantedBy}
            {provenance.grantedAt && <> · {new Date(provenance.grantedAt).toLocaleString()}</>}
            <br />
            Original fixed expiry: {new Date(provenance.expiresAt).toLocaleString()}
          </p>
        ) : (
          <p>{provenance?.kind === 'once' ? 'Approved once' : 'Decision recorded for this call'}</p>
        )}
        {approval.scope && (
          <p>
            Tool: {approval.scope.operation.toolName}
            {approval.scope.operation.mcpServerId && (
              <> · Server: {approval.scope.operation.mcpServerId}</>
            )}
          </p>
        )}
        {approval.resolutionReason && <p>Reason: {approval.resolutionReason}</p>}
        <ApprovalArguments approval={approval} />
        {children}
      </div>
    </details>
  );
}
