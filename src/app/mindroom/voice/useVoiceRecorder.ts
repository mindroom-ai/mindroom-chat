import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MatrixError } from 'matrix-js-sdk';
import { useAtom, useStore } from 'jotai';
import { createFallbackWaveform } from '../../utils/audioWaveform';
import { getMatrixUploadErrorMessage, getMatrixUploadErrorStage } from '../../utils/matrix';
import {
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
  type PendingVoiceSendInFlight,
} from '../../state/room/roomInputDrafts';
import { createVoiceCaptureSession, type VoiceCapturePhase } from './voiceCaptureSession';

export {
  VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
  VOICE_RECORDER_AUDIO_CONSTRAINTS,
  getVoiceRecorderErrorMessage,
} from './voiceCaptureSession';
export type VoiceRecorderPhase = VoiceCapturePhase | 'sending';
const RETRY_BUSY_MESSAGE = 'Another voice message is still sending. Please wait.';

type SendRecordingCallback = (
  file: File,
  duration: number,
  waveform: number[] | undefined,
  context: PendingVoiceSendContext
) => Promise<void> | void;

type UseVoiceRecorderOptions = {
  onRecordingStart?: () => void;
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onSendRecording?: SendRecordingCallback;
  /**
   * Supplies the room/thread/reply context for the next send.
   * The room is captured at start() and remains authoritative across navigation.
   * A same-room relation is refreshed when Send is claimed and becomes the durable retry context.
   */
  getSendContext: () => PendingVoiceSendContext;
};

export function useVoiceRecorder({
  onRecordingStart,
  onSendStopRequest,
  onSendStopFailure,
  onSendRecording,
  getSendContext,
}: UseVoiceRecorderOptions) {
  const store = useStore();
  const [capture] = useState(createVoiceCaptureSession);
  const captureSnapshot = useSyncExternalStore(
    capture.subscribe,
    capture.getSnapshot,
    capture.getSnapshot
  );
  const [sending, setSending] = useState(false);
  const [pendingDraft, setPendingDraft] = useAtom(pendingVoiceSendDraftAtom);
  const phase: VoiceRecorderPhase =
    pendingDraft?.inFlight || sending ? 'sending' : captureSnapshot.phase;
  const { elapsedMs, waveform, canPause } = captureSnapshot;
  const hasPendingSend = !!pendingDraft;
  const pendingDuration = pendingDraft?.duration ?? 0;
  const pendingWaveform = pendingDraft?.waveform ?? createFallbackWaveform();
  const errorMessage = pendingDraft?.errorMessage ?? captureSnapshot.errorMessage;
  const mountedRef = useRef(true);
  const latestOnRecordingStartRef = useRef(onRecordingStart);
  const latestOnSendStopRequestRef = useRef(onSendStopRequest);
  const latestOnSendStopFailureRef = useRef(onSendStopFailure);
  const latestOnSendRecordingRef = useRef(onSendRecording);
  const latestGetSendContextRef = useRef(getSendContext);
  const sendRecordingAtStartRef = useRef<SendRecordingCallback>();
  const sendContextAtStartRef = useRef<PendingVoiceSendContext>();
  // Durable delivery stays here until the draft-controller extraction.
  const pendingDraftRef = useRef<PendingVoiceSendDraft>();
  const setPendingDraftRef = useRef(setPendingDraft);
  const retryInFlightRef = useRef(false);

  useEffect(() => {
    pendingDraftRef.current = pendingDraft;
  }, [pendingDraft]);
  useEffect(() => {
    setPendingDraftRef.current = setPendingDraft;
  }, [setPendingDraft]);
  useEffect(() => {
    latestOnRecordingStartRef.current = onRecordingStart;
  }, [onRecordingStart]);
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

  const safeSetPhase = useCallback((next: 'idle' | 'sending') => {
    if (mountedRef.current) setSending(next === 'sending');
  }, []);
  const writePendingDraft = useCallback((draft: PendingVoiceSendDraft | undefined) => {
    pendingDraftRef.current = draft;
    setPendingDraftRef.current(draft);
  }, []);
  const resetLocalRecorderState = useCallback(() => {
    capture.reset();
    sendRecordingAtStartRef.current = undefined;
    sendContextAtStartRef.current = undefined;
    retryInFlightRef.current = false;
    safeSetPhase('idle');
  }, [capture, safeSetPhase]);
  // Full reset is only for callers that already own the durable draft.
  const reset = useCallback(() => {
    resetLocalRecorderState();
    writePendingDraft(undefined);
  }, [resetLocalRecorderState, writePendingDraft]);

  const start = useCallback(async () => {
    if (phase !== 'idle' || capture.getSnapshot().phase !== 'idle' || hasPendingSend) return false;
    latestOnRecordingStartRef.current?.();
    sendRecordingAtStartRef.current = latestOnSendRecordingRef.current;
    sendContextAtStartRef.current = latestGetSendContextRef.current();
    return capture.start();
  }, [capture, hasPendingSend, phase]);

  const send = useCallback(async (): Promise<boolean> => {
    if (!capture.canStop()) return false;
    if (latestOnSendStopRequestRef.current?.() === false) return false;
    const recordingContext = sendContextAtStartRef.current;
    const currentContext = latestGetSendContextRef.current();
    if (
      recordingContext &&
      currentContext.ownerSessionId === recordingContext.ownerSessionId &&
      currentContext.roomId === recordingContext.roomId
    ) {
      sendContextAtStartRef.current = {
        ...recordingContext,
        threadId: currentContext.threadId,
        replyDraft: currentContext.replyDraft,
        threadingEnabled: currentContext.threadingEnabled,
      };
    }
    // Bind accepted work before native stop or any await can outlive this facade.
    const sendRecording = sendRecordingAtStartRef.current;
    const sendContext = sendContextAtStartRef.current;
    const result = await capture.finish();
    if (result.status !== 'captured' || !sendRecording || !sendContext) {
      if (result.status === 'captured') capture.reset();
      latestOnSendStopFailureRef.current?.();
      return false;
    }
    const { file, duration, waveform: sampleWaveformData } = result.recording;
    safeSetPhase('sending');
    try {
      await sendRecording(file, duration, sampleWaveformData, sendContext);
      writePendingDraft(undefined);
      resetLocalRecorderState();
      return true;
    } catch (err) {
      capture.reset();
      safeSetPhase('idle');
      const friendlyMessage =
        err instanceof MatrixError
          ? getMatrixUploadErrorMessage(err, getMatrixUploadErrorStage(err) ?? 'send')
          : err instanceof Error
          ? err.message
          : 'Failed to send voice message.';
      writePendingDraft({
        file,
        duration,
        waveform: sampleWaveformData,
        errorMessage: friendlyMessage,
        context: sendContext,
      });
      latestOnSendStopFailureRef.current?.();
      return false;
    }
  }, [capture, resetLocalRecorderState, safeSetPhase, writePendingDraft]);

  const discard = useCallback(async () => {
    const result = await capture.discard();
    if (capture.getSnapshot().phase === 'idle') {
      sendRecordingAtStartRef.current = undefined;
      sendContextAtStartRef.current = undefined;
    }
    return result;
  }, [capture]);
  const { pause, resume, clearError } = capture;

  const retry = useCallback(async (): Promise<boolean> => {
    if (retryInFlightRef.current) {
      return false;
    }
    const draft = pendingDraftRef.current;
    const sendRecording = sendRecordingAtStartRef.current ?? latestOnSendRecordingRef.current;
    // Refuse a fresh retry if the atom already has an inFlight marker — a
    // previous mount's retry is still racing the network. Capsule Discard is
    // disabled and primary Send is blocked by the synced phase='sending' state
    // above, but a programmatic call into retry() must also bail.
    if (
      !draft ||
      !sendRecording ||
      phase === 'sending' ||
      draft.inFlight ||
      store.get(pendingVoiceSendDraftAtom)?.inFlight
    ) {
      return false;
    }

    if (latestOnSendStopRequestRef.current?.() === false) {
      // Surface a dedicated message instead of silently failing the click.
      writePendingDraft({ ...draft, errorMessage: RETRY_BUSY_MESSAGE });
      return false;
    }

    retryInFlightRef.current = true;
    safeSetPhase('sending');
    // Stamp this attempt with a token. The token survives a keyed remount
    // via the atom; a freshly mounted hook reads it and surfaces 'sending'
    // so the user cannot discard a draft whose request is still in flight.
    // The token also lets us recognize "another caller took over" on the
    // resolution paths below.
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const inFlight: PendingVoiceSendInFlight = { token, startedAt: Date.now() };
    // Optimistically clear the error while the retry is in flight; failure
    // path below restores it together with the draft.
    writePendingDraft({ ...draft, errorMessage: undefined, inFlight });
    try {
      await sendRecording(draft.file, draft.duration, draft.waveform, draft.context);
      // Only clear if this is still our attempt. If a discard or another
      // operation overwrote the atom, leave that state alone. Note: must
      // use resetLocalRecorderState() — NOT reset() — below so the local
      // cleanup never clobbers a newer draft that the token guard just
      // declined to touch.
      const liveDraft = store.get(pendingVoiceSendDraftAtom);
      if (!liveDraft || liveDraft.inFlight?.token === token) {
        writePendingDraft(undefined);
      }
      resetLocalRecorderState();
      return true;
    } catch (err) {
      safeSetPhase('idle');
      // Re-read the live atom directly: pendingDraftRef is synced via a
      // useEffect (post-commit) and won't reflect a discard that happened
      // during this same await microtask. Also refuse to clobber a draft
      // whose token has changed since we started.
      const liveDraft = store.get(pendingVoiceSendDraftAtom);
      if (!liveDraft || liveDraft.inFlight?.token !== token) {
        return false;
      }
      const friendlyMessage =
        err instanceof MatrixError
          ? getMatrixUploadErrorMessage(err, getMatrixUploadErrorStage(err) ?? 'send')
          : err instanceof Error
          ? err.message
          : 'Failed to send voice message.';
      writePendingDraft({
        ...liveDraft,
        errorMessage: friendlyMessage,
        inFlight: undefined,
      });
      latestOnSendStopFailureRef.current?.();
      return false;
    } finally {
      retryInFlightRef.current = false;
    }
  }, [phase, resetLocalRecorderState, safeSetPhase, store, writePendingDraft]);

  const discardPending = useCallback(() => {
    sendRecordingAtStartRef.current = undefined;
    writePendingDraft(undefined);
    capture.reset();
    safeSetPhase('idle');
  }, [capture, safeSetPhase, writePendingDraft]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      capture.releaseOwner();
    };
  }, [capture]);

  return {
    phase,
    elapsedMs,
    waveform,
    errorMessage,
    canPause,
    hasPendingSend,
    pendingDuration,
    pendingWaveform,
    start,
    pause,
    resume,
    send,
    discard,
    retry,
    discardPending,
    reset,
    clearError,
  };
}
