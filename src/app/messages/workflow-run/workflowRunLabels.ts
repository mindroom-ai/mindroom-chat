import type { TFunction } from 'i18next';
import type {
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

/** Human-readable status label shared by the run card, jobs bar, and graph panel. */
export const workflowRunStatusLabel = (status: WorkflowRunStatus, t: TFunction): string =>
  t(STATUS_KEYS[status]);

/** Heading for a run: its title, else saved workflow name, else generic "Workflow". */
export const workflowRunHeading = (
  meta: { title: string | null; name?: string | null },
  t: TFunction
): string => meta.title || meta.name || t('mindroomUi.workflowRun.title');

/** Progress counts summary shared by the run card, jobs bar, and graph panel. */
export const workflowRunCountsLine = (counts: WorkflowRunCounts, t: TFunction): string =>
  t('mindroomUi.workflowRun.counts', {
    done: counts.completed,
    running: counts.running,
    waiting: counts.waiting,
  });

/**
 * Cost summary line for a run: shows "at least" when pricing is incomplete, a spent/projected pair
 * when projected exceeds spent, or spent alone once tokens or cost are recorded.
 */
export const workflowRunCostLine = (
  usage: WorkflowRunUsage,
  t: TFunction,
  language = 'en'
): string | undefined => {
  if (usage.costUsd === undefined) return undefined;
  const spent = formatCostUsd(usage.costUsd, language);
  if (usage.costUnknown) {
    return t('mindroomUi.workflowRun.costAtLeast', { spent });
  }
  if (usage.projectedCostUsd !== undefined && usage.projectedCostUsd > usage.costUsd + 1e-6) {
    return t('mindroomUi.workflowRun.cost', {
      spent,
      projected: formatCostUsd(usage.projectedCostUsd, language),
    });
  }
  if (usage.costUsd > 0 || usage.inputTokens + usage.outputTokens > 0) {
    return spent;
  }
  return undefined;
};
