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
import { getLatestEdit } from '../room';
import {
  isKnownRedactedEventId,
  recordKnownRedactedEventId,
  stripRedactedRelationsFromRawEvent,
} from '../eventRevision';
import {
  isAnchoredSecretRequestEvent,
  isFoldedSecretRequestEvent,
} from '../protocol/secretRequestPreview';
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
/** The anchored secret request an unopened thread last summarized; dropped once the thread opens. */
const summarizedSecretRequests = new WeakMap<object, MatrixEvent>();

type SummarizedThread = {
  id?: string;
  replyToEvent?: MatrixEvent | null;
  room?: Room;
  replayEvents?: MatrixEvent[] | null;
};

/** Whether `room` took a redaction of `eventId` (eventRevision.ts). */
const isKnownRedacted = (room: Room | undefined, eventId: string | undefined): boolean =>
  !!room && !!eventId && isKnownRedactedEventId(room, eventId);

const isRedactedEvent = (room: Room | undefined, event: MatrixEvent | null | undefined): boolean =>
  !!event && (event.isRedacted() || isKnownRedacted(room, event.getId()));

const getRedactedEventId = (event: MatrixEvent): string | undefined => {
  const associated = event.getAssociatedId();
  if (associated) return associated;
  const contentRedacts: unknown = event.getContent().redacts;
  return typeof contentRedacts === 'string' ? contentRedacts : undefined;
};

const serverOf = (userId: string | undefined): string | undefined => {
  const colon = userId?.indexOf(':') ?? -1;
  return colon >= 0 ? userId?.slice(colon + 1) : undefined;
};

const mayRedactEvent = (room: Room, redaction: MatrixEvent, target: MatrixEvent): boolean => {
  const sender = redaction.getSender();
  if (!sender) return false;
  const senderServer = serverOf(sender);
  if (senderServer && senderServer === serverOf(target.getSender())) return true;
  return room.currentState.maySendRedactionForEvent(target, sender);
};

const viewerIdOf = (thread: SummarizedThread): string | undefined =>
  thread.room?.myUserId || undefined;

const isThreadReply = (
  thread: SummarizedThread,
  event: MatrixEvent | null | undefined
): event is MatrixEvent =>
  !!event &&
  event.getId() !== thread.id &&
  !isRedactedEvent(thread.room, event) &&
  !isThreadSummaryEvent(event);

/**
 * A reply to retain across later non-conversational summaries: not the root, title notice, or an
 * anchored secret request (which stays pending briefly and then folds back into its reply).
 */
const isRetainableSummaryReply = (
  thread: SummarizedThread,
  event: MatrixEvent | null | undefined
): event is MatrixEvent =>
  isThreadReply(thread, event) && !isAnchoredSecretRequestEvent(event, viewerIdOf(thread));

/** A reply the thread's summary may name: not its root, title notice, or folded secret request. */
const isSummarizedReply = (
  thread: SummarizedThread,
  event: MatrixEvent | null | undefined
): event is MatrixEvent =>
  isThreadReply(thread, event) && !isFoldedSecretRequestEvent(event, viewerIdOf(thread));

const refreshRetainedReply = (
  thread: SummarizedThread,
  store: WeakMap<object, MatrixEvent>
): MatrixEvent | undefined => {
  const retained = store.get(thread);
  if (!retained) return undefined;
  if (isRedactedEvent(thread.room, retained)) {
    store.delete(thread);
    return undefined;
  }
  // The SDK takes a redacted bundled edit off the copies it holds, from their bundle too; it does
  // not hold this one. The app hides an edit it cannot decrypt yet from replacingEvent(), not
  // from replacingEventId().
  const editId = retained.replacingEventId();
  if (editId && isKnownRedacted(thread.room, editId)) {
    const { unsigned } = stripRedactedRelationsFromRawEvent(retained.event, new Set([editId]));
    retained.setUnsigned(unsigned ?? {});
    showNewestEdit(thread, retained);
  }
  return retained;
};

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
  const retained = refreshRetainedReply(thread, summarizedReplies);
  if (isSummarizedReply(thread, retained)) return retained;
  return isRedactedEvent(thread.room, summarized) ? undefined : summarized;
};

/** The reply retained by the unopened-thread watcher, even if it has since folded. */
export const getRetainedThreadSummaryReply = (
  thread: SummarizedThread | null | undefined
): MatrixEvent | undefined =>
  thread ? refreshRetainedReply(thread, summarizedReplies) : undefined;

/** The anchored secret request last seen in an unopened thread's summary, even after a later title. */
export const getRetainedThreadSecretRequest = (
  thread: SummarizedThread | null | undefined
): MatrixEvent | undefined =>
  thread ? refreshRetainedReply(thread, summarizedSecretRequests) : undefined;

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
 * A reply of a thread: in its timeline, or, for a thread listed with the room, the latest event
 * of the root's summary, which is in no timeline.
 */
export const findReply = (thread: Thread, eventId: string): MatrixEvent | undefined => {
  const fromTimeline = thread.findEventById(eventId);
  if (fromTimeline) return fromTimeline;
  if (
    thread.replyToEvent?.getId() === eventId &&
    !isRedactedEvent(thread.room, thread.replyToEvent)
  )
    return thread.replyToEvent;
  const retained = refreshRetainedReply(thread, summarizedReplies);
  if (retained?.getId() === eventId) return retained;
  const secret = refreshRetainedReply(thread, summarizedSecretRequests);
  return secret?.getId() === eventId ? secret : undefined;
};

/** The edits waiting in an unopened thread for the given reply. */
const waitingEditsFor = (thread: SummarizedThread, targetId: string): MatrixEvent[] =>
  (thread.replayEvents ?? []).filter(
    (event) => event.isRelation(RelationType.Replace) && event.getAssociatedId() === targetId
  );

/**
 * Shows the newest waiting edit on a reply of an unopened thread. An edit the reply shows already
 * stays when it is newer, so a bundled or cached edit is never replaced by an older one. Returns
 * whether the reply changed.
 */
const showNewestEdit = (thread: SummarizedThread, target: MatrixEvent): boolean => {
  const targetId = target.getId();
  if (!targetId || isRedactedEvent(thread.room, target) || target.isState()) return false;
  const shown = target.replacingEvent();
  const waiting = waitingEditsFor(thread, targetId).filter((edit) => isValidEdit(target, edit));
  const candidates = [shown ?? undefined, ...waiting].filter(
    (edit): edit is MatrixEvent =>
      !!edit && !edit.isRedacted() && !isKnownRedacted(thread.room, edit.getId())
  );
  const newest = getLatestEdit(target, candidates);
  if (newest === shown || (!newest && !shown)) return false;
  target.makeReplaced(newest);
  return true;
};

type EditWatcher = {
  /** Shows the waiting edits of one thread; returns whether a reply changed. */
  showThreadEdits: (thread: Thread) => boolean;
  /** Drops detached summary replies targeted by an authorized live redaction. */
  handleRedaction: (mx: MatrixClient, event: MatrixEvent) => void;
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

  const handleRedaction = (mx: MatrixClient, event: MatrixEvent) => {
    if (!event.isRedaction() || event.status !== null) return;
    const targetId = getRedactedEventId(event);
    const roomId = event.getRoomId();
    const room = targetId && roomId ? mx.getRoom(roomId) : null;
    if (!targetId || !room) return;
    room.getThreads().forEach((thread) => {
      if (thread.initialEventsFetched) return;
      const retained = summarizedReplies.get(thread);
      const secret = summarizedSecretRequests.get(thread);
      const summarized = thread.replyToEvent ?? undefined;
      const target =
        (retained?.getId() === targetId ? retained : undefined) ??
        (secret?.getId() === targetId ? secret : undefined) ??
        (summarized?.getId() === targetId ? summarized : undefined);
      if (!target) return;
      const alreadyRedacted = isRedactedEvent(room, target);
      if (!alreadyRedacted && !mayRedactEvent(room, event, target)) return;
      const removedRetained = retained?.getId() === targetId && summarizedReplies.delete(thread);
      const removedSecret = secret?.getId() === targetId && summarizedSecretRequests.delete(thread);
      if (!alreadyRedacted) recordKnownRedactedEventId(room, targetId);
      if (!alreadyRedacted || removedRetained || removedSecret) notify(thread);
    });
  };

  const showThreadEdits = (thread: Thread): boolean => {
    if (thread.initialEventsFetched) {
      summarizedReplies.delete(thread);
      summarizedSecretRequests.delete(thread);
      return false;
    }
    const existingRetained = refreshRetainedReply(thread, summarizedReplies);
    refreshRetainedReply(thread, summarizedSecretRequests);
    if (
      thread.replyToEvent &&
      !isRedactedEvent(thread.room, thread.replyToEvent) &&
      isAnchoredSecretRequestEvent(thread.replyToEvent, viewerIdOf(thread))
    ) {
      summarizedSecretRequests.set(thread, thread.replyToEvent);
    }
    if (
      isRetainableSummaryReply(thread, thread.replyToEvent) ||
      (!isRetainableSummaryReply(thread, existingRetained) &&
        isThreadReply(thread, thread.replyToEvent))
    ) {
      summarizedReplies.set(thread, thread.replyToEvent);
    }
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

  return { showThreadEdits, handleRedaction, stop };
};

/**
 * Keeps the replies of unopened threads on their newest edit for the client's whole life; call it
 * before the client starts. Returns a function that stops it.
 */
export const keepUnopenedThreadEditsShown = (mx: MatrixClient): (() => void) => {
  const watcher = createEditWatcher();
  const onEvent = (event: MatrixEvent) => {
    watcher.handleRedaction(mx, event);
  };
  mx.on(ClientEvent.Event, onEvent);
  // The SDK updates a thread after each batch it adds, also one that only brings edits. The
  // listeners that rebuild the thread cards come later in the same update, so they see the edit.
  const stopRooms = watchRoomThreads(mx, {
    onThread: (_room, thread) => {
      watcher.showThreadEdits(thread);
    },
  });

  return () => {
    mx.removeListener(ClientEvent.Event, onEvent);
    stopRooms();
    watcher.stop();
  };
};
