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
  deleteVoiceRecording,
  updateVoiceRecording,
  type JournaledVoiceRecording,
} from './voiceRecordingJournal';
import { VOICE_SEND_INTERRUPTED_MESSAGE } from './voiceSendDraftController';

/**
 * Voice recordings that are neither recording nor sending, around the single slot the composers
 * show (`pendingVoiceSendDraftAtom`): those that wait for it (`queuedVoiceDraftsAtom`), and those
 * whose Discard can still be undone (`discardedVoiceDraftsAtom`). The journal
 * (voiceRecordingJournal.ts) keeps each on disk until it is sent or its discard stands, so none
 * is erased for want of a place to show it.
 */

type Store = ReturnType<typeof createStore>;

/** How long a Discard can be undone. */
export const VOICE_DISCARD_UNDO_MS = 10_000;

/**
 * Parks audio that was not sent, first in line for the slot: of a recorder that stopped by
 * itself or lost its composer, and of a discard that was undone.
 */
export const parkVoiceDraft = (store: Store, draft: PendingVoiceSendDraft): void =>
  store.set(queuedVoiceDraftsAtom, (queued) => [draft, ...queued]);

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

/** Ends a recording's offer of Undo, and returns what was discarded. */
const takeDiscarded = (store: Store, recordingId: string, expired = false) => {
  const discarded = store
    .get(discardedVoiceDraftsAtom)
    .find((entry) => entry.draft.recordingId === recordingId);
  // Undone and discarded again since: that discard has its own time.
  if (!discarded || (expired && discarded.until > Date.now())) return undefined;
  store.set(discardedVoiceDraftsAtom, (all) => all.filter((entry) => entry !== discarded));
  return discarded;
};

/** Offers Undo for a discarded recording until `until`; then it is deleted if the disk agrees. */
const offerVoiceUndo = (store: Store, draft: PendingVoiceSendDraft, until: number): void => {
  store.set(discardedVoiceDraftsAtom, (all) => [...all, { draft, until }]);
  setTimeout(() => {
    takeDiscarded(store, draft.recordingId, true);
    // Only what the disk says is discarded, and for that long: an Undo may have cleared it.
    void deleteVoiceRecording(draft.recordingId, Date.now());
  }, until - Date.now());
};

/** Discards a recording: it is deleted once its Undo ran out, also when the page goes first. */
export const discardVoiceDraft = (store: Store, draft: PendingVoiceSendDraft): void => {
  const until = Date.now() + VOICE_DISCARD_UNDO_MS;
  void updateVoiceRecording(draft.recordingId, { discardUntil: until });
  offerVoiceUndo(store, draft, until);
};

/**
 * Takes a discard back. The recording waits for the slot again only once the disk no longer
 * says it is discarded; if the disk could not be told, it is back from memory, and says so.
 */
export const undoVoiceDiscard = async (store: Store, recordingId: string): Promise<void> => {
  const discarded = takeDiscarded(store, recordingId);
  if (!discarded) return;
  const kept = await updateVoiceRecording(recordingId, { discardUntil: undefined });
  parkVoiceDraft(store, kept ? discarded.draft : { ...discarded.draft, unprotected: true });
};

const toDraft = (
  mx: MatrixClient,
  ownerSessionId: string,
  { record, file, duration, waveform }: JournaledVoiceRecording
): PendingVoiceSendDraft => {
  const { recordingId, destination, txnId } = record;
  const recording = { recordingId, file, duration, waveform, txnId };
  const room = destination && mx.getRoom(destination.roomId);
  // Never sent, or its room is gone: every composer offers it, to send where Send is pressed.
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
  globalThis.addEventListener?.('focus', recover);
  globalThis.addEventListener?.('visibilitychange', recover);
  return () => {
    globalThis.removeEventListener?.('focus', recover);
    globalThis.removeEventListener?.('visibilitychange', recover);
  };
};
