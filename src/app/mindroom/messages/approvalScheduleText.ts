import { parseToolApprovalExpiryTimestamp, ToolApprovalScheduledScope } from './toolApproval';

// Backend timestamps can carry sub-millisecond fractions that browser date parsing rejects.
export const formatApprovalTime = (value: string, language: string): string => {
  const timestamp = parseToolApprovalExpiryTimestamp(value);
  return timestamp === undefined ? value : new Date(timestamp).toLocaleString(language);
};

// One label per scope, shared by scheduling cards and send-time receipts.
export const scheduledScopeLabelKey = (scope: ToolApprovalScheduledScope) =>
  scope === 'any_arguments'
    ? ('mindroomUi.messages.approvalSchedule.approvedAnyArguments' as const)
    : ('mindroomUi.messages.approvalSchedule.approvedExactArguments' as const);
