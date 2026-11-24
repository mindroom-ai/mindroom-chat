import type { TFunction } from 'i18next';
import { formatWorkDuration } from '../../lib/time';
import type {
  WorkflowNodeStatus,
  WorkflowRunCounts,
  WorkflowRunStatus,
  WorkflowRunUsage,
  WorkflowWaitingOn,
} from '../../matrix/protocol/workflowFrame';
import { formatCostUsd } from '../agent-run/aiRunDisplay';

const STATUS_KEYS = {
  starting: 'mindroomUi.workflowRun.status.starting',
  running: 'mindroomUi.workflowRun.status.running',
  waiting: 'mindroomUi.workflowRun.status.waiting',
  completed: 'mindroomUi.workflowRun.status.completed',
  failed: 'mindroomUi.workflowRun.status.failed',
  cancelled: 'mindroomUi.workflowRun.status.cancelled',
  interrupted: 'mindroomUi.workflowRun.status.interrupted',
} as const satisfies Record<WorkflowRunStatus, string>;

export const workflowRunStatusLabel = (status: WorkflowRunStatus, t: TFunction): string =>
  t(STATUS_KEYS[status]);

const WAITING_ON_KEYS = {
  user: 'mindroomUi.workflowRun.node.waitingOn.user',
  approval: 'mindroomUi.workflowRun.node.waitingOn.approval',
  peer: 'mindroomUi.workflowRun.node.waitingOn.peer',
} as const satisfies Record<WorkflowWaitingOn, string>;

export const workflowNodeWaitLabel = (waitingOn: WorkflowWaitingOn, t: TFunction): string =>
  t(WAITING_ON_KEYS[waitingOn]);

export const workflowNodeStatusLabel = (
  status: WorkflowNodeStatus,
  t: TFunction,
  waitingOn?: WorkflowWaitingOn | null
): string =>
  status === 'waiting' && waitingOn
    ? t(WAITING_ON_KEYS[waitingOn])
    : status === 'queued'
      ? t('mindroomUi.workflowRun.node.queued')
      : status === 'indeterminate'
        ? t('mindroomUi.workflowRun.node.mayHaveRun')
        : t(STATUS_KEYS[status]);

export const workflowRunHeading = (
  meta: { title: string | null; name?: string | null },
  t: TFunction
): string => meta.title || meta.name || t('mindroomUi.workflowRun.title');

export const workflowRunCountsLine = (counts: WorkflowRunCounts, t: TFunction): string =>
  t('mindroomUi.workflowRun.counts', {
    done: counts.completed,
    running: counts.running,
    waiting: counts.waiting,
  });

export const workflowRunCostLine = (
  usage: WorkflowRunUsage,
  t: TFunction,
  language = 'en'
): string | undefined => {
  if (usage.costUsd === undefined) return undefined;
  const spent = formatCostUsd(usage.costUsd, language);
  if (usage.costUnknown) return t('mindroomUi.workflowRun.costAtLeast', { spent });
  if (usage.projectedCostUsd !== undefined && usage.projectedCostUsd > usage.costUsd + 1e-6) {
    return t('mindroomUi.workflowRun.cost', {
      spent,
      projected: formatCostUsd(usage.projectedCostUsd, language),
    });
  }
  return usage.costUsd > 0 || usage.inputTokens + usage.outputTokens > 0 ? spent : undefined;
};

export const formatWorkflowElapsed = (
  startedAt: number | null,
  endedAt: number | null,
  liveNow: number | null,
  language: string
): string | undefined => {
  if (startedAt === null) return undefined;
  if (liveNow !== null && liveNow > 0)
    return formatWorkDuration(Math.max(0, liveNow - startedAt * 1000), language);
  return endedAt !== null
    ? formatWorkDuration(Math.max(0, (endedAt - startedAt) * 1000), language)
    : undefined;
};
