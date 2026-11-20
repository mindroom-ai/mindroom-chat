import type { createStore } from 'jotai';
import { RelationType, type MatrixClient } from 'matrix-js-sdk';
import {
  discardedVoiceDraftsAtom,
  openVoiceRecorderAtom,
  pendingVoiceSendDraftAtom,
  queuedVoiceDraftsAtom,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import {
  adoptVoiceOrphans,
  transitionVoiceRecording,
  type JournaledVoiceRecording,
} from './voiceRecordingJournal';
import {
  VOICE_NOT_SAVED_MESSAGE,
  VOICE_SEND_INTERRUPTED_MESSAGE,
} from './voiceSendDraftController';

/**
 * Voice recordings that are neither recording nor sending, around the single slot the composers
 * show (`pendingVoiceSendDraftAtom`): those that wait for it (`queuedVoiceDraftsAtom`), and those
 * whose Discard can still be undone (`discardedVoiceDraftsAtom`). The journal
 * (voiceRecordingJournal.ts) keeps each on disk until it is sent or its discard stands, and what
 * shows here follows what the journal took: a change it could not write is not shown as made.
 */

type Store = ReturnType<typeof createStore>;

/** How long a Discard can be undone. */
export const VOICE_DISCARD_UNDO_MS = 10_000;

/** Puts a recording first in line for the slot. */
export const parkVoiceDraft = (store: Store, draft: PendingVoiceSendDraft): void =>
  store.set(queuedVoiceDraftsAtom, (queued) => [draft, ...queued]);

/**
 * Parks audio that was not sent, of a recorder that stopped by itself or lost its composer. It
 * says it is saved only once the disk holds all of it.
 */
export const keepVoiceDraft = async (store: Store, draft: PendingVoiceSendDraft): Promise<void> => {
  const outcome = await transitionVoiceRecording(draft.recordingId);
  parkVoiceDraft(store, { ...draft, unprotected: outcome !== 'committed' });
};

/**
 * Shows the account's next waiting recording, once the slot is free and nothing records: the
 * slot's recording takes the composer's place, also of one that is recording.
 */
export const offerQueuedVoiceDraft = (store: Store, userId: string | undefined): void => {
  if (store.get(pendingVoiceSendDraftAtom) || store.get(openVoiceRecorderAtom)) return;
  const queued = store.get(queuedVoiceDraftsAtom);
  const next = queued.find((draft) => draft.context.ownerSessionId === userId);
  if (!next) return;
  store.set(
    queuedVoiceDraftsAtom,
    queued.filter((draft) => draft !== next)
  );
  store.set(pendingVoiceSendDraftAtom, next);
};

/**
 * Ends the send attempt `token` of a recording wherever its draft is by now, in the slot or
 * waiting for it: gone when sent, kept as `failed` otherwise. Another recording in the slot is
 * never touched. The draft of a first attempt (no token) is in neither yet: failed, it takes the
 * slot for its recorder to show, or waits for it. False when the draft is no longer there.
 */
export const settleVoiceDraft = (
  store: Store,
  recordingId: string,
  token: string | undefined,
  failed: PendingVoiceSendDraft | undefined
): boolean => {
  const attempted = (draft: PendingVoiceSendDraft | undefined) =>
    draft?.recordingId === recordingId && draft.inFlight?.token === token;
  if (attempted(store.get(pendingVoiceSendDraftAtom))) {
    store.set(pendingVoiceSendDraftAtom, failed);
  } else if (store.get(queuedVoiceDraftsAtom).some(attempted)) {
    store.set(queuedVoiceDraftsAtom, (queued) =>
      queued.flatMap((draft) => (attempted(draft) ? failed ?? [] : draft))
    );
  } else if (token !== undefined) {
    return false;
  } else if (failed) {
    if (store.get(pendingVoiceSendDraftAtom)) parkVoiceDraft(store, failed);
    else store.set(pendingVoiceSendDraftAtom, failed);
  }
  return true;
};

/**
 * Offers Undo for a recording the disk says is discarded until `until`. Then the recording is
 * deleted, if the disk still says so by then: an Undo calls this off first.
 */
const offerVoiceUndo = (store: Store, draft: PendingVoiceSendDraft, until: number): void => {
  const timer = setTimeout(() => {
    void transitionVoiceRecording(draft.recordingId, (record) =>
      (record.discardUntil ?? Infinity) <= Date.now() ? undefined : record
    ).then(() =>
      store.set(discardedVoiceDraftsAtom, (all) => all.filter((entry) => entry.timer !== timer))
    );
  }, until - Date.now());
  store.set(discardedVoiceDraftsAtom, (all) => [...all, { draft, until, timer }]);
};

/**
 * Discards a recording, the slot's or one not shown yet. Once the disk says it is discarded it
 * leaves the slot and offers Undo, and it is deleted when that ran out, also when the page goes
 * first. If the disk could not be told, it stays, and says so.
 */
export const discardVoiceDraft = async (
  store: Store,
  draft: PendingVoiceSendDraft
): Promise<void> => {
  const until = Date.now() + VOICE_DISCARD_UNDO_MS;
  const outcome = await transitionVoiceRecording(draft.recordingId, (record) => ({
    ...record,
    discardUntil: until,
  }));
  const shown = store.get(pendingVoiceSendDraftAtom)?.recordingId === draft.recordingId;
  const kept = { ...draft, errorMessage: VOICE_NOT_SAVED_MESSAGE };
  if (outcome !== 'failed') {
    if (shown) store.set(pendingVoiceSendDraftAtom, undefined);
    offerVoiceUndo(store, draft, until);
  } else if (shown) store.set(pendingVoiceSendDraftAtom, kept);
  else parkVoiceDraft(store, kept);
};

/**
 * Takes a discard back. Its expiry is called off first, and the recording waits for the slot
 * again once the disk no longer says it is discarded. Until then its offer stays, and says that
 * the Undo failed.
 */
export const undoVoiceDiscard = async (store: Store, recordingId: string): Promise<void> => {
  const offer = store
    .get(discardedVoiceDraftsAtom)
    .find((entry) => entry.draft.recordingId === recordingId);
  if (!offer) return;
  clearTimeout(offer.timer);
  const outcome = await transitionVoiceRecording(recordingId, (record) => ({
    ...record,
    discardUntil: undefined,
  }));
  // Pressed twice: the first one brought it back.
  if (!store.get(discardedVoiceDraftsAtom).includes(offer)) return;
  store.set(discardedVoiceDraftsAtom, (all) =>
    all.flatMap((entry) => {
      if (entry !== offer) return entry;
      return outcome === 'failed' ? { ...offer, failed: true } : [];
    })
  );
  if (outcome !== 'failed') {
    parkVoiceDraft(store, { ...offer.draft, unprotected: outcome === 'absent' });
  }
};

const toDraft = (
  mx: MatrixClient,
  ownerSessionId: string,
  { record, file, duration }: JournaledVoiceRecording
): PendingVoiceSendDraft => {
  const { recordingId, destination, txnId } = record;
  const recording = { recordingId, file, duration, txnId };
  const room = destination && mx.getRoom(destination.roomId);
  // Never sent: every composer offers it, to send where Send is pressed. Sent to a room that is
  // not there: every composer offers a copy of it, as its transaction ID says.
  if (!destination || !room) return { ...recording, context: { ownerSessionId } };
  const { replyEventId, replyThreadId } = destination;
  // Its send failed, or was cut short by what ended the page: it waits there, with Retry.
  return {
    ...recording,
    errorMessage: VOICE_SEND_INTERRUPTED_MESSAGE,
    context: {
      ownerSessionId,
      roomId: destination.roomId,
      room,
      threadId: destination.threadId,
      // A voice message needs only the IDs of what it replies to.
      replyDraft: replyEventId
        ? {
            userId: '',
            eventId: replyEventId,
            body: '',
            relation: replyThreadId
              ? { rel_type: RelationType.Thread, event_id: replyThreadId }
              : undefined,
          }
        : undefined,
      threadingEnabled: destination.threadingEnabled,
      // Read from the room again when it is sent.
      signalBridgedRoom: false,
      ...(destination.threadView && { threadView: true }),
    },
  };
};

/**
 * Brings back the recordings a crash, a reload or an app update left on disk for the account:
 * those to send queue for the slot, oldest first, and a discard with time left offers its Undo
 * again. Each call takes what no tab owns by then.
 */
export const recoverVoiceDrafts = async (mx: MatrixClient, store: Store): Promise<void> => {
  const userId = mx.getUserId();
  if (!userId) return;
  const orphans = await adoptVoiceOrphans(userId);
  const waiting: PendingVoiceSendDraft[] = [];
  orphans.forEach((orphan) => {
    const draft = toDraft(mx, userId, orphan);
    const { discardUntil } = orphan.record;
    if (discardUntil === undefined) waiting.push(draft);
    else offerVoiceUndo(store, draft, discardUntil);
  });
  if (waiting.length > 0) store.set(queuedVoiceDraftsAtom, (queued) => [...queued, ...waiting]);
};

/**
 * Recovers now, when the account's rooms are there to send into, and again whenever the page
 * comes back to the front: a recording another tab held may have lost its tab since. Returns
 * what stops it.
 */
export const keepRecoveringVoiceDrafts = (mx: MatrixClient, store: Store): (() => void) => {
  const recover = () => void recoverVoiceDrafts(mx, store);
  recover();
  const events = ['focus', 'visibilitychange'];
  events.forEach((event) => globalThis.addEventListener?.(event, recover));
  return () => events.forEach((event) => globalThis.removeEventListener?.(event, recover));
};
