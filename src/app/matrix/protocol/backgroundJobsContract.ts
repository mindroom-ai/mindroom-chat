import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';

/** Each MindRoom agent's live background jobs in a room, as state keyed by the agent's own user ID. */
export const MINDROOM_BACKGROUND_JOBS_EVENT = 'io.mindroom.background_jobs';

/** The timeline event that asks every agent in the room to cancel one job, or all of them here. */
export const MINDROOM_BACKGROUND_JOB_CANCEL_EVENT = 'io.mindroom.background_job_cancel';

export type BackgroundJob = {
  jobId: string;
  /** The agent that runs the job and publishes it, whose reply in the job's thread calls it. */
  agentId: string;
  threadId: string | null;
  kind: string;
  tool: string;
  status: string;
  startedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJob = (agentId: string, value: unknown): BackgroundJob | undefined => {
  if (!isRecord(value)) return undefined;
  const { job_id: jobId, thread_id: threadId, kind, tool, status, started_at: startedAt } = value;
  if (
    typeof jobId !== 'string' ||
    !(typeof threadId === 'string' || threadId === null || threadId === undefined) ||
    typeof kind !== 'string' ||
    typeof tool !== 'string' ||
    typeof status !== 'string' ||
    typeof startedAt !== 'string'
  ) {
    return undefined;
  }
  return { jobId, agentId, threadId: threadId ?? null, kind, tool, status, startedAt };
};

/** Read one agent's jobs from state `agentRoomState` already checked the agent published about itself. */
export const parseBackgroundJobsStateEvent = (event: MatrixEvent): BackgroundJob[] => {
  const jobs = event.getContent().jobs;
  const agentId = event.getStateKey();
  if (!Array.isArray(jobs) || !agentId) return [];
  return jobs.flatMap((value) => parseJob(agentId, value) ?? []);
};

// Machine strings sort as the backend sorts them; locale collation would misplace an ISO time without a fraction.
const byCodePoint = (a: string, b: string): number => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/**
 * The listed jobs of the agents' jobs state, oldest first, and the number of their live jobs here.
 * An agent lists only its newest jobs that fit the event and states `total`, its live jobs in the
 * room listed or not; a `total` that is no whole number or below its listed jobs counts as absent.
 */
export const selectBackgroundJobs = (
  events: MatrixEvent[]
): { jobs: BackgroundJob[]; total: number } => {
  let total = 0;
  const jobs = events.flatMap((event) => {
    const listed = parseBackgroundJobsStateEvent(event);
    const stated: unknown = event.getContent().total;
    total +=
      Number.isSafeInteger(stated) && (stated as number) >= listed.length
        ? (stated as number)
        : listed.length;
    return listed;
  });
  jobs.sort((a, b) => byCodePoint(a.startedAt, b.startedAt) || byCodePoint(a.jobId, b.jobId));
  return { jobs, total };
};

/** The jobs a view shows: the open thread's, or every job of the room in the main timeline. */
export const jobsInView = (jobs: BackgroundJob[], threadId: string | null): BackgroundJob[] =>
  threadId === null ? jobs : jobs.filter((job) => job.threadId === threadId);
