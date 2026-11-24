import { MindroomServerError } from '../../computer/clientSessions';
import { VOICE_WAVEFORM_SAMPLE_INTERVAL_MS } from '../../lib/audioWaveform';
import { pauseAllMediaElements } from '../../lib/dom';
import { DictationApiError, type DictationTranscribeResult } from './api';
import {
  createBrowserCaptureFactory,
  describeCaptureError,
  type DictationAudioCaptureOptions,
  type DictationCaptureFactory,
  type DictationCaptureHandle,
} from './dictationAudioCapture';
import {
  appendSegmentToGroups,
  canAffordRefinement,
  pruneUploadHistory,
  sealRefinementGroup,
  stitchRefinedSegments,
  type RefinementGroup,
  type UploadHistoryEntry,
} from './dictationRefinement';
import { DictationSegmenter, type DictationSegment } from './dictationSegmenter';
import { loadSileroVad, type SileroVadInstance } from './sileroVad';
import { buildTrailingPrompt } from './stitchTranscript';

const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_FINISH_POLISH_TIMEOUT_MS = 4_000;
const ELAPSED_TICK_MS = 250;
const MAX_WAVEFORM_SAMPLES = 1200;
const TRANSIENT_STATUSES = new Set([0, 429, 502, 503, 504]);

export type { DictationCaptureFactory, DictationCaptureHandle } from './dictationAudioCapture';
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
  previewText: string;
  capReached: boolean;
  interrupted: boolean;
  errorMessage?: string;
};

export type DictationFinishResult =
  | { status: 'completed'; text: string }
  | { status: 'failed'; failedSegments: number; completedSegments: number; errorMessage: string }
  | { status: 'cancelled' };

export type DictationTranscriber = {
  transcribe: (
    wav: Blob,
    opts?: { prompt?: string; roomId?: string },
    signal?: AbortSignal
  ) => Promise<DictationTranscribeResult>;
};

export type DictationSessionOptions = DictationAudioCaptureOptions & {
  client: DictationTranscriber;
  roomId?: string;
  loadVad?: (signal?: AbortSignal) => Promise<SileroVadInstance>;
  captureFactory?: DictationCaptureFactory;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  finishPolishTimeoutMs?: number;
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

type SegmentRecord = {
  segment: DictationSegment;
  status: 'queued' | 'uploading' | 'completed' | 'failed';
  text?: string;
  error?: string;
  retryable: boolean;
  autoRetried: boolean;
};

type SegmentStats = Pick<
  DictationSnapshot,
  'pendingUploads' | 'failedSegments' | 'completedSegments' | 'hasPartialText' | 'previewText'
>;

const EMPTY_STATS: SegmentStats = {
  pendingUploads: 0,
  failedSegments: 0,
  completedSegments: 0,
  hasPartialText: false,
  previewText: '',
};

const idleSnapshot = (errorMessage?: string): DictationSnapshot => ({
  phase: 'idle',
  elapsedMs: 0,
  waveform: [],
  sampleCount: 0,
  ...EMPTY_STATS,
  capReached: false,
  interrupted: false,
  errorMessage,
});

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

const isTransientUploadError = (error: unknown): boolean =>
  !(error instanceof MindroomServerError) || TRANSIENT_STATUSES.has(error.status);

const describeUploadError = (error: unknown): string =>
  error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Could not transcribe dictation audio.';

export const createDictationSession = (options: DictationSessionOptions): DictationSession => {
  const {
    client,
    roomId,
    loadVad = loadSileroVad,
    now = () => Date.now(),
    sleep = defaultSleep,
    finishPolishTimeoutMs = DEFAULT_FINISH_POLISH_TIMEOUT_MS,
  } = options;
  const captureFactory = options.captureFactory ?? createBrowserCaptureFactory(options);

  const listeners = new Set<() => void>();
  const uploadHistory: UploadHistoryEntry[] = [];
  let snapshot: DictationSnapshot = idleSnapshot();
  let generation = 0;
  let sessionAbort: AbortController | undefined;
  let segmenter: DictationSegmenter | undefined;
  let vadInstance: SileroVadInstance | undefined;
  let vadLoading = false;
  let activeCapture: DictationCaptureHandle | undefined;
  let pendingCaptureStop: Promise<void> | undefined;
  let flushingCapture = false;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let accumulatedMs = 0;
  let recordingStartedAt: number | undefined;
  let waveformSamples: number[] = [];
  let records: SegmentRecord[] = [];
  let groups: RefinementGroup[] = [];
  let segmentStats: SegmentStats = EMPTY_STATS;
  let retryNotBeforeMs = 0;
  let queuePromise: Promise<void> | undefined;
  let deferQueuePumpDepth = 0;
  let armActivePolishTimeout: (() => void) | undefined;

  const emit = () => listeners.forEach((listener) => listener());
  const isStale = (activeGen: number) =>
    generation !== activeGen || Boolean(sessionAbort?.signal.aborted);

  const findGroupForRecord = (index: number): RefinementGroup | undefined =>
    groups.find((group) => index >= group.startIndex && index <= group.endIndex);

  const isRecordCovered = (index: number): boolean =>
    findGroupForRecord(index)?.state === 'refined';

  const stitchCompleted = (limit = records.length): string =>
    stitchRefinedSegments(records, groups, limit);

  const recordUpload = (seconds: number) => {
    const atMs = now();
    pruneUploadHistory(uploadHistory, atMs);
    uploadHistory.push({ atMs, seconds });
  };

  const applyRetryAfter = (error: unknown): number | undefined => {
    const retryAfterMs =
      error instanceof DictationApiError && error.status === 429 ? error.retryAfterMs : undefined;
    if (retryAfterMs !== undefined) {
      retryNotBeforeMs = Math.max(retryNotBeforeMs, now() + retryAfterMs);
    }
    return retryAfterMs;
  };

  const currentElapsedMs = (): number =>
    recordingStartedAt === undefined
      ? accumulatedMs
      : Math.max(0, Math.round(accumulatedMs + (now() - recordingStartedAt)));

  const publish = (patch: Partial<DictationSnapshot> = {}) => {
    snapshot = { ...snapshot, ...segmentStats, ...patch };
    emit();
  };

  const publishRecords = (patch: Partial<DictationSnapshot> = {}) => {
    let pendingUploads = 0;
    let failedSegments = 0;
    let completedSegments = 0;
    for (const group of groups) {
      if (group.state === 'refined') {
        completedSegments += group.endIndex - group.startIndex + 1;
        continue;
      }
      const refining = group.state === 'queued' || group.state === 'uploading';
      if (refining) pendingUploads += 1;
      for (let i = group.startIndex; i <= group.endIndex; i += 1) {
        const record = records[i];
        if (!record) continue;
        if (record.status === 'uploading' || (!refining && record.status === 'queued')) {
          pendingUploads += 1;
        } else if (record.status === 'failed') failedSegments += 1;
        else if (record.status === 'completed') completedSegments += 1;
      }
    }
    const previewText = stitchCompleted();
    segmentStats = {
      pendingUploads,
      failedSegments,
      completedSegments,
      hasPartialText: previewText.length > 0,
      previewText,
    };
    publish(patch);
  };

  const stopTimer = () => {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
  };

  const disposeActiveCapture = () => {
    stopTimer();
    flushingCapture = false;
    pendingCaptureStop = undefined;
    activeCapture?.dispose();
    activeCapture = undefined;
  };

  const flushAndStopActiveCapture = (): Promise<void> => {
    if (pendingCaptureStop) return pendingCaptureStop;
    stopTimer();
    const handle = activeCapture;
    activeCapture = undefined;
    if (!handle) return Promise.resolve();
    flushingCapture = true;
    pendingCaptureStop = handle.stopAndFlush().finally(() => {
      flushingCapture = false;
      pendingCaptureStop = undefined;
    });
    return pendingCaptureStop;
  };

  const resetRunState = () => {
    accumulatedMs = 0;
    recordingStartedAt = undefined;
    waveformSamples = [];
    records = [];
    groups = [];
    segmentStats = EMPTY_STATS;
    retryNotBeforeMs = 0;
    queuePromise = undefined;
    deferQueuePumpDepth = 0;
    armActivePolishTimeout = undefined;
  };

  const releaseAll = (errorMessage?: string) => {
    generation += 1;
    sessionAbort?.abort();
    sessionAbort = undefined;
    disposeActiveCapture();
    segmenter?.clear();
    segmenter = undefined;
    if (vadInstance) {
      const toRelease = vadInstance;
      vadInstance = undefined;
      void toRelease.release().catch(() => undefined);
    }
    vadLoading = false;
    resetRunState();
    snapshot = idleSnapshot(errorMessage);
    emit();
  };

  const startTimer = (activeGen: number, readLevel?: () => number) => {
    stopTimer();
    const tick = () => {
      if (generation !== activeGen || snapshot.phase !== 'recording') return;
      if (!readLevel) {
        publish({ elapsedMs: currentElapsedMs() });
        return;
      }
      waveformSamples = [...waveformSamples, readLevel()].slice(-MAX_WAVEFORM_SAMPLES);
      publish({
        waveform: waveformSamples,
        sampleCount: snapshot.sampleCount + 1,
        elapsedMs: currentElapsedMs(),
      });
    };
    tickTimer = setInterval(tick, readLevel ? VOICE_WAVEFORM_SAMPLE_INTERVAL_MS : ELAPSED_TICK_MS);
    if (readLevel) tick();
  };

  const waitUntil = async (
    delayMs: number,
    signal: AbortSignal,
    activeGen: number
  ): Promise<boolean> => {
    if (delayMs <= 0) return !isStale(activeGen);
    try {
      await sleep(delayMs, signal);
    } catch {
      return false;
    }
    return !isStale(activeGen);
  };

  const sealOpenGroup = () => {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup) {
      sealRefinementGroup(
        lastGroup,
        records.map((item) => item.segment)
      );
    }
  };

  const uploadOne = async (record: SegmentRecord, index: number, activeGen: number) => {
    const signal = sessionAbort?.signal;
    if (!signal || isStale(activeGen)) return;
    if (
      retryNotBeforeMs > now() &&
      !(await waitUntil(retryNotBeforeMs - now(), signal, activeGen))
    ) {
      return;
    }
    record.status = 'uploading';
    publishRecords();

    for (;;) {
      const prompt = index === 0 ? undefined : buildTrailingPrompt(stitchCompleted(index), 200);
      try {
        recordUpload(record.segment.seconds);
        const result = await client.transcribe(record.segment.wav, { prompt, roomId }, signal);
        if (isStale(activeGen)) return;
        record.text = result.text;
        record.error = undefined;
        record.retryable = false;
        record.status = 'completed';
        publishRecords();
        return;
      } catch (error) {
        if (isStale(activeGen)) return;
        const transient = isTransientUploadError(error);
        const retryAfterMs = applyRetryAfter(error);
        record.error = describeUploadError(error);
        record.retryable = transient;

        if (transient && !record.autoRetried && snapshot.phase !== 'finishing') {
          record.autoRetried = true;
          const delay =
            retryAfterMs !== undefined
              ? Math.max(0, retryNotBeforeMs - now())
              : DEFAULT_RETRY_DELAY_MS;
          if (!(await waitUntil(delay, signal, activeGen))) return;
          continue;
        }

        record.status = 'failed';
        publishRecords();
        return;
      }
    }
  };

  const uploadRefinement = async (group: RefinementGroup, activeGen: number) => {
    const signal = sessionAbort?.signal;
    const mergedWav = group.mergedWav;
    const mergedSeconds = group.mergedSeconds ?? 0;
    if (!signal || isStale(activeGen)) return;

    const failOpen = () => {
      if (isStale(activeGen)) return;
      group.mergedWav = undefined;
      group.state = 'fallback';
      publishRecords();
    };
    if (!mergedWav) {
      failOpen();
      return;
    }

    const allCompleted = records
      .slice(group.startIndex, group.endIndex + 1)
      .every((item) => item.status === 'completed');

    let requestSignal: AbortSignal = signal;
    let cleanupSignal: (() => void) | undefined;
    if (allCompleted) {
      const requestAbort = new AbortController();
      const onSessionAbort = () => requestAbort.abort();
      signal.addEventListener('abort', onSessionAbort, { once: true });
      requestSignal = requestAbort.signal;

      let timeoutAbort: AbortController | undefined;
      const startPolishTimer = () => {
        if (timeoutAbort || requestAbort.signal.aborted) return;
        timeoutAbort = new AbortController();
        void sleep(finishPolishTimeoutMs, timeoutAbort.signal).then(
          () => requestAbort.abort(),
          () => undefined
        );
      };
      if (snapshot.phase === 'finishing') startPolishTimer();
      armActivePolishTimeout = startPolishTimer;
      cleanupSignal = () => {
        if (armActivePolishTimeout === startPolishTimer) armActivePolishTimeout = undefined;
        timeoutAbort?.abort();
        signal.removeEventListener('abort', onSessionAbort);
      };
    }

    try {
      if (
        retryNotBeforeMs > now() &&
        !(await waitUntil(retryNotBeforeMs - now(), requestSignal, activeGen))
      ) {
        failOpen();
        return;
      }
      group.state = 'uploading';
      publishRecords();

      const prompt =
        group.startIndex === 0
          ? undefined
          : buildTrailingPrompt(stitchCompleted(group.startIndex), 200);
      recordUpload(mergedSeconds);

      const result = await client.transcribe(mergedWav, { prompt, roomId }, requestSignal);
      if (isStale(activeGen)) return;
      group.mergedWav = undefined;
      const cleaned = result.text.trim();
      if (cleaned.length > 0) {
        group.refinedText = cleaned;
        group.state = 'refined';
      } else {
        group.state = 'fallback';
      }
      publishRecords();
    } catch (error) {
      if (isStale(activeGen)) return;
      applyRetryAfter(error);
      failOpen();
    } finally {
      cleanupSignal?.();
    }
  };

  const pumpQueue = (activeGen: number): Promise<void> => {
    if (queuePromise) return queuePromise;
    let done = false;
    const run = async () => {
      try {
        while (!isStale(activeGen)) {
          const nextGroup = groups.find((group) => group.state === 'queued');
          if (nextGroup) {
            if (!canAffordRefinement(uploadHistory, now(), nextGroup.mergedSeconds ?? 0)) {
              nextGroup.state = 'fallback';
              nextGroup.mergedWav = undefined;
              publishRecords();
              continue;
            }
            await uploadRefinement(nextGroup, activeGen);
            continue;
          }

          const nextIndex = records.findIndex((item, index) => {
            if (item.status !== 'queued') return false;
            const state = findGroupForRecord(index)?.state;
            return (
              state !== 'queued' &&
              state !== 'uploading' &&
              state !== 'refined' &&
              !(deferQueuePumpDepth > 0 && state === 'open')
            );
          });
          if (nextIndex === -1) break;
          const nextRecord = records[nextIndex];
          if (!nextRecord) break;
          await uploadOne(nextRecord, nextIndex, activeGen);
        }
      } finally {
        done = true;
        queuePromise = undefined;
      }
    };
    const promise = run();
    if (!done) queuePromise = promise;
    return promise;
  };

  const enqueueSegment = (segment: DictationSegment, activeGen: number) => {
    if (isStale(activeGen)) return;
    records.push({ segment, status: 'queued', retryable: true, autoRetried: false });
    appendSegmentToGroups(
      groups,
      records.map((item) => item.segment)
    );
    publishRecords();
    if (deferQueuePumpDepth === 0) void pumpQueue(activeGen);
  };

  const ensureVadLoading = (activeGen: number) => {
    if (vadInstance || vadLoading || !sessionAbort) return;
    vadLoading = true;
    const signal = sessionAbort.signal;
    void loadVad(signal).then(
      (instance) => {
        vadLoading = false;
        if (isStale(activeGen)) {
          void instance.release().catch(() => undefined);
          return;
        }
        vadInstance = instance;
        void segmenter?.attachVad(instance);
      },
      () => {
        vadLoading = false;
        if (!isStale(activeGen)) void segmenter?.markVadFailed();
      }
    );
  };

  const flushAndSeal = async (activeGen: number): Promise<boolean> => {
    deferQueuePumpDepth += 1;
    try {
      await flushAndStopActiveCapture();
      if (isStale(activeGen)) return false;
      await segmenter?.flush();
      if (isStale(activeGen)) return false;
    } finally {
      deferQueuePumpDepth = Math.max(0, deferQueuePumpDepth - 1);
    }
    sealOpenGroup();
    publishRecords();
    return true;
  };

  const pauseWithReason = async (reason: 'user' | 'interrupted' | 'capReached'): Promise<void> => {
    if (snapshot.phase !== 'recording') return;
    const activeGen = generation;
    accumulatedMs = currentElapsedMs();
    recordingStartedAt = undefined;
    publish({
      phase: 'paused',
      elapsedMs: accumulatedMs,
      capReached: reason === 'capReached' ? true : snapshot.capReached,
      interrupted: reason === 'interrupted' ? true : snapshot.interrupted,
    });
    if (!(await flushAndSeal(activeGen))) return;
    vadInstance?.reset();
    void pumpQueue(activeGen);
  };

  const beginCapture = async (activeGen: number, mode: 'start' | 'resume'): Promise<boolean> => {
    try {
      const handle = await captureFactory({
        onFrame: (frame) => {
          if (generation === activeGen && (snapshot.phase === 'recording' || flushingCapture)) {
            segmenter?.pushFrame(frame);
          }
        },
        onTrackEnded: () => {
          if (generation === activeGen && snapshot.phase === 'recording') {
            void pauseWithReason('interrupted');
          }
        },
        signal: sessionAbort?.signal,
      });
      if (generation !== activeGen) {
        handle.dispose();
        return false;
      }
      activeCapture = handle;
      ensureVadLoading(activeGen);
      recordingStartedAt = now();
      publish({
        phase: 'recording',
        ...(mode === 'start' ? { elapsedMs: 0 } : {}),
        errorMessage: undefined,
      });
      startTimer(activeGen, handle.readLevel);
      return true;
    } catch (error) {
      if (generation === activeGen) {
        const message = describeCaptureError(error);
        if (mode === 'start') releaseAll(message);
        else {
          disposeActiveCapture();
          publish({ phase: 'paused', errorMessage: message });
        }
      }
      return false;
    }
  };

  const requeueFailedSegments = (onlyRetryable: boolean, patch?: Partial<DictationSnapshot>) => {
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      if (
        record &&
        record.status === 'failed' &&
        !isRecordCovered(i) &&
        (!onlyRetryable || record.retryable)
      ) {
        record.status = 'queued';
        record.autoRetried = true;
      }
    }
    publishRecords(patch);
  };

  const settleFinishOrRetry = async (activeGen: number): Promise<DictationFinishResult> => {
    await pumpQueue(activeGen);
    if (isStale(activeGen)) return { status: 'cancelled' };
    const failed = records.filter(
      (item, index) => item.status === 'failed' && !isRecordCovered(index)
    );
    if (failed.length === 0) {
      const text = stitchCompleted();
      releaseAll();
      return { status: 'completed', text };
    }
    const lastError = failed[failed.length - 1]?.error ?? 'Could not transcribe dictation audio.';
    publish({ phase: 'failed', errorMessage: lastError });
    return {
      status: 'failed',
      failedSegments: failed.length,
      completedSegments: segmentStats.completedSegments,
      errorMessage: lastError,
    };
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      if (snapshot.phase !== 'idle') return Promise.resolve(false);
      pauseAllMediaElements();
      generation += 1;
      const activeGen = generation;
      sessionAbort = new AbortController();
      resetRunState();
      segmenter = new DictationSegmenter({
        onSegment: (segment) => enqueueSegment(segment, activeGen),
        onLongSilence: () => {
          if (isStale(activeGen)) return;
          const last = groups[groups.length - 1];
          if (last?.state === 'open' && last.endIndex - last.startIndex + 1 >= 2) {
            sealOpenGroup();
            publishRecords();
            if (deferQueuePumpDepth === 0) void pumpQueue(activeGen);
          }
        },
        onCapReached: () => {
          void pauseWithReason('capReached');
        },
      });
      publish({ ...idleSnapshot(), phase: 'requesting' });
      return beginCapture(activeGen, 'start');
    },
    pause: () => pauseWithReason('user'),
    resume: async () => {
      if (snapshot.phase !== 'paused' || snapshot.capReached) return false;
      const activeGen = generation;
      pauseAllMediaElements();
      publish({ phase: 'requesting', interrupted: false, errorMessage: undefined });
      await flushAndStopActiveCapture();
      if (generation !== activeGen) return false;
      return beginCapture(activeGen, 'resume');
    },
    finish: async () => {
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
      publish({ phase: 'finishing', elapsedMs: accumulatedMs, errorMessage: undefined });
      armActivePolishTimeout?.();
      if (!(await flushAndSeal(activeGen))) return { status: 'cancelled' };
      await pumpQueue(activeGen);
      if (isStale(activeGen)) return { status: 'cancelled' };
      requeueFailedSegments(true);
      return settleFinishOrRetry(activeGen);
    },
    retryFailed: () => {
      if (snapshot.phase !== 'failed') return Promise.resolve({ status: 'cancelled' });
      requeueFailedSegments(false, { phase: 'finishing', errorMessage: undefined });
      return settleFinishOrRetry(generation);
    },
    takePartialText: () => {
      const text = stitchCompleted();
      releaseAll();
      return text;
    },
    discard: () => releaseAll(),
    clearError: () => {
      if (snapshot.phase === 'idle' && snapshot.errorMessage !== undefined) {
        publish({ errorMessage: undefined });
      }
    },
  };
};
