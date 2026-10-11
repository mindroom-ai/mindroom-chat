import type { TFunction } from 'i18next';
import type { BackgroundJob } from './backgroundJobsContract';

export type BackgroundJobsBarItem = {
  jobId: string;
  agentId: string;
  label: string;
  waitingForApproval: boolean;
};

export type BackgroundJobsBarModel = {
  title: string;
  items: BackgroundJobsBarItem[];
};

const isWaitingForApproval = (job: BackgroundJob): boolean => job.status === 'awaiting_approval';

const label = (job: BackgroundJob, t: TFunction): string =>
  job.kind === 'subagent' ? t('mindroomUi.backgroundJobs.subagent', { tool: job.tool }) : job.tool;

/** The jobs bar for a view's background jobs, or nothing when it has none. */
export const presentBackgroundJobs = (
  jobs: BackgroundJob[],
  t: TFunction
): BackgroundJobsBarModel | null => {
  if (jobs.length === 0) return null;
  const items = jobs.map((job) => ({
    jobId: job.jobId,
    agentId: job.agentId,
    label: label(job, t),
    waitingForApproval: isWaitingForApproval(job),
  }));
  if (items.length > 1) {
    return { title: t('mindroomUi.backgroundJobs.many', { count: items.length }), items };
  }
  const [only] = items;
  const title = only.waitingForApproval
    ? t('mindroomUi.backgroundJobs.approvalOne', { tool: only.label })
    : t('mindroomUi.backgroundJobs.runningOne', { tool: only.label });
  return { title, items };
};
