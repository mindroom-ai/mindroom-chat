import { MatrixEventEvent, type MatrixClient, type MatrixEvent, type Thread } from 'matrix-js-sdk';
import { watchRoomThreads } from '../../matrix/watchRoomThreads';
import {
  getThreadSummaryInfosFromEventSources,
  isThreadSummaryEvent,
} from '../../matrix/protocol/threadSummary';
import { storeThreadSummaryInState } from '../../event-store/threads/threadSummaryState';

// MindRoom titles a thread with an `m.notice` thread event (`io.mindroom.thread_summary`). A device
// that was not online when it arrived learns a title only from the thread's events: the latest
// event of the root's server summary, which is the notice until someone writes after it, or a page
// of the thread the device loaded (a card shown on screen loads its latest page). Those events stay
// in memory only, so the card fell back to the root's text once a later reply took the summary's
// place, and every reload lost them again. This module saves each title it finds there to the
// thread summary state, which keeps it on disk for the room's cards, the sidebar and the Threads
// page.

/** A shown card's first page holds 30 events; the newest title of a loaded thread is near its end. */
const SCANNED_TAIL = 100;

const isUndecrypted = (event: MatrixEvent): boolean =>
  event.isEncrypted() && (event.isBeingDecrypted() || event.getClearContent() === null);

/**
 * Saves the titles a thread holds in memory. An encrypted latest event is read again once it is
 * decrypted. Returns what removes the listener it may leave on that event.
 */
const createThreadTitleReader = (sessionId: string) => {
  const awaiting = new WeakSet<MatrixEvent>();
  const stops = new Set<() => void>();

  const read = (roomId: string, thread: Thread) => {
    const latest = thread.replyToEvent ?? undefined;
    if (latest && isUndecrypted(latest) && !awaiting.has(latest)) {
      awaiting.add(latest);
      const stop = () => {
        latest.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
        stops.delete(stop);
      };
      const onDecrypted = () => {
        if (latest.isDecryptionFailure()) return;
        stop();
        read(roomId, thread);
      };
      latest.on(MatrixEventEvent.Decrypted, onDecrypted);
      stops.add(stop);
    }
    const tail = thread.events.slice(-SCANNED_TAIL);
    const listed = latest && isThreadSummaryEvent(latest) ? [latest] : undefined;
    const infos = getThreadSummaryInfosFromEventSources(listed, tail).filter(
      (info) => !!info?.summaryText && info.eventTs !== undefined
    );
    if (infos.length > 0) storeThreadSummaryInState(sessionId, roomId, thread.id, ...infos);
  };

  return {
    read,
    stop: () => stops.forEach((stop) => stop()),
  };
};

/**
 * Keeps the titles of every room's threads in the session's thread summary state, from the
 * events each thread holds whenever the SDK announces or updates it. Returns what stops it.
 */
export const keepThreadTitles = (mx: MatrixClient, sessionId: string): (() => void) => {
  const reader = createThreadTitleReader(sessionId);
  const stopRooms = watchRoomThreads(mx, {
    onThread: (room, thread) => reader.read(room.roomId, thread),
  });
  return () => {
    stopRooms();
    reader.stop();
  };
};
