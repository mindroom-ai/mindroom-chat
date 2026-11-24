import type { TFunction } from 'i18next';
import type {
  WorkflowNodeStatus,
  WorkflowRunCounts,
  WorkflowRunStatus,
  WorkflowRunUsage,
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

const NODE_STATUS_KEYS = {
  queued: 'mindroomUi.workflowRun.node.queued',
  running: 'mindroomUi.workflowRun.status.running',
  waiting: 'mindroomUi.workflowRun.status.waiting',
  completed: 'mindroomUi.workflowRun.status.completed',
  failed: 'mindroomUi.workflowRun.status.failed',
  cancelled: 'mindroomUi.workflowRun.status.cancelled',
  indeterminate: 'mindroomUi.workflowRun.node.mayHaveRun',
} as const satisfies Record<WorkflowNodeStatus, string>;

export const workflowRunStatusLabel = (status: WorkflowRunStatus, t: TFunction): string =>
  t(STATUS_KEYS[status]);

export const workflowNodeStatusLabel = (status: WorkflowNodeStatus, t: TFunction): string =>
  t(NODE_STATUS_KEYS[status]);

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
