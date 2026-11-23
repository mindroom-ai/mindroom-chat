import {
  timeDomainDataToWaveformPoint,
  VOICE_WAVEFORM_SAMPLE_INTERVAL_MS,
} from '../../lib/audioWaveform';
import { pauseAllMediaElements } from '../../lib/dom';
import { DICTATION_WORKLET_FILE, getSpeechModelDirectory } from '../../lib/speechModelAssets';
import {
  VOICE_RECORDER_AUDIO_CONSTRAINTS,
  getVoiceRecorderErrorMessage,
} from '../voice/voiceCaptureSession';
import { DictationApiError, type DictationClient } from './api';
import {
  DICTATION_FRAME_SAMPLES,
  DICTATION_SAMPLE_RATE,
  DictationSegmenter,
  type DictationSegment,
} from './dictationSegmenter';
import { loadSileroVad, type SileroVadInstance } from './sileroVad';
import { buildTrailingPrompt, stitchTranscript } from './stitchTranscript';

const USER_GESTURES = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'] as const;
const MAX_WAVEFORM_SAMPLES = 1200;
const DEFAULT_RETRY_DELAY_MS = 1000;
const ELAPSED_TICK_MS = 200;

export type DictationPhase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'paused'
  | 'finishing'
  | 'failed';

export type DictationSnapshot = {
  phase: DictationPhase;
  elapsedMs: number;
  waveform: number[];
  sampleCount: number;
  pendingUploads: number;
  failedSegments: number;
  completedSegments: number;
  hasPartialText: boolean;
  capReached: boolean;
  interrupted: boolean;
  errorMessage: string | undefined;
};

export type DictationFinishResult =
  | { status: 'completed'; text: string }
  | {
      status: 'failed';
      failedSegments: number;
      completedSegments: number;
      errorMessage: string;
    }
  | { status: 'cancelled' };

export type DictationSessionOptions = {
  client: Pick<DictationClient, 'transcribe'>;
  roomId?: string;
  loadVad?: (signal?: AbortSignal) => Promise<SileroVadInstance>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => AudioContext;
  workletUrl?: string;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Exposed for tests to push synthetic frames when bypassing browser AudioWorklet. */
  onCaptureReady?: (pushFrame: (frame: Float32Array) => void) => void;
};

type SegmentRecord = {
  segment: DictationSegment;
  status: 'queued' | 'uploading' | 'completed' | 'failed';
  text?: string;
  promptUsed?: string;
  error?: string;
  retryNotBefore?: number;
  autoRetried: boolean;
};

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const getAudioContextConstructor = (): typeof AudioContext | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
};

const idleSnapshot = (errorMessage?: string): DictationSnapshot => ({
  phase: 'idle',
  elapsedMs: 0,
  waveform: [],
  sampleCount: 0,
  pendingUploads: 0,
  failedSegments: 0,
  completedSegments: 0,
  hasPartialText: false,
  capReached: false,
  interrupted: false,
  errorMessage,
});

const describeUploadError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Could not transcribe dictation audio.';
};

export type DictationSession = {
  getSnapshot: () => DictationSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: () => Promise<boolean>;
  pause: () => Promise<void>;
  resume: () => Promise<boolean>;
  finish: () => Promise<DictationFinishResult>;
  retryFailed: () => Promise<DictationFinishResult>;
  takePartialText: () => string;
  discard: () => void;
  clearError: () => void;
};

export const createDictationSession = (options: DictationSessionOptions): DictationSession => {
  const {
    client,
    roomId,
    loadVad = loadSileroVad,
    now = () => Date.now(),
    sleep = defaultSleep,
    onCaptureReady,
  } = options;

  const listeners = new Set<() => void>();
  let snapshot: DictationSnapshot = idleSnapshot();
  let generation = 0;
  let sessionAbort: AbortController | undefined;
  let segmenter: DictationSegmenter | undefined;
  let vadInstance: SileroVadInstance | undefined;
  let vadLoading = false;

  // Active capture resources
  let stream: MediaStream | undefined;
  let audioContext: AudioContext | undefined;
  let sourceNode: MediaStreamAudioSourceNode | undefined;
  let workletNode: AudioWorkletNode | undefined;
  let scriptNode: ScriptProcessorNode | undefined;
  let silentGain: GainNode | undefined;
  let readLevel: (() => number) | undefined;
  let detachGestureListeners: (() => void) | undefined;
  let detachTrackEnded: (() => void) | undefined;
  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  let waveformTimer: ReturnType<typeof setInterval> | undefined;

  // Session progress state
  let accumulatedMs = 0;
  let recordingStartedAt: number | undefined;
  let waveformSamples: number[] = [];
  let records: SegmentRecord[] = [];
  let queuePromise: Promise<void> | undefined;

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const stitchCompleted = (limit = records.length): string =>
    stitchTranscript(
      records
        .slice(0, limit)
        .filter((item) => item.status === 'completed' && item.text !== undefined)
        .map((item) => ({
          text: item.text ?? '',
          overlapped: item.segment.overlapped,
          prompt: item.promptUsed,
          seconds: item.segment.seconds,
          peakRms: item.segment.peakRms,
        }))
    );

  const currentElapsedMs = (): number =>
    recordingStartedAt === undefined
      ? accumulatedMs
      : Math.max(0, Math.round(accumulatedMs + (now() - recordingStartedAt)));

  const computeCounts = () => {
    let pendingUploads = 0;
    let failedSegments = 0;
    let completedSegments = 0;
    for (const record of records) {
      if (record.status === 'queued' || record.status === 'uploading') pendingUploads += 1;
      else if (record.status === 'failed') failedSegments += 1;
      else if (record.status === 'completed') completedSegments += 1;
    }
    const hasPartialText = completedSegments > 0 && stitchCompleted().trim().length > 0;
    return { pendingUploads, failedSegments, completedSegments, hasPartialText };
  };

  const publish = (patch: Partial<DictationSnapshot> = {}) => {
    snapshot = {
      ...snapshot,
      ...computeCounts(),
      ...patch,
    };
    emit();
  };

  const stopTimers = () => {
    if (elapsedTimer !== undefined) clearInterval(elapsedTimer);
    if (waveformTimer !== undefined) clearInterval(waveformTimer);
    elapsedTimer = undefined;
    waveformTimer = undefined;
  };

  const safeDisconnect = (node?: AudioNode) => {
    try {
      node?.disconnect();
    } catch {
      // Ignore disconnect errors on torn-down graphs.
    }
  };

  const releaseCapture = () => {
    stopTimers();
    detachTrackEnded?.();
    detachTrackEnded = undefined;
    detachGestureListeners?.();
    detachGestureListeners = undefined;
    readLevel = undefined;

    if (workletNode) {
      try {
        workletNode.port.postMessage('stop');
        workletNode.port.onmessage = null;
      } catch {
        // Ignore port errors on torn-down nodes.
      }
      safeDisconnect(workletNode);
      workletNode = undefined;
    }
    if (scriptNode) {
      scriptNode.onaudioprocess = null;
      safeDisconnect(scriptNode);
      scriptNode = undefined;
    }
    safeDisconnect(silentGain);
    silentGain = undefined;
    safeDisconnect(sourceNode);
    sourceNode = undefined;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    if (audioContext) {
      audioContext.onstatechange = null;
      void audioContext.close().catch(() => undefined);
      audioContext = undefined;
    }
  };

  const releaseAll = (errorMessage?: string) => {
    generation += 1;
    sessionAbort?.abort();
    sessionAbort = undefined;
    releaseCapture();
    segmenter?.clear();
    segmenter = undefined;
    if (vadInstance) {
      const toRelease = vadInstance;
      vadInstance = undefined;
      void toRelease.release().catch(() => undefined);
    }
    vadLoading = false;
    accumulatedMs = 0;
    recordingStartedAt = undefined;
    waveformSamples = [];
    records = [];
    queuePromise = undefined;
    snapshot = idleSnapshot(errorMessage);
    emit();
  };

  const requestMicrophone = async (): Promise<MediaStream> => {
    const acquire =
      options.getUserMedia ??
      ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
    try {
      return await acquire({ audio: VOICE_RECORDER_AUDIO_CONSTRAINTS });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'OverconstrainedError') {
        return acquire({ audio: true });
      }
      throw error;
    }
  };

  const installScriptProcessorFallback = (
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    gain: GainNode,
    activeGen: number
  ) => {
    const processor = context.createScriptProcessor(4096, 1, 1);
    const ratio = context.sampleRate / DICTATION_SAMPLE_RATE;
    let out = new Float32Array(DICTATION_FRAME_SAMPLES);
    let outIndex = 0;
    let acc = 0;
    let accCount = 0;
    let srcPos = 0;
    let nextEmit = ratio;

    processor.onaudioprocess = (event) => {
      if (generation !== activeGen || snapshot.phase !== 'recording') return;
      const input = event.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i += 1) {
        acc += input[i] ?? 0;
        accCount += 1;
        srcPos += 1;
        if (srcPos >= nextEmit) {
          const val = acc / accCount;
          acc = 0;
          accCount = 0;
          while (srcPos >= nextEmit) {
            out[outIndex] = val;
            outIndex += 1;
            nextEmit += ratio;
            if (outIndex === DICTATION_FRAME_SAMPLES) {
              segmenter?.pushFrame(out);
              out = new Float32Array(DICTATION_FRAME_SAMPLES);
              outIndex = 0;
              nextEmit -= srcPos;
              srcPos = 0;
            }
          }
        }
      }
    };
    source.connect(processor);
    processor.connect(gain);
    scriptNode = processor;
  };

  const startTimers = (activeGen: number) => {
    stopTimers();
    const sample = () => {
      if (generation !== activeGen || snapshot.phase !== 'recording' || !readLevel) return;
      waveformSamples = [...waveformSamples, readLevel()];
      if (waveformSamples.length > MAX_WAVEFORM_SAMPLES) {
        waveformSamples = waveformSamples.slice(-MAX_WAVEFORM_SAMPLES);
      }
      publish({
        waveform: waveformSamples,
        sampleCount: snapshot.sampleCount + 1,
        elapsedMs: currentElapsedMs(),
      });
    };

    elapsedTimer = setInterval(() => {
      if (generation === activeGen && snapshot.phase === 'recording') {
        publish({ elapsedMs: currentElapsedMs() });
      }
    }, ELAPSED_TICK_MS);

    if (readLevel) {
      waveformTimer = setInterval(sample, VOICE_WAVEFORM_SAMPLE_INTERVAL_MS);
      sample();
    }
  };

  const uploadOne = async (record: SegmentRecord, index: number, activeGen: number) => {
    const signal = sessionAbort?.signal;
    if (!signal || signal.aborted || generation !== activeGen) return;

    const waitUntil = async (delayMs: number): Promise<boolean> => {
      if (delayMs <= 0) return true;
      try {
        await sleep(delayMs, signal);
      } catch {
        return false;
      }
      return !signal.aborted && generation === activeGen;
    };

    if (record.retryNotBefore !== undefined && !(await waitUntil(record.retryNotBefore - now()))) {
      return;
    }

    record.status = 'uploading';
    publish();

    for (;;) {
      const prompt = index === 0 ? undefined : buildTrailingPrompt(stitchCompleted(index), 200);
      try {
        const result = await client.transcribe(record.segment.wav, { prompt, roomId }, signal);
        if (signal.aborted || generation !== activeGen) return;
        record.text = result.text;
        record.promptUsed = prompt;
        record.error = undefined;
        record.retryNotBefore = undefined;
        record.status = 'completed';
        publish();
        return;
      } catch (error) {
        if (signal.aborted || generation !== activeGen) return;
        const retryAfterMs =
          error instanceof DictationApiError && error.status === 429
            ? error.retryAfterMs
            : undefined;
        record.error = describeUploadError(error);
        record.retryNotBefore = retryAfterMs !== undefined ? now() + retryAfterMs : undefined;

        // Mid-speech failure: auto-retry once after Retry-After or 1 s backoff, then mark failed.
        if (!record.autoRetried && snapshot.phase !== 'finishing') {
          record.autoRetried = true;
          if (!(await waitUntil(retryAfterMs ?? DEFAULT_RETRY_DELAY_MS))) return;
          continue;
        }

        record.status = 'failed';
        publish();
        return;
      }
    }
  };

  const pumpQueue = (activeGen: number): Promise<void> => {
    if (queuePromise) return queuePromise;
    const run = async () => {
      while (generation === activeGen && !sessionAbort?.signal.aborted) {
        const nextIndex = records.findIndex((item) => item.status === 'queued');
        if (nextIndex === -1) break;
        const nextRecord = records[nextIndex];
        if (!nextRecord) break;
        await uploadOne(nextRecord, nextIndex, activeGen);
      }
    };
    queuePromise = run().finally(() => {
      queuePromise = undefined;
    });
    return queuePromise;
  };

  const enqueueSegment = (segment: DictationSegment, activeGen: number) => {
    if (generation !== activeGen || sessionAbort?.signal.aborted) return;
    records.push({
      segment,
      status: 'queued',
      autoRetried: false,
    });
    publish();
    void pumpQueue(activeGen);
  };

  const pauseWithReason = async (reason: 'user' | 'interrupted' | 'capReached'): Promise<void> => {
    if (snapshot.phase !== 'recording') return;
    const activeGen = generation;
    accumulatedMs = currentElapsedMs();
    recordingStartedAt = undefined;
    releaseCapture();
    publish({
      phase: 'paused',
      elapsedMs: accumulatedMs,
      capReached: reason === 'capReached' ? true : snapshot.capReached,
      interrupted: reason === 'interrupted' ? true : snapshot.interrupted,
    });
    await segmenter?.flush('pause');
    if (generation === activeGen) publish();
  };

  const attachAudioPipeline = async (activeGen: number): Promise<boolean> => {
    const makeContext =
      options.createAudioContext ??
      (() => {
        const Ctor = getAudioContextConstructor();
        if (!Ctor) throw new Error('AudioContext is not available.');
        return new Ctor();
      });

    // Create and resume AudioContext synchronously inside the user gesture before awaiting mic.
    const context = makeContext();
    audioContext = context;
    const keepRunning = () => {
      if (context.state !== 'running') void context.resume().catch(() => undefined);
    };
    keepRunning();
    context.onstatechange = keepRunning;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      USER_GESTURES.forEach((type) =>
        window.addEventListener(type, keepRunning, { capture: true })
      );
      detachGestureListeners = () => {
        USER_GESTURES.forEach((type) =>
          window.removeEventListener(type, keepRunning, { capture: true })
        );
      };
    }

    const micStream = await requestMicrophone();
    if (generation !== activeGen) {
      micStream.getTracks().forEach((track) => track.stop());
      return false;
    }
    stream = micStream;

    const [audioTrack] = micStream.getAudioTracks();
    if (audioTrack) {
      const handleEnded = () => {
        if (generation === activeGen && snapshot.phase === 'recording') {
          void pauseWithReason('interrupted');
        }
      };
      audioTrack.addEventListener('ended', handleEnded);
      detachTrackEnded = () => audioTrack.removeEventListener('ended', handleEnded);
    }

    const source = context.createMediaStreamSource(micStream);
    sourceNode = source;

    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const timeDomain = new Uint8Array(analyser.fftSize);
    readLevel = () => {
      analyser.getByteTimeDomainData(timeDomain);
      return timeDomainDataToWaveformPoint(timeDomain);
    };

    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
    silentGain = gain;

    const workletUrl =
      options.workletUrl ?? `${getSpeechModelDirectory()}${DICTATION_WORKLET_FILE}`;
    const hasAudioWorklet =
      'audioWorklet' in context &&
      typeof context.audioWorklet?.addModule === 'function' &&
      typeof AudioWorkletNode === 'function';

    if (hasAudioWorklet) {
      await context.audioWorklet.addModule(workletUrl);
      if (generation !== activeGen) return false;
      const node = new AudioWorkletNode(context, 'dictation-capture-processor', {
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (generation !== activeGen || snapshot.phase !== 'recording') return;
        if (event.data instanceof Float32Array) {
          segmenter?.pushFrame(event.data);
        } else if (event.data instanceof ArrayBuffer) {
          segmenter?.pushFrame(new Float32Array(event.data));
        }
      };
      source.connect(node);
      node.connect(gain);
      workletNode = node;
    } else if (typeof context.createScriptProcessor === 'function') {
      installScriptProcessorFallback(context, source, gain, activeGen);
    }

    onCaptureReady?.((frame) => {
      if (generation === activeGen && snapshot.phase === 'recording') {
        segmenter?.pushFrame(frame);
      }
    });

    return generation === activeGen;
  };

  const ensureVadLoading = (activeGen: number) => {
    if (vadInstance || vadLoading || !sessionAbort) return;
    vadLoading = true;
    const signal = sessionAbort.signal;
    void loadVad(signal).then(
      (instance) => {
        vadLoading = false;
        if (generation !== activeGen || signal.aborted) {
          void instance.release().catch(() => undefined);
          return;
        }
        vadInstance = instance;
        void segmenter?.attachVad(instance);
      },
      () => {
        vadLoading = false;
        if (generation === activeGen && !signal.aborted) {
          segmenter?.markVadFailed();
        }
      }
    );
  };

  const start = async (): Promise<boolean> => {
    if (snapshot.phase !== 'idle') return false;
    pauseAllMediaElements();

    generation += 1;
    const activeGen = generation;
    sessionAbort = new AbortController();
    accumulatedMs = 0;
    recordingStartedAt = undefined;
    waveformSamples = [];
    records = [];
    segmenter = new DictationSegmenter({
      onSegment: (segment) => enqueueSegment(segment, activeGen),
      onCapReached: () => {
        void pauseWithReason('capReached');
      },
    });
    publish({
      phase: 'requesting',
      elapsedMs: 0,
      waveform: [],
      sampleCount: 0,
      capReached: false,
      interrupted: false,
      errorMessage: undefined,
    });

    try {
      const ok = await attachAudioPipeline(activeGen);
      if (!ok) return false;
      ensureVadLoading(activeGen);
      recordingStartedAt = now();
      publish({ phase: 'recording', elapsedMs: 0, errorMessage: undefined });
      startTimers(activeGen);
      return true;
    } catch (error) {
      if (generation === activeGen) {
        releaseAll(getVoiceRecorderErrorMessage(error));
      }
      return false;
    }
  };

  const pause = async (): Promise<void> => {
    await pauseWithReason('user');
  };

  const resume = async (): Promise<boolean> => {
    if (snapshot.phase !== 'paused' || snapshot.capReached) return false;
    pauseAllMediaElements();
    const activeGen = generation;
    publish({ phase: 'requesting', interrupted: false, errorMessage: undefined });

    try {
      const ok = await attachAudioPipeline(activeGen);
      if (!ok) return false;
      ensureVadLoading(activeGen);
      recordingStartedAt = now();
      publish({ phase: 'recording', errorMessage: undefined });
      startTimers(activeGen);
      return true;
    } catch (error) {
      if (generation === activeGen) {
        releaseCapture();
        publish({
          phase: 'paused',
          errorMessage: getVoiceRecorderErrorMessage(error),
        });
      }
      return false;
    }
  };

  const settleFinishOrRetry = async (activeGen: number): Promise<DictationFinishResult> => {
    await pumpQueue(activeGen);
    if (generation !== activeGen || sessionAbort?.signal.aborted) {
      return { status: 'cancelled' };
    }

    const failed = records.filter((item) => item.status === 'failed');
    if (failed.length === 0) {
      const text = stitchCompleted();
      releaseAll();
      return { status: 'completed', text };
    }

    const lastError = failed[failed.length - 1]?.error ?? 'Could not transcribe dictation audio.';
    const completedSegments = records.filter((item) => item.status === 'completed').length;
    publish({
      phase: 'failed',
      errorMessage: lastError,
    });
    return {
      status: 'failed',
      failedSegments: failed.length,
      completedSegments,
      errorMessage: lastError,
    };
  };

  const finish = async (): Promise<DictationFinishResult> => {
    if (snapshot.phase === 'requesting') {
      releaseAll();
      return { status: 'cancelled' };
    }
    if (snapshot.phase !== 'recording' && snapshot.phase !== 'paused') {
      return { status: 'cancelled' };
    }

    const activeGen = generation;
    accumulatedMs = currentElapsedMs();
    recordingStartedAt = undefined;
    releaseCapture();
    publish({ phase: 'finishing', elapsedMs: accumulatedMs, errorMessage: undefined });

    await segmenter?.flush('finish');
    if (generation !== activeGen || sessionAbort?.signal.aborted) {
      return { status: 'cancelled' };
    }

    // Wait for any already-queued/in-flight segments before retrying failures in order.
    await pumpQueue(activeGen);
    if (generation !== activeGen || sessionAbort?.signal.aborted) {
      return { status: 'cancelled' };
    }

    // Retry every failed segment once in chronological order.
    for (const record of records) {
      if (record.status === 'failed') {
        record.status = 'queued';
        record.autoRetried = true;
      }
    }
    publish();

    return settleFinishOrRetry(activeGen);
  };

  const retryFailed = async (): Promise<DictationFinishResult> => {
    if (snapshot.phase !== 'failed') return { status: 'cancelled' };
    const activeGen = generation;
    for (const record of records) {
      if (record.status === 'failed') {
        record.status = 'queued';
        record.autoRetried = true;
      }
    }
    publish({ phase: 'finishing', errorMessage: undefined });
    return settleFinishOrRetry(activeGen);
  };

  const takePartialText = (): string => {
    const text = stitchCompleted();
    releaseAll();
    return text;
  };

  const discard = () => {
    releaseAll();
  };

  const clearError = () => {
    if (snapshot.phase === 'idle' && snapshot.errorMessage !== undefined) {
      publish({ errorMessage: undefined });
    }
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
    pause,
    resume,
    finish,
    retryFailed,
    takePartialText,
    discard,
    clearError,
  };
};
