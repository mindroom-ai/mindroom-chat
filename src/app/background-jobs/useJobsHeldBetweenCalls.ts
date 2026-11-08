import { useEffect, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import { FINISHED_JOB_STATUS } from './backgroundJobsPresentation';
import { useJobRepliesStreaming } from './useJobRepliesStreaming';

/** How long the jobs bar keeps the jobs it last showed after they and their reply end, in ms. */
export const JOBS_HOLD_MS = 2_000;

type Held = { view: string | null; jobs: BackgroundJob[] };

/**
 * The view's jobs, or, after the last of them ends, the jobs it showed last, as finished.
 *
 * An agent runs its tool calls one after the other, and each call's job ends before the next one
 * starts. Without the hold the bar would leave between two calls and come back for the next one,
 * and the timeline, which keeps its newest row above the bar, would move down and up again. A job
 * that starts within the hold takes the bar's place at once.
 * The agent calls its tools while its reply streams (in the jobs' thread, or in the main timeline
 * of a room whose agents answer there), however long it thinks between two calls, so the hold
 * lasts while that reply streams and for `JOBS_HOLD_MS` after it ends (or after the jobs end, when
 * this client does not see the reply stream); then the bar goes. Another agent's reply in the same
 * conversation does not hold it.
 * Jobs that were all being stopped are not held: the person stopped them and expects them gone.
 * `view` names the view (its thread), so a held bar never shows in another one.
 */
export const useJobsHeldBetweenCalls = (
  jobs: BackgroundJob[],
  view: string | null,
  // Whether this client sent a cancel for the job.
  cancelSent: (jobId: string) => boolean,
  room?: Room
): BackgroundJob[] => {
  const [held, setHeld] = useState<Held>({ view, jobs: [] });
  const shown = jobs.length > 0;
  const holdable =
    shown && jobs.some((job) => job.status !== 'cancel_requested' && !cancelSent(job.jobId));
  useEffect(() => {
    if (!shown) return;
    const finished = holdable ? jobs.map((job) => ({ ...job, status: FINISHED_JOB_STATUS })) : [];
    setHeld({ view, jobs: finished });
  }, [holdable, jobs, shown, view]);
  const replyStreams = useJobRepliesStreaming(room, shown ? jobs : held.jobs, shown);
  // Only the view's jobs ending, or their reply ending after them, starts the release; changes
  // elsewhere in the room do not extend it.
  useEffect(() => {
    if (shown || replyStreams) return undefined;
    const release = window.setTimeout(
      () =>
        setHeld((previous) =>
          previous.view === view && previous.jobs.length === 0 ? previous : { view, jobs: [] }
        ),
      JOBS_HOLD_MS
    );
    return () => window.clearTimeout(release);
  }, [replyStreams, shown, view]);
  if (shown || held.view !== view) return jobs;
  return held.jobs;
};
