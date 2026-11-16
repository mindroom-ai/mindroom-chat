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
