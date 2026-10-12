import type { TFunction } from 'i18next';
import type { BackgroundJob } from './backgroundJobsContract';

export type BackgroundJobsBarItem = {
  jobId: string;
  // The job's own name, for its cancel button and errors; `label` may add that it waits for approval.
  name: string;
  label: string;
  // Its cancel was already requested, from this view or anywhere else.
  stopping: boolean;
};

export type BackgroundJobsBarModel = {
  title: string;
  items: BackgroundJobsBarItem[];
};

const jobName = (job: BackgroundJob, t: TFunction): string =>
  job.kind === 'subagent' ? t('mindroomUi.backgroundJobs.subagent', { tool: job.tool }) : job.tool;

const awaitingApproval = (job: BackgroundJob): boolean => job.status === 'awaiting_approval';

/** The jobs bar for a view's background jobs, or nothing when it has none. */
export const presentBackgroundJobs = (
  jobs: BackgroundJob[],
  t: TFunction
): BackgroundJobsBarModel | null => {
  const [first] = jobs;
  if (!first) return null;
  const several = jobs.length > 1;
  const items = jobs.map((job) => {
    const name = jobName(job, t);
    return {
      jobId: job.jobId,
      name,
      // With one job the title says it waits for approval; with several, its own label does.
      label:
        several && awaitingApproval(job)
          ? t('mindroomUi.backgroundJobs.awaitingApproval', { tool: name })
          : name,
      stopping: job.status === 'cancel_requested',
    };
  });
  let title: string;
  if (several) title = t('mindroomUi.backgroundJobs.jobCount', { count: jobs.length });
  else if (awaitingApproval(first))
    title = t('mindroomUi.backgroundJobs.awaitingApproval', { tool: items[0].name });
  else title = t('mindroomUi.backgroundJobs.running', { tool: items[0].name });
  return { title, items };
};
