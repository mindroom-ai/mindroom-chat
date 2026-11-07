import {
  RelationType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type Thread,
} from 'matrix-js-sdk';
import { watchRoomThreads } from '../../matrix/watchRoomThreads';

/**
 * Saves the edits that wait in unopened threads. The MindRoom SDK patch leaves a thread unopened
 * (its server summary only) until the app opens or shows it, and keeps its replies' edits in
 * `replayEvents` instead of a timeline, so they never reach RoomEvent.Timeline and the engine's
 * write-through. `unopenedThreadEdits.ts` shows the newest one on the summarized reply, in memory
 * only: once a newer event of the thread (an agent's title notice) takes the reply's place in the
 * summary, a Compact card reads the reply from the thread's cache, which held its first revision.
 * Each waiting edit goes to its thread's cache once, as a row of its own that the cache applies to
 * the reply when the thread is read. An opened thread replays its edits into its timeline, and the
 * write-through saves them from there.
 *
 * `save` returns whether it saved the edits; an edit it did not save is offered again with the
 * thread's next update. Returns what stops the watch.
 */
export const saveUnopenedThreadEdits = (
  mx: MatrixClient,
  save: (room: Room, thread: Thread, edits: MatrixEvent[]) => boolean
): (() => void) => {
  const saved = new WeakSet<MatrixEvent>();
  return watchRoomThreads(mx, {
    onThread: (room, thread) => {
      if (thread.initialEventsFetched) return;
      const edits = (thread.replayEvents ?? []).filter(
        (event) =>
          !saved.has(event) &&
          event.isRelation(RelationType.Replace) &&
          !!event.getId() &&
          !event.status &&
          !event.isRedacted() &&
          !event.shouldAttemptDecryption() &&
          !event.isBeingDecrypted() &&
          !event.isDecryptionFailure()
      );
      if (edits.length === 0 || !save(room, thread, edits)) return;
      edits.forEach((edit) => saved.add(edit));
    },
  });
};
