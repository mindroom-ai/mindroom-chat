/**
 * The account owns the live voice recording; the composer whose Send is pressed owns its delivery.
 * So a recording has no destination until Send: it lives here, in one atom, through every
 * navigation, and only Send (a claim), Discard or leaving the account ends it. Leaving the account
 * also ends what a Send began under it: see `voiceAccountGuard`.
 *
 * This module knows capture and jotai only: no room, thread, draft or Matrix type belongs here
 * (`__tests__/voiceOwnership.architecture.test.ts`). Delivery is `useVoiceRecorder.ts`.
 */
import { atom, type createStore } from 'jotai';
import { createVoiceCaptureSession, type VoiceCaptureSession } from './voiceCaptureSession';

type JotaiStore = ReturnType<typeof createStore>;

/** The recording being made. Every mounted composer shows it; none owns it before its Send. */
export const liveVoiceRecordingAtom = atom<VoiceCaptureSession | undefined>(undefined);

/** Why a recording could not be captured, until the person dismisses it. */
export const liveVoiceRecordingErrorAtom = atom<string | undefined>(undefined);

/** How many composers show the recording's capsule now; with none, the shell's indicator shows. */
export const liveVoiceCapsulesShownAtom = atom(0);

/** How many accounts a store's window has left; `voiceAccountGuard` reads it. */
const accountsLeft = new WeakMap<JotaiStore, number>();

/** Recordings a Send claimed that may still hold the microphone, until the next claim. */
const claimedRecordings = new WeakMap<JotaiStore, VoiceCaptureSession[]>();

/** Stops the account hearing how its recording ends, once that is no longer the account's. */
const stopWatching = new WeakMap<VoiceCaptureSession, () => void>();

/** Takes the recording out of the account's hands. */
const takeLiveVoiceRecording = (store: JotaiStore): VoiceCaptureSession | undefined => {
  const session = store.get(liveVoiceRecordingAtom);
  if (!session) return undefined;
  store.set(liveVoiceRecordingAtom, undefined);
  stopWatching.get(session)?.();
  stopWatching.delete(session);
  return session;
};

/**
 * Starts the account's one recording; false when one runs already or the microphone did not
 * start. A recording that ends on its own (no microphone, a recorder that stops) leaves the atom
 * with its reason in `liveVoiceRecordingErrorAtom`.
 */
export const startLiveVoiceRecording = async (store: JotaiStore): Promise<boolean> => {
  if (store.get(liveVoiceRecordingAtom)) return false;
  const session = createVoiceCaptureSession();
  store.set(liveVoiceRecordingAtom, session);
  store.set(liveVoiceRecordingErrorAtom, undefined);
  // Only the recording the account still holds reports here: one that was claimed is its
  // composer's, and one that was discarded (account exit too) says nothing more.
  const endOnItsOwn = () => {
    if (store.get(liveVoiceRecordingAtom) !== session) return;
    takeLiveVoiceRecording(store);
    store.set(liveVoiceRecordingErrorAtom, session.getSnapshot().errorMessage);
  };
  if (!(await session.start())) {
    endOnItsOwn();
    return false;
  }
  if (store.get(liveVoiceRecordingAtom) !== session) return false;
  stopWatching.set(
    session,
    session.subscribe(() => {
      if (session.getSnapshot().phase === 'idle') endOnItsOwn();
    })
  );
  return true;
};

/**
 * Takes the recording out for the composer whose Send was pressed, synchronously: a second Send,
 * in this composer or any other, finds nothing. Undefined while nothing can be sent yet.
 */
export const claimLiveVoiceRecording = (store: JotaiStore): VoiceCaptureSession | undefined => {
  if (!store.get(liveVoiceRecordingAtom)?.canStop()) return undefined;
  const session = takeLiveVoiceRecording(store);
  if (!session) return undefined;
  const stillStopping = (claimedRecordings.get(store) ?? []).filter(
    (earlier) => earlier.getSnapshot().phase !== 'idle'
  );
  claimedRecordings.set(store, [...stillStopping, session]);
  return session;
};

/** Ends the recording unsent, for every composer at once, and frees the microphone. */
export const discardLiveVoiceRecording = (store: JotaiStore): void => {
  void takeLiveVoiceRecording(store)?.discard();
};

/**
 * Leaving the account ends its recordings now: the live one, and those a Send claimed that are
 * still stopping. The microphone is released at once, without waiting for the recorder to say it
 * stopped, and nothing begun under the account writes after this (`voiceAccountGuard`).
 */
export const endVoiceRecordingsOfAccount = (store: JotaiStore): void => {
  accountsLeft.set(store, (accountsLeft.get(store) ?? 0) + 1);
  takeLiveVoiceRecording(store)?.reset();
  claimedRecordings.get(store)?.forEach((session) => session.reset());
  claimedRecordings.delete(store);
  store.set(liveVoiceRecordingErrorAtom, undefined);
};

/**
 * Tells whether the account is still the one signed in when this was called. A Send takes one
 * as it is pressed and checks it before each thing it writes later: a capture error, a parked
 * recording, the send lock, the message itself. All of those are the next account's by then.
 */
export const voiceAccountGuard = (store: JotaiStore): (() => boolean) => {
  const left = accountsLeft.get(store);
  return () => accountsLeft.get(store) === left;
};
