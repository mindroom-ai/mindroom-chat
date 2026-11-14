import type { TFunction } from 'i18next';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';

export type BackgroundJobsBarItem = {
  jobId: string;
  // The job's own name, for its row, its Stop button and errors.
  name: string;
  // Among several, its row says it waits for approval; one job's title says so.
  waiting: boolean;
  // Its cancel was sent from this client, or requested anywhere else.
  stopping: boolean;
  // It ended, and the bar keeps it while the agent's reply goes on; nothing is left to stop.
  finished: boolean;
  // A sub-agent's run, which the room's Sub-agents panel shows: its row's name opens the panel.
  subagent: boolean;
};

export type BackgroundJobsBarModel = {
  title: string;
  items: BackgroundJobsBarItem[];
};

const jobName = (job: BackgroundJob, t: TFunction): string =>
  job.kind === 'subagent' ? t('mindroomUi.backgroundJobs.subagent', { tool: job.tool }) : job.tool;

const awaitingApproval = (job: BackgroundJob): boolean => job.status === 'awaiting_approval';

/** The status the bar gives the jobs it keeps after they ended; agents list only live jobs. */
export const FINISHED_JOB_STATUS = 'finished';

/** The jobs bar for a view's background jobs, or nothing when it has none. */
export const presentBackgroundJobs = (
  jobs: BackgroundJob[],
  // Whether this client sent a cancel for the job.
  cancelSent: (jobId: string) => boolean,
  t: TFunction,
  // The view's live jobs, listed or not; more than listed when the agents list only their newest.
  total = jobs.length
): BackgroundJobsBarModel | null => {
  const [first] = jobs;
  if (!first) return null;
  const several = jobs.length > 1;
  const items = jobs.map((job) => {
    const finished = job.status === FINISHED_JOB_STATUS;
    return {
      jobId: job.jobId,
      name: jobName(job, t),
      waiting: !finished && several && awaitingApproval(job),
      stopping: !finished && (job.status === 'cancel_requested' || cancelSent(job.jobId)),
      finished,
      subagent: job.kind === 'subagent',
    };
  });
  const finished = items.every((item) => item.finished);
  if (several && finished) {
    return {
      title: t('mindroomUi.backgroundJobs.jobCountFinished', { count: jobs.length }),
      items,
    };
  }
  if (several) {
    const title =
      total > jobs.length
        ? t('mindroomUi.backgroundJobs.jobCountShowing', { count: total, shown: jobs.length })
        : t('mindroomUi.backgroundJobs.jobCount', { count: jobs.length });
    return { title, items };
  }
  const tool = items[0]!.name;
  if (finished) return { title: t('mindroomUi.backgroundJobs.finished', { tool }), items };
  if (items[0]!.stopping)
    return { title: t('mindroomUi.backgroundJobs.stoppingJob', { tool }), items };
  if (awaitingApproval(first))
    return { title: t('mindroomUi.backgroundJobs.awaitingApproval', { tool }), items };
  return { title: t('mindroomUi.backgroundJobs.running', { tool }), items };
};
