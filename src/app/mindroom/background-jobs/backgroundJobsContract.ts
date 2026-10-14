import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';

/** Each MindRoom agent's live background jobs in a room, as state keyed by the agent's own user ID. */
export const MINDROOM_BACKGROUND_JOBS_EVENT = 'io.mindroom.background_jobs';

/** The timeline event that asks every agent in the room to cancel one job, or all of them here. */
export const MINDROOM_BACKGROUND_JOB_CANCEL_EVENT = 'io.mindroom.background_job_cancel';

export type BackgroundJob = {
  jobId: string;
  threadId: string | null;
  kind: string;
  tool: string;
  status: string;
  startedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJob = (value: unknown): BackgroundJob | undefined => {
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
  return { jobId, threadId: threadId ?? null, kind, tool, status, startedAt };
};

/** Read one agent's jobs; an agent may only describe its own jobs, under its own user ID. */
export const parseBackgroundJobsStateEvent = (event: MatrixEvent): BackgroundJob[] => {
  const sender = event.getSender();
  const jobs = event.getContent().jobs;
  if (!sender || event.getStateKey() !== sender || !Array.isArray(jobs)) return [];
  return jobs.flatMap((value) => parseJob(value) ?? []);
};

// Machine strings sort as the backend sorts them; locale collation would misplace an ISO time without a fraction.
const byCodePoint = (a: string, b: string): number => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/**
 * Every job of the room, oldest first. Only MindRoom agents on the viewer's homeserver that are still
 * in the room publish jobs; an agent known to have left cannot clear its state, so its last list is ignored.
 */
export const selectBackgroundJobs = (
  events: MatrixEvent[],
  viewerUserId: string | undefined,
  isJoined: (userId: string) => boolean
): BackgroundJob[] =>
  events
    .filter((event) => {
      const sender = event.getSender();
      return !!sender && isMindroomAgentUserIdForViewer(sender, viewerUserId) && isJoined(sender);
    })
    .flatMap(parseBackgroundJobsStateEvent)
    .sort((a, b) => byCodePoint(a.startedAt, b.startedAt) || byCodePoint(a.jobId, b.jobId));

/** The jobs a view shows: the open thread's, or every job of the room in the main timeline. */
export const jobsInView = (jobs: BackgroundJob[], threadId: string | null): BackgroundJob[] =>
  threadId === null ? jobs : jobs.filter((job) => job.threadId === threadId);
