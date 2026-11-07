import { RelationType, type MatrixEvent, type Room, type Thread } from 'matrix-js-sdk';
import { isEventOrderedAfter } from '../../matrix/room';
import { unopenedThreadHoldingEdit } from '../../matrix/client/unopenedThreadEdits';
import { THREAD_EDIT_COMPACTION_DEBOUNCE_MS } from '../cache/preloadSettings';
import {
  createEditCompactionScheduler,
  type EditCompactionScheduler,
} from './editCompactionScheduler';

export type UnopenedThreadEditSaver = {
  /** Takes a live event; an edit that waits in an unopened thread is saved to that thread. */
  handle: (event: MatrixEvent, room: Room) => void;
  /** Saves the pending edits now (page hide, the engine's stop). */
  flush: () => void;
};

/**
 * Saves the edits that wait in unopened threads. The MindRoom SDK patch leaves a thread unopened
 * (its server summary only) until the app opens or shows it, and keeps its replies' edits in
 * `replayEvents` instead of a timeline, so they never reach RoomEvent.Timeline and the engine's
 * write-through. `unopenedThreadEdits.ts` shows the newest one on the summarized reply, in memory
 * only: once a newer event of the thread (an agent's title notice) takes the reply's place in the
 * summary, a Compact card reads the reply from the thread's cache, which held its first revision.
 * The newest edit of each reply goes to its thread's cache after the stream's edits pause, as with
 * the write-through's edits, as a row of its own that the cache applies to the reply when the
 * thread is read. An opened thread replays its edits into its timeline, and the write-through
 * saves them from there.
 */
export const createUnopenedThreadEditSaver = (
  save: (room: Room, thread: Thread, edit: MatrixEvent) => void,
  scheduler: EditCompactionScheduler = createEditCompactionScheduler(
    THREAD_EDIT_COMPACTION_DEBOUNCE_MS
  )
): UnopenedThreadEditSaver => {
  const newest = new Map<string, MatrixEvent>();
  return {
    handle: (event, room) => {
      const targetId = event.getAssociatedId();
      if (
        !targetId ||
        !event.getId() ||
        event.status ||
        !event.isRelation(RelationType.Replace) ||
        event.shouldAttemptDecryption() ||
        event.isBeingDecrypted() ||
        event.isDecryptionFailure()
      )
        return;
      const thread = unopenedThreadHoldingEdit(room, event);
      if (!thread) return;
      const key = `${room.roomId}|${thread.id}|${targetId}`;
      const pending = newest.get(key);
      if (!pending || !isEventOrderedAfter(pending, event)) newest.set(key, event);
      scheduler.scheduleTargetUpsert(key, () => {
        const edit = newest.get(key);
        newest.delete(key);
        if (edit) save(room, thread, edit);
      });
    },
    flush: () => scheduler.flushAll(),
  };
};
