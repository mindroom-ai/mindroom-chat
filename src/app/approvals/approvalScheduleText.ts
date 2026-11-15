import { parseToolApprovalExpiryTimestamp, ToolApprovalScheduledScope } from '../matrix/protocol/toolApproval';

// Backend timestamps can carry sub-millisecond fractions that browser date parsing rejects.
export const formatApprovalTime = (value: string, language: string): string => {
  const timestamp = parseToolApprovalExpiryTimestamp(value);
  return timestamp === undefined ? value : new Date(timestamp).toLocaleString(language);
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** "in 20 minutes", "in 24 hours", "in 3 days" until `timestamp` (ms); undefined once it has passed. */
export const formatTimeUntil = (
  timestamp: number,
  now: number,
  language: string
): string | undefined => {
  if (timestamp <= now) return undefined;
  const remaining = timestamp - now;
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'always' });
  if (remaining < HOUR_MS)
    return format.format(Math.max(1, Math.round(remaining / MINUTE_MS)), 'minute');
  if (remaining < 48 * HOUR_MS) return format.format(Math.round(remaining / HOUR_MS), 'hour');
  return format.format(Math.round(remaining / (24 * HOUR_MS)), 'day');
};

/** {@link formatTimeUntil} for an approval's expiry, as the backend writes it. */
export const formatExpiryDistance = (
  value: string,
  now: number,
  language: string
): string | undefined => {
  const timestamp = parseToolApprovalExpiryTimestamp(value);
  return timestamp === undefined ? undefined : formatTimeUntil(timestamp, now, language);
};

// One label per scope, shared by scheduling cards and send-time receipts.
export const scheduledScopeLabelKey = (scope: ToolApprovalScheduledScope) =>
  scope === 'any_arguments'
    ? ('mindroomUi.messages.approvalSchedule.approvedAnyArguments' as const)
    : ('mindroomUi.messages.approvalSchedule.approvedExactArguments' as const);
