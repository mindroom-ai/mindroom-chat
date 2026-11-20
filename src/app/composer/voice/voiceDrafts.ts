import type { createStore } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { isLocalEchoEventId } from '../../event-store/threads/threadRouteUtils';
import {
  discardedVoiceDraftAtom,
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
 * show (`pendingVoiceSendDraftAtom`): those that wait for it (`queuedVoiceDraftsAtom`), and the
 * one whose Discard can still be undone (`discardedVoiceDraftAtom`). The journal (voiceRecordingJournal.ts) keeps each on disk until it is sent or its
 * discard stands, so none is erased for want of a place to show it.
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

/** Deletes the discarded recording: its Undo ran out, or another discard took its place. */
export const confirmVoiceDiscard = (store: Store): void => {
  const discarded = store.get(discardedVoiceDraftAtom);
  if (!discarded) return;
  store.set(discardedVoiceDraftAtom, undefined);
  void deleteVoiceRecording(discarded.draft.recordingId);
};

/** Discards a recording: it is deleted once its Undo ran out, also when the page goes first. */
export const discardVoiceDraft = (
  store: Store,
  draft: PendingVoiceSendDraft,
  now = Date.now()
): void => {
  confirmVoiceDiscard(store);
  const until = now + VOICE_DISCARD_UNDO_MS;
  store.set(discardedVoiceDraftAtom, { draft, until });
  void updateVoiceRecording(draft.recordingId, { discardUntil: until });
};

/** Takes the last discard back: the recording waits for the slot again, as it was. */
export const undoVoiceDiscard = (store: Store): void => {
  const discarded = store.get(discardedVoiceDraftAtom);
  if (!discarded) return;
  store.set(discardedVoiceDraftAtom, undefined);
  void updateVoiceRecording(discarded.draft.recordingId, { discardUntil: undefined });
  parkVoiceDraft(store, discarded.draft);
};

const toDraft = (
  mx: MatrixClient,
  ownerSessionId: string,
  { record, file, duration, waveform }: JournaledVoiceRecording
): PendingVoiceSendDraft => {
  const { recordingId, destination, txnId } = record;
  const recording = { recordingId, file, duration, waveform, txnId };
  // A thread root that had no server ID yet cannot be found again after a reload.
  const room =
    destination && !isLocalEchoEventId(destination.threadId)
      ? mx.getRoom(destination.roomId)
      : null;
  // Never sent, or its destination is gone: every composer offers it, to send where Send is pressed.
  if (!destination || !room) return { ...recording, context: { ownerSessionId } };
  // Its send failed, or was cut short by what ended the page: it waits there, with Retry.
  return {
    ...recording,
    errorMessage: record.errorMessage ?? VOICE_SEND_INTERRUPTED_MESSAGE,
    context: {
      ownerSessionId,
      roomId: destination.roomId,
      room,
      threadId: destination.threadId,
      replyDraft: destination.replyDraft,
      threadingEnabled: destination.threadingEnabled,
      signalBridgedRoom: destination.signalBridgedRoom,
      ...(destination.threadView && { threadView: true }),
    },
  };
};

const recoveredAccounts = new Set<string>();

/**
 * Queues the recordings a crash, a reload or an app update left on disk for the account, oldest
 * first, once a page. Called by a composer, when the account's rooms are there to send into.
 */
export const recoverVoiceDrafts = async (mx: MatrixClient, store: Store): Promise<void> => {
  const userId = mx.getUserId();
  if (!userId || recoveredAccounts.has(userId)) return;
  recoveredAccounts.add(userId);
  const orphans = await adoptVoiceOrphans(userId);
  if (orphans.length === 0) return;
  store.set(queuedVoiceDraftsAtom, (queued) => [
    ...queued,
    ...orphans.map((orphan) => toDraft(mx, userId, orphan)),
  ]);
};
