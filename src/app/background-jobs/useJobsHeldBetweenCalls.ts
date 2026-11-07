import { useEffect, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';
import {
  getThreadStreamingState,
  useThreadStreamingState,
} from '../event-store/threads/useThreadStreamingState';

/** How long the jobs bar keeps the jobs it last showed after they end, in ms. */
export const JOBS_HOLD_MS = 2_000;

type Held = { view: string | null; jobs: BackgroundJob[] };

/** The thread all the jobs run in, when they share one. */
const threadOf = (jobs: BackgroundJob[]): string | undefined => {
  const threadId = jobs[0]?.threadId;
  return threadId && jobs.every((job) => job.threadId === threadId) ? threadId : undefined;
};

/**
 * The view's jobs, or, for a moment after the last of them ends, the jobs it showed last.
 *
 * An agent runs its tool calls one after the other, and each call's job ends before the next one
 * starts. Without the hold the bar would leave between two calls and come back for the next one,
 * and the timeline, which keeps its newest row above the bar, would move down and up again. A job
 * that starts within the hold takes the bar's place at once; when none does, the bar goes.
 * Jobs that were all being stopped are not held: the person stopped them and expects them gone.
 * The agent calls its tools while its reply in the jobs' thread streams, so once that reply has
 * finished no call follows and the bar goes at once. `view` names the view (its thread), so a held
 * bar never shows in another one.
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
    if (shown) setHeld({ view, jobs: holdable ? jobs : [] });
  }, [holdable, jobs, shown, view]);
  // The reply that runs the jobs. Only one seen streaming while they ran ends the hold: a thread
  // this client does not follow never reads as streaming.
  const runThread = threadOf(shown ? jobs : held.jobs);
  const replyStreams = useThreadStreamingState(room, runThread);
  const [streamedThread, setStreamedThread] = useState<string>();
  useEffect(() => {
    // Asked of the thread itself: the hook's answer can still be the previous thread's.
    if (shown && runThread && getThreadStreamingState(room, runThread)) {
      setStreamedThread(runThread);
    }
  }, [replyStreams, room, runThread, shown]);
  // Only the view's jobs ending starts the hold; changes elsewhere in the room do not extend it.
  useEffect(() => {
    if (shown) return undefined;
    const release = window.setTimeout(
      () =>
        setHeld((previous) =>
          previous.view === view && previous.jobs.length === 0 ? previous : { view, jobs: [] }
        ),
      JOBS_HOLD_MS
    );
    return () => window.clearTimeout(release);
  }, [shown, view]);
  if (shown || held.view !== view) return jobs;
  if (runThread && streamedThread === runThread && !replyStreams) return [];
  return held.jobs;
};
