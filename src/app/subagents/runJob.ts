import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import type { SubagentRun } from '../messages/live/subagentRunStore';

/**
 * A sub-agent job's own run: the run the job names. A job from MindRoom before that field takes
 * its sub-agent's newest turn, only one that started with the job or later, so a follow-up turn
 * whose first frame has not come shows nothing of the turn before it.
 */
export const runOfJob = (
  runs: readonly SubagentRun[],
  job: BackgroundJob
): SubagentRun | undefined => {
  if (job.run !== undefined) return runs.find((run) => run.run === job.run);
  const startedAt = Date.parse(job.startedAt) / 1000;
  let newest: SubagentRun | undefined;
  runs.forEach((run) => {
    if (run.meta.subagent !== job.subagent || !(run.meta.startedAt >= startedAt)) return;
    if (!newest || run.meta.startedAt >= newest.meta.startedAt) newest = run;
  });
  return job.subagent === undefined ? undefined : newest;
};

/** The live sub-agent job whose run `run` is, which its Stop cancels; none once the agent let it go. */
export const jobOfRun = (
  jobs: readonly BackgroundJob[],
  runs: readonly SubagentRun[],
  run: SubagentRun
): BackgroundJob | undefined =>
  jobs.find((job) => job.kind === 'subagent' && runOfJob(runs, job) === run);
