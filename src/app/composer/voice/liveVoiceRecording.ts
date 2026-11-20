/**
 * The account owns the live voice recording; the composer whose Send is pressed owns its delivery.
 * So a recording has no destination until Send: it lives here, in one atom, through every
 * navigation, and only Send (a claim), Discard or leaving the account ends it.
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
    store.set(liveVoiceRecordingAtom, undefined);
    store.set(liveVoiceRecordingErrorAtom, session.getSnapshot().errorMessage);
  };
  if (!(await session.start())) {
    endOnItsOwn();
    return false;
  }
  const stopWatching = session.subscribe(() => {
    if (session.getSnapshot().phase !== 'idle') return;
    stopWatching();
    endOnItsOwn();
  });
  return true;
};

/**
 * Takes the recording out for the composer whose Send was pressed, synchronously: a second Send,
 * in this composer or any other, finds nothing. Undefined while nothing can be sent yet.
 */
export const claimLiveVoiceRecording = (store: JotaiStore): VoiceCaptureSession | undefined => {
  const session = store.get(liveVoiceRecordingAtom);
  if (!session?.canStop()) return undefined;
  store.set(liveVoiceRecordingAtom, undefined);
  return session;
};

/** Ends the recording unsent, for every composer at once, and frees the microphone. */
export const discardLiveVoiceRecording = (store: JotaiStore): void => {
  const session = store.get(liveVoiceRecordingAtom);
  if (!session) return;
  store.set(liveVoiceRecordingAtom, undefined);
  void session.discard();
};
