import type { MatrixEvent } from 'matrix-js-sdk';
import {
  MAX_FORK_DEPTH,
  cutThreadAtForkPoint,
  parseThreadForkRef,
  type ThreadForkRef,
} from '../../event-store/threads/threadFork';

/** The parent conversation a fork shows before its own messages. */
export type ThreadForkPrefix = {
  /** Each parent's messages up to its fork point, the oldest parent first. */
  events: MatrixEvent[];
  /** The root's own reference; undefined when the root is no fork. */
  parent?: ThreadForkRef;
  /** Whether every reference in the chain resolved, up to a thread that is no fork. */
  complete: boolean;
};

/** A thread's events; `forkPointId` is the last of them the prefix needs. */
export type LoadThreadEvents = (threadId: string, forkPointId: string) => Promise<MatrixEvent[]>;

/**
 * Follows the fork references from `root` through its parents. Each parent is cut at the fork
 * point that names it and goes in front of what was resolved before it. A parent without its fork
 * point among its own messages ends the walk there, as do the depth cap and a cycle, which log.
 */
export const loadThreadForkPrefix = async (
  { loadThreadEvents }: { loadThreadEvents: LoadThreadEvents },
  root: MatrixEvent
): Promise<ThreadForkPrefix> => {
  const parent = parseThreadForkRef(root.getOriginalContent());
  const segments: MatrixEvent[][] = [];
  const visited = new Set([root.getId()]);
  const prefix = (complete: boolean): ThreadForkPrefix => ({
    events: segments.flat(),
    parent,
    complete,
  });

  let ref = parent;
  while (ref) {
    const { threadId, eventId } = ref;
    if (segments.length >= MAX_FORK_DEPTH || visited.has(threadId)) {
      console.warn('[threadFork] fork chain stopped', {
        rootId: root.getId(),
        threadId,
        depth: segments.length,
      });
      return prefix(false);
    }
    visited.add(threadId);
    const events = await loadThreadEvents(threadId, eventId);
    const cut = cutThreadAtForkPoint(threadId, events, eventId);
    if (!cut) return prefix(false);
    segments.unshift(cut);
    const parentRoot = events.find((event) => event.getId() === threadId);
    if (!parentRoot) return prefix(false);
    ref = parseThreadForkRef(parentRoot.getOriginalContent());
  }
  return prefix(true);
};
