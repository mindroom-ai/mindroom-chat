import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAtomValue, useStore } from 'jotai';
import { createFallbackWaveform } from '../../lib/audioWaveform';
import {
  hasVoiceDestination,
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendContext,
} from '../roomInputDrafts';
import { createVoiceCaptureSession, type VoiceCapturePhase } from './voiceCaptureSession';
import { discardVoiceDraft, keepVoiceDraft, settleVoiceDraft } from './voiceDrafts';
import {
  createVoiceSendDraftController,
  type SendRecordingCallback,
} from './voiceSendDraftController';
import { transitionVoiceRecording, voiceCaptureJournal } from './voiceRecordingJournal';

export {
  VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
  VOICE_RECORDER_AUDIO_CONSTRAINTS,
  getVoiceRecorderErrorMessage,
} from './voiceCaptureSession';
export type VoiceRecorderPhase = VoiceCapturePhase | 'sending';

type UseVoiceRecorderOptions = {
  onRecordingStart?: () => void;
  /** The recorder stopped by itself, and its audio waits as a recording without a destination. */
  onRecordingParked?: () => void;
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
  onRecordingParked,
  onSendStopRequest,
  onSendStopFailure,
  onSendRecording,
  getSendContext,
}: UseVoiceRecorderOptions) {
  const store = useStore();
  const [draftController] = useState(() =>
    createVoiceSendDraftController(
      {
        read: () => store.get(pendingVoiceSendDraftAtom),
        write: (draft) => store.set(pendingVoiceSendDraftAtom, draft),
        settle: (recordingId, token, failed) => settleVoiceDraft(store, recordingId, token, failed),
      },
      transitionVoiceRecording
    )
  );
  const mountedRef = useRef(true);
  const latestOnRecordingStartRef = useRef(onRecordingStart);
  const latestOnSendStopRequestRef = useRef(onSendStopRequest);
  const latestOnSendStopFailureRef = useRef(onSendStopFailure);
  const latestOnSendRecordingRef = useRef(onSendRecording);
  const latestGetSendContextRef = useRef(getSendContext);
  const latestOnRecordingParkedRef = useRef(onRecordingParked);
  const sendBindingAtStartRef = useRef<{
    sendRecording: SendRecordingCallback | undefined;
    context: PendingVoiceSendContext;
  }>();
  const [capture] = useState(() => {
    // The account that records: the one that started it, also after its composer went.
    const owner = () =>
      (sendBindingAtStartRef.current?.context ?? latestGetSendContextRef.current()).ownerSessionId;
    return createVoiceCaptureSession({
      // Every chunk goes to disk as it arrives, so a crash loses at most the last second.
      journal: voiceCaptureJournal(owner),
      // Audio that was not sent is never dropped: only a Discard the person confirmed deletes
      // it, and what a recorder had when it stopped by itself, or lost its composer, waits to be
      // sent or discarded.
      keep: (recording, discarded) => {
        const draft = { ...recording, context: { ownerSessionId: owner() } };
        void (discarded ? discardVoiceDraft : keepVoiceDraft)(store, draft);
        if (!discarded) latestOnRecordingParkedRef.current?.();
      },
    });
  });
  const captureSnapshot = useSyncExternalStore(
    capture.subscribe,
    capture.getSnapshot,
    capture.getSnapshot
  );
  const [sending, setSending] = useState(false);
  const pendingDraft = useAtomValue(pendingVoiceSendDraftAtom);
  let phase: VoiceRecorderPhase = captureSnapshot.phase;
  if (pendingDraft?.inFlight?.discard) phase = 'processing';
  else if (pendingDraft?.inFlight || sending) phase = 'sending';
  const { elapsedMs, waveform, sampleCount, canPause } = captureSnapshot;
  const hasPendingSend = !!pendingDraft;
  // Of the parked recording, or of the one being recorded.
  const unprotected = pendingDraft ? !!pendingDraft.unprotected : captureSnapshot.unprotected;
  const unplaced =
    pendingDraft && !hasVoiceDestination(pendingDraft.context) ? pendingDraft.context : undefined;
  const pendingUnplaced = !!unplaced;
  // It may already be sent where this account cannot send it now: here it is sent as a copy.
  const pendingAttempted = unplaced?.attempted;
  const pendingDuration = pendingDraft?.duration ?? 0;
  const pendingWaveform = pendingDraft?.waveform ?? createFallbackWaveform();
  const errorMessage = pendingDraft?.errorMessage ?? captureSnapshot.errorMessage;
  useEffect(() => {
    latestOnRecordingStartRef.current = onRecordingStart;
  }, [onRecordingStart]);
  useEffect(() => {
    latestOnRecordingParkedRef.current = onRecordingParked;
  }, [onRecordingParked]);
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
  const claimSendStop = useCallback(() => {
    return latestOnSendStopRequestRef.current?.();
  }, []);
  const notifySendStopFailure = useCallback(() => {
    latestOnSendStopFailureRef.current?.();
  }, []);
  // The recorder only: a parked recording leaves the slot by being sent or discarded.
  const reset = useCallback(() => {
    capture.reset();
    sendBindingAtStartRef.current = undefined;
    safeSetPhase('idle');
  }, [capture, safeSetPhase]);

  const start = useCallback(async () => {
    if (phase !== 'idle' || capture.getSnapshot().phase !== 'idle' || hasPendingSend) return false;
    latestOnRecordingStartRef.current?.();
    sendBindingAtStartRef.current = {
      sendRecording: latestOnSendRecordingRef.current,
      context: latestGetSendContextRef.current(),
    };
    return capture.start();
  }, [capture, hasPendingSend, phase]);

  const send = useCallback(async (): Promise<boolean> => {
    if (!capture.canStop()) return false;
    if (claimSendStop() === false) return false;
    const startBinding = sendBindingAtStartRef.current;
    const recordingContext = startBinding?.context;
    const currentContext = latestGetSendContextRef.current();
    if (
      startBinding &&
      recordingContext &&
      currentContext.ownerSessionId === recordingContext.ownerSessionId &&
      currentContext.roomId === recordingContext.roomId
    ) {
      sendBindingAtStartRef.current = {
        ...startBinding,
        context: {
          ...recordingContext,
          threadId: currentContext.threadId,
          replyDraft: currentContext.replyDraft,
          threadingEnabled: currentContext.threadingEnabled,
        },
      };
    }
    // Bind accepted work before native stop or any await can outlive this facade.
    const acceptedBinding = sendBindingAtStartRef.current;
    const sendRecording = acceptedBinding?.sendRecording;
    const sendContext = acceptedBinding?.context;
    const result = await capture.finish();
    if (result.status !== 'captured' || !sendRecording || !sendContext) {
      if (result.status === 'captured') capture.reset();
      notifySendStopFailure();
      return false;
    }
    safeSetPhase('sending');
    const delivered = await draftController.sendInitial(result.recording, sendContext, {
      sendRecording,
      onFailure: notifySendStopFailure,
    });
    if (sendBindingAtStartRef.current === acceptedBinding) {
      capture.reset();
      safeSetPhase('idle');
      if (delivered) sendBindingAtStartRef.current = undefined;
    }
    return delivered;
  }, [capture, claimSendStop, draftController, notifySendStopFailure, safeSetPhase]);

  const discard = useCallback(async () => {
    const result = await capture.discard();
    if (capture.getSnapshot().phase === 'idle') {
      sendBindingAtStartRef.current = undefined;
    }
    return result;
  }, [capture]);
  const { pause, resume, clearError } = capture;

  const retry = useCallback(async (): Promise<boolean> => {
    if (sending || capture.getSnapshot().phase === 'processing') return false;
    const activeBinding = sendBindingAtStartRef.current;
    const sendRecording = activeBinding?.sendRecording ?? latestOnSendRecordingRef.current;
    if (!sendRecording) return false;

    const delivered = await draftController.retry({
      claim: claimSendStop,
      sendRecording,
      onFailure: notifySendStopFailure,
      // A recording without a destination goes where Send was pressed.
      context: () => latestGetSendContextRef.current(),
    });
    if (delivered && sendBindingAtStartRef.current === activeBinding) {
      reset();
    }
    return delivered;
  }, [capture, claimSendStop, draftController, notifySendStopFailure, reset, sending]);

  const discardPending = useCallback(() => {
    sendBindingAtStartRef.current = undefined;
    const draft = store.get(pendingVoiceSendDraftAtom);
    // Out of the slot once it is deleted.
    if (draft) void discardVoiceDraft(store, draft);
    capture.reset();
    safeSetPhase('idle');
  }, [capture, safeSetPhase, store]);

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
    sampleCount,
    errorMessage,
    canPause,
    unprotected,
    hasPendingSend,
    pendingUnplaced,
    pendingAttempted,
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
