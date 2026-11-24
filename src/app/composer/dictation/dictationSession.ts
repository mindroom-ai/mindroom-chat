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
  buildGroupMergedWav,
  canAffordRefinement,
  createDictationRateBudget,
  isRecordCoveredByRefinement,
  recordDictationUpload,
  releaseGroupWavs,
  sealRefinementGroup,
  selectNextUpload,
  stitchRefinedSegments,
  summarizeSessionRecords,
  type DictationRateBudget,
  type RefinementGroup,
  type RefinementSegmentRecord,
  type SessionRecordSummary,
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
  'idle' | 'requesting' | 'recording' | 'paused' | 'finishing' | 'failed';

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
  readonly rateBudget?: DictationRateBudget;
  transcribe: (
    wav: Blob,
    opts?: { prompt?: string; roomId?: string },
    signal?: AbortSignal
  ) => Promise<DictationTranscribeResult>;
};

export type DictationSessionOptions = DictationAudioCaptureOptions & {
  client: DictationTranscriber;
  rateBudget?: DictationRateBudget;
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

type SegmentRecord = RefinementSegmentRecord & {
  error?: string;
  retryable: boolean;
  autoRetried: boolean;
};

const EMPTY_STATS: SessionRecordSummary = {
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
  const rateBudget = options.rateBudget ?? client.rateBudget ?? createDictationRateBudget();

  const listeners = new Set<() => void>();
  let snapshot: DictationSnapshot = idleSnapshot();
  let generation = 0;
  let sessionAbort: AbortController | undefined;
  let finishPolishAbort: AbortController | undefined;
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
  let segmentStats: SessionRecordSummary = EMPTY_STATS;
  let queuePromise: Promise<void> | undefined;
  let deferQueuePumpDepth = 0;

  const emit = () => listeners.forEach((listener) => listener());
  const isStale = (activeGen: number) =>
    generation !== activeGen || Boolean(sessionAbort?.signal.aborted);
  const stitchCompleted = (limit = records.length): string =>
    stitchRefinedSegments(records, groups, limit);
  const promptBefore = (index: number): string | undefined =>
    index === 0 ? undefined : buildTrailingPrompt(stitchCompleted(index), 200);

  const applyRetryAfter = (error: unknown): number | undefined => {
    const retryAfterMs =
      error instanceof DictationApiError && error.status === 429 ? error.retryAfterMs : undefined;
    if (retryAfterMs !== undefined) {
      rateBudget.retryNotBeforeMs = Math.max(rateBudget.retryNotBeforeMs, now() + retryAfterMs);
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
    segmentStats = summarizeSessionRecords(records, groups);
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
    queuePromise = undefined;
    deferQueuePumpDepth = 0;
  };

  const releaseAll = (errorMessage?: string) => {
    generation += 1;
    sessionAbort?.abort();
    finishPolishAbort?.abort();
    sessionAbort = undefined;
    finishPolishAbort = undefined;
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

  const sealOpenGroup = (): boolean => {
    const last = groups[groups.length - 1];
    return last ? sealRefinementGroup(last, records) : false;
  };

  const uploadOne = async (record: SegmentRecord, index: number, activeGen: number) => {
    const signal = sessionAbort?.signal;
    if (!signal || isStale(activeGen)) return;
    const wav = record.wav;
    if (!wav) {
      record.error = 'Could not transcribe dictation audio.';
      record.retryable = false;
      record.status = 'failed';
      publishRecords();
      return;
    }
    if (!(await waitUntil(rateBudget.retryNotBeforeMs - now(), signal, activeGen))) return;
    record.status = 'uploading';
    publishRecords();

    for (;;) {
      const prompt = promptBefore(index);
      try {
        recordDictationUpload(rateBudget, now(), record.segment.seconds);
        const result = await client.transcribe(wav, { prompt, roomId }, signal);
        if (isStale(activeGen)) return;
        record.text = result.text;
        record.error = undefined;
        record.retryable = false;
        record.status = 'completed';
        const group = groups.find((item) => index >= item.startIndex && index <= item.endIndex);
        if (group) releaseGroupWavs(group, records);
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
              ? Math.max(0, rateBudget.retryNotBeforeMs - now())
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

  const uploadRefinement = async (group: RefinementGroup, targetEnd: number, activeGen: number) => {
    const signal = sessionAbort?.signal;
    if (!signal || isStale(activeGen)) return;

    const failOpen = () => {
      if (isStale(activeGen)) return;
      group.uploadingEndIndex = undefined;
      group.mergedWav = undefined;
      group.mergedSeconds = undefined;
      if (group.state === 'open') {
        group.liveFailedEndIndex = targetEnd;
      } else {
        group.state = 'fallback';
        releaseGroupWavs(group, records);
      }
      publishRecords();
    };
    const merged =
      group.mergedWav && group.mergedSeconds !== undefined
        ? { wav: group.mergedWav, seconds: group.mergedSeconds }
        : buildGroupMergedWav(records, group.startIndex, targetEnd);
    const firstUncovered = Math.max(
      group.startIndex,
      group.refinedText && group.refinedEndIndex !== undefined ? group.refinedEndIndex + 1 : 0
    );
    const allUncoveredCompleted = records
      .slice(firstUncovered, targetEnd + 1)
      .every((item) => item.status === 'completed');
    const requestSignal = allUncoveredCompleted ? (finishPolishAbort?.signal ?? signal) : signal;
    if (
      !merged ||
      requestSignal.aborted ||
      !canAffordRefinement(rateBudget.uploadHistory, now(), merged.seconds)
    ) {
      failOpen();
      return;
    }

    group.uploadingEndIndex = targetEnd;
    group.mergedWav = undefined;
    group.mergedSeconds = undefined;
    if (group.state === 'queued') group.state = 'uploading';
    publishRecords();

    try {
      if (!(await waitUntil(rateBudget.retryNotBeforeMs - now(), requestSignal, activeGen))) {
        failOpen();
        return;
      }
      const prompt = promptBefore(group.startIndex);
      recordDictationUpload(rateBudget, now(), merged.seconds);
      const result = await client.transcribe(merged.wav, { prompt, roomId }, requestSignal);
      if (isStale(activeGen)) return;
      const cleaned = result.text.trim();
      if (!cleaned) {
        failOpen();
        return;
      }
      group.uploadingEndIndex = undefined;
      group.refinedText = cleaned;
      group.refinedEndIndex = targetEnd;
      if (group.state === 'uploading') {
        group.state = 'open';
        sealRefinementGroup(group, records);
      }
      publishRecords();
    } catch (error) {
      if (isStale(activeGen)) return;
      applyRetryAfter(error);
      failOpen();
    }
  };

  const pumpQueue = (activeGen: number): Promise<void> => {
    if (queuePromise) return queuePromise;
    let done = false;
    const run = async () => {
      try {
        while (!isStale(activeGen)) {
          const next = selectNextUpload(records, groups, deferQueuePumpDepth > 0);
          if (!next) break;
          if (next.kind === 'refinement') {
            await uploadRefinement(next.group, next.endIndex, activeGen);
          } else {
            const record = records[next.index];
            if (record) await uploadOne(record, next.index, activeGen);
          }
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
    const { wav, ...meta } = segment;
    records.push({ segment: meta, wav, status: 'queued', retryable: true, autoRetried: false });
    appendSegmentToGroups(groups, records);
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
        record?.status === 'failed' &&
        !isRecordCoveredByRefinement(groups, i) &&
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
      (item, index) => item.status === 'failed' && !isRecordCoveredByRefinement(groups, index)
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
      finishPolishAbort = new AbortController();
      resetRunState();
      segmenter = new DictationSegmenter({
        onSegment: (segment) => enqueueSegment(segment, activeGen),
        onLongSilence: () => {
          if (isStale(activeGen) || !sealOpenGroup()) return;
          publishRecords();
          if (deferQueuePumpDepth === 0) void pumpQueue(activeGen);
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

      const polishAbort = finishPolishAbort;
      const polishTimer = polishAbort
        ? setTimeout(() => polishAbort.abort(), finishPolishTimeoutMs)
        : undefined;
      try {
        if (!(await flushAndSeal(activeGen))) return { status: 'cancelled' };
        await pumpQueue(activeGen);
        if (isStale(activeGen)) return { status: 'cancelled' };
        requeueFailedSegments(true);
        return await settleFinishOrRetry(activeGen);
      } finally {
        if (polishTimer !== undefined) clearTimeout(polishTimer);
      }
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
