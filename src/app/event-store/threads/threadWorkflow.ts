import { isSnoozedAt } from './threadSnooze';

export type ThreadWorkflowBucket = 'needsYou' | 'working' | 'later' | 'done';
export type ThreadWorkflowTab = ThreadWorkflowBucket | 'all';
export const THREAD_WORKFLOW_TABS: ThreadWorkflowTab[] = [
  'needsYou',
  'working',
  'later',
  'done',
  'all',
];
export type ThreadWorkflowCounts = Record<ThreadWorkflowTab, number>;

export type ThreadWorkflowStatus = {
  isResolved: boolean;
  snoozedUntilTs?: number;
  isStreaming: boolean;
  scheduledTaskCount: number;
  hasBackgroundJob?: boolean;
  hasBackgroundApproval?: boolean;
};

/**
 * A foreground request or background job waiting for the person, independent of workflow buckets.
 * Resolving answers every question, approvals asked at or before the resolve, and background
 * approvals. A foreground approval asked after the resolve still waits.
 */
export const isWaitingOnYou = (
  signals: { pendingApproval?: unknown; pendingQuestion?: unknown },
  thread: {
    isResolved: boolean;
    threadRecord: { status: Pick<ThreadWorkflowStatus, 'hasBackgroundApproval'> };
  }
): boolean =>
  !!(
    signals.pendingApproval ||
    (!thread.isResolved && signals.pendingQuestion) ||
    (!thread.isResolved && thread.threadRecord.status.hasBackgroundApproval)
  );

/** Shared by the room overview and sidebar sections. First match wins, independent of unread state. */
export const classifyThreadWorkflow = (
  status: ThreadWorkflowStatus,
  now: number
): ThreadWorkflowBucket => {
  if (status.isResolved) return 'done';
  if (isSnoozedAt(status.snoozedUntilTs, now)) return 'later';
  if (status.hasBackgroundApproval) return 'needsYou';
  if (status.isStreaming || status.hasBackgroundJob) return 'working';
  if (status.scheduledTaskCount > 0) return 'later';
  return 'needsYou';
};

/**
 * When a Later thread comes back: the end of its active snooze, else its next scheduled run, else
 * `Infinity` (unknown, so it sorts last). The sidebar's and the Compact room's Later sections both
 * order by it, soonest first.
 */
export const threadReturnTs = (
  status: Pick<ThreadWorkflowStatus, 'snoozedUntilTs'> & { nextScheduledTs?: number },
  now: number
): number =>
  (isSnoozedAt(status.snoozedUntilTs, now) ? status.snoozedUntilTs : status.nextScheduledTs) ??
  Infinity;

/** How long a read, inactive Needs you thread waits before folding into Quiet. */
export const QUIET_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

export type ThreadQuietActivityInput = {
  lastActivityTs?: number;
  snoozedUntilTs?: number;
  outcomeTs?: number;
  newsTs?: number;
  isStreaming?: boolean;
  now: number;
};

/** Latest activity timestamp of a Needs you thread (streamed edits ignored; expired snooze wakes it). */
export const threadQuietActivityTs = ({
  lastActivityTs,
  snoozedUntilTs,
  outcomeTs,
  newsTs,
  isStreaming,
  now,
}: ThreadQuietActivityInput): number => {
  const news = isStreaming ? 0 : newsTs ?? 0;
  const expiredSnooze = snoozedUntilTs !== undefined && snoozedUntilTs <= now ? snoozedUntilTs : 0;
  return Math.max(outcomeTs ?? 0, news, lastActivityTs ?? 0, expiredSnooze);
};

export type ThreadQuietInput = Omit<ThreadQuietActivityInput, 'now' | 'outcomeTs' | 'newsTs'> & {
  isPinned?: boolean;
  isUnread?: boolean;
  replyCount?: number;
  hasPendingSend?: boolean;
  hasFailedSend?: boolean;
  hasBackgroundApproval?: boolean;
  signals?: {
    pendingApproval?: unknown;
    pendingQuestion?: unknown;
    newCount?: number;
    mentionedMe?: boolean;
    newsTs?: number;
    outcome?: { ts: number };
    waitsUntil?: number;
  };
};

const quietEligibleActivityTs = (input: ThreadQuietInput, now: number): number | undefined => {
  const { signals } = input;
  if (
    input.isPinned ||
    input.isUnread ||
    input.hasPendingSend ||
    input.hasFailedSend ||
    input.hasBackgroundApproval ||
    (signals === undefined
      ? (input.replyCount ?? 0) > 0
      : (signals.newCount ?? 0) > 0 || signals.mentionedMe)
  ) {
    return undefined;
  }
  const activityTs = threadQuietActivityTs({
    ...input,
    outcomeTs: signals?.outcome?.ts,
    newsTs: signals?.newsTs,
    now,
  });
  return activityTs > 0 ? activityTs : undefined;
};

/** Whether a Needs you thread is read and inactive for QUIET_AFTER_MS and folds into Quiet. */
export const isQuietThread = (input: ThreadQuietInput, now: number): boolean => {
  if (input.signals?.pendingApproval || input.signals?.pendingQuestion) return false;
  const activityTs = quietEligibleActivityTs(input, now);
  return activityTs !== undefined && now - activityTs >= QUIET_AFTER_MS;
};

/** When a non-quiet Needs you thread will become quiet from the clock alone, if ever. */
export const nextThreadQuietTs = (input: ThreadQuietInput, now: number): number | undefined => {
  const activityTs = quietEligibleActivityTs(input, now);
  if (activityTs === undefined) return undefined;
  const waiting = !!(input.signals?.pendingApproval || input.signals?.pendingQuestion);
  const candidate = waiting
    ? input.signals?.waitsUntil !== undefined
      ? Math.max(activityTs + QUIET_AFTER_MS, input.signals.waitsUntil)
      : undefined
    : activityTs + QUIET_AFTER_MS;
  return candidate !== undefined && Number.isFinite(candidate) && candidate > now
    ? candidate
    : undefined;
};
