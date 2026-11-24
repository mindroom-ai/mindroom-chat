/**
 * The account owns the live audio capture (voice recording or dictation); the composer whose
 * Finish or Send is pressed owns its delivery. A live capture lives here, in one atom, through
 * every navigation, making voice recording and dictation structurally mutually exclusive.
 *
 * This module knows capture and jotai only: no room, thread, draft, React or Matrix type belongs
 * here (`__tests__/captureOwnership.architecture.test.ts`).
 *
 * The shell loads this module on its first download, to see a live capture and to end it with the
 * account, so it knows capture sessions by their types alone; `startLiveVoiceRecording.ts` (and
 * later `startLiveDictation.ts`), loaded with the composer, bring the capture code.
 */
import { atom, type createStore } from 'jotai';
import type { DictationSession } from '../dictation/dictationSession';
import type { VoiceCaptureSession } from '../voice/voiceCaptureSession';

type JotaiStore = ReturnType<typeof createStore>;

export type LiveCapture =
  | { readonly kind: 'voice'; readonly session: VoiceCaptureSession }
  | { readonly kind: 'dictation'; readonly session: DictationSession };

export type LiveCaptureKind = LiveCapture['kind'];

export type LiveCaptureSession = LiveCapture['session'];

export type LiveCaptureError = {
  readonly kind: LiveCaptureKind;
  readonly message: string;
};

/** The live capture being made. Every mounted composer shows it; none owns it before delivery. */
export const liveCaptureAtom = atom<LiveCapture | undefined>(undefined);

/** Why a capture could not be completed, until the person dismisses it. */
export const liveCaptureErrorAtom = atom<LiveCaptureError | undefined>(undefined);

/** Confirmed Discards, of a live or parked capture, whose disk copy is not gone yet. */
export const captureDiscardsInFlightAtom = atom(0);

/** How many composers show the live capture's capsule now; with none, the shell's indicator shows. */
export const liveCaptureCapsulesShownAtom = atom(0);

/** How many accounts a store's window has left; `captureAccountGuard` reads it. */
const accountsLeft = new WeakMap<JotaiStore, number>();

/** Captures a Send claimed that may still hold the microphone or journal lock. */
const claimedCaptures = new WeakMap<JotaiStore, LiveCaptureSession[]>();

/** Stops the account hearing how its capture ends, once that is no longer the account's. */
const stopWatching = new WeakMap<LiveCaptureSession, () => void>();

/** Takes the live capture out of the account's hands, optionally matching a specific session. */
const takeLiveCapture = (
  store: JotaiStore,
  expected?: LiveCaptureSession
): LiveCapture | undefined => {
  const live = store.get(liveCaptureAtom);
  if (!live || (expected !== undefined && live.session !== expected)) return undefined;
  store.set(liveCaptureAtom, undefined);
  stopWatching.get(live.session)?.();
  stopWatching.delete(live.session);
  return live;
};

const clearOnIdle = (store: JotaiStore, entry: LiveCapture): void => {
  const { kind, session } = entry;
  if (store.get(liveCaptureAtom)?.session !== session) return;
  takeLiveCapture(store, session);
  const { errorMessage } = session.getSnapshot();
  store.set(liveCaptureErrorAtom, errorMessage ? { kind, message: errorMessage } : undefined);
};

const watchLiveCapture = (store: JotaiStore, entry: LiveCapture): void => {
  const { session } = entry;
  stopWatching.get(session)?.();
  stopWatching.set(
    session,
    session.subscribe(() => {
      if (session.getSnapshot().phase === 'idle') clearOnIdle(store, entry);
    })
  );
};

const recordClaimed = (store: JotaiStore, session: LiveCaptureSession): void => {
  const stillActive = (claimedCaptures.get(store) ?? []).filter(
    (earlier) => earlier.getSnapshot().phase !== 'idle'
  );
  claimedCaptures.set(store, [...stillActive, session]);
};

/**
 * Starts the account's one live capture in a session from `createSession`; false when one runs
 * already or the microphone did not start. A capture that ends on its own leaves the atom, with
 * its reason in `liveCaptureErrorAtom` when its audio was lost.
 */
export const beginLiveCapture = async <K extends LiveCaptureKind>(
  store: JotaiStore,
  kind: K,
  createSession: () => Extract<LiveCapture, { kind: K }>['session']
): Promise<boolean> => {
  if (store.get(liveCaptureAtom)) return false;
  const session = createSession();
  const entry = { kind, session } as LiveCapture;
  store.set(liveCaptureAtom, entry);
  store.set(liveCaptureErrorAtom, undefined);
  let started: boolean;
  try {
    started = await session.start();
  } catch (error) {
    if (store.get(liveCaptureAtom)?.session === session) {
      takeLiveCapture(store, session);
      const message =
        session.getSnapshot().errorMessage ??
        (error instanceof Error ? error.message : String(error));
      store.set(liveCaptureErrorAtom, message ? { kind, message } : undefined);
    }
    return false;
  }
  if (!started) {
    clearOnIdle(store, entry);
    return false;
  }
  if (store.get(liveCaptureAtom)?.session !== session) return false;
  watchLiveCapture(store, entry);
  return true;
};

/**
 * Installs an already-paused recovered capture into the live slot without starting the microphone.
 * Returns false if another live capture already occupies the slot or the session is already idle.
 */
export const restoreLiveCapture = (store: JotaiStore, entry: LiveCapture): boolean => {
  if (store.get(liveCaptureAtom)) return false;
  if (entry.session.getSnapshot().phase === 'idle') return false;
  store.set(liveCaptureAtom, entry);
  watchLiveCapture(store, entry);
  return true;
};

/**
 * Takes the live voice recording out for the composer whose Send was pressed, synchronously:
 * a second Send, in this composer or any other, finds nothing. Undefined while no stoppable
 * voice recording is live.
 */
export const claimLiveVoice = (
  store: JotaiStore,
  expected?: VoiceCaptureSession
): VoiceCaptureSession | undefined => {
  const current = store.get(liveCaptureAtom);
  if (current?.kind !== 'voice') return undefined;
  if (expected !== undefined && current.session !== expected) return undefined;
  if (!current.session.canStop()) return undefined;
  const live = takeLiveCapture(store, current.session);
  if (live?.kind !== 'voice') return undefined;
  recordClaimed(store, live.session);
  return live.session;
};

/**
 * Takes the live dictation out for the composer whose Finish & Send was pressed, synchronously:
 * a second Send, in this composer or any other, finds nothing. Undefined while no recording or
 * paused dictation is live.
 */
export const claimLiveDictation = (
  store: JotaiStore,
  expected?: DictationSession
): DictationSession | undefined => {
  const current = store.get(liveCaptureAtom);
  if (current?.kind !== 'dictation') return undefined;
  if (expected !== undefined && current.session !== expected) return undefined;
  const { phase } = current.session.getSnapshot();
  if (phase !== 'recording' && phase !== 'paused') return undefined;
  const live = takeLiveCapture(store, current.session);
  if (live?.kind !== 'dictation') return undefined;
  recordClaimed(store, live.session);
  return live.session;
};

/**
 * Removes the live capture from the account slot once its caller has completed delivery.
 * When `expected` is provided, only clears if that exact session still occupies the slot.
 */
export const clearLiveCapture = (store: JotaiStore, expected?: LiveCaptureSession): boolean =>
  takeLiveCapture(store, expected) !== undefined;

/**
 * Ends the live capture unsent, for every composer at once, and its disk copy goes. The microphone
 * is released in the same call, so nothing is left for a later account exit to stop. Resolves
 * once the disk copy is gone.
 */
export const discardLiveCapture = async (
  store: JotaiStore,
  expected?: LiveCaptureSession
): Promise<void> => {
  const live = takeLiveCapture(store, expected);
  if (!live) return;
  await live.session.discard();
};

/**
 * Parks the live capture where nothing shows it (the sign-in pages opened by Add account, or a
 * hidden desktop window): releases the microphone while preserving the captured audio.
 */
export const parkLiveCapture = (store: JotaiStore): void => {
  const live = store.get(liveCaptureAtom);
  if (!live) return;
  live.session.park();
  // One still asking for the microphone may end synchronously in that call.
  if (live.session.getSnapshot().phase === 'idle') takeLiveCapture(store, live.session);
};

/**
 * Leaving the account ends its captures now: the live one, and those a Send claimed that are
 * still stopping. The microphone is released at once, and nothing begun under the account writes
 * after this (`captureAccountGuard`). Disk copies stay for the account to recover later; signing
 * out deletes them (`sessionCleanup.ts`).
 */
export const endLiveCapturesOfAccount = (store: JotaiStore): void => {
  accountsLeft.set(store, (accountsLeft.get(store) ?? 0) + 1);
  const live = takeLiveCapture(store);
  if (live) live.session.reset();
  claimedCaptures.get(store)?.forEach((session) => session.reset());
  claimedCaptures.delete(store);
  store.set(liveCaptureErrorAtom, undefined);
};

/**
 * Tells whether the account is still the one signed in when this was called. A Send or Finish
 * takes one as it is pressed and checks it before each thing it writes later: a capture error,
 * a parked recording, a draft merge, the send lock, the message itself.
 */
export const captureAccountGuard = (store: JotaiStore): (() => boolean) => {
  const left = accountsLeft.get(store);
  return () => accountsLeft.get(store) === left;
};
