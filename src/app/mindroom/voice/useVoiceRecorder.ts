import { useCallback, useEffect, useRef, useState } from 'react';
import { MatrixError } from 'matrix-js-sdk';
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
  waveform?: number[]
) => Promise<void> | void;

type UseVoiceRecorderOptions = {
  onRecordingStart?: () => void;
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onSendRecording?: SendRecordingCallback;
};

type StopResolver = (sent: boolean) => void;

const TIMER_INTERVAL_MS = 200;
const WAVEFORM_SAMPLE_INTERVAL_MS = 80;
const MAX_LIVE_SAMPLES = 1200;

const now = (): number => Date.now();

const getAudioContextConstructor = (): typeof AudioContext | undefined => {
  if (typeof window === 'undefined') return undefined;

  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
};

export const getVoiceRecorderErrorMessage = (err: unknown): string => {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Voice recording requires HTTPS on iPhone Safari (or localhost). Open MindRoom over HTTPS.';
  }

  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') {
      return 'Microphone access is blocked. Allow microphone access for this site/app in iPhone settings and try again.';
    }
    if (err.name === 'NotFoundError') {
      return 'No microphone was found on this device.';
    }
    if (err.name === 'NotReadableError') {
      return 'Microphone is unavailable right now (it may be in use by another app).';
    }
  }

  if (err instanceof Error) {
    if (/not allowed by the user agent|current context/i.test(err.message)) {
      return 'Microphone access is blocked in this context. On iPhone Safari/Brave, use HTTPS and allow microphone permission.';
    }
    return err.message;
  }

  return 'Failed to access microphone.';
};

export function useVoiceRecorder({
  onRecordingStart,
  onSendStopRequest,
  onSendStopFailure,
  onSendRecording,
}: UseVoiceRecorderOptions) {
  const [phase, setPhase] = useState<VoiceRecorderPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [waveform, setWaveform] = useState(() => createFallbackWaveform());
  const [errorMessage, setErrorMessage] = useState<string>();
  const [canPause, setCanPause] = useState(true);

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
  const latestOnRecordingStartRef = useRef(onRecordingStart);
  const latestOnSendStopRequestRef = useRef(onSendStopRequest);
  const latestOnSendStopFailureRef = useRef(onSendStopFailure);
  const latestOnSendRecordingRef = useRef(onSendRecording);
  const sendRecordingAtStartRef = useRef<SendRecordingCallback>();

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

  const safeSetPhase = useCallback((nextPhase: VoiceRecorderPhase) => {
    if (mountedRef.current) setPhase(nextPhase);
  }, []);

  const safeSetElapsedMs = useCallback((value: number) => {
    if (mountedRef.current) setElapsedMs(value);
  }, []);

  const safeSetWaveform = useCallback((value: number[]) => {
    if (mountedRef.current) setWaveform(value);
  }, []);

  const safeSetErrorMessage = useCallback((value: string | undefined) => {
    if (mountedRef.current) setErrorMessage(value);
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

  const reset = useCallback(() => {
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
    setCanPause(true);
    safeSetElapsedMs(0);
    safeSetWaveform(createFallbackWaveform());
    safeSetPhase('idle');
  }, [cleanupCapture, safeSetElapsedMs, safeSetPhase, safeSetWaveform]);

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
        safeSetErrorMessage('Voice recording stopped unexpectedly. Please record again.');
        resolveStop?.(false);
        return;
      }

      if (chunks.length === 0) {
        safeSetPhase('idle');
        safeSetErrorMessage('No audio data was captured.');
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
      if (!sendRecording) {
        safeSetPhase('idle');
        latestOnSendStopFailureRef.current?.();
        resolveStop?.(false);
        return;
      }

      safeSetPhase('sending');
      try {
        await sendRecording(file, duration, sampleWaveformData);
        reset();
        resolveStop?.(true);
      } catch (err) {
        safeSetPhase('idle');
        const friendlyMessage =
          err instanceof MatrixError
            ? getMatrixUploadErrorMessage(err, getMatrixUploadErrorStage(err) ?? 'send')
            : err instanceof Error
            ? err.message
            : 'Failed to send voice message.';
        safeSetErrorMessage(friendlyMessage);
        latestOnSendStopFailureRef.current?.();
        resolveStop?.(false);
      }
    },
    [
      clearSampleTimer,
      clearTimer,
      closeAudioContext,
      reset,
      safeSetElapsedMs,
      safeSetErrorMessage,
      safeSetPhase,
      safeSetWaveform,
      stopStream,
    ]
  );

  const start = useCallback(async () => {
    if (
      phase === 'requesting' ||
      phase === 'recording' ||
      phase === 'paused' ||
      phase === 'processing' ||
      phase === 'sending'
    ) {
      return false;
    }

    latestOnRecordingStartRef.current?.();
    sendRecordingAtStartRef.current = latestOnSendRecordingRef.current;
    safeSetErrorMessage(undefined);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      safeSetErrorMessage('Voice recording is not supported in this browser.');
      return false;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      safeSetErrorMessage(
        'Voice recording requires HTTPS on iPhone Safari/Brave (or localhost). Open MindRoom over HTTPS.'
      );
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (sessionIdRef.current !== sessionId) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      const mimeType = getSupportedRecorderMimeType();
      streamRef.current = stream;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const pauseSupported =
        typeof recorder.pause === 'function' && typeof recorder.resume === 'function';

      recorderRef.current = recorder;
      setCanPause(pauseSupported);
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
        safeSetErrorMessage(getVoiceRecorderErrorMessage(err));
      }
      return false;
    }
  }, [
    cleanupCapture,
    finishStop,
    phase,
    safeSetElapsedMs,
    safeSetErrorMessage,
    safeSetPhase,
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
          reset();
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
          safeSetErrorMessage(getVoiceRecorderErrorMessage(err));
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
      reset,
      safeSetElapsedMs,
      safeSetErrorMessage,
      safeSetPhase,
    ]
  );

  const send = useCallback(() => stopWithAction('send'), [stopWithAction]);
  const discard = useCallback(() => stopWithAction('discard'), [stopWithAction]);

  const clearError = useCallback(() => safeSetErrorMessage(undefined), [safeSetErrorMessage]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (pendingStopActionRef.current === 'send') {
        cleanupUnmountDuringSend();
        return;
      }
      reset();
    },
    [cleanupUnmountDuringSend, reset]
  );

  return {
    phase,
    elapsedMs,
    waveform,
    errorMessage,
    canPause,
    start,
    pause,
    resume,
    send,
    discard,
    reset,
    clearError,
  };
}
