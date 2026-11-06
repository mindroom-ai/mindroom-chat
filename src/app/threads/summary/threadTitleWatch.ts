import {
  MatrixEventEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type Thread,
} from 'matrix-js-sdk';
import { watchRoomThreads } from '../../matrix/watchRoomThreads';
import {
  getThreadSummaryInfo,
  getThreadSummaryInfosFromEventSources,
  isThreadSummaryEvent,
  THREAD_SUMMARY_METADATA_KEY,
  type ThreadSummaryInfo,
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
//
// A room can also hold each thread's current title as state: an `io.mindroom.thread_summary` state
// event whose key is the thread's root ID and whose content is the title notice's metadata plus its
// `event_id`. Every device then knows every title from the room's state, also titles in a sync gap
// and in threads it never loaded. Encrypted rooms keep titles in their encrypted notices only: a
// title in plain state there would show the room's conversation to the server, so such state is
// ignored.

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

/** The title a room's state holds for one thread, dated by the state event. */
const getStateTitle = (event: MatrixEvent): ThreadSummaryInfo | undefined => {
  const content = event.getContent();
  const info = getThreadSummaryInfo({ [THREAD_SUMMARY_METADATA_KEY]: content });
  if (!info?.summaryText) return undefined;
  const eventId = typeof content.event_id === 'string' ? content.event_id : undefined;
  return { ...info, eventTs: event.getTs(), ...(eventId ? { eventId } : {}) };
};

/** Saves the titles a room holds as state, now and as they change. Returns what stops it. */
const keepStateTitles = (sessionId: string, room: Room): (() => void) => {
  const save = (event: MatrixEvent) => {
    const threadRootId = event.getStateKey();
    if (event.getType() !== THREAD_SUMMARY_METADATA_KEY || !threadRootId?.startsWith('$')) return;
    if (room.hasEncryptionStateEvent()) return;
    const info = getStateTitle(event);
    if (info) storeThreadSummaryInState(sessionId, room.roomId, threadRootId, info);
  };
  room.currentState.getStateEvents(THREAD_SUMMARY_METADATA_KEY).forEach(save);
  room.on(RoomStateEvent.Events, save);
  return () => {
    room.removeListener(RoomStateEvent.Events, save);
  };
};

/**
 * Keeps the titles of every room's threads in the session's thread summary state: from the room's
 * state, and from the events each thread holds whenever the SDK announces or updates it. Returns
 * what stops it.
 */
export const keepThreadTitles = (mx: MatrixClient, sessionId: string): (() => void) => {
  const reader = createThreadTitleReader(sessionId);
  const stopRooms = watchRoomThreads(mx, {
    onThread: (room, thread) => reader.read(room.roomId, thread),
    onRoom: (room) => keepStateTitles(sessionId, room),
  });
  return () => {
    stopRooms();
    reader.stop();
  };
};
