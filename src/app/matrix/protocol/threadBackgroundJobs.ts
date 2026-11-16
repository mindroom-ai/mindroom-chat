import type { Room } from 'matrix-js-sdk';
import { agentRoomState } from './agentRoomState';
import {
  MINDROOM_BACKGROUND_JOBS_EVENT,
  selectBackgroundJobs,
  type BackgroundJob,
} from './backgroundJobsContract';

export type ThreadBackgroundState = { hasBackgroundJob: boolean; hasBackgroundApproval: boolean };

/** One pass over published live jobs, never assign room-wide jobs to a thread. */
export const indexThreadBackgroundJobs = (
  jobs: readonly BackgroundJob[]
): Map<string, ThreadBackgroundState> => {
  const result = new Map<string, ThreadBackgroundState>();
  for (const job of jobs) {
    if (!job.threadId) continue;
    const state = result.get(job.threadId) ?? {
      hasBackgroundJob: false,
      hasBackgroundApproval: false,
    };
    if (job.status === 'awaiting_approval') state.hasBackgroundApproval = true;
    else state.hasBackgroundJob = true;
    result.set(job.threadId, state);
  }
  return result;
};

const cache = new WeakMap<
  Room,
  { contents: unknown[]; states: Map<string, ThreadBackgroundState> }
>();
/** Reuse the per-room join across cross-room entries; stream edits do not rescan jobs. */
export const roomThreadBackgroundJobs = (room: Room): Map<string, ThreadBackgroundState> => {
  const events = agentRoomState(room, MINDROOM_BACKGROUND_JOBS_EVENT);
  const contents = events.map((event) => event.getContent());
  const previous = cache.get(room);
  if (
    previous &&
    previous.contents.length === contents.length &&
    contents.every((content, i) => content === previous.contents[i])
  )
    return previous.states;
  const states = indexThreadBackgroundJobs(selectBackgroundJobs(events).jobs);
  cache.set(room, { contents, states });
  return states;
};
