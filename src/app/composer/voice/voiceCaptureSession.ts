import { isNativeApp } from '../../native/nativeSso';
import {
  isNativeVoiceRecorderAvailable,
  startNativeVoiceRecorder,
} from '../../native/nativeVoiceRecorder';
import {
  analyserRmsToMatrixPoint,
  createFallbackWaveform,
  normalizeMatrixWaveform,
  timeDomainDataToWaveformPoint,
  VOICE_WAVEFORM_SAMPLE_INTERVAL_MS,
} from '../../lib/audioWaveform';
import { pauseAllMediaElements } from '../../lib/dom';
import { randomUuid } from '../../lib/randomUuid';
import {
  DEFAULT_VOICE_RECORDER_MIME_TYPE,
  getSupportedRecorderMimeType,
  getVoiceFileName,
} from './voiceRecorderMime';
import { getMicrophoneAccessErrorMessage } from './microphoneAccess';
import { publishVoiceCaptureState, releaseVoiceCaptureState } from './voiceCaptureDiagnostics';
import { recordDeepTraceEvent } from '../../diagnostics/deepTrace';

export const VOICE_RECORDER_AUDIO_BITS_PER_SECOND = 32_000;
// Audio reaches the app as it is recorded, so a native stop that never arrives loses at most this.
export const VOICE_RECORDER_TIMESLICE_MS = 1_000;
// WebKit can skip the stop event; finish with the delivered audio instead of waiting forever.
export const VOICE_RECORDER_STOP_TIMEOUT_MS = 5_000;
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

export type VoiceCapturePhase = 'idle' | 'requesting' | 'recording' | 'paused' | 'processing';
export type CapturedVoiceRecording = {
  /** Names the recording in the journal. */
  recordingId: string;
  file: File;
  duration: number;
  waveform: number[] | undefined;
  /** The journal does not hold all of it: a crash would lose it. */
  unprotected?: boolean;
};
export type VoiceCaptureResult =
  | { status: 'captured'; recording: CapturedVoiceRecording }
  | { status: 'failed' }
  | { status: 'ignored' };
export type VoiceCaptureSnapshot = {
  phase: VoiceCapturePhase;
  elapsedMs: number;
  waveform: number[];
  /** Grows by one with each waveform sample, also once `waveform` stops growing; only its changes matter. */
  sampleCount: number;
  canPause: boolean;
  /** The journal does not hold all that was recorded so far: a crash would lose it. */
  unprotected: boolean;
  errorMessage: string | undefined;
};
/**
 * Where the session writes a recording as it arrives, so a crash loses at most the last second
 * (voiceRecordingJournal.ts). `begin` and `append` resolve true while the journal holds all of
 * the recording so far: a write that failed is made again with the next one. Recording goes on
 * from memory either way.
 */
export type VoiceCaptureJournal = {
  begin: (meta: { recordingId: string; startedAt: number; mimeType: string }) => Promise<boolean>;
  append: (
    recordingId: string,
    seq: number,
    chunk: { data: Blob; elapsedMs: number; samples: number[] }
  ) => Promise<boolean>;
  /** The recorder stopped without audio. */
  abandon: (recordingId: string) => void;
};
export type VoiceCaptureOptions = {
  journal?: VoiceCaptureJournal;
  /**
   * Takes audio that was not sent, instead of dropping it: of a recording the person discarded
   * (`discarded`, for its Undo), of a recorder that stopped by itself, and of a session that was
   * reset or released while it held audio.
   */
  keep?: (recording: CapturedVoiceRecording, discarded: boolean) => void;
};
export type VoiceCaptureSession = {
  getSnapshot: () => VoiceCaptureSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: () => Promise<boolean>;
  canStop: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
  finish: () => Promise<VoiceCaptureResult>;
  discard: () => Promise<boolean>;
  reset: () => void;
  clearError: () => void;
  releaseOwner: () => void;
};

/** What the session drives: a MediaRecorder, or the Mac app's native recorder. */
type VoiceRecorder = Pick<MediaRecorder, 'state' | 'mimeType' | 'pause' | 'resume' | 'stop'> &
  Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

type Generation = {
  acceptsEvents: boolean;
  recordingId: string;
  /** The place of the next chunk in the journal. */
  seq: number;
  /** The journal's last write, once it has a record: whether it holds all of it so far. */
  written?: Promise<boolean>;
  /** The samples since the last chunk, which the next chunk takes to the journal. */
  unjournaledSamples: number[];
  mimeType?: string;
  recorder?: VoiceRecorder;
  stream?: MediaStream;
  audioContext?: AudioContext;
  source?: MediaStreamAudioSourceNode;
  /** The level now, as a Matrix waveform point. */
  readLevel?: () => number;
  timer?: ReturnType<typeof setInterval>;
  sampleTimer?: ReturnType<typeof setInterval>;
  stopTimer?: ReturnType<typeof setTimeout>;
  finishStop?: () => void;
  chunks: Blob[];
  samples: number[];
  elapsedMs: number;
  startedAt?: number;
  action?: 'send' | 'discard';
  resolve?: (result: VoiceCaptureResult) => void;
  detach?: () => void;
};

const freezeSnapshot = (snapshot: VoiceCaptureSnapshot): VoiceCaptureSnapshot =>
  Object.freeze({ ...snapshot, waveform: Object.freeze([...snapshot.waveform]) as number[] });
const idleSnapshot = (): VoiceCaptureSnapshot =>
  freezeSnapshot({
    phase: 'idle',
    elapsedMs: 0,
    waveform: createFallbackWaveform(),
    sampleCount: 0,
    canPause: true,
    unprotected: false,
    errorMessage: undefined,
  });

export const createVoiceCaptureSession = ({
  journal,
  keep,
}: VoiceCaptureOptions = {}): VoiceCaptureSession => {
  const source = Symbol('voice-recorder');
  const listeners = new Set<() => void>();
  let snapshot = idleSnapshot();
  let current: Generation | undefined;
  let released = false;

  const owns = (generation: Generation) =>
    !released && current === generation && generation.acceptsEvents;
  // A subscriber can accept a stop without replacing the generation.
  const isRecording = (generation: Generation) =>
    owns(generation) && !generation.action && generation.recorder?.state === 'recording';

  const publish = (changes: Partial<VoiceCaptureSnapshot>) => {
    if (released) return;
    snapshot = freezeSnapshot({ ...snapshot, ...changes });
    if (changes.phase)
      publishVoiceCaptureState(source, changes.phase === 'idle' ? 'inactive' : changes.phase);
    listeners.forEach((listener) => listener());
  };
  const elapsed = (generation: Generation) =>
    generation.elapsedMs +
    (generation.startedAt === undefined ? 0 : Math.max(0, now() - generation.startedAt));
  const clearTimers = (generation: Generation) => {
    if (generation.timer !== undefined) clearInterval(generation.timer);
    if (generation.sampleTimer !== undefined) clearInterval(generation.sampleTimer);
    generation.timer = undefined;
    generation.sampleTimer = undefined;
  };
  const closeAudio = (generation: Generation) => {
    try {
      generation.source?.disconnect();
    } catch {
      /* Already disconnected. */
    }
    generation.source = undefined;
    generation.readLevel = undefined;
    const context = generation.audioContext;
    generation.audioContext = undefined;
    if (context && context.state !== 'closed') {
      try {
        void context.close().catch(() => undefined);
      } catch {
        /* Best-effort native cleanup. */
      }
    }
  };
  const releaseResources = (generation: Generation) => {
    clearTimers(generation);
    closeAudio(generation);
    const stream = generation.stream;
    generation.stream = undefined;
    stream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* Release other tracks too. */
      }
    });
    generation.elapsedMs = elapsed(generation);
    generation.startedAt = undefined;
  };
  /**
   * What the generation recorded, which it gives up: undefined without audio. It says whether
   * the journal holds all of it once its last write, which tries every failed one again, is done.
   */
  const take = (
    generation: Generation,
    recorder: VoiceRecorder | undefined
  ): Promise<CapturedVoiceRecording> | undefined => {
    const { chunks, samples, recordingId, written } = generation;
    generation.chunks = [];
    generation.samples = [];
    generation.written = undefined;
    if (chunks.length === 0) {
      if (written) journal?.abandon(recordingId);
      return undefined;
    }
    const type =
      recorder?.mimeType ||
      generation.mimeType ||
      chunks.find((chunk) => chunk.type)?.type ||
      DEFAULT_VOICE_RECORDER_MIME_TYPE;
    const recording = {
      recordingId,
      file: new File(chunks, getVoiceFileName(type, new Date()), { type }),
      duration: Math.max(1, Math.round(generation.elapsedMs)),
      waveform: samples.length > 0 ? normalizeMatrixWaveform(samples) : undefined,
    };
    return (written ?? Promise.resolve(true)).then((all) =>
      all ? recording : { ...recording, unprotected: true }
    );
  };
  /** Follows a journal write: the capsule says while the recording is not protected against a crash. */
  const protect = (generation: Generation, write: Promise<boolean>) => {
    const written = write.catch(() => false);
    generation.written = written;
    void written.then((all) => {
      if (current === generation && snapshot.unprotected === all) publish({ unprotected: !all });
    });
  };
  // An accepted stop keeps its deadline through releaseOwner; only the end of the generation clears it.
  const clearStopTimer = (generation: Generation) => {
    if (generation.stopTimer !== undefined) clearTimeout(generation.stopTimer);
    generation.stopTimer = undefined;
  };
  const retire = (generation: Generation) => {
    const { recorder } = generation;
    if (
      recorder &&
      recorder.state !== 'inactive' &&
      generation.acceptsEvents &&
      !generation.action
    ) {
      // Its composer went, or the session starts over, while it recorded: the recorder's last
      // audio comes with its stop, and `finishStop` keeps all of it then.
      try {
        recorder.stop();
        releaseResources(generation);
        generation.stopTimer = setTimeout(
          () => generation.finishStop?.(),
          VOICE_RECORDER_STOP_TIMEOUT_MS
        );
        return;
      } catch {
        /* What it has is kept below. */
      }
    }
    generation.acceptsEvents = false;
    clearStopTimer(generation);
    generation.detach?.();
    generation.detach = undefined;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* Tracks still release below. */
      }
    }
    releaseResources(generation);
    const recording = take(generation, recorder);
    generation.recorder = undefined;
    void recording?.then((kept) => keep?.(kept, generation.action === 'discard'));
    generation.resolve?.({ status: 'ignored' });
    generation.resolve = undefined;
  };
  const reset = () => {
    const generation = current;
    current = undefined;
    if (generation) retire(generation);
    publish(idleSnapshot());
  };
  const sample = (generation: Generation) => {
    if (current !== generation || !generation.acceptsEvents || !generation.readLevel) return;
    const level = generation.readLevel();
    generation.samples.push(level);
    if (journal) generation.unjournaledSamples.push(level);
    if (generation.samples.length > 1200)
      generation.samples.splice(0, generation.samples.length - 1200);
    publish({ waveform: generation.samples, sampleCount: snapshot.sampleCount + 1 });
  };
  const startTimers = (generation: Generation) => {
    clearTimers(generation);
    generation.timer = setInterval(() => {
      if (current === generation)
        publish({ elapsedMs: Math.max(0, Math.round(elapsed(generation))) });
    }, 200);
    if (generation.readLevel) {
      generation.sampleTimer = setInterval(
        () => sample(generation),
        VOICE_WAVEFORM_SAMPLE_INTERVAL_MS
      );
      sample(generation);
    }
  };
  const setupAnalyser = (generation: Generation, stream: MediaStream) => {
    const Constructor = getAudioContextConstructor();
    if (!Constructor) return;
    try {
      const context = new Constructor();
      generation.audioContext = context;
      generation.source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      generation.source.connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      generation.readLevel = () => {
        analyser.getByteTimeDomainData(buffer);
        return timeDomainDataToWaveformPoint(buffer);
      };
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
    } catch {
      closeAudio(generation);
    }
  };
  const finishStop = (generation: Generation, recorder: VoiceRecorder) => {
    if (!generation.acceptsEvents) return;
    generation.acceptsEvents = false;
    clearStopTimer(generation);
    generation.detach?.();
    generation.detach = undefined;
    releaseResources(generation);
    generation.recorder = undefined;
    const recording = take(generation, recorder);
    const resolve = generation.resolve;
    generation.resolve = undefined;
    const isCurrent = current === generation;
    const update = (changes: Partial<VoiceCaptureSnapshot>) => {
      if (isCurrent) publish(changes);
    };
    if (generation.action !== 'send') {
      // Not sent: discarded, the recorder stopped by itself (microphone gone, page suspended),
      // or the session let go of it while it recorded.
      const kept = recording !== undefined && keep !== undefined;
      if (kept) void recording.then((audio) => keep(audio, generation.action === 'discard'));
      update({
        phase: 'idle',
        elapsedMs: 0,
        waveform: createFallbackWaveform(),
        ...(generation.action === 'discard' || kept
          ? {}
          : { errorMessage: 'Voice recording stopped unexpectedly. Please record again.' }),
      });
      resolve?.({ status: 'ignored' });
      return;
    }
    if (!recording) {
      update({ phase: 'idle', errorMessage: 'No audio data was captured.' });
      resolve?.({ status: 'failed' });
      return;
    }
    // The facade retains processing until delivery begins; capture diagnostics end here.
    if (isCurrent && !released) releaseVoiceCaptureState(source);
    void recording.then((captured) => resolve?.({ status: 'captured', recording: captured }));
  };
  const start = async () => {
    if (!released && (snapshot.phase !== 'idle' || current?.acceptsEvents)) return false;
    released = false;
    if (current) retire(current);
    const generation: Generation = {
      acceptsEvents: true,
      recordingId: randomUuid(),
      seq: 0,
      unjournaledSamples: [],
      chunks: [],
      samples: [],
      elapsedMs: 0,
    };
    current = generation;
    publish({ errorMessage: undefined });
    if (!owns(generation)) return false;
    const webCapture =
      !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
    const native = !webCapture && isNativeVoiceRecorderAvailable();
    if (!webCapture && !native) {
      current = undefined;
      retire(generation);
      publish({ errorMessage: 'Voice recording is not supported in this browser.' });
      return false;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext && !isNativeApp()) {
      current = undefined;
      retire(generation);
      publish({ errorMessage: getInsecureContextVoiceRecorderMessage() });
      return false;
    }
    pauseAllMediaElements();
    publish({ ...idleSnapshot(), phase: 'requesting' });
    if (!owns(generation)) return false;
    try {
      let recorder: VoiceRecorder;
      let webRecorder: MediaRecorder | undefined;
      let mimeType: string | undefined;
      if (native) {
        const nativeRecorder = await startNativeVoiceRecorder();
        if (!owns(generation)) {
          nativeRecorder.stop();
          return false;
        }
        recorder = nativeRecorder;
        generation.recorder = recorder;
        generation.readLevel = () => analyserRmsToMatrixPoint(nativeRecorder.level());
      } else {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: VOICE_RECORDER_AUDIO_CONSTRAINTS,
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'OverconstrainedError') {
            if (!owns(generation)) return false;
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } else throw err;
        }
        if (!owns(generation)) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        generation.stream = stream;
        mimeType = getSupportedRecorderMimeType();
        const options: MediaRecorderOptions = {
          audioBitsPerSecond: VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
        };
        if (mimeType) options.mimeType = mimeType;
        webRecorder = new MediaRecorder(stream, options);
        recorder = webRecorder;
        generation.recorder = recorder;
        publish({
          canPause: typeof recorder.pause === 'function' && typeof recorder.resume === 'function',
        });
        if (!owns(generation)) return false;
        setupAnalyser(generation, stream);
      }
      generation.mimeType = mimeType;
      const onData = (event: Event) => {
        const { data } = event as BlobEvent;
        if (!generation.acceptsEvents || data.size === 0) return;
        generation.chunks.push(data);
        if (!journal) return;
        // The chunk's place is fixed here, as it arrives: reading its bytes takes a while.
        const { seq } = generation;
        generation.seq += 1;
        protect(
          generation,
          journal.append(generation.recordingId, seq, {
            data,
            elapsedMs: Math.round(elapsed(generation)),
            samples: generation.unjournaledSamples.splice(0),
          })
        );
      };
      const onStop = () => finishStop(generation, recorder);
      // A page that is hidden or left may never run again: get what was recorded so far to disk.
      const flush = () => {
        try {
          if (webRecorder && webRecorder.state !== 'inactive') webRecorder.requestData();
        } catch {
          /* Best effort. */
        }
      };
      const flushWhenHidden = () => {
        if (document.visibilityState === 'hidden') flush();
      };
      generation.finishStop = onStop;
      recorder.addEventListener('dataavailable', onData);
      recorder.addEventListener('stop', onStop);
      if (journal && webRecorder && typeof document !== 'undefined') {
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', flushWhenHidden);
      }
      generation.detach = () => {
        recorder.removeEventListener?.('dataavailable', onData);
        recorder.removeEventListener?.('stop', onStop);
        if (typeof document === 'undefined') return;
        window.removeEventListener('pagehide', flush);
        document.removeEventListener('visibilitychange', flushWhenHidden);
      };
      webRecorder?.start(VOICE_RECORDER_TIMESLICE_MS);
      generation.startedAt = now();
      if (journal) {
        protect(
          generation,
          journal.begin({
            recordingId: generation.recordingId,
            startedAt: generation.startedAt,
            mimeType: recorder.mimeType || mimeType || DEFAULT_VOICE_RECORDER_MIME_TYPE,
          })
        );
      }
      startTimers(generation);
      if (!isRecording(generation)) return false;
      publish({ phase: 'recording' });
      return isRecording(generation);
    } catch (err) {
      if (current === generation) {
        current = undefined;
        retire(generation);
        publish({ phase: 'idle', elapsedMs: 0, errorMessage: getVoiceRecorderErrorMessage(err) });
      }
      return false;
    }
  };
  const canStop = () =>
    !!current &&
    !current.action &&
    (current.recorder?.state === 'recording' || current.recorder?.state === 'paused');
  const stop = (action: 'send' | 'discard'): Promise<VoiceCaptureResult> => {
    if (current?.action) return Promise.resolve({ status: 'ignored' });
    if (!canStop()) {
      if (action === 'discard') reset();
      return Promise.resolve({ status: 'ignored' });
    }
    const generation = current!;
    generation.elapsedMs = Math.max(0, Math.round(elapsed(generation)));
    generation.startedAt = undefined;
    generation.action = action;
    clearTimers(generation);
    return new Promise((resolve) => {
      // A processing subscriber can release ownership synchronously.
      generation.resolve = resolve;
      publish({ elapsedMs: generation.elapsedMs, phase: 'processing' });
      if (!generation.acceptsEvents) return;
      try {
        generation.recorder!.stop();
        generation.stopTimer = setTimeout(() => {
          recordDeepTraceEvent('voice.capture.stop_timeout', {
            chunk_count: generation.chunks.length,
          });
          generation.finishStop?.();
        }, VOICE_RECORDER_STOP_TIMEOUT_MS);
      } catch (err) {
        generation.resolve = undefined;
        retire(generation);
        if (current === generation) {
          current = undefined;
          publish({ phase: 'idle', errorMessage: getVoiceRecorderErrorMessage(err) });
        }
        resolve({ status: 'failed' });
      }
    });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    canStop,
    pause: () => {
      const generation = current;
      if (!generation?.recorder || snapshot.phase !== 'recording' || !snapshot.canPause)
        return false;
      try {
        generation.recorder.pause();
      } catch {
        publish({ canPause: false });
        return false;
      }
      generation.elapsedMs = elapsed(generation);
      generation.startedAt = undefined;
      clearTimers(generation);
      publish({ phase: 'paused', elapsedMs: Math.max(0, Math.round(generation.elapsedMs)) });
      return true;
    },
    resume: () => {
      const generation = current;
      if (!generation?.recorder || snapshot.phase !== 'paused' || !snapshot.canPause) return false;
      try {
        generation.recorder.resume();
      } catch {
        publish({ canPause: false });
        return false;
      }
      generation.startedAt = now();
      startTimers(generation);
      if (!isRecording(generation)) return false;
      publish({ phase: 'recording' });
      return isRecording(generation);
    },
    finish: () => stop('send'),
    discard: async () => {
      await stop('discard');
      return false;
    },
    reset,
    clearError: () => {
      if (snapshot.errorMessage !== undefined) publish({ errorMessage: undefined });
    },
    releaseOwner: () => {
      if (released) return;
      released = true;
      const generation = current;
      current = undefined;
      if (generation?.action === 'send' && generation.resolve) releaseResources(generation);
      else if (generation) retire(generation);
      snapshot = idleSnapshot();
      releaseVoiceCaptureState(source);
    },
  };
};
