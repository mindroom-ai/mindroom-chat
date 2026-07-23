import { MatrixEvent, RelationType } from 'matrix-js-sdk';

export const MINDROOM_TOOL_APPROVAL_EVENT = 'io.mindroom.tool_approval';
export const MINDROOM_TOOL_APPROVAL_RESPONSE_EVENT = 'io.mindroom.tool_approval_response';

export type ToolApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ToolApprovalData {
  approvalId: string;
  toolName: string;
  toolCallId: string | null;
  arguments: Record<string, unknown>;
  agentName: string;
  requesterId: string | null;
  status: ToolApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  threadId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionReason: string | null;
}

type ToolApprovalResponseStatus = 'approved' | 'denied';

type ToolApprovalResponseContent = {
  status: ToolApprovalResponseStatus;
  reason?: string | null;
  'm.relates_to': {
    rel_type: RelationType.Thread;
    event_id: string;
    is_falling_back: true;
    'm.in_reply_to': {
      event_id: string;
    };
  };
};

const TOOL_APPROVAL_STATUSES = new Set<ToolApprovalStatus>([
  'pending',
  'approved',
  'denied',
  'expired',
]);

const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

const getDaysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

export const parseToolApprovalExpiryTimestamp = (value: string): number | undefined => {
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return undefined;

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > getDaysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const getEffectiveToolApprovalStatus = (
  status: ToolApprovalStatus,
  expiresTs: number | undefined,
  currentTime = Date.now()
): ToolApprovalStatus => {
  if (status !== 'pending') return status;
  if (expiresTs === undefined) return status;

  return expiresTs <= currentTime ? 'expired' : status;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getApprovalCandidates = (content: Record<string, unknown>): Record<string, unknown>[] => {
  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;

  return newContent ? [newContent, content] : [content];
};

const pickCandidateValue = (content: Record<string, unknown>, key: string): unknown | undefined => {
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
  const toolCallId = asNullableString(pickCandidateValue(content, 'tool_call_id'));
  const toolArguments = asArguments(pickCandidateValue(content, 'arguments'));
  const agentName = asString(pickCandidateValue(content, 'agent_name'));
  const requesterId = asNullableString(pickCandidateValue(content, 'requester_id'));
  const status = asStatus(pickCandidateValue(content, 'status'));
  const requestedAt =
    asString(pickCandidateValue(content, 'requested_at')) ??
    asString(pickCandidateValue(content, 'created_at'));
  const expiresAt = asString(pickCandidateValue(content, 'expires_at'));
  const threadId = asNullableString(pickCandidateValue(content, 'thread_id'));
  const resolvedAt = asNullableString(pickCandidateValue(content, 'resolved_at'));
  const resolvedBy = asNullableString(pickCandidateValue(content, 'resolved_by'));
  const resolutionReason = asNullableString(pickCandidateValue(content, 'resolution_reason'));

  if (
    !approvalId ||
    !toolName ||
    !toolArguments ||
    !agentName ||
    !status ||
    !requestedAt ||
    !expiresAt
  ) {
    return null;
  }

  return {
    approvalId,
    toolName,
    toolCallId: toolCallId ?? null,
    arguments: toolArguments,
    agentName,
    requesterId: requesterId ?? null,
    status,
    requestedAt,
    expiresAt,
    threadId: threadId ?? null,
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

export const buildToolApprovalResponseContent = (
  status: ToolApprovalResponseStatus,
  threadId: string,
  eventId: string,
  reason?: string
): ToolApprovalResponseContent => ({
  status,
  ...(status === 'denied' ? { reason: reason?.trim() ? reason.trim() : null } : {}),
  'm.relates_to': {
    rel_type: RelationType.Thread,
    event_id: threadId,
    is_falling_back: true,
    'm.in_reply_to': {
      event_id: eventId,
    },
  },
});

export function parseToolApproval(event: MatrixEvent): ToolApprovalData | null {
  const content = event.getContent();
  if (!isRecord(content)) return null;
  return parseToolApprovalContent(event.getType(), content);
}
