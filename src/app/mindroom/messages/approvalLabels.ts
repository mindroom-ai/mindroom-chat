import type { ThreadApprovalRecord } from './threadApprovalModel';
import { getToolApprovalOperationLabel } from './toolApproval';

export type ApprovalHistorySummary =
  | {
      kind: 'single';
      status: ThreadApprovalRecord['approval']['status'];
      /** Who decided: the viewer, another user, or nobody (expiry). */
      actor: 'you' | { userId: string } | null;
      operation: string;
    }
  | { kind: 'count'; total: number; approved: number };

export const describeApprovalHistory = (
  records: readonly ThreadApprovalRecord[],
  viewerId: string | null
): ApprovalHistorySummary => {
  if (records.length !== 1) {
    return {
      kind: 'count',
      total: records.length,
      approved: records.filter((item) => item.approval.status === 'approved').length,
    };
  }
  const { approval } = records[0];
  const resolver = approval.resolvedBy;
  return {
    kind: 'single',
    status: approval.status,
    actor: !resolver ? null : resolver === viewerId ? 'you' : { userId: resolver },
    operation: getToolApprovalOperationLabel(approval),
  };
};

export type WaitingApprovalsSummary = {
  agents: string[];
  tools: { operation: string; count: number }[];
};

export const describeWaitingApprovals = (
  groups: readonly (readonly ThreadApprovalRecord[])[]
): WaitingApprovalsSummary => {
  const records = groups.flat();
  const tools = new Map<string, number>();
  records.forEach(({ approval }) => {
    const operation = getToolApprovalOperationLabel(approval);
    tools.set(operation, (tools.get(operation) ?? 0) + 1);
  });
  return {
    agents: [...new Set(records.map(({ approval }) => approval.agentName))],
    tools: [...tools].map(([operation, count]) => ({ operation, count })),
  };
};
