import type { createStore } from 'jotai';
import { ClientEvent, RelationType, type MatrixClient } from 'matrix-js-sdk';
import { randomUuid } from '../../lib/randomUuid';
import { unsentVoiceCopy } from '../../matrix/client/unsentMessages';
import { isJoined } from '../../matrix/state/roomList';
import {
  hasVoiceDestination,
  openVoiceRecorderAtom,
  pendingVoiceSendDraftAtom,
  queuedVoiceDraftsAtom,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import { adoptVoiceOrphans, transitionVoiceRecording } from './voiceRecordingJournal';
import {
  destinationAtRest,
  VOICE_NOT_DELETED_MESSAGE,
  VOICE_SEND_INTERRUPTED_MESSAGE,
} from './voiceSendDraftController';

/**
 * Voice recordings that are neither recording nor sending, around the single slot the composers
 * show (`pendingVoiceSendDraftAtom`), and those that wait for it (`queuedVoiceDraftsAtom`). The
 * journal (voiceRecordingJournal.ts) keeps each on disk until it is sent or its Discard is
 * confirmed, and what shows here follows what the journal took: a change it could not write is
 * not shown as made.
 */

type Store = ReturnType<typeof createStore>;

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
 * Ends the attempt `token` on a recording, a send or a delete, wherever its draft is by now, in
 * the slot or waiting for it: gone when done, kept as `failed` otherwise. Another recording in
 * the slot is never touched. The draft of a first attempt (no token) is in neither yet: failed,
 * it takes the slot for its recorder to show, or waits for it. False when the draft is no longer
 * there.
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
 * Deletes a recording whose Discard the person confirmed: the slot's, or one its recorder just
 * stopped for it. The slot's is taken before anything is awaited, so nothing sends it and no
 * second Discard starts meanwhile. One the disk would not delete stays, and says so.
 */
export const discardVoiceDraft = async (
  store: Store,
  draft: PendingVoiceSendDraft
): Promise<void> => {
  if (draft.inFlight) return;
  const token = store.get(pendingVoiceSendDraftAtom) === draft ? randomUuid() : undefined;
  if (token) store.set(pendingVoiceSendDraftAtom, { ...draft, inFlight: { token, discard: true } });
  const outcome = await transitionVoiceRecording(draft.recordingId, () => undefined);
  const kept =
    outcome === 'failed' ? { ...draft, errorMessage: VOICE_NOT_DELETED_MESSAGE } : undefined;
  settleVoiceDraft(store, draft.recordingId, token, kept);
};

/**
 * A recording as its destination stands now: in its room, with Retry, while this account can
 * send there what it sent before; otherwise in every composer, where one that was attempted is
 * sent as a copy. Undefined while that cannot be told: only the server says that a room is gone,
 * and before it was heard the room may not be loaded yet.
 */
const resolveVoiceDraft = (
  mx: MatrixClient,
  draft: PendingVoiceSendDraft
): PendingVoiceSendDraft | undefined => {
  const { context } = draft;
  const { ownerSessionId } = context;
  const placed = hasVoiceDestination(context);
  const to = placed ? destinationAtRest(context) : context.attempted;
  if (!to || draft.inFlight) return draft;
  const room = mx.getRoom(to.roomId);
  const { replyEventId, replyThreadId } = to;
  // Under its send's ID an event of the other type would be another event.
  if (
    room &&
    isJoined(room) &&
    [undefined, room.hasEncryptionStateEvent()].includes(to.encrypted)
  ) {
    if (placed) return draft;
    // Its send failed, or was cut short by what ended the page: it waits there, with Retry.
    return {
      ...draft,
      errorMessage: VOICE_SEND_INTERRUPTED_MESSAGE,
      context: {
        ownerSessionId,
        roomId: to.roomId,
        room,
        threadId: to.threadId,
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
        threadingEnabled: to.threadingEnabled,
        // Read from the room again when it is sent.
        signalBridgedRoom: false,
        encrypted: to.encrypted,
        ...(to.threadView && { threadView: true }),
      },
    };
  }
  if (!mx.isInitialSyncComplete()) return placed ? draft : undefined;
  const roomName = room?.name;
  // Without `encrypted` its send never began: it is only a recording.
  const attempted = to.encrypted === undefined ? undefined : { ...to, roomName };
  if (!placed && attempted && context.attempted?.roomName === roomName) return draft;
  return { ...draft, errorMessage: undefined, context: { ownerSessionId, attempted } };
};

/**
 * Brings the slot in line with the account and its rooms, in one step that reads what the store
 * holds now, so several composers calling it move each recording once. Another account's
 * recording (the slot outlives a switch of accounts) waits for its account; this account's goes
 * where its destination stands now; and into a free slot comes the account's next recording
 * that waits, unless one is being recorded.
 */
export const reconcileVoiceDrafts = (mx: MatrixClient, store: Store): void => {
  const userId = mx.getUserId();
  const shown = store.get(pendingVoiceSendDraftAtom);
  if (shown && shown.context.ownerSessionId === userId) {
    const now = resolveVoiceDraft(mx, shown) ?? shown;
    if (now !== shown) store.set(pendingVoiceSendDraftAtom, now);
    return;
  }
  if (shown) {
    store.set(pendingVoiceSendDraftAtom, undefined);
    parkVoiceDraft(store, shown);
  }
  if (store.get(openVoiceRecorderAtom)) return;
  const queued = store.get(queuedVoiceDraftsAtom);
  const resolved = queued.map((draft) =>
    draft.context.ownerSessionId === userId ? resolveVoiceDraft(mx, draft) : undefined
  );
  const next = resolved.findIndex(Boolean);
  if (next < 0) return;
  store.set(
    queuedVoiceDraftsAtom,
    queued.filter((_, at) => at !== next)
  );
  store.set(pendingVoiceSendDraftAtom, resolved[next]);
};

/**
 * Brings back the recordings a crash, a reload or an app update left on disk for the account,
 * oldest first, to wait for the slot. Each call takes what no tab owns by then.
 */
export const recoverVoiceDrafts = async (mx: MatrixClient, store: Store): Promise<void> => {
  const userId = mx.getUserId();
  if (!userId) return;
  const orphans = await adoptVoiceOrphans(userId, (roomId, size) =>
    unsentVoiceCopy(mx, roomId, size)
  );
  const waiting = orphans.map(({ record, file, duration }) => ({
    recordingId: record.recordingId,
    file,
    duration,
    txnId: record.txnId,
    context: { ownerSessionId: userId, attempted: record.destination },
  }));
  if (waiting.length > 0) store.set(queuedVoiceDraftsAtom, (queued) => [...queued, ...waiting]);
};

/**
 * Recovers now, and again whenever the page comes back to the front: a recording another tab
 * held may have lost its tab since. And with every answer of the server, which is what tells
 * that a room is there, left or encrypted, the slot is brought in line. Returns what stops it.
 */
export const keepRecoveringVoiceDrafts = (mx: MatrixClient, store: Store): (() => void) => {
  const recover = () => void recoverVoiceDrafts(mx, store);
  const reconcile = () => reconcileVoiceDrafts(mx, store);
  recover();
  const events = ['focus', 'visibilitychange'];
  events.forEach((event) => globalThis.addEventListener?.(event, recover));
  mx.on(ClientEvent.Sync, reconcile);
  return () => {
    events.forEach((event) => globalThis.removeEventListener?.(event, recover));
    mx.removeListener(ClientEvent.Sync, reconcile);
  };
};
