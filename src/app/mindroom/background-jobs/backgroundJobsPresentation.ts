import type { TFunction } from 'i18next';
import type { BackgroundJob } from './backgroundJobsContract';

export type BackgroundJobsBarItem = {
  jobId: string;
  // The job's own name, for its cancel button and errors; `label` may add its status.
  name: string;
  label: string;
  waitingForApproval: boolean;
  // Its cancel was already requested, from this view or anywhere else.
  stopping: boolean;
};

export type BackgroundJobsBarModel = {
  title: string;
  items: BackgroundJobsBarItem[];
};

const isWaitingForApproval = (job: BackgroundJob): boolean => job.status === 'awaiting_approval';

const name = (job: BackgroundJob, t: TFunction): string =>
  job.kind === 'subagent' ? t('mindroomUi.backgroundJobs.subagent', { tool: job.tool }) : job.tool;

/** The jobs bar for a view's background jobs, or nothing when it has none. */
export const presentBackgroundJobs = (
  jobs: BackgroundJob[],
  t: TFunction
): BackgroundJobsBarModel | null => {
  if (jobs.length === 0) return null;
  const items = jobs.map((job) => {
    const jobName = name(job, t);
    return {
      jobId: job.jobId,
      name: jobName,
      label: jobName,
      waitingForApproval: isWaitingForApproval(job),
      stopping: job.status === 'cancel_requested',
    };
  });
  if (items.length > 1) {
    // With one job the title says it waits for approval; with several, its own label does.
    const labelled = items.map((item) =>
      item.waitingForApproval
        ? { ...item, label: t('mindroomUi.backgroundJobs.awaitingApproval', { tool: item.name }) }
        : item
    );
    return {
      title: t('mindroomUi.backgroundJobs.jobCount', { count: items.length }),
      items: labelled,
    };
  }
  const [only] = items;
  const title = only.waitingForApproval
    ? t('mindroomUi.backgroundJobs.awaitingApproval', { tool: only.name })
    : t('mindroomUi.backgroundJobs.running', { tool: only.name });
  return { title, items };
};
