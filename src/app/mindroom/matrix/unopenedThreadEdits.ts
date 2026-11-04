import {
  ClientEvent,
  MatrixEventEvent,
  RelationType,
  ThreadEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type Thread,
} from 'matrix-js-sdk';
import { getLatestEdit } from '../../utils/room';

// The MindRoom SDK patch leaves a thread unopened (summary only) until the app shows or opens it.
// Its replies still join the thread as they arrive, but their edits wait in `replayEvents` (the
// newest one per reply and sender) for the first page. A Compact card loads its thread only after
// it stays on screen for a moment, and while agents stream, cards trade places faster than that,
// so a card could show a streamed reply at its first revision through the whole stream and after
// it (one large-room burst of 400 edits ended with a card on its first message). This module puts
// the newest waiting edit on the reply it replaces, in memory and without loading the thread;
// opening or showing the thread later replays the edits as before.

const isValidEdit = (target: MatrixEvent, edit: MatrixEvent): boolean => {
  const newContent = edit.getContent()['m.new_content'];
  return (
    !edit.isRedacted() &&
    !edit.isDecryptionFailure() &&
    edit.getType() === target.getType() &&
    !!newContent &&
    typeof newContent === 'object'
  );
};

/** The edits waiting in an unopened thread for the given reply. */
const waitingEditsFor = (thread: Thread, targetId: string): MatrixEvent[] =>
  (thread.replayEvents ?? []).filter(
    (event) => event.isRelation(RelationType.Replace) && event.getAssociatedId() === targetId
  );

/**
 * Shows the newest waiting edit on a reply of an unopened thread. An edit the reply shows already
 * stays when it is newer, so a bundled or cached edit is never replaced by an older one. Returns
 * whether the reply changed.
 */
const showNewestEdit = (thread: Thread, target: MatrixEvent): boolean => {
  const targetId = target.getId();
  if (!targetId || target.isRedacted() || target.isState()) return false;
  const shown = target.replacingEvent();
  const candidates = waitingEditsFor(thread, targetId).filter((edit) => isValidEdit(target, edit));
  if (shown && !shown.isRedacted()) candidates.unshift(shown);
  const newest = getLatestEdit(target, candidates);
  if (newest === shown || (!newest && !shown)) return false;
  target.makeReplaced(newest);
  return true;
};

type EditWatcher = {
  /** Shows the waiting edits of one thread; returns whether a reply changed. */
  showThreadEdits: (thread: Thread) => boolean;
};

const createEditWatcher = (): EditWatcher => {
  // Edits still being decrypted, and the edits shown on a reply, each listened to once.
  const decrypting = new WeakSet<MatrixEvent>();
  const shownEdits = new WeakSet<MatrixEvent>();

  const notify = (thread: Thread) => {
    thread.emit(ThreadEvent.Update, thread);
  };

  const showThreadEdits = (thread: Thread): boolean => {
    if (thread.initialEventsFetched) return false;
    let changed = false;
    const targets = new Set<MatrixEvent>();
    (thread.replayEvents ?? []).forEach((edit) => {
      if (!edit.isRelation(RelationType.Replace)) return;
      const targetId = edit.getAssociatedId();
      const target = targetId ? thread.findEventById(targetId) : undefined;
      if (!target) return;
      if (edit.shouldAttemptDecryption() || edit.isBeingDecrypted()) {
        if (decrypting.has(edit)) return;
        decrypting.add(edit);
        edit.once(MatrixEventEvent.Decrypted, () => {
          if (showThreadEdits(thread)) notify(thread);
        });
        return;
      }
      targets.add(target);
    });
    targets.forEach((target) => {
      if (!showNewestEdit(thread, target)) return;
      changed = true;
      const edit = target.replacingEvent();
      if (!edit || shownEdits.has(edit)) return;
      shownEdits.add(edit);
      // The SDK takes a redacted edit out of the waiting ones; show the newest one left.
      edit.once(MatrixEventEvent.BeforeRedaction, () => {
        queueMicrotask(() => {
          if (target.replacingEvent() !== edit || thread.initialEventsFetched) return;
          showNewestEdit(thread, target);
          notify(thread);
        });
      });
    });
    return changed;
  };

  return { showThreadEdits };
};

/**
 * Keeps the replies of unopened threads on their newest edit for the client's whole life; call it
 * before the client starts. Returns a function that stops it.
 */
export const keepUnopenedThreadEditsShown = (mx: MatrixClient): (() => void) => {
  const watcher = createEditWatcher();
  const stops = new Map<Room, () => void>();

  const watchRoom = (room: Room) => {
    if (stops.has(room)) return;
    // The SDK updates a thread after each batch it adds, also one that only brings edits. The
    // listeners that rebuild the thread cards come later in the same update, so they see the edit.
    const onThread = (thread: Thread) => {
      watcher.showThreadEdits(thread);
    };
    room.on(ThreadEvent.New, onThread);
    room.on(ThreadEvent.Update, onThread);
    stops.set(room, () => {
      room.removeListener(ThreadEvent.New, onThread);
      room.removeListener(ThreadEvent.Update, onThread);
    });
    room.getThreads().forEach(onThread);
  };

  mx.on(ClientEvent.Room, watchRoom);
  mx.getRooms().forEach(watchRoom);

  return () => {
    mx.removeListener(ClientEvent.Room, watchRoom);
    stops.forEach((stop) => stop());
    stops.clear();
  };
};
