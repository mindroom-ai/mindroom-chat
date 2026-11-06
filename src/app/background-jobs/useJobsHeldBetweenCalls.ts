import { useEffect, useState } from 'react';
import type { BackgroundJob } from '../matrix/protocol/backgroundJobsContract';

/** How long the jobs bar keeps the jobs it last showed after they end, in ms. */
export const JOBS_HOLD_MS = 2_000;

type Held = { view: string | null; jobs: BackgroundJob[] };

/**
 * The view's jobs, or, for a moment after the last of them ends, the jobs it showed last.
 *
 * An agent runs its tool calls one after the other, and each call's job ends before the next one
 * starts. Without the hold the bar would leave between two calls and come back for the next one,
 * and the timeline, which keeps its newest row above the bar, would move down and up again. A job
 * that starts within the hold takes the bar's place at once; when none does, the bar goes.
 * Jobs that were all being stopped are not held: the person stopped them and expects them gone.
 * `view` names the view (its thread), so a held bar never shows in another one.
 */
export const useJobsHeldBetweenCalls = (
  jobs: BackgroundJob[],
  view: string | null,
  // Whether this client sent a cancel for the job.
  cancelSent: (jobId: string) => boolean
): BackgroundJob[] => {
  const [held, setHeld] = useState<Held>({ view, jobs: [] });
  const shown = jobs.length > 0;
  const holdable =
    shown && jobs.some((job) => job.status !== 'cancel_requested' && !cancelSent(job.jobId));
  useEffect(() => {
    if (shown) setHeld({ view, jobs: holdable ? jobs : [] });
  }, [holdable, jobs, shown, view]);
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
  return held.jobs;
};
