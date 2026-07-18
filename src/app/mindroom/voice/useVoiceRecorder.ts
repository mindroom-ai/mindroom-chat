import { useCallback, useEffect, useRef, useState } from 'react';
import { MatrixError } from 'matrix-js-sdk';
import { useAtom, useStore } from 'jotai';
import { isNativeApp } from '../native/nativeSso';
import {
  createFallbackWaveform,
  normalizeMatrixWaveform,
  timeDomainDataToWaveformPoint,
} from '../../utils/audioWaveform';
import { pauseAllMediaElements } from '../../utils/dom';
import { getMatrixUploadErrorMessage, getMatrixUploadErrorStage } from '../../utils/matrix';
import {
  DEFAULT_VOICE_RECORDER_MIME_TYPE,
  getAudioFileExtension,
  getSupportedRecorderMimeType,
} from './voiceRecorderMime';
import {
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
  type PendingVoiceSendInFlight,
} from '../../state/room/roomInputDrafts';
import { getMicrophoneAccessErrorMessage } from './microphoneAccess';
import { setFlightRecorderVoiceCaptureState } from '../diagnostics/flightRecorder';

const RETRY_BUSY_MESSAGE = 'Another voice message is still sending. Please wait.';

export type VoiceRecorderPhase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'paused'
  | 'processing'
  | 'sending';

type PendingStopAction = 'send' | 'discard';

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
   * Snapshot of the room/thread/reply context to attach to the next send.
   * Captured fresh at start() time so a failure persists the original
   * destination across the RoomProvider key remount that real navigation
   * triggers, even though the hook itself unmounts with the keyed subtree.
   */
  getSendContext: () => PendingVoiceSendContext;
};

type StopResolver = (sent: boolean) => void;

const TIMER_INTERVAL_MS = 200;
const WAVEFORM_SAMPLE_INTERVAL_MS = 80;
const MAX_LIVE_SAMPLES = 1200;

export const VOICE_RECORDER_AUDIO_BITS_PER_SECOND = 32_000;
export const VOICE_RECORDER_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  sampleRate: 24_000,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const now = (): number => Date.now();

const getAudioContextConstructor = (): typeof AudioContext | undefined => {
  if (typeof window === 'undefined') return undefined;

  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
};

const getInsecureContextVoiceRecorderMessage = (): string =>
  'Voice recording requires HTTPS (or localhost). Open MindRoom over HTTPS.';

export const getVoiceRecorderErrorMessage = (err: unknown): string => {
  if (typeof window !== 'undefined' && !window.isSecureContext && !isNativeApp()) {
    return getInsecureContextVoiceRecorderMessage();
  }
  return getMicrophoneAccessErrorMessage(err);
};

export function useVoiceRecorder({
  onRecordingStart,
  onSendStopRequest,
  onSendStopFailure,
  onSendRecording,
  getSendContext,
}: UseVoiceRecorderOptions) {
  const store = useStore();
  // Initialize phase from the atom on first render. If a previous mount's
  // retry is still in flight (atom.inFlight set), we MUST surface 'sending'
  // immediately so the capsule's Discard / Send buttons stay disabled until
  // that request settles — otherwise the user can discard a draft whose
  // matrix message is still uploading and end up with the message landing
  // after the explicit discard.
  const [phase, setPhase] = useState<VoiceRecorderPhase>(() =>
    store.get(pendingVoiceSendDraftAtom)?.inFlight ? 'sending' : 'idle'
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [waveform, setWaveform] = useState(() => createFallbackWaveform());
  const [transientErrorMessage, setTransientErrorMessage] = useState<string>();
  const [canPause, setCanPause] = useState(true);

  const [pendingDraft, setPendingDraft] = useAtom(pendingVoiceSendDraftAtom);

  const hasPendingSend = !!pendingDraft;
  const pendingDuration = pendingDraft?.duration ?? 0;
  const pendingWaveform = pendingDraft?.waveform ?? createFallbackWaveform();
  const errorMessage = pendingDraft?.errorMessage ?? transientErrorMessage;

  const recorderRef = useRef<MediaRecorder>();
  const streamRef = useRef<MediaStream>();
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const sampleTimerRef = useRef<ReturnType<typeof setInterval>>();
  const chunksRef = useRef<Blob[]>([]);
  const metadataSampleRef = useRef<number[]>([]);
  const displaySampleRef = useRef<number[]>([]);
  const activeStartedAtRef = useRef<number>();
  const activeElapsedMsRef = useRef(0);
  const elapsedAtStopRef = useRef(0);
  const pendingStopActionRef = useRef<PendingStopAction>();
  const stopResolverRef = useRef<StopResolver>();
  const sessionIdRef = useRef(0);
  const mountedRef = useRef(true);
  const lastPublishedRef = useRef('inactive');
  const latestOnRecordingStartRef = useRef(onRecordingStart);
  const latestOnSendStopRequestRef = useRef(onSendStopRequest);
  const latestOnSendStopFailureRef = useRef(onSendStopFailure);
  const latestOnSendRecordingRef = useRef(onSendRecording);
  const latestGetSendContextRef = useRef(getSendContext);
  const sendRecordingAtStartRef = useRef<SendRecordingCallback>();
  const sendContextAtStartRef = useRef<PendingVoiceSendContext>();
  const pendingDraftRef = useRef<PendingVoiceSendDraft>();
  const setPendingDraftRef = useRef(setPendingDraft);
  const retryInFlightRef = useRef(false);

  useEffect(() => {
    pendingDraftRef.current = pendingDraft;
  }, [pendingDraft]);

  useEffect(() => {
    setPendingDraftRef.current = setPendingDraft;
  }, [setPendingDraft]);

  // Sync local phase with the atom's inFlight marker. Two transitions to
  // handle without disturbing in-progress local recording state:
  //   1. atom gains inFlight (e.g. another component triggered a retry,
  //      or — more commonly — this hook just wrote it from retry()).
  //      → ensure phase='sending'.
  //   2. atom loses inFlight while we're still showing 'sending' from a
  //      previous mount's retry that just settled remotely.
  //      → reset phase to 'idle' so the capsule (if still mounted) tears
  //      down cleanly. Skip if a live recorder exists; the local
  //      retry/finishStop paths manage phase themselves there.
  useEffect(() => {
    const inFlight = pendingDraft?.inFlight;
    if (inFlight && phase !== 'sending') {
      safeSetPhase('sending');
    } else if (!inFlight && phase === 'sending' && !recorderRef.current) {
      safeSetPhase('idle');
    }
    // safeSetPhase is stable; phase is a state value (re-runs on change is
    // intentional); pendingDraft?.inFlight drives the sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDraft?.inFlight]);

  const audioContextRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const audioSourceRef = useRef<MediaStreamAudioSourceNode>();
  const timeDomainBufferRef = useRef<Uint8Array>();

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

  const safeSetPhase = useCallback((nextPhase: VoiceRecorderPhase) => {
    if (!mountedRef.current) return;
    const nextState = nextPhase === 'idle' || nextPhase === 'sending' ? 'inactive' : nextPhase;
    lastPublishedRef.current = nextState;
    setFlightRecorderVoiceCaptureState(nextState);
    setPhase(nextPhase);
  }, []);

  const safeSetElapsedMs = useCallback((value: number) => {
    if (mountedRef.current) setElapsedMs(value);
  }, []);

  const safeSetWaveform = useCallback((value: number[]) => {
    if (mountedRef.current) setWaveform(value);
  }, []);

  const safeSetTransientErrorMessage = useCallback((value: string | undefined) => {
    if (mountedRef.current) setTransientErrorMessage(value);
  }, []);

  const safeSetCanPause = useCallback((value: boolean) => {
    if (mountedRef.current) setCanPause(value);
  }, []);

  /**
   * Persist the pending draft via the global atom. Always allowed: the atom
   * outlives this hook so the parent can still read it after a keyed remount.
   * pendingDraftRef is the synchronous read path used inside the hook; the
   * atom is the persistence + cross-component-visibility surface.
   */
  const writePendingDraft = useCallback((draft: PendingVoiceSendDraft | undefined) => {
    pendingDraftRef.current = draft;
    setPendingDraftRef.current(draft);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const clearSampleTimer = useCallback(() => {
    if (sampleTimerRef.current) {
      clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = undefined;
    }
  }, []);

  const getActiveElapsedMs = useCallback((): number => {
    const startedAt = activeStartedAtRef.current;
    if (startedAt === undefined) return activeElapsedMsRef.current;
    return activeElapsedMsRef.current + Math.max(0, now() - startedAt);
  }, []);

  const updateElapsedState = useCallback(() => {
    safeSetElapsedMs(Math.max(0, Math.round(getActiveElapsedMs())));
  }, [getActiveElapsedMs, safeSetElapsedMs]);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setInterval(updateElapsedState, TIMER_INTERVAL_MS);
  }, [clearTimer, updateElapsedState]);

  const closeAudioContext = useCallback(() => {
    try {
      audioSourceRef.current?.disconnect();
    } catch {
      // Ignore cleanup failures from already-disconnected nodes.
    }
    audioSourceRef.current = undefined;
    analyserRef.current = undefined;
    timeDomainBufferRef.current = undefined;

    const audioContext = audioContextRef.current;
    audioContextRef.current = undefined;
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch(() => undefined);
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
  }, []);

  const stopActiveRecorderForCleanup = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return false;

    pendingStopActionRef.current = 'discard';
    try {
      recorder.stop();
    } catch {
      // Cleanup should remain best-effort; tracks and audio nodes are still released below.
    }
    return true;
  }, []);

  const cleanupCapture = useCallback(() => {
    const stoppedRecorder = stopActiveRecorderForCleanup();
    clearTimer();
    clearSampleTimer();
    closeAudioContext();
    stopStream();
    recorderRef.current = undefined;
    activeStartedAtRef.current = undefined;
    return stoppedRecorder;
  }, [clearSampleTimer, clearTimer, closeAudioContext, stopActiveRecorderForCleanup, stopStream]);

  /**
   * Reset all hook-local recorder state — refs, timers, capture
   * resources, React-managed UI state — WITHOUT touching the global
   * pendingVoiceSendDraftAtom. Use this from any path where another caller
   * may legitimately own the atom value (retry resolutions that lost the
   * token race, stale finishStop tails after the user has discarded, etc).
   */
  const resetLocalRecorderState = useCallback(() => {
    sessionIdRef.current += 1;
    const stoppedRecorder = cleanupCapture();
    chunksRef.current = [];
    metadataSampleRef.current = [];
    displaySampleRef.current = [];
    activeElapsedMsRef.current = 0;
    elapsedAtStopRef.current = 0;
    if (!stoppedRecorder) {
      pendingStopActionRef.current = undefined;
    }
    stopResolverRef.current?.(false);
    stopResolverRef.current = undefined;
    sendRecordingAtStartRef.current = undefined;
    sendContextAtStartRef.current = undefined;
    retryInFlightRef.current = false;
    safeSetTransientErrorMessage(undefined);
    safeSetCanPause(true);
    safeSetElapsedMs(0);
    safeSetWaveform(createFallbackWaveform());
    safeSetPhase('idle');
  }, [
    cleanupCapture,
    safeSetCanPause,
    safeSetElapsedMs,
    safeSetPhase,
    safeSetTransientErrorMessage,
    safeSetWaveform,
  ]);

  /**
   * Full reset: local state PLUS clear the global pending-draft atom. Only
   * use this from a code path that has already verified ownership of the
   * atom value (e.g. the composer's idle-transition useEffect calls reset()
   * because hasPendingSend is already false; finishStop's success path has
   * just written undefined explicitly). Never use this from a stale async
   * tail — it will defeat the inFlight token guard.
   */
  const reset = useCallback(() => {
    resetLocalRecorderState();
    writePendingDraft(undefined);
  }, [resetLocalRecorderState, writePendingDraft]);

  const cleanupUnmountDuringSend = useCallback(() => {
    clearTimer();
    clearSampleTimer();
    closeAudioContext();
    stopStream();
    activeStartedAtRef.current = undefined;
  }, [clearSampleTimer, clearTimer, closeAudioContext, stopStream]);

  const sampleWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    const buffer = timeDomainBufferRef.current;
    if (!analyser || !buffer) return;

    analyser.getByteTimeDomainData(buffer);
    const sample = timeDomainDataToWaveformPoint(buffer);

    metadataSampleRef.current.push(sample);
    if (metadataSampleRef.current.length > MAX_LIVE_SAMPLES) {
      metadataSampleRef.current.splice(0, metadataSampleRef.current.length - MAX_LIVE_SAMPLES);
    }

    displaySampleRef.current.push(sample);
    if (displaySampleRef.current.length > MAX_LIVE_SAMPLES) {
      displaySampleRef.current.splice(0, displaySampleRef.current.length - MAX_LIVE_SAMPLES);
    }

    safeSetWaveform([...displaySampleRef.current]);
  }, [safeSetWaveform]);

  const startSampleTimer = useCallback(() => {
    clearSampleTimer();
    if (!analyserRef.current || !timeDomainBufferRef.current) return;

    sampleWaveform();
    sampleTimerRef.current = setInterval(sampleWaveform, WAVEFORM_SAMPLE_INTERVAL_MS);
  }, [clearSampleTimer, sampleWaveform]);

  const setupAnalyser = useCallback(
    (stream: MediaStream) => {
      const AudioContextConstructor = getAudioContextConstructor();
      if (!AudioContextConstructor) return;

      try {
        const audioContext = new AudioContextConstructor();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        audioContextRef.current = audioContext;
        audioSourceRef.current = source;
        analyserRef.current = analyser;
        timeDomainBufferRef.current = new Uint8Array(analyser.fftSize);
        if (audioContext.state === 'suspended') {
          void audioContext.resume().catch(() => undefined);
        }
      } catch {
        closeAudioContext();
      }
    },
    [closeAudioContext]
  );

  const finishStop = useCallback(
    async (recorder: MediaRecorder, mimeType: string | undefined) => {
      clearTimer();
      clearSampleTimer();
      closeAudioContext();
      stopStream();

      const action = pendingStopActionRef.current;
      const resolveStop = stopResolverRef.current;
      pendingStopActionRef.current = undefined;
      stopResolverRef.current = undefined;

      const chunks = chunksRef.current;
      const sampleWaveformData =
        metadataSampleRef.current.length > 0
          ? normalizeMatrixWaveform(metadataSampleRef.current)
          : undefined;

      chunksRef.current = [];
      metadataSampleRef.current = [];
      displaySampleRef.current = [];
      activeElapsedMsRef.current = 0;
      activeStartedAtRef.current = undefined;
      recorderRef.current = undefined;

      if (action === 'discard') {
        elapsedAtStopRef.current = 0;
        safeSetElapsedMs(0);
        safeSetWaveform(createFallbackWaveform());
        safeSetPhase('idle');
        resolveStop?.(false);
        return;
      }

      if (action !== 'send') {
        elapsedAtStopRef.current = 0;
        safeSetElapsedMs(0);
        safeSetWaveform(createFallbackWaveform());
        safeSetPhase('idle');
        safeSetTransientErrorMessage('Voice recording stopped unexpectedly. Please record again.');
        resolveStop?.(false);
        return;
      }

      if (chunks.length === 0) {
        safeSetPhase('idle');
        safeSetTransientErrorMessage('No audio data was captured.');
        latestOnSendStopFailureRef.current?.();
        resolveStop?.(false);
        return;
      }

      const chunkMimeType = chunks.find((chunk) => chunk.type)?.type;
      const outputMimeType =
        recorder.mimeType || mimeType || chunkMimeType || DEFAULT_VOICE_RECORDER_MIME_TYPE;
      const blob = new Blob(chunks, { type: outputMimeType });
      const duration = Math.max(1, Math.round(elapsedAtStopRef.current));
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = new File(
        [blob],
        `voice-message-${timestamp}.${getAudioFileExtension(outputMimeType)}`,
        { type: outputMimeType }
      );

      const sendRecording = sendRecordingAtStartRef.current;
      const sendContext = sendContextAtStartRef.current;
      if (!sendRecording || !sendContext) {
        safeSetPhase('idle');
        latestOnSendStopFailureRef.current?.();
        resolveStop?.(false);
        return;
      }

      safeSetPhase('sending');
      try {
        await sendRecording(file, duration, sampleWaveformData, sendContext);
        // Initial send: this hook is the only writer of the atom for this
        // recording, so the explicit clear above is the authoritative
        // ownership transition. The local-state cleanup must NOT also write
        // the atom — see reset() comment for the stale-tail race.
        writePendingDraft(undefined);
        resetLocalRecorderState();
        resolveStop?.(true);
      } catch (err) {
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
        resolveStop?.(false);
      }
    },
    [
      clearSampleTimer,
      clearTimer,
      closeAudioContext,
      resetLocalRecorderState,
      safeSetElapsedMs,
      safeSetPhase,
      safeSetTransientErrorMessage,
      safeSetWaveform,
      stopStream,
      writePendingDraft,
    ]
  );

  const start = useCallback(async () => {
    if (
      phase === 'requesting' ||
      phase === 'recording' ||
      phase === 'paused' ||
      phase === 'processing' ||
      phase === 'sending' ||
      hasPendingSend
    ) {
      return false;
    }

    latestOnRecordingStartRef.current?.();
    sendRecordingAtStartRef.current = latestOnSendRecordingRef.current;
    sendContextAtStartRef.current = latestGetSendContextRef.current();
    safeSetTransientErrorMessage(undefined);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      safeSetTransientErrorMessage('Voice recording is not supported in this browser.');
      return false;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext && !isNativeApp()) {
      safeSetTransientErrorMessage(getInsecureContextVoiceRecorderMessage());
      return false;
    }

    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    pauseAllMediaElements();
    cleanupCapture();
    chunksRef.current = [];
    metadataSampleRef.current = [];
    displaySampleRef.current = [];
    activeElapsedMsRef.current = 0;
    elapsedAtStopRef.current = 0;
    pendingStopActionRef.current = undefined;
    stopResolverRef.current = undefined;
    safeSetElapsedMs(0);
    safeSetWaveform(createFallbackWaveform());
    safeSetPhase('requesting');

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: VOICE_RECORDER_AUDIO_CONSTRAINTS,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'OverconstrainedError') {
          if (sessionIdRef.current !== sessionId) return false;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw err;
        }
      }
      if (sessionIdRef.current !== sessionId) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      const mimeType = getSupportedRecorderMimeType();
      streamRef.current = stream;
      const recorderOptions: MediaRecorderOptions = {
        audioBitsPerSecond: VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
      };
      if (mimeType) recorderOptions.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, recorderOptions);
      const pauseSupported =
        typeof recorder.pause === 'function' && typeof recorder.resume === 'function';

      recorderRef.current = recorder;
      safeSetCanPause(pauseSupported);
      setupAnalyser(stream);

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener('stop', () => {
        void finishStop(recorder, mimeType);
      });

      recorder.start();
      activeStartedAtRef.current = now();
      startTimer();
      startSampleTimer();
      safeSetPhase('recording');
      return true;
    } catch (err) {
      if (sessionIdRef.current === sessionId) {
        cleanupCapture();
        chunksRef.current = [];
        metadataSampleRef.current = [];
        displaySampleRef.current = [];
        activeElapsedMsRef.current = 0;
        elapsedAtStopRef.current = 0;
        safeSetElapsedMs(0);
        safeSetPhase('idle');
        safeSetTransientErrorMessage(getVoiceRecorderErrorMessage(err));
      }
      return false;
    }
  }, [
    cleanupCapture,
    finishStop,
    hasPendingSend,
    phase,
    safeSetCanPause,
    safeSetElapsedMs,
    safeSetPhase,
    safeSetTransientErrorMessage,
    safeSetWaveform,
    setupAnalyser,
    startSampleTimer,
    startTimer,
  ]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || phase !== 'recording' || !canPause) return false;

    try {
      recorder.pause();
    } catch {
      setCanPause(false);
      return false;
    }

    activeElapsedMsRef.current = getActiveElapsedMs();
    activeStartedAtRef.current = undefined;
    updateElapsedState();
    clearTimer();
    clearSampleTimer();
    safeSetPhase('paused');
    return true;
  }, [
    canPause,
    clearSampleTimer,
    clearTimer,
    getActiveElapsedMs,
    phase,
    safeSetPhase,
    updateElapsedState,
  ]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || phase !== 'paused' || !canPause) return false;

    try {
      recorder.resume();
    } catch {
      setCanPause(false);
      return false;
    }

    activeStartedAtRef.current = now();
    startTimer();
    startSampleTimer();
    safeSetPhase('recording');
    return true;
  }, [canPause, phase, safeSetPhase, startSampleTimer, startTimer]);

  const stopWithAction = useCallback(
    (action: PendingStopAction): Promise<boolean> => {
      if (pendingStopActionRef.current) {
        return Promise.resolve(false);
      }

      const recorder = recorderRef.current;
      if (!recorder || (recorder.state !== 'recording' && recorder.state !== 'paused')) {
        if (action === 'discard') {
          // Discarding when there's no live recorder: clear local UI state
          // only. Parked-draft discard goes through discardPending() instead;
          // this path must not collide with that ownership.
          resetLocalRecorderState();
        }
        return Promise.resolve(false);
      }

      if (action === 'send' && latestOnSendStopRequestRef.current?.() === false) {
        return Promise.resolve(false);
      }

      elapsedAtStopRef.current = Math.max(0, Math.round(getActiveElapsedMs()));
      activeElapsedMsRef.current = elapsedAtStopRef.current;
      activeStartedAtRef.current = undefined;
      pendingStopActionRef.current = action;
      clearTimer();
      clearSampleTimer();
      safeSetElapsedMs(elapsedAtStopRef.current);
      safeSetPhase('processing');

      return new Promise<boolean>((resolve) => {
        stopResolverRef.current = resolve;
        try {
          recorder.stop();
        } catch (err) {
          pendingStopActionRef.current = undefined;
          stopResolverRef.current = undefined;
          safeSetPhase('idle');
          safeSetTransientErrorMessage(getVoiceRecorderErrorMessage(err));
          if (action === 'send') {
            latestOnSendStopFailureRef.current?.();
          }
          resolve(false);
        }
      });
    },
    [
      clearSampleTimer,
      clearTimer,
      getActiveElapsedMs,
      resetLocalRecorderState,
      safeSetElapsedMs,
      safeSetPhase,
      safeSetTransientErrorMessage,
    ]
  );

  const send = useCallback(() => stopWithAction('send'), [stopWithAction]);
  const discard = useCallback(() => stopWithAction('discard'), [stopWithAction]);

  /**
   * clearError dismisses transient errors only (mic permission, no-blob, etc).
   * Persisted send-failure errors live on the pending draft and are cleared
   * only by retry() success or discardPending().
   */
  const clearError = useCallback(
    () => safeSetTransientErrorMessage(undefined),
    [safeSetTransientErrorMessage]
  );

  const retry = useCallback(async (): Promise<boolean> => {
    if (retryInFlightRef.current) {
      return false;
    }
    const draft = pendingDraftRef.current;
    const sendRecording = sendRecordingAtStartRef.current ?? latestOnSendRecordingRef.current;
    // Refuse a fresh retry if the atom already has an inFlight marker — a
    // previous mount's retry is still racing the network. The capsule's
    // Discard / Send buttons are disabled by the synced phase='sending'
    // state above, but a programmatic call into retry() must also bail.
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
    safeSetTransientErrorMessage(undefined);
    safeSetElapsedMs(0);
    safeSetWaveform(createFallbackWaveform());
    safeSetPhase('idle');
  }, [
    safeSetElapsedMs,
    safeSetPhase,
    safeSetTransientErrorMessage,
    safeSetWaveform,
    writePendingDraft,
  ]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (lastPublishedRef.current !== 'inactive') setFlightRecorderVoiceCaptureState('inactive');
      if (pendingStopActionRef.current === 'send') {
        cleanupUnmountDuringSend();
        return;
      }
      // Invalidate any in-flight start() that is still awaiting
      // getUserMedia. Without this bump, a permission prompt resolved after
      // unmount would pass the post-await session check, construct a
      // MediaRecorder, and start capture/timers with no surviving owner —
      // leaking the mic stream. reset() used to do this; we no longer call
      // reset() on unmount because it would also clear the parked draft.
      sessionIdRef.current += 1;
      // Tear down live-recording resources only. Pending draft state lives in
      // the global atom and must outlive this hook so a RoomProvider key
      // remount on real navigation does not lose retry state.
      cleanupCapture();
      chunksRef.current = [];
      metadataSampleRef.current = [];
      displaySampleRef.current = [];
      activeElapsedMsRef.current = 0;
      elapsedAtStopRef.current = 0;
      pendingStopActionRef.current = undefined;
      stopResolverRef.current?.(false);
      stopResolverRef.current = undefined;
      sendRecordingAtStartRef.current = undefined;
      sendContextAtStartRef.current = undefined;
      retryInFlightRef.current = false;
    },
    [cleanupCapture, cleanupUnmountDuringSend]
  );

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
