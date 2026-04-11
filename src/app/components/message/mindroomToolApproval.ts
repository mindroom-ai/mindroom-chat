import { MatrixEvent } from 'matrix-js-sdk';

export const MINDROOM_TOOL_APPROVAL_EVENT = 'io.mindroom.tool_approval';

export type ToolApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ToolApprovalData {
  approvalId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  agentName: string;
  status: ToolApprovalStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionReason: string | null;
}

const TOOL_APPROVAL_STATUSES = new Set<ToolApprovalStatus>([
  'pending',
  'approved',
  'denied',
  'expired',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getApprovalCandidates = (content: Record<string, unknown>): Record<string, unknown>[] => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  return newContent ? [newContent, content] : [content];
};

const pickCandidateValue = (
  content: Record<string, unknown>,
  key: string
): unknown | undefined => {
  const candidates = getApprovalCandidates(content);

  for (let i = 0; i < candidates.length; i += 1) {
    const value = candidates[i][key];
    if (value !== undefined) return value;
  }

  return undefined;
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const asNullableString = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  return asString(value);
};

const asStatus = (value: unknown): ToolApprovalStatus | undefined => {
  if (typeof value !== 'string') return undefined;
  return TOOL_APPROVAL_STATUSES.has(value as ToolApprovalStatus)
    ? (value as ToolApprovalStatus)
    : undefined;
};

const asArguments = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  return value;
};

export const parseToolApprovalContent = (
  eventType: string,
  content: Record<string, unknown>
): ToolApprovalData | null => {
  if (eventType !== MINDROOM_TOOL_APPROVAL_EVENT) return null;

  const approvalId = asString(pickCandidateValue(content, 'approval_id'));
  const toolName = asString(pickCandidateValue(content, 'tool_name'));
  const toolArguments = asArguments(pickCandidateValue(content, 'arguments'));
  const agentName = asString(pickCandidateValue(content, 'agent_name'));
  const status = asStatus(pickCandidateValue(content, 'status'));
  const createdAt = asString(pickCandidateValue(content, 'created_at'));
  const expiresAt = asString(pickCandidateValue(content, 'expires_at'));
  const resolvedAt = asNullableString(pickCandidateValue(content, 'resolved_at'));
  const resolvedBy = asNullableString(pickCandidateValue(content, 'resolved_by'));
  const resolutionReason = asNullableString(pickCandidateValue(content, 'resolution_reason'));

  if (
    !approvalId ||
    !toolName ||
    !toolArguments ||
    !agentName ||
    !status ||
    !createdAt ||
    !expiresAt
  ) {
    return null;
  }

  return {
    approvalId,
    toolName,
    arguments: toolArguments,
    agentName,
    status,
    createdAt,
    expiresAt,
    resolvedAt: resolvedAt ?? null,
    resolvedBy: resolvedBy ?? null,
    resolutionReason: resolutionReason ?? null,
  };
};

export const getToolApprovalRenderContent = (
  content: Record<string, unknown>,
  editedContent?: Record<string, unknown>
): Record<string, unknown> => {
  if (!editedContent) return content;

  const newContent = isRecord(editedContent['m.new_content'])
    ? (editedContent['m.new_content'] as Record<string, unknown>)
    : editedContent;

  return {
    ...content,
    'm.new_content': newContent,
  };
};

export function parseToolApproval(event: MatrixEvent): ToolApprovalData | null {
  const content = event.getContent();
  if (!isRecord(content)) return null;
  return parseToolApprovalContent(event.getType(), content);
}
