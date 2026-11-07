import {
  MatrixEventEvent,
  RelationType,
  ThreadEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type Thread,
} from 'matrix-js-sdk';
import { getLatestEdit } from '../room';
import { isThreadSummaryEvent } from '../protocol/threadSummary';
import { watchRoomThreads } from '../watchRoomThreads';

// The MindRoom SDK patch leaves a thread unopened (summary only) until the app shows or opens it.
// Its replies still join the thread as they arrive, but their edits wait in `replayEvents` (the
// newest one per reply and sender) for the first page. A Compact card loads its thread only after
// it stays on screen for a moment, and while agents stream, cards trade places faster than that,
// so a card could show a streamed reply at its first revision through the whole stream and after
// it (one large-room burst of 400 edits ended with a card on its first message). This module puts
// the newest waiting edit on the reply it replaces, in memory and without loading the thread;
// opening or showing the thread later replays the edits as before.
//
// The SDK forgets the summary's reply as soon as a newer thread event arrives, such as the title
// notice that follows a finished reply. That copy of the reply is in no timeline, so the edit
// still waiting for it, and the card, would lose it. The watcher keeps the reply each unopened
// thread last summarized for as long as the thread stays unopened.

/** The reply each unopened thread last summarized; the watcher drops it once the thread opens. */
const summarizedReplies = new WeakMap<object, MatrixEvent>();

type SummarizedThread = {
  id?: string;
  replyToEvent?: MatrixEvent | null;
};

/** A reply the thread's summary may name: not its root, nor its title notice. */
const isSummarizedReply = (
  thread: SummarizedThread,
  event: MatrixEvent | null | undefined
): event is MatrixEvent => !!event && event.getId() !== thread.id && !isThreadSummaryEvent(event);

/**
 * The thread's newest reply outside its timeline: the reply its summary names, or, in an unopened
 * thread whose summary moved on to a title notice, the reply it named before, on its newest edit.
 */
export const getThreadSummaryReply = (
  thread: SummarizedThread | null | undefined
): MatrixEvent | undefined => {
  if (!thread) return undefined;
  const summarized = thread.replyToEvent ?? undefined;
  if (isSummarizedReply(thread, summarized)) return summarized;
  return summarizedReplies.get(thread) ?? summarized;
};

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
export const findReply = (thread: Thread, eventId: string): MatrixEvent | undefined => {
  const summarized = getThreadSummaryReply(thread);
  return (
    thread.findEventById(eventId) ?? (summarized?.getId() === eventId ? summarized : undefined)
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
    if (thread.initialEventsFetched) {
      summarizedReplies.delete(thread);
      return false;
    }
    if (isSummarizedReply(thread, thread.replyToEvent))
      summarizedReplies.set(thread, thread.replyToEvent);
    let changed = false;
    const targets = new Set<MatrixEvent>();
    (thread.replayEvents ?? []).forEach((edit) => {
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

/**
 * The unopened thread of `room` whose waiting edits hold `edit`. These edits reach no timeline, so
 * whoever saves the timelines' events must take them from here.
 */
export const unopenedThreadHoldingEdit = (room: Room, edit: MatrixEvent): Thread | undefined =>
  room
    .getThreads()
    .find((thread) => !thread.initialEventsFetched && !!thread.replayEvents?.includes(edit));
