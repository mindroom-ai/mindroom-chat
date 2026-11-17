import type { TFunction } from 'i18next';
import type { ThreadConversationCost } from '../event-store/threads/threadConversationCost';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { formatCostUsd } from '../messages/agent-run/aiRunDisplay';

/** What a thread is doing now, as the stores tell it. */
export type ThreadLiveStatus = {
  streaming: boolean;
  pendingApproval: boolean;
  pendingQuestion: boolean;
  /** The tool calls its streaming reply runs (`runningToolCalls`). */
  runningTools: { count: number; names: readonly string[] };
  activeSubagents: number;
  /** Its live background jobs. */
  jobs: readonly Pick<BackgroundJob, 'status'>[];
  /** The room has live jobs its agents do not list, so the thread can have more than `jobs`. */
  jobsUnlisted?: boolean;
  /** What its loaded replies cost; undefined when none is priced. */
  cost?: ThreadConversationCost;
};

export type ThreadLiveStatusRow = {
  key: 'status' | 'tools' | 'subagents' | 'background' | 'cost';
  label: string;
  value: string;
};

const SHOWN_TOOL_NAMES = 2;

/** The status rows of a thread's details, each only when it has something to say. */
export const threadLiveStatusRows = (
  status: ThreadLiveStatus,
  t: TFunction,
  language: string
): ThreadLiveStatusRow[] => {
  const rows: ThreadLiveStatusRow[] = [];
  // What waits for the person comes before the stream that waits with it.
  let state: string | undefined;
  if (status.pendingApproval) {
    state = t('mindroomUi.messages.threadApprovalControls.waitingForApproval');
  } else if (status.pendingQuestion) state = t('threadNav.live.waitingForAnswer');
  else if (status.streaming) state = t('thread.status.streaming');
  if (state) rows.push({ key: 'status', label: t('thread.filters.status'), value: state });

  const { count, names } = status.runningTools;
  if (count > 0) {
    const shown = names.slice(0, SHOWN_TOOL_NAMES);
    if (names.length > shown.length) shown.push('…');
    rows.push({
      key: 'tools',
      label: t('threadNav.live.tools'),
      value:
        shown.length > 0
          ? t('threadNav.live.toolsRunningNamed', { count, names: shown.join(', ') })
          : t('threadNav.live.toolsRunning', { count }),
    });
  }

  if (status.activeSubagents > 0) {
    rows.push({
      key: 'subagents',
      label: t('mindroomUi.subagents.title'),
      value: t('mindroomUi.subagents.count', { count: status.activeSubagents }),
    });
  }

  if (status.jobs.length > 0) {
    const jobs = t('threadNav.live.jobs', { count: status.jobs.length });
    const waiting = status.jobs.filter((job) => job.status === 'awaiting_approval').length;
    const value = waiting > 0 ? t('threadNav.live.jobsWaiting', { count: waiting, jobs }) : jobs;
    rows.push({
      key: 'background',
      label: t('threadNav.live.background'),
      // The cost row's lower-bound mark: both counts can be more.
      value: status.jobsUnlisted
        ? t('mindroomUi.messages.mindroomReplyDetails.atLeastCost', { cost: value })
        : value,
    });
  }

  const lastReply = status.cost?.replies.at(-1);
  const total = lastReply && status.cost?.byEventId.get(lastReply.eventId)?.usd;
  if (status.cost && total !== undefined) {
    const amount = formatCostUsd(total, language);
    rows.push({
      key: 'cost',
      label: t('mindroomUi.messages.mindroomReplyDetails.cost'),
      value: status.cost.complete
        ? amount
        : t('mindroomUi.messages.mindroomReplyDetails.atLeastCost', { cost: amount }),
    });
  }
  return rows;
};
