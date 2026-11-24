import { useEffect } from 'react';
import { atom, useStore, type createStore } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { isJoined } from '../../matrix/state/roomList';
import { useOptionalClientConfig, type ClientConfig } from '../../config/useClientConfig';
import { clientSessions } from '../../computer/clientSessions';
import { resolveComputerApiUrl } from '../../computer/api';
import { trustedServerOrigins } from '../../computer/agentServer';
import {
  computerServicePreferenceAtom,
  resolveComputerServiceUrl,
} from '../../computer/computerServiceSettings';
import {
  beginLiveCapture,
  captureAccountGuard,
  liveCaptureAtom,
  restoreLiveCapture,
} from '../capture/liveCapture';
import {
  beginDictationJournal,
  recoverDictationJournal,
  type DictationJournalHandle,
  type DictationJournalMeta,
  type RecoveredDictationJournal,
} from '../capture/captureJournal';
import { DictationClient } from './api';
import {
  appendSegmentToGroups,
  sealRefinementGroup,
  summarizeSessionRecords,
  type RefinementGroup,
} from './dictationRefinement';
import {
  decodePcm16Frames,
  DICTATION_FRAME_MS,
  DICTATION_FRAME_SAMPLES,
  DICTATION_MAX_ACTIVE_FRAMES,
  DICTATION_SAMPLE_RATE,
  DictationSegmenter,
  type DictationSegment,
} from './dictationSegmenter';
import {
  createDictationSession,
  type DictationSession,
  type DictationSessionOptions,
  type DictationTranscriber,
  type RecoveredDictationRecord,
} from './dictationSession';

type JotaiStore = ReturnType<typeof createStore>;

export type StartLiveDictationOptions = Omit<
  DictationSessionOptions,
  'journal' | 'recovered' | 'originApiUrl'
> & {
  userId?: string;
  originApiUrl?: string;
  createSession?: (options: DictationSessionOptions) => DictationSession;
};

export type RecoverDictationOptions = {
  createSession?: (options: DictationSessionOptions) => DictationSession;
};

/**
 * Per-account dictation restore tracking (missing = not started, Promise = in flight, null = settled),
 * mirroring `voiceDraftRestoresAtom` in `savedVoiceDraft.ts`.
 */
export const dictationRestoresAtom = atom<ReadonlyMap<string, Promise<void> | null>>(new Map());

/**
 * Tracks the `captureAccountGuard` under which each userId's restore ran in a store so switching
 * accounts A -> B -> A triggers a fresh recovery for A without coupling shell cleanup to this module.
 */
const restoreGuards = new WeakMap<JotaiStore, Map<string, () => boolean>>();

/**
 * Starts the account's one live dictation (`capture/liveCapture.ts`) backed by the shared IndexedDB
 * journal (`capture/captureJournal.ts`). Its own module, loaded with the composer, so capture and
 * VAD code stays out of the shell's first download.
 */
export const startLiveDictation = (
  store: JotaiStore,
  options: StartLiveDictationOptions
): Promise<boolean> => {
  const {
    userId,
    originApiUrl,
    createSession = createDictationSession,
    ...sessionOptions
  } = options;
  return beginLiveCapture(store, 'dictation', () => {
    const startedAt = sessionOptions.now ? sessionOptions.now() : Date.now();
    let journal: DictationJournalHandle | undefined;
    if (userId) {
      try {
        journal = beginDictationJournal(userId, {
          startedAt,
          elapsedMs: 0,
          capReached: false,
          ...(originApiUrl !== undefined ? { originApiUrl } : {}),
          ...(sessionOptions.roomId !== undefined ? { originRoomId: sessionOptions.roomId } : {}),
          segments: [],
          groups: [],
        });
      } catch {
        // Storage is best effort; dictation still works from memory.
      }
    }
    return createSession({
      ...sessionOptions,
      originApiUrl,
      journal,
    });
  });
};

const resolveRecoveryTranscriber = (
  store: JotaiStore,
  mx: MatrixClient,
  clientConfig: ClientConfig,
  originApiUrl?: string,
  originRoomId?: string
): { client?: DictationTranscriber; roomId?: string; originApiUrl?: string } => {
  const computers = clientConfig.mindroom?.computers;
  const trusted = trustedServerOrigins(computers);
  const isTrustedOrigin = (origin: string): boolean => trusted === undefined || trusted.has(origin);

  let resolvedUrl: string | undefined;
  if (originApiUrl !== undefined) {
    const normalized = resolveComputerApiUrl(originApiUrl);
    if (normalized && isTrustedOrigin(normalized)) {
      resolvedUrl = normalized;
    }
  } else {
    const preference = store.get(computerServicePreferenceAtom);
    const deploymentUrl = resolveComputerApiUrl(computers?.apiUrl);
    const fallback = resolveComputerServiceUrl(preference, deploymentUrl);
    if (fallback && isTrustedOrigin(fallback)) {
      resolvedUrl = fallback;
    }
  }

  if (!resolvedUrl) return {};

  const room = originRoomId ? mx.getRoom(originRoomId) : null;
  const validRoomId = room && isJoined(room) ? originRoomId : undefined;
  return {
    client: new DictationClient(clientSessions(mx, resolvedUrl)),
    roomId: validRoomId,
    originApiUrl: resolvedUrl,
  };
};

const buildPersistedRecoveredMeta = (
  startedAt: number,
  elapsedMs: number,
  capReached: boolean,
  originApiUrl: string | undefined,
  originRoomId: string | undefined,
  records: readonly RecoveredDictationRecord[],
  groups: readonly RefinementGroup[]
): DictationJournalMeta => ({
  startedAt,
  elapsedMs,
  capReached,
  ...(originApiUrl !== undefined ? { originApiUrl } : {}),
  ...(originRoomId !== undefined ? { originRoomId } : {}),
  segments: records.map((record) => ({
    ...record.segment,
    status: record.status,
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

const offerRecoveredDictation = async (
  store: JotaiStore,
  mx: MatrixClient,
  clientConfig: ClientConfig,
  sameAccount: () => boolean,
  recovered: RecoveredDictationJournal,
  createSession: (options: DictationSessionOptions) => DictationSession
): Promise<boolean> => {
  if (!sameAccount() || store.get(liveCaptureAtom) !== undefined) return false;

  const { meta, wavs, tailChunks, journal } = recovered;
  const sortedSegments = [...meta.segments].sort((a, b) => a.index - b.index);
  const records: RecoveredDictationRecord[] = sortedSegments.map((persisted) => {
    const wavBytes = wavs.get(persisted.index);
    return {
      segment: {
        index: persisted.index,
        seconds: persisted.seconds,
        overlapped: persisted.overlapped,
        cutReason: persisted.cutReason,
        leadingQuietFrames: persisted.leadingQuietFrames,
        trailingQuietFrames: persisted.trailingQuietFrames,
        pauseBeforeMs:
          typeof persisted.pauseBeforeMs === 'number' ? persisted.pauseBeforeMs : Infinity,
      },
      wav: wavBytes ? new Blob([wavBytes], { type: 'audio/wav' }) : undefined,
      status: persisted.status,
      text: persisted.text,
      error: persisted.error,
      retryable: persisted.retryable,
    };
  });

  const groups: RefinementGroup[] = meta.groups.map((group) => ({
    startIndex: group.startIndex,
    endIndex: group.endIndex,
    state: group.state,
    ...(group.refinedText !== undefined ? { refinedText: group.refinedText } : {}),
    ...(group.refinedEndIndex !== undefined ? { refinedEndIndex: group.refinedEndIndex } : {}),
  }));

  const sortedTail = [...tailChunks].sort(
    (a, b) => a.startFramePos - b.startFramePos || a.seq - b.seq
  );
  let effectiveElapsedMs = meta.elapsedMs;
  for (const chunk of sortedTail) {
    if (chunk.elapsedMs > effectiveElapsedMs) effectiveElapsedMs = chunk.elapsedMs;
  }

  const tailSegments: DictationSegment[] = [];
  const prunedOnSeal: number[] = [];
  if (sortedTail.length > 0) {
    const tailSegmenter = new DictationSegmenter({
      initialSegmentIndex: records.length,
      maxActiveFrames: Infinity,
      onSegment: (seg) => tailSegments.push(seg),
    });
    let lastEndPos = -Infinity;
    for (const chunk of sortedTail) {
      const frames = decodePcm16Frames(chunk.bytes);
      const skipFrames =
        chunk.startFramePos < lastEndPos
          ? Math.min(frames.length, lastEndPos - chunk.startFramePos)
          : 0;
      for (let i = skipFrames; i < frames.length; i += 1) {
        const frame = frames[i];
        if (frame) tailSegmenter.pushFrame(frame);
      }
      lastEndPos = Math.max(lastEndPos, chunk.endFramePos);
    }
    await tailSegmenter.markVadFailed();
    await tailSegmenter.flush();

    for (const seg of tailSegments) {
      const { wav, wavBuffer: _wavBuffer, consumedThroughFramePos: _pos, ...segMeta } = seg;
      records.push({
        segment: segMeta,
        wav,
        status: 'queued',
        retryable: true,
      });
      appendSegmentToGroups(groups, records, prunedOnSeal);
    }
  }

  for (const group of groups) {
    if (group.state === 'open') {
      sealRefinementGroup(group, records, prunedOnSeal);
    }
  }

  const summary = summarizeSessionRecords(records, groups);
  const hasTranscribedText = summary.previewText.trim().length > 0;
  if (records.length === 0 && !hasTranscribedText) {
    await journal.remove();
    return false;
  }

  // Recheck account and slot occupancy after async tail flushing before hydrating into the store.
  if (!sameAccount() || store.get(liveCaptureAtom) !== undefined) return false;

  const initialSegmentIndex = records.length;
  const elapsedFrames = Math.floor(effectiveElapsedMs / DICTATION_FRAME_MS);
  const segmentFrames = Math.round(
    records.reduce((total, record) => total + record.segment.seconds, 0) *
      (DICTATION_SAMPLE_RATE / DICTATION_FRAME_SAMPLES)
  );
  const initialActiveFrames = elapsedFrames > 0 ? elapsedFrames : segmentFrames;
  const capReached = meta.capReached || initialActiveFrames >= DICTATION_MAX_ACTIVE_FRAMES;

  const { client, roomId, originApiUrl } = resolveRecoveryTranscriber(
    store,
    mx,
    clientConfig,
    meta.originApiUrl,
    meta.originRoomId
  );

  const session = createSession({
    client,
    roomId,
    originApiUrl,
    journal,
    recovered: {
      startedAt: meta.startedAt,
      elapsedMs: effectiveElapsedMs,
      capReached,
      originApiUrl,
      originRoomId: roomId,
      records,
      groups,
      initialSegmentIndex,
      initialActiveFrames,
    },
  });

  if (!restoreLiveCapture(store, { kind: 'dictation', session })) {
    session.reset();
    return false;
  }

  // Convert replayed tail PCM chunks into durable segment WAVs and clear old tail rows so a
  // subsequent Resume never collides with pre-crash tail sequence numbers.
  if (tailSegments.length > 0 || tailChunks.length > 0 || prunedOnSeal.length > 0) {
    const recoveredMeta = buildPersistedRecoveredMeta(
      meta.startedAt,
      effectiveElapsedMs,
      capReached,
      originApiUrl,
      roomId,
      records,
      groups
    );
    for (const seg of tailSegments) {
      if (seg.wavBuffer) {
        void journal.commitSegment(seg.index, seg.wavBuffer, recoveredMeta).catch(() => undefined);
      }
    }
    void journal
      .updateState(recoveredMeta, prunedOnSeal.length > 0 ? prunedOnSeal : undefined, true)
      .catch(() => undefined);
  }

  return true;
};

/**
 * Recovers the signed-in account's persisted dictation journal (if any) directly into
 * `liveCaptureAtom` in `paused` (`recovered: true`) state. Runs once per account lifetime and
 * resets automatically after `endLiveCapturesOfAccount` so switching A -> B -> A recovers again.
 */
export const recoverDictationForAccount = (
  store: JotaiStore,
  mx: MatrixClient,
  clientConfig: ClientConfig,
  options?: RecoverDictationOptions
): Promise<void> => {
  const userId = mx.getUserId() ?? undefined;
  if (!userId) return Promise.resolve();

  const restores = store.get(dictationRestoresAtom);
  const existingGuard = restoreGuards.get(store)?.get(userId);
  if (restores.has(userId) && (existingGuard === undefined || existingGuard())) {
    return restores.get(userId) ?? Promise.resolve();
  }

  const sameAccount = captureAccountGuard(store);
  let guards = restoreGuards.get(store);
  if (!guards) {
    guards = new Map();
    restoreGuards.set(store, guards);
  }
  guards.set(userId, sameAccount);

  const createSession = options?.createSession ?? createDictationSession;
  const pending = recoverDictationJournal(userId, (recovered) =>
    offerRecoveredDictation(store, mx, clientConfig, sameAccount, recovered, createSession)
  ).finally(() => {
    if (store.get(dictationRestoresAtom).get(userId) === pending) {
      store.set(dictationRestoresAtom, (prev) => new Map(prev).set(userId, null));
    }
  });
  store.set(dictationRestoresAtom, (prev) => new Map(prev).set(userId, pending));
  return pending;
};

/** React hook mounting once per account to hydrate any recovered dictation into `liveCaptureAtom`. */
const EMPTY_CLIENT_CONFIG: ClientConfig = {};

export const useRecoverDictation = (mx: MatrixClient, enabled = true): void => {
  const store = useStore();
  const clientConfig = useOptionalClientConfig() ?? EMPTY_CLIENT_CONFIG;
  const userId = mx.getUserId() ?? undefined;

  useEffect(() => {
    if (!enabled || !userId) return;
    void recoverDictationForAccount(store, mx, clientConfig);
  }, [clientConfig, enabled, mx, store, userId]);
};
