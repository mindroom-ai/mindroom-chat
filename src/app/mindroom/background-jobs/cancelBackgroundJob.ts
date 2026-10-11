import type { MatrixClient } from 'matrix-js-sdk';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from './backgroundJobsContract';

export type BackgroundJobCancelRequest = { jobId: string } | { all: true };

/**
 * Ask the room's agents to cancel one job, or every job of this view: in a thread, that thread's jobs; in the
 * main timeline, every job of the room. Every agent sees the event and cancels only its own jobs.
 */
export const cancelBackgroundJob = async (
  mx: MatrixClient,
  roomId: string,
  threadId: string | null,
  request: BackgroundJobCancelRequest
): Promise<void> => {
  const content: Record<string, unknown> =
    'jobId' in request ? { job_id: request.jobId } : { all: true };
  if (threadId) content['m.relates_to'] = { rel_type: 'm.thread', event_id: threadId };
  await mx.sendEvent(roomId, MINDROOM_BACKGROUND_JOB_CANCEL_EVENT as never, content as never);
};
