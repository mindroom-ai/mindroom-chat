/**
 * Content key on a fork's root: `{thread_id, event_id}`, the parent thread's root and the last of its
 * messages the fork includes (read in `event-store/threads/threadFork.ts`).
 */
export const THREAD_FORK_KEY = 'io.mindroom.fork';
