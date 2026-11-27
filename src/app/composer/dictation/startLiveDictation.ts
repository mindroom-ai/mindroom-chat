import { atom, type createStore } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { createSessionId } from '../../matrix/session/sessions';
import { isJoined } from '../../matrix/state/roomList';
import type { ClientConfig } from '../../config/useClientConfig';
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
  type RecoveredDictationJournal,
} from '../capture/captureJournal';
import { DictationClient } from './api';
import { persistRecoveredTail, prepareRecoveredDictation } from './dictationCheckpoint';
import {
  createDictationSession,
  type DictationSession,
  type DictationSessionOptions,
  type DictationTranscriber,
} from './dictationSession';
import type { SileroVadInstance } from './sileroVad';

type JotaiStore = ReturnType<typeof createStore>;

export type StartLiveDictationOptions = Omit<
  DictationSessionOptions,
  'journal' | 'recovered' | 'originApiUrl'
> & {
  sessionId?: string;
  originApiUrl?: string;
  createSession?: (options: DictationSessionOptions) => DictationSession;
};

export type RecoverDictationOptions = {
  createSession?: (options: DictationSessionOptions) => DictationSession;
  loadVad?: (signal?: AbortSignal) => Promise<SileroVadInstance>;
};

/**
 * Computes the homeserver-scoped dictation session key (`createSessionId(baseUrl, userId)`) so
 * switching between same-MXID logins on different homeservers never cross-recovers dictation rows.
 */
export const getDictationSessionId = (
  mx: Pick<MatrixClient, 'getUserId' | 'getHomeserverUrl' | 'baseUrl'> | undefined
): string | undefined => {
  const userId = mx?.getUserId() ?? undefined;
  if (!mx || !userId) return undefined;
  const baseUrl = typeof mx.getHomeserverUrl === 'function' ? mx.getHomeserverUrl() : mx.baseUrl;
  return baseUrl ? createSessionId(baseUrl, userId) : userId;
};

/**
 * Per-session dictation restore tracking (missing = not started, Promise = in flight, null = settled),
 * mirroring `voiceDraftRestoresAtom` in `savedVoiceDraft.ts`.
 */
export const dictationRestoresAtom = atom<ReadonlyMap<string, Promise<void> | null>>(new Map());

/**
 * Tracks the `captureAccountGuard` under which each session's restore ran in a store so switching
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
    sessionId,
    originApiUrl,
    createSession = createDictationSession,
    ...sessionOptions
  } = options;
  return beginLiveCapture(store, 'dictation', () => {
    const startedAt = sessionOptions.now ? sessionOptions.now() : Date.now();
    let journal: DictationJournalHandle | undefined;
    if (sessionId) {
      try {
        journal = beginDictationJournal(sessionId, {
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
  // Saved originApiUrl is trusted when no allowlist is configured because this client wrote it, matching useDictationServer discovery.
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

const offerRecoveredDictation = async (
  store: JotaiStore,
  mx: MatrixClient,
  clientConfig: ClientConfig,
  sameAccount: () => boolean,
  recovered: RecoveredDictationJournal,
  createSession: (options: DictationSessionOptions) => DictationSession,
  loadVad?: (signal?: AbortSignal) => Promise<SileroVadInstance>
): Promise<boolean> => {
  if (!sameAccount() || store.get(liveCaptureAtom) !== undefined) return false;

  const { meta, wavs, tailChunks, journal } = recovered;
  const prepared = await prepareRecoveredDictation(meta, wavs, tailChunks, loadVad);

  // Recheck account before mutating disk state or hydrating after async tail replay.
  if (!sameAccount()) return false;
  if (prepared.isEmpty) {
    await journal.remove();
    return false;
  }
  if (store.get(liveCaptureAtom) !== undefined) return false;

  const { client, roomId, originApiUrl } = resolveRecoveryTranscriber(
    store,
    mx,
    clientConfig,
    meta.originApiUrl,
    meta.originRoomId
  );
  // Preserve the original originApiUrl even when no recovery client was bound so lazy room-level
  // client attachment never silently uploads leftover audio to a different room's server.
  const sessionOriginApiUrl = originApiUrl ?? meta.originApiUrl;

  const session = createSession({
    client,
    roomId,
    originApiUrl: sessionOriginApiUrl,
    journal,
    recovered: {
      startedAt: meta.startedAt,
      elapsedMs: prepared.effectiveElapsedMs,
      capReached: prepared.capReached,
      originApiUrl: sessionOriginApiUrl,
      originRoomId: roomId,
      records: prepared.records,
      groups: prepared.groups,
      initialSegmentIndex: prepared.initialSegmentIndex,
      initialActiveFrames: prepared.initialActiveFrames,
    },
  });

  if (!restoreLiveCapture(store, { kind: 'dictation', session })) {
    session.reset();
    return false;
  }

  persistRecoveredTail(
    journal,
    {
      startedAt: meta.startedAt,
      elapsedMs: prepared.effectiveElapsedMs,
      capReached: prepared.capReached,
      originApiUrl: sessionOriginApiUrl,
      originRoomId: roomId,
      records: prepared.records,
      groups: prepared.groups,
    },
    prepared.tailSegments,
    tailChunks.length
  );

  return true;
};

/**
 * Recovers the signed-in session's persisted dictation journal (if any) directly into
 * `liveCaptureAtom` in `paused` (`recovered: true`) state. Runs once per session lifetime and
 * resets automatically after `endLiveCapturesOfAccount` so switching A -> B -> A recovers again.
 */
export const recoverDictationForAccount = (
  store: JotaiStore,
  mx: MatrixClient,
  clientConfig: ClientConfig,
  options?: RecoverDictationOptions
): Promise<void> => {
  const sessionId = getDictationSessionId(mx);
  if (!sessionId) return Promise.resolve();

  const restores = store.get(dictationRestoresAtom);
  const existingGuard = restoreGuards.get(store)?.get(sessionId);
  if (restores.has(sessionId) && (existingGuard === undefined || existingGuard())) {
    return restores.get(sessionId) ?? Promise.resolve();
  }

  const sameAccount = captureAccountGuard(store);
  let guards = restoreGuards.get(store);
  if (!guards) {
    guards = new Map();
    restoreGuards.set(store, guards);
  }
  guards.set(sessionId, sameAccount);

  const createSession = options?.createSession ?? createDictationSession;
  const pending = recoverDictationJournal(sessionId, (recovered) =>
    offerRecoveredDictation(
      store,
      mx,
      clientConfig,
      sameAccount,
      recovered,
      createSession,
      options?.loadVad
    )
  ).finally(() => {
    if (store.get(dictationRestoresAtom).get(sessionId) === pending) {
      store.set(dictationRestoresAtom, (prev) => new Map(prev).set(sessionId, null));
    }
  });
  store.set(dictationRestoresAtom, (prev) => new Map(prev).set(sessionId, pending));
  return pending;
};
