import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { createFallbackWaveform } from '../../lib/audioWaveform';
import { pendingVoiceSendDraftAtom, type PendingVoiceSendContext } from '../roomInputDrafts';
import {
  claimLiveVoiceRecording,
  discardLiveVoiceRecording,
  liveVoiceRecordingAtom,
  liveVoiceRecordingErrorAtom,
  voiceAccountGuard,
} from './liveVoiceRecording';
import type {
  VoiceCapturePhase,
  VoiceCaptureSession,
  VoiceCaptureSnapshot,
} from './voiceCaptureSession';
import {
  createVoiceSendDraftController,
  type SendRecordingCallback,
} from './voiceSendDraftController';

export {
  VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
  VOICE_RECORDER_AUDIO_CONSTRAINTS,
  getVoiceRecorderErrorMessage,
} from './voiceCaptureSession';
/**
 * What a composer shows of a recording. Capture's `processing` (a recorder that is stopping) is
 * not among them: a recording stops only once a Send claimed it, and that one is `sending`.
 */
export type VoiceRecorderPhase = Exclude<VoiceCapturePhase, 'processing'> | 'sending';

const NO_RECORDING: VoiceCaptureSnapshot = {
  phase: 'idle',
  elapsedMs: 0,
  waveform: createFallbackWaveform(),
  sampleCount: 0,
  canPause: true,
  errorMessage: undefined,
};
const getNoRecording = () => NO_RECORDING;
const subscribeToNothing = () => () => undefined;

/** What a recording shows now: the one timer, waveform and pause state of every surface. */
export const useVoiceCaptureSnapshot = (
  session: VoiceCaptureSession | undefined
): VoiceCaptureSnapshot =>
  useSyncExternalStore(
    session?.subscribe ?? subscribeToNothing,
    session?.getSnapshot ?? getNoRecording,
    session?.getSnapshot ?? getNoRecording
  );

type UseVoiceRecorderOptions = {
  ownsPendingVoiceDraft: boolean;
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onSendRecording?: SendRecordingCallback;
  /**
   * This composer's room, thread and reply. It is read once, when Send is pressed here: a
   * recording goes where its Send is pressed, wherever it was started. A failed send parks the
   * audio with that context, which a retry keeps.
   */
  getSendContext: () => PendingVoiceSendContext;
};

/**
 * One composer's view of the account's live recording (`liveVoiceRecording.ts`) and of the parked
 * draft of a failed send. Mounting or unmounting it never starts or ends a recording.
 */
export function useVoiceRecorder({
  ownsPendingVoiceDraft,
  onSendStopRequest,
  onSendStopFailure,
  onSendRecording,
  getSendContext,
}: UseVoiceRecorderOptions) {
  const store = useStore();
  const [draftController] = useState(() =>
    createVoiceSendDraftController({
      read: () => store.get(pendingVoiceSendDraftAtom),
      write: (draft) => store.set(pendingVoiceSendDraftAtom, draft),
    })
  );
  const live = useAtomValue(liveVoiceRecordingAtom);
  // The recording this composer's Send claimed. No other composer shows it any more; this one
  // shows it as sending until it is delivered or parked.
  const [claimed, setClaimed] = useState<VoiceCaptureSession>();
  const captureSnapshot = useVoiceCaptureSnapshot(claimed ?? live);
  const savedDraft = useAtomValue(pendingVoiceSendDraftAtom);
  const pendingDraft = ownsPendingVoiceDraft ? savedDraft : undefined;
  const phase: VoiceRecorderPhase =
    pendingDraft?.inFlight || claimed || captureSnapshot.phase === 'processing'
      ? 'sending'
      : captureSnapshot.phase;
  const { elapsedMs, waveform, sampleCount, canPause } = captureSnapshot;
  const hasPendingSend = !!pendingDraft;
  const pendingDuration = pendingDraft?.duration ?? 0;
  const pendingWaveform = pendingDraft?.waveform ?? createFallbackWaveform();
  const errorMessage = pendingDraft?.errorMessage;
  const mountedRef = useRef(true);
  const latestOnSendStopRequestRef = useRef(onSendStopRequest);
  const latestOnSendStopFailureRef = useRef(onSendStopFailure);
  const latestOnSendRecordingRef = useRef(onSendRecording);
  const latestGetSendContextRef = useRef(getSendContext);
  useEffect(() => {
    latestOnSendStopRequestRef.current = onSendStopRequest;
  }, [onSendStopRequest]);
  useEffect(() => {
    latestOnSendStopFailureRef.current = onSendStopFailure;
  }, [onSendStopFailure]);
  useEffect(() => {
    latestOnSendRecordingRef.current = onSendRecording;
  }, [onSendRecording]);
  useEffect(() => {
    latestGetSendContextRef.current = getSendContext;
  }, [getSendContext]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const claimSendStop = useCallback(() => {
    return latestOnSendStopRequestRef.current?.();
  }, []);
  const notifySendStopFailure = useCallback(() => {
    latestOnSendStopFailureRef.current?.();
  }, []);

  const send = useCallback(async (): Promise<boolean> => {
    // Synchronous up to the claim: of two Sends, in any composers, the first takes the recording
    // and the second finds none, before it touches its composer.
    if (!store.get(liveVoiceRecordingAtom)?.canStop()) return false;
    if (claimSendStop() === false) return false;
    const session = claimLiveVoiceRecording(store);
    if (!session) {
      notifySendStopFailure();
      return false;
    }
    // The destination is this composer's, read once, now. The send outlives the composer, but
    // not the account: once that is left, it writes nothing more.
    const sendRecording = latestOnSendRecordingRef.current;
    const sendContext = latestGetSendContextRef.current();
    const sameAccount = voiceAccountGuard(store);
    setClaimed(session);
    const settle = () => {
      session.reset();
      if (mountedRef.current) setClaimed(undefined);
    };
    const result = await session.finish();
    if (result.status !== 'captured' || !sendRecording || !sameAccount()) {
      const { errorMessage: captureError } = session.getSnapshot();
      if (captureError && sameAccount()) store.set(liveVoiceRecordingErrorAtom, captureError);
      settle();
      notifySendStopFailure();
      return false;
    }
    const delivered = await draftController.sendInitial(result.recording, sendContext, {
      sendRecording,
      onFailure: notifySendStopFailure,
      sameAccount,
    });
    settle();
    return delivered;
  }, [claimSendStop, draftController, notifySendStopFailure, store]);

  const pause = useCallback(() => store.get(liveVoiceRecordingAtom)?.pause() ?? false, [store]);
  const resume = useCallback(() => store.get(liveVoiceRecordingAtom)?.resume() ?? false, [store]);
  const discard = useCallback(() => discardLiveVoiceRecording(store), [store]);

  const retry = useCallback(async (): Promise<boolean> => {
    const sendRecording = latestOnSendRecordingRef.current;
    if (claimed || !sendRecording) return false;
    return draftController.retry({
      claim: claimSendStop,
      sendRecording,
      onFailure: notifySendStopFailure,
    });
  }, [claimSendStop, claimed, draftController, notifySendStopFailure]);

  const { discardPending } = draftController;

  return {
    phase,
    elapsedMs,
    waveform,
    sampleCount,
    errorMessage,
    canPause,
    hasPendingSend,
    pendingDuration,
    pendingWaveform,
    pause,
    resume,
    send,
    discard,
    retry,
    discardPending,
  };
}
