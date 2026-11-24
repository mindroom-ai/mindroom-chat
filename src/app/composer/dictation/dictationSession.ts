import { MindroomServerError } from '../../computer/clientSessions';
import { VOICE_WAVEFORM_SAMPLE_INTERVAL_MS } from '../../lib/audioWaveform';
import { pauseAllMediaElements } from '../../lib/dom';
import type { DictationJournalHandle, DictationJournalMeta } from '../capture/captureJournal';
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
  type DictationSegmentMeta,
  type RefinementGroup,
  type RefinementSegmentRecord,
  type SessionRecordSummary,
} from './dictationRefinement';
import { DictationSegmenter, encodePcm16Frames, type DictationSegment } from './dictationSegmenter';
import { loadSileroVad, type SileroVadInstance } from './sileroVad';
import { buildTrailingPrompt } from './stitchTranscript';

export type {
  DictationAudioCaptureOptions,
  DictationCaptureFactory,
  DictationCaptureHandle,
} from './dictationAudioCapture';

const MAX_WAVEFORM_SAMPLES = 1200;
const ELAPSED_TICK_MS = 250;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_FINISH_POLISH_TIMEOUT_MS = 4_000;
/** Flush delta PCM tail chunks roughly once per second (~10 * 96 ms = 960 ms). */
const TAIL_CHECKPOINT_FRAMES = 10;
const TRANSIENT_STATUSES = new Set([0, 429, 502, 503, 504]);
const NO_CLIENT_RETRY_MESSAGE = 'Open a room with dictation to retry.';

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
  recovered: boolean;
  hasClient: boolean;
  errorMessage?: string;
};

export type DictationFinishResult =
  | { status: 'completed'; text: string; journalId?: string }
  | { status: 'failed'; failedSegments: number; completedSegments: number; errorMessage: string }
  | { status: 'cancelled' };

export type DictationPartialTextResult = {
  text: string;
  journalId?: string;
};

export type DictationTranscriber = {
  readonly rateBudget?: DictationRateBudget;
  transcribe: (
    wav: Blob,
    opts?: { prompt?: string; roomId?: string },
    signal?: AbortSignal
  ) => Promise<DictationTranscribeResult>;
};

export type RecoveredDictationRecord = {
  segment: DictationSegmentMeta;
  wav?: Blob;
  status: 'queued' | 'completed' | 'failed';
  text?: string;
  error?: string;
  retryable: boolean;
};

export type RecoveredDictationState = {
  startedAt: number;
  elapsedMs: number;
  capReached: boolean;
  originApiUrl?: string;
  originRoomId?: string;
  records: RecoveredDictationRecord[];
  groups: RefinementGroup[];
  initialSegmentIndex: number;
  initialActiveFrames: number;
};

export type DictationSessionOptions = DictationAudioCaptureOptions & {
  client?: DictationTranscriber;
  rateBudget?: DictationRateBudget;
  roomId?: string;
  originApiUrl?: string;
  journal?: DictationJournalHandle;
  recovered?: RecoveredDictationState;
  maxActiveFrames?: number;
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
  takePartialText: () => DictationPartialTextResult;
  park: () => void;
  reset: () => void;
  discard: () => Promise<void>;
  attachClient: (client: DictationTranscriber, roomId?: string) => void;
  hasClient: () => boolean;
  getJournalId: () => string | undefined;
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

const idleSnapshot = (hasClient: boolean, errorMessage?: string): DictationSnapshot => ({
  phase: 'idle',
  elapsedMs: 0,
  waveform: [],
  sampleCount: 0,
  ...EMPTY_STATS,
  capReached: false,
  interrupted: false,
  recovered: false,
  hasClient,
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
    loadVad = loadSileroVad,
    now = () => Date.now(),
    sleep = defaultSleep,
    finishPolishTimeoutMs = DEFAULT_FINISH_POLISH_TIMEOUT_MS,
    maxActiveFrames,
    recovered,
  } = options;
  const captureFactory = options.captureFactory ?? createBrowserCaptureFactory(options);
  let activeClient: DictationTranscriber | undefined = options.client;
  let activeRoomId: string | undefined = options.roomId;
  const activeOriginApiUrl: string | undefined = options.originApiUrl ?? recovered?.originApiUrl;
  let journal: DictationJournalHandle | undefined = options.journal;
  let rateBudget = options.rateBudget ?? options.client?.rateBudget ?? createDictationRateBudget();

  const listeners = new Set<() => void>();
  let generation = 0;
  let captureGeneration = 0;
  let sessionAbort: AbortController | undefined;
  let captureAbort: AbortController | undefined;
  let finishPolishAbort: AbortController | undefined;
  let requestMode: 'start' | 'resume' | undefined;
  let segmenter: DictationSegmenter | undefined;
  let vadInstance: SileroVadInstance | undefined;
  let vadLoading = false;
  let activeCapture: DictationCaptureHandle | undefined;
  let pendingCaptureStop: Promise<void> | undefined;
  let flushingCapture = false;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let startedAt = recovered?.startedAt ?? now();
  let accumulatedMs = recovered?.elapsedMs ?? 0;
  let recordingStartedAt: number | undefined;
  let waveformSamples: number[] = [];
  let records: SegmentRecord[] = recovered
    ? recovered.records.map((rec) => ({
        segment: { ...rec.segment },
        wav: rec.wav,
        status: rec.status,
        text: rec.text,
        error: rec.error,
        retryable: rec.retryable,
        autoRetried: false,
      }))
    : [];
  let groups: RefinementGroup[] = recovered ? recovered.groups.map((group) => ({ ...group })) : [];
  let segmentStats: SessionRecordSummary = recovered
    ? summarizeSessionRecords(records, groups)
    : EMPTY_STATS;
  let nextInitialSegmentIndex = recovered?.initialSegmentIndex ?? 0;
  let nextInitialActiveFrames = recovered?.initialActiveFrames ?? 0;
  let tailFrames: Float32Array[] = [];
  let tailStartPos: number | undefined;
  let tailEndPos = 0;
  let tailSeq = 0;
  let queuePromise: Promise<void> | undefined;
  let deferQueuePumpDepth = 0;

  let snapshot: DictationSnapshot = recovered
    ? {
        ...idleSnapshot(Boolean(activeClient)),
        ...segmentStats,
        phase: 'paused',
        elapsedMs: accumulatedMs,
        capReached: recovered.capReached,
        recovered: true,
        hasClient: Boolean(activeClient),
      }
    : idleSnapshot(Boolean(activeClient));

  if (recovered) {
    generation = 1;
    sessionAbort = new AbortController();
    finishPolishAbort = new AbortController();
  }

  const emit = () => listeners.forEach((listener) => listener());
  const getPhase = (): DictationPhase => snapshot.phase;
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

  const buildJournalMeta = (): DictationJournalMeta => ({
    startedAt,
    elapsedMs: currentElapsedMs(),
    capReached: snapshot.capReached,
    ...(activeOriginApiUrl !== undefined ? { originApiUrl: activeOriginApiUrl } : {}),
    ...(activeRoomId !== undefined ? { originRoomId: activeRoomId } : {}),
    segments: records.map((record) => ({
      ...record.segment,
      status: record.status === 'uploading' ? 'queued' : record.status,
      ...(record.text !== undefined ? { text: record.text } : {}),
      ...(record.error !== undefined ? { error: record.error } : {}),
      retryable: record.retryable,
      hasWav: record.wav !== undefined,
    })),
    groups: groups.map((group) => ({
      startIndex: group.startIndex,
      endIndex: group.endIndex,
      state: group.state === 'uploading' ? 'queued' : group.state,
      ...(group.refinedText !== undefined ? { refinedText: group.refinedText } : {}),
      ...(group.refinedEndIndex !== undefined ? { refinedEndIndex: group.refinedEndIndex } : {}),
    })),
  });

  const checkpointState = (pruned?: readonly number[], clearAllTail?: boolean): Promise<void> => {
    if (!journal) return Promise.resolve();
    return journal
      .updateState(
        buildJournalMeta(),
        pruned && pruned.length > 0 ? pruned : undefined,
        clearAllTail
      )
      .catch(() => undefined);
  };

  const flushTailBuffer = () => {
    if (!journal || tailFrames.length === 0 || tailStartPos === undefined) return;
    const framesToWrite = tailFrames;
    const startPos = tailStartPos;
    const endPos = tailEndPos;
    tailFrames = [];
    tailStartPos = undefined;
    const seq = tailSeq;
    tailSeq += 1;
    const pcm16 = encodePcm16Frames(framesToWrite);
    void journal
      .appendTail(seq, pcm16, currentElapsedMs(), startPos, endPos)
      .catch(() => undefined);
  };

  const pruneTailBufferThrough = (consumedThroughPos: number | undefined) => {
    if (consumedThroughPos === undefined || tailFrames.length === 0 || tailStartPos === undefined) {
      return;
    }
    if (tailEndPos <= consumedThroughPos) {
      tailFrames = [];
      tailStartPos = undefined;
    } else if (tailStartPos < consumedThroughPos) {
      const drop = consumedThroughPos - tailStartPos;
      tailFrames = tailFrames.slice(drop);
      tailStartPos = consumedThroughPos;
    }
  };

  const publish = (patch: Partial<DictationSnapshot> = {}) => {
    snapshot = { ...snapshot, ...segmentStats, hasClient: Boolean(activeClient), ...patch };
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

  const cancelCaptureRequest = () => {
    captureGeneration += 1;
    captureAbort?.abort();
    captureAbort = undefined;
    requestMode = undefined;
  };

  const disposeActiveCapture = () => {
    stopTimer();
    cancelCaptureRequest();
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
    nextInitialSegmentIndex = 0;
    nextInitialActiveFrames = 0;
    tailFrames = [];
    tailStartPos = undefined;
    tailEndPos = 0;
    tailSeq = 0;
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
    snapshot = idleSnapshot(Boolean(activeClient), errorMessage);
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

  const sealOpenGroup = (prunedOut?: number[]): boolean => {
    const last = groups[groups.length - 1];
    return last ? sealRefinementGroup(last, records, prunedOut) : false;
  };

  const uploadOne = async (record: SegmentRecord, index: number, activeGen: number) => {
    const signal = sessionAbort?.signal;
    const client = activeClient;
    if (!signal || !client || isStale(activeGen)) return;
    const wav = record.wav;
    if (!wav) {
      record.error = 'Could not transcribe dictation audio.';
      record.retryable = false;
      record.status = 'failed';
      publishRecords();
      void checkpointState();
      return;
    }
    if (!(await waitUntil(rateBudget.retryNotBeforeMs - now(), signal, activeGen))) return;
    record.status = 'uploading';
    publishRecords();

    for (;;) {
      const prompt = promptBefore(index);
      try {
        recordDictationUpload(rateBudget, now(), record.segment.seconds);
        const result = await client.transcribe(wav, { prompt, roomId: activeRoomId }, signal);
        if (isStale(activeGen)) return;
        record.text = result.text;
        record.error = undefined;
        record.retryable = false;
        record.status = 'completed';
        const group = groups.find((item) => index >= item.startIndex && index <= item.endIndex);
        const pruned = group ? releaseGroupWavs(group, records) : [];
        publishRecords();
        void checkpointState(pruned);
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
        void checkpointState();
        return;
      }
    }
  };

  const uploadRefinement = async (group: RefinementGroup, targetEnd: number, activeGen: number) => {
    const signal = sessionAbort?.signal;
    const client = activeClient;
    if (!signal || !client || isStale(activeGen)) return;

    const failOpen = () => {
      if (isStale(activeGen)) return;
      group.uploadingEndIndex = undefined;
      group.mergedWav = undefined;
      group.mergedSeconds = undefined;
      let pruned: number[] = [];
      if (group.state === 'open') {
        group.liveFailedEndIndex = targetEnd;
      } else {
        group.state = 'fallback';
        pruned = releaseGroupWavs(group, records);
      }
      publishRecords();
      void checkpointState(pruned);
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
    const requestSignal = allUncoveredCompleted ? finishPolishAbort?.signal ?? signal : signal;
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
      const result = await client.transcribe(
        merged.wav,
        { prompt, roomId: activeRoomId },
        requestSignal
      );
      if (isStale(activeGen)) return;
      const cleaned = result.text.trim();
      if (!cleaned) {
        failOpen();
        return;
      }
      group.uploadingEndIndex = undefined;
      group.refinedText = cleaned;
      group.refinedEndIndex = targetEnd;
      const pruned: number[] = [];
      if (group.state === 'uploading') {
        group.state = 'open';
        sealRefinementGroup(group, records, pruned);
      }
      publishRecords();
      void checkpointState(pruned);
    } catch (error) {
      if (isStale(activeGen)) return;
      applyRetryAfter(error);
      failOpen();
    }
  };

  const pumpQueue = (activeGen: number): Promise<void> => {
    if (!activeClient) return Promise.resolve();
    if (queuePromise) return queuePromise;
    let done = false;
    const run = async () => {
      try {
        while (!isStale(activeGen) && activeClient) {
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
    const { wav, wavBuffer, consumedThroughFramePos, ...meta } = segment;
    records.push({ segment: meta, wav, status: 'queued', retryable: true, autoRetried: false });
    const pruned: number[] = [];
    appendSegmentToGroups(groups, records, pruned);
    publishRecords();
    pruneTailBufferThrough(consumedThroughFramePos);
    if (journal && wavBuffer) {
      const journalMeta = buildJournalMeta();
      void journal
        .commitSegment(meta.index, wavBuffer, journalMeta, consumedThroughFramePos)
        .catch(() => undefined);
      if (pruned.length > 0) {
        void journal.updateState(journalMeta, pruned).catch(() => undefined);
      }
      if (meta.cutReason === 'hard' && tailFrames.length > 0) {
        flushTailBuffer();
      }
    }
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
    tailFrames = [];
    tailStartPos = undefined;
    const pruned: number[] = [];
    sealOpenGroup(pruned);
    publishRecords();
    await checkpointState(pruned, true);
    return !isStale(activeGen);
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

  const createSegmenterForSession = (
    activeGen: number,
    initialSegmentIndex: number,
    initialActiveFrames: number
  ) =>
    new DictationSegmenter({
      initialSegmentIndex,
      initialActiveFrames,
      maxActiveFrames,
      onSegment: (segment) => enqueueSegment(segment, activeGen),
      onLongSilence: () => {
        if (isStale(activeGen)) return;
        const pruned: number[] = [];
        if (!sealOpenGroup(pruned)) return;
        publishRecords();
        void checkpointState(pruned);
        if (deferQueuePumpDepth === 0) void pumpQueue(activeGen);
      },
      onCapReached: () => {
        void pauseWithReason('capReached');
      },
    });

  const beginCapture = async (activeGen: number, mode: 'start' | 'resume'): Promise<boolean> => {
    captureGeneration += 1;
    const activeCaptureGen = captureGeneration;
    captureAbort?.abort();
    const requestAbort = new AbortController();
    captureAbort = requestAbort;
    requestMode = mode;

    try {
      const handle = await captureFactory({
        onFrame: (frame) => {
          if (generation === activeGen && (snapshot.phase === 'recording' || flushingCapture)) {
            const pos = segmenter?.pushFrame(frame);
            if (pos !== null && pos !== undefined && journal) {
              if (tailFrames.length === 0) tailStartPos = pos;
              tailFrames.push(frame);
              tailEndPos = pos + 1;
              if (tailFrames.length >= TAIL_CHECKPOINT_FRAMES) {
                flushTailBuffer();
              }
            }
          }
        },
        onTrackEnded: () => {
          if (generation === activeGen && snapshot.phase === 'recording') {
            void pauseWithReason('interrupted');
          }
        },
        signal: requestAbort.signal,
      });
      if (generation !== activeGen || captureGeneration !== activeCaptureGen) {
        handle.dispose();
        return false;
      }
      requestMode = undefined;
      captureAbort = undefined;
      activeCapture = handle;
      ensureVadLoading(activeGen);
      recordingStartedAt = now();
      publish({
        phase: 'recording',
        ...(mode === 'start' ? { elapsedMs: 0 } : { recovered: false }),
        errorMessage: undefined,
      });
      startTimer(activeGen, handle.readLevel);
      return true;
    } catch (error) {
      if (generation === activeGen && captureGeneration === activeCaptureGen) {
        requestMode = undefined;
        captureAbort = undefined;
        const message = describeCaptureError(error);
        if (mode === 'start') {
          const toRemove = journal;
          journal = undefined;
          releaseAll(message);
          if (toRemove) void toRemove.remove().catch(() => undefined);
        } else {
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

  const settleOffline = () => {
    const pruned: number[] = [];
    for (const group of groups) {
      if (group.state === 'refined') continue;
      const coveredEnd =
        group.refinedText && group.refinedEndIndex !== undefined
          ? group.refinedEndIndex
          : group.startIndex - 1;
      for (let i = Math.max(group.startIndex, coveredEnd + 1); i <= group.endIndex; i += 1) {
        const record = records[i];
        if (record && (record.status === 'queued' || record.status === 'failed')) {
          record.status = 'failed';
          record.retryable = true;
          record.error = NO_CLIENT_RETRY_MESSAGE;
        }
      }
      if (group.state === 'queued' || group.state === 'open') {
        group.mergedWav = undefined;
        group.mergedSeconds = undefined;
        group.state = 'fallback';
        pruned.push(...releaseGroupWavs(group, records));
      }
    }
    publishRecords();
    void checkpointState(pruned);
  };

  const settleFinishOrRetry = async (activeGen: number): Promise<DictationFinishResult> => {
    if (activeClient) {
      await pumpQueue(activeGen);
      if (isStale(activeGen)) return { status: 'cancelled' };
    } else {
      settleOffline();
      if (isStale(activeGen)) return { status: 'cancelled' };
    }

    const failed = records.filter(
      (item, index) => item.status === 'failed' && !isRecordCoveredByRefinement(groups, index)
    );
    if (failed.length === 0) {
      const text = stitchCompleted();
      const journalId = journal?.id;
      journal = undefined;
      releaseAll();
      return { status: 'completed', text, ...(journalId ? { journalId } : {}) };
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

  if (recovered && activeClient) {
    const initialGen = generation;
    queueMicrotask(() => {
      if (!isStale(initialGen) && activeClient && snapshot.phase === 'paused') {
        void pumpQueue(initialGen);
      }
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      if (snapshot.phase !== 'idle' || !activeClient) return Promise.resolve(false);
      pauseAllMediaElements();
      generation += 1;
      const activeGen = generation;
      sessionAbort = new AbortController();
      finishPolishAbort = new AbortController();
      resetRunState();
      startedAt = now();
      segmenter = createSegmenterForSession(activeGen, 0, 0);
      publish({ ...idleSnapshot(true), phase: 'requesting' });
      return beginCapture(activeGen, 'start');
    },
    pause: () => pauseWithReason('user'),
    resume: async () => {
      if (snapshot.phase !== 'paused' || snapshot.capReached || !activeClient) return false;
      const activeGen = generation;
      pauseAllMediaElements();
      if (!segmenter) {
        segmenter = createSegmenterForSession(
          activeGen,
          nextInitialSegmentIndex,
          nextInitialActiveFrames
        );
      }
      requestMode = 'resume';
      publish({ phase: 'requesting', interrupted: false, errorMessage: undefined });
      await flushAndStopActiveCapture();
      if (generation !== activeGen || getPhase() !== 'requesting') return false;
      return beginCapture(activeGen, 'resume');
    },
    finish: async () => {
      if (snapshot.phase === 'requesting') {
        if (requestMode === 'start') {
          const toRemove = journal;
          journal = undefined;
          releaseAll();
          if (toRemove) await toRemove.remove().catch(() => undefined);
          return { status: 'cancelled' };
        }
        cancelCaptureRequest();
      } else if (snapshot.phase !== 'recording' && snapshot.phase !== 'paused') {
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
        if (activeClient) {
          await pumpQueue(activeGen);
          if (isStale(activeGen)) return { status: 'cancelled' };
        }
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
      const journalId = journal?.id;
      journal = undefined;
      releaseAll();
      return { text, ...(journalId ? { journalId } : {}) };
    },
    park: () => {
      if (snapshot.phase === 'requesting') {
        if (requestMode === 'start') {
          const toRemove = journal;
          journal = undefined;
          releaseAll();
          if (toRemove) void toRemove.remove().catch(() => undefined);
          return;
        }
        cancelCaptureRequest();
        publish({ phase: 'paused' });
        return;
      }
      if (snapshot.phase === 'recording') {
        void pauseWithReason('user');
      }
    },
    reset: () => {
      if (snapshot.phase === 'recording') flushTailBuffer();
      const toRelease = journal;
      journal = undefined;
      releaseAll();
      toRelease?.release();
    },
    discard: async () => {
      const toRemove = journal;
      journal = undefined;
      releaseAll();
      if (toRemove) await toRemove.remove();
    },
    attachClient: (nextClient, nextRoomId) => {
      if (snapshot.phase === 'idle' || activeClient !== undefined) return;
      activeClient = nextClient;
      if (nextRoomId !== undefined) activeRoomId = nextRoomId;
      if (!options.rateBudget && nextClient.rateBudget) {
        rateBudget = nextClient.rateBudget;
      }
      publish({ hasClient: true });
      if (snapshot.phase === 'paused' && !isStale(generation)) {
        void pumpQueue(generation);
      }
    },
    hasClient: () => activeClient !== undefined,
    getJournalId: () => journal?.id,
    clearError: () => {
      if (snapshot.phase === 'idle' && snapshot.errorMessage !== undefined) {
        publish({ errorMessage: undefined });
      }
    },
  };
};
