import {
  MatrixEventEvent,
  RelationType,
  ThreadEvent,
  type MatrixClient,
  type MatrixEvent,
  type Thread,
} from 'matrix-js-sdk';
import { getLatestEdit } from '../room';
import { watchRoomThreads } from '../watchRoomThreads';

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

/**
 * A reply of an unopened thread: in its timeline, or, for a thread listed with the room, the
 * latest event of the root's summary, which is in no timeline.
 */
const findReply = (thread: Thread, eventId: string): MatrixEvent | undefined => {
  const summarized = thread.replyToEvent;
  return (
    thread.findEventById(eventId) ?? (summarized?.getId() === eventId ? summarized : undefined)
  );
};

// Edits of replies of unopened threads that came from the page's event cache, not from the SDK
// (`event-store/sdk/restoredStreamingReplies.ts`). They count as waiting edits, so an update of the
// thread puts the newest back on its reply, also after the SDK mapped an older copy of the reply
// (with that copy's edit) onto it. The SDK does not replay them; the thread's first page brings
// edits at least as new.
const cachedEdits = new WeakMap<Thread, MatrixEvent[]>();

/** The edits waiting in an unopened thread for the given reply. */
const waitingEditsFor = (thread: Thread, targetId: string): MatrixEvent[] =>
  [...(thread.replayEvents ?? []), ...(cachedEdits.get(thread) ?? [])].filter(
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
  /** Removes the listeners the watcher put on edits. */
  stop: () => void;
};

const createEditWatcher = (): EditWatcher => {
  // Edits waiting for a successful decryption, and the edits shown on a reply, each listened to
  // once; `listening` holds the removal of every listener still on an edit.
  const decrypting = new WeakSet<MatrixEvent>();
  const shownEdits = new WeakSet<MatrixEvent>();
  const listening = new Set<() => void>();

  const notify = (thread: Thread) => {
    thread.emit(ThreadEvent.Update, thread);
  };

  /**
   * A failed attempt also announces itself as decrypted, and the SDK decrypts the edit again
   * once its key arrives, so listen until an attempt succeeds or the thread opens.
   */
  const awaitDecryption = (thread: Thread, edit: MatrixEvent) => {
    if (decrypting.has(edit)) return;
    decrypting.add(edit);
    const stopListening = () => {
      edit.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
      listening.delete(stopListening);
      decrypting.delete(edit);
    };
    const onDecrypted = () => {
      if (thread.initialEventsFetched) {
        stopListening();
        return;
      }
      if (edit.isDecryptionFailure()) return;
      stopListening();
      if (showThreadEdits(thread)) notify(thread);
    };
    edit.on(MatrixEventEvent.Decrypted, onDecrypted);
    listening.add(stopListening);
  };

  /** The SDK takes a redacted edit out of the waiting ones; show the newest one left. */
  const followRedaction = (thread: Thread, target: MatrixEvent, edit: MatrixEvent) => {
    if (shownEdits.has(edit)) return;
    shownEdits.add(edit);
    const stopListening = () => {
      edit.removeListener(MatrixEventEvent.BeforeRedaction, onBeforeRedaction);
      listening.delete(stopListening);
    };
    const onBeforeRedaction = () => {
      stopListening();
      queueMicrotask(() => {
        if (target.replacingEvent() !== edit || thread.initialEventsFetched) return;
        showNewestEdit(thread, target);
        notify(thread);
      });
    };
    edit.on(MatrixEventEvent.BeforeRedaction, onBeforeRedaction);
    listening.add(stopListening);
  };

  const showThreadEdits = (thread: Thread): boolean => {
    if (thread.initialEventsFetched) return false;
    let changed = false;
    const targets = new Set<MatrixEvent>();
    [...(thread.replayEvents ?? []), ...(cachedEdits.get(thread) ?? [])].forEach((edit) => {
      if (!edit.isRelation(RelationType.Replace)) return;
      const targetId = edit.getAssociatedId();
      const target = targetId ? findReply(thread, targetId) : undefined;
      if (!target) return;
      if (edit.shouldAttemptDecryption() || edit.isBeingDecrypted() || edit.isDecryptionFailure()) {
        awaitDecryption(thread, edit);
        return;
      }
      targets.add(target);
    });
    targets.forEach((target) => {
      if (!showNewestEdit(thread, target)) return;
      changed = true;
      const edit = target.replacingEvent();
      if (edit) followRedaction(thread, target, edit);
    });
    return changed;
  };

  const stop = () => {
    [...listening].forEach((stopListening) => stopListening());
  };

  return { showThreadEdits, stop };
};

/**
 * Has an unopened thread count an edit the event cache saved for one of its replies among its
 * waiting edits, and announces the thread so its replies show their newest edit.
 */
export const holdCachedEditInUnopenedThread = (thread: Thread, edit: MatrixEvent): void => {
  const held = cachedEdits.get(thread) ?? [];
  if (!held.includes(edit)) cachedEdits.set(thread, [...held, edit]);
  thread.emit(ThreadEvent.Update, thread);
};

/**
 * Keeps the replies of unopened threads on their newest edit for the client's whole life; call it
 * before the client starts. Returns a function that stops it.
 */
export const keepUnopenedThreadEditsShown = (mx: MatrixClient): (() => void) => {
  const watcher = createEditWatcher();
  // The SDK updates a thread after each batch it adds, also one that only brings edits. The
  // listeners that rebuild the thread cards come later in the same update, so they see the edit.
  const stopRooms = watchRoomThreads(mx, {
    onThread: (_room, thread) => {
      watcher.showThreadEdits(thread);
    },
  });

  return () => {
    stopRooms();
    watcher.stop();
  };
};
