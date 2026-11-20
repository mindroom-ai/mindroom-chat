import type { MatrixClient, Room } from 'matrix-js-sdk';
import { discardFailedLocalEcho } from '../protocol/pendingLocalEcho';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../protocol/backgroundJobsContract';
import { forgetCancel, markCancelSent } from '../state/sentCancels';

export type BackgroundJobCancelRequest = { jobId: string } | { all: true };

/**
 * Ask the room's agents to cancel one job, or every job of this view: in a thread, that thread's jobs; in the
 * main timeline, every job of the room. Every agent sees the event and cancels only its own jobs.
 * A cancel that fails to send leaves no local echo behind to be resent later.
 */
export const cancelBackgroundJob = async (
  mx: MatrixClient,
  room: Room,
  threadId: string | null,
  request: BackgroundJobCancelRequest
): Promise<void> => {
  const content: Record<string, unknown> =
    'jobId' in request ? { job_id: request.jobId } : { all: true };
  if (threadId) content['m.relates_to'] = { rel_type: 'm.thread', event_id: threadId };
  const txnId = mx.makeTxnId();
  try {
    await mx.sendEvent(
      room.roomId,
      MINDROOM_BACKGROUND_JOB_CANCEL_EVENT as never,
      content as never,
      txnId
    );
  } catch (error) {
    discardFailedLocalEcho(mx, room.getEventForTxnId(txnId));
    throw error;
  }
};

/**
 * Stop jobs, as the jobs bar's and the Sub-agents panel's Stop do: `jobIds` show as stopping
 * while the cancel is on its way, and again once it failed to send. Whether it went out.
 */
export const stopBackgroundJobs = async (
  mx: MatrixClient,
  room: Room,
  threadId: string | null,
  request: BackgroundJobCancelRequest,
  jobIds: readonly string[]
): Promise<boolean> => {
  const marked = markCancelSent(room.roomId, jobIds);
  try {
    await cancelBackgroundJob(mx, room, threadId, request);
    return true;
  } catch {
    forgetCancel(room.roomId, marked);
    return false;
  }
};
