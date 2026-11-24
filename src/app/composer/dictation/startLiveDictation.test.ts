// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { openDB } from 'idb';
import { createStore, Provider } from 'jotai';
import { render, waitFor } from '@testing-library/react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { KnownMembership } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { createSessionId, putSession, SESSION_STORE_KEY } from '../../matrix/session/sessions';
import { removeStoredSession } from '../../account/lifecycle/sessionLifecycle';
import { DictationRecoveryFeature } from '../../shell/ClientNonUIFeatures';
import { computerServicePreferenceAtom } from '../../computer/computerServiceSettings';
import {
  beginDictationJournal,
  clearCaptureJournal,
  deleteCapture,
  hasDictationJournalRecord,
  TAIL_SEQ_OFFSET,
} from '../capture/captureJournal';
import {
  endLiveCapturesOfAccount,
  liveCaptureAtom,
  restoreLiveCapture,
} from '../capture/liveCapture';
import {
  computeFrameRms,
  decodePcm16Frames,
  DICTATION_FRAME_SAMPLES,
  DICTATION_MAX_SEGMENT_BYTES,
  DICTATION_SAMPLE_RATE,
  encodePcm16Frames,
  encodePcm16WavBuffer,
  SILENCE_RMS_FLOOR,
} from './dictationSegmenter';
import type { DictationCaptureFactory, DictationSessionOptions } from './dictationSession';
import {
  dictationRestoresAtom,
  recoverDictationForAccount,
  startLiveDictation,
} from './startLiveDictation';

const HS_A = 'https://hs-a.example.org';
const HS_B = 'https://hs-b.example.org';
const USER_A = '@alice-dictation:example.org';
const USER_B = '@bob-dictation:example.org';
const SESSION_A = createSessionId(HS_A, USER_A);
const SESSION_B = createSessionId(HS_A, USER_B);
const SESSION_A_OTHER_HS = createSessionId(HS_B, USER_A);

const makeFrame = (amplitude: number): Float32Array => {
  const frame = new Float32Array(DICTATION_FRAME_SAMPLES);
  for (let i = 0; i < frame.length; i += 1) {
    frame[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / DICTATION_SAMPLE_RATE);
  }
  return frame;
};

const makeRoom = (roomId: string, membership: KnownMembership): Room =>
  ({
    roomId,
    getMyMembership: () => membership,
  } as unknown as Room);

const makeMatrixClient = (
  userId: string,
  rooms: Record<string, Room> = {},
  baseUrl = HS_A
): MatrixClient =>
  ({
    baseUrl,
    getHomeserverUrl: () => baseUrl,
    getUserId: () => userId,
    getRoom: (roomId: string) => rooms[roomId] ?? null,
    getOpenIdToken: vi.fn(async () => ({
      access_token: 'tok',
      token_type: 'Bearer',
      matrix_server_name: 'example.org',
      expires_in: 3600,
    })),
  } as unknown as MatrixClient);

const makeFakeCapture = (): DictationCaptureFactory => async () => ({
  readLevel: () => 0.2,
  stopAndFlush: async () => undefined,
  dispose: () => undefined,
});

const makePausedStubSession = () =>
  ({
    getSnapshot: () => ({ phase: 'paused' }),
    subscribe: () => () => undefined,
    reset: vi.fn(),
  } as never);

const waitForJournalSettled = async (ms = 40) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const readJournalRow = async (id: string) => {
  const db = await openDB('mindroom-voice-journal', 1);
  try {
    const recording = (await db.get('recordings', id)) as Record<string, unknown> | undefined;
    const chunks = (await db.getAll(
      'chunks',
      IDBKeyRange.bound([id, 0], [id, Infinity])
    )) as Array<{ seq: number; bytes: ArrayBuffer }>;
    return { recording, chunks };
  } finally {
    db.close();
  }
};

describe('startLiveDictation and recovery', () => {
  let heldLocks: Set<string>;

  beforeEach(() => {
    heldLocks = new Set<string>();
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: {
        request: async (name: string, _options: LockOptions, callback: LockGrantedCallback) => {
          if (heldLocks.has(name)) return callback(null);
          heldLocks.add(name);
          try {
            return await callback({ name, mode: 'exclusive' });
          } finally {
            heldLocks.delete(name);
          }
        },
      },
    });
  });

  afterEach(async () => {
    await clearCaptureJournal(SESSION_A);
    await clearCaptureJournal(SESSION_B);
    await clearCaptureJournal(SESSION_A_OTHER_HS);
    await clearCaptureJournal(USER_A);
    await clearCaptureJournal(USER_B);
    localStorage.removeItem(SESSION_STORE_KEY);
    vi.restoreAllMocks();
  });

  it('starts live dictation in liveCaptureAtom with a journal and blocks concurrent starts', async () => {
    const store = createStore();
    const transcribe = vi.fn(async () => ({ text: 'ok', seconds: 1 }));

    const started = await startLiveDictation(store, {
      sessionId: SESSION_A,
      client: { transcribe },
      roomId: '!room:example.org',
      originApiUrl: 'https://trusted.example',
      captureFactory: makeFakeCapture(),
      loadVad: () => new Promise(() => undefined),
    });
    expect(started).toBe(true);
    const live = store.get(liveCaptureAtom);
    expect(live?.kind).toBe('dictation');
    const journalId = live?.kind === 'dictation' ? live.session.getJournalId() : undefined;
    expect(journalId).toBeDefined();
    await waitForJournalSettled();
    expect(await hasDictationJournalRecord(SESSION_A)).toBe(true);

    // Concurrent start while occupied is rejected without touching the active slot.
    const second = await startLiveDictation(store, {
      sessionId: SESSION_A,
      client: { transcribe },
      captureFactory: makeFakeCapture(),
    });
    expect(second).toBe(false);
    expect(store.get(liveCaptureAtom)).toBe(live);

    if (live?.kind === 'dictation') await live.session.discard();
  });

  it('recovers mid-utterance PCM tail chunks via RMS fallback into liveCaptureAtom (paused, recovered: true)', async () => {
    const journal = beginDictationJournal(SESSION_A, {
      startedAt: 10_000,
      elapsedMs: 0,
      capReached: false,
      originApiUrl: 'https://trusted.example',
      originRoomId: '!joined:example.org',
      segments: [],
      groups: [],
    })!;
    const speechFrames = Array.from({ length: 10 }, () => makeFrame(0.3));
    await journal.appendTail(0, encodePcm16Frames(speechFrames), 960, 0, 10);
    journal.release();
    await waitForJournalSettled();

    const store = createStore();
    const mx = makeMatrixClient(USER_A, {
      '!joined:example.org': makeRoom('!joined:example.org', KnownMembership.Join),
    });
    const config: ClientConfig = {
      mindroom: { computers: { apiUrl: 'https://trusted.example' } },
    };

    const capturedOpts: DictationSessionOptions[] = [];
    await recoverDictationForAccount(store, mx, config, {
      createSession: (opts) => {
        capturedOpts.push(opts);
        return makePausedStubSession();
      },
    });
    expect(capturedOpts).toHaveLength(1);
    expect(capturedOpts[0]?.client).toBeDefined();
    expect(capturedOpts[0]?.roomId).toBe('!joined:example.org');
    expect(capturedOpts[0]?.recovered?.records).toHaveLength(1);
    expect(capturedOpts[0]?.recovered?.elapsedMs).toBe(960);
    expect(capturedOpts[0]?.recovered?.initialSegmentIndex).toBe(1);
    await deleteCapture(journal.id);

    // End-to-end hydration with real createDictationSession, IDB tail conversion, and attachClient upload.
    const journal2 = beginDictationJournal(SESSION_A, {
      startedAt: 20_000,
      elapsedMs: 0,
      capReached: false,
      segments: [],
      groups: [],
    })!;
    await journal2.appendTail(0, encodePcm16Frames(speechFrames), 960, 0, 10);
    journal2.release();
    await waitForJournalSettled();

    const store2 = createStore();
    store2.set(computerServicePreferenceAtom, '');
    await recoverDictationForAccount(store2, mx, {});
    await waitForJournalSettled(60);

    const live = store2.get(liveCaptureAtom);
    expect(live?.kind).toBe('dictation');
    if (live?.kind !== 'dictation') throw new Error('expected dictation');
    expect(live.session.getSnapshot()).toMatchObject({
      phase: 'paused',
      recovered: true,
      hasClient: false,
      elapsedMs: 960,
      pendingUploads: 1,
    });
    // Old tail chunk was converted to segment 0 WAV and tail range was cleared in IDB.
    const row = await readJournalRow(journal2.id);
    expect(row.chunks.some((c) => c.seq === 0)).toBe(true);
    expect(row.chunks.some((c) => c.seq >= TAIL_SEQ_OFFSET)).toBe(false);

    const mockTranscribe = vi.fn(async () => ({ text: 'Recovered tail speech.', seconds: 0.96 }));
    live.session.attachClient({ transcribe: mockTranscribe }, '!joined:example.org');
    await waitFor(() => {
      expect(live.session.getSnapshot().previewText).toBe('Recovered tail speech.');
    });
    await live.session.discard();
  });

  it('recovers text-only records with 0 remaining WAVs and deletes truly empty records', async () => {
    // 1. Truly empty record (no segments, only silent tail) -> dropped & deleted.
    const emptyJournal = beginDictationJournal(SESSION_A, {
      startedAt: 1_000,
      elapsedMs: 500,
      capReached: false,
      segments: [],
      groups: [],
    })!;
    const silentFrames = Array.from({ length: 5 }, () => makeFrame(0.0005));
    await emptyJournal.appendTail(0, encodePcm16Frames(silentFrames), 500, 0, 5);
    emptyJournal.release();

    // 2. Newer text-only record with 0 WAVs on disk -> MUST recover!
    const textOnlyJournal = beginDictationJournal(SESSION_A, {
      startedAt: 2_000,
      elapsedMs: 6_000,
      capReached: false,
      segments: [
        {
          index: 0,
          seconds: 3,
          overlapped: false,
          cutReason: 'natural',
          leadingQuietFrames: 2,
          trailingQuietFrames: 8,
          pauseBeforeMs: Infinity,
          status: 'completed',
          text: 'Preserved text without wav.',
          retryable: false,
        },
      ],
      groups: [
        {
          startIndex: 0,
          endIndex: 0,
          state: 'refined',
          refinedText: 'Preserved text without wav.',
          refinedEndIndex: 0,
        },
      ],
    })!;
    textOnlyJournal.release();
    await waitForJournalSettled();

    const store = createStore();
    store.set(computerServicePreferenceAtom, '');
    await recoverDictationForAccount(store, makeMatrixClient(USER_A), {});
    await waitForJournalSettled();

    expect((await readJournalRow(emptyJournal.id)).recording).toBeUndefined();
    const live = store.get(liveCaptureAtom);
    expect(live?.kind).toBe('dictation');
    if (live?.kind !== 'dictation') throw new Error('expected dictation');
    expect(live.session.getJournalId()).toBe(textOnlyJournal.id);
    expect(live.session.getSnapshot()).toMatchObject({
      phase: 'paused',
      recovered: true,
      previewText: 'Preserved text without wav.',
    });
    await live.session.discard();
  });

  it('validates trusted vs untrusted originApiUrl, strips left originRoomId, and falls back only when unset & trusted', async () => {
    const seedRecord = async (originApiUrl?: string, originRoomId?: string) => {
      const startedAt = Date.now();
      const baseMeta = {
        startedAt,
        elapsedMs: 2_000,
        capReached: false,
        ...(originApiUrl !== undefined ? { originApiUrl } : {}),
        ...(originRoomId !== undefined ? { originRoomId } : {}),
        segments: [
          {
            index: 0,
            seconds: 1,
            overlapped: false,
            cutReason: 'flush' as const,
            leadingQuietFrames: 1,
            trailingQuietFrames: 0,
            pauseBeforeMs: Infinity,
            status: 'completed' as const,
            text: 'Hello.',
            retryable: false,
          },
        ],
        groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' as const }],
      };
      const j = beginDictationJournal(SESSION_A, { ...baseMeta, segments: [], groups: [] })!;
      await j.commitSegment(0, encodePcm16WavBuffer([makeFrame(0.3), makeFrame(0.3)]), baseMeta);
      j.release();
      await waitForJournalSettled();
      return j.id;
    };

    const config: ClientConfig = {
      mindroom: {
        computers: {
          apiUrl: 'https://deploy.example',
          trustedApiUrls: ['https://partner.example'],
        },
      },
    };
    const mx = makeMatrixClient(USER_A, {
      '!joined:example.org': makeRoom('!joined:example.org', KnownMembership.Join),
      '!left:example.org': makeRoom('!left:example.org', KnownMembership.Leave),
    });

    // Case 1: Untrusted originApiUrl -> client: undefined (NEVER falls back to deploy.example).
    const untrustedId = await seedRecord('https://evil.example', '!joined:example.org');
    const store1 = createStore();
    store1.set(computerServicePreferenceAtom, null);
    await recoverDictationForAccount(store1, mx, config);
    const live1 = store1.get(liveCaptureAtom);
    expect(live1?.kind).toBe('dictation');
    if (live1?.kind !== 'dictation') throw new Error('expected dictation');
    expect(live1.session.hasClient()).toBe(false);
    expect(live1.session.getSnapshot().hasClient).toBe(false);
    expect(live1.session.getOriginApiUrl()).toBe('https://evil.example');
    await live1.session.discard();
    await deleteCapture(untrustedId);

    // Case 2: Trusted originApiUrl + left originRoomId -> client bound, roomId stripped.
    const leftRoomId = await seedRecord('https://partner.example', '!left:example.org');
    const store2 = createStore();
    store2.set(computerServicePreferenceAtom, null);
    let capturedLeftOpts: DictationSessionOptions | undefined;
    await recoverDictationForAccount(store2, mx, config, {
      createSession: (opts) => {
        capturedLeftOpts = opts;
        return makePausedStubSession();
      },
    });
    expect(capturedLeftOpts?.client).toBeDefined();
    expect(capturedLeftOpts?.originApiUrl).toBe('https://partner.example');
    expect(capturedLeftOpts?.roomId).toBeUndefined();
    await deleteCapture(leftRoomId);

    // Case 3: Unset originApiUrl + preference null -> falls back to trusted deployment apiUrl.
    const unsetId = await seedRecord(undefined, '!joined:example.org');
    const store3 = createStore();
    store3.set(computerServicePreferenceAtom, null);
    let capturedFallbackOpts: DictationSessionOptions | undefined;
    await recoverDictationForAccount(store3, mx, config, {
      createSession: (opts) => {
        capturedFallbackOpts = opts;
        return makePausedStubSession();
      },
    });
    expect(capturedFallbackOpts?.client).toBeDefined();
    expect(capturedFallbackOpts?.originApiUrl).toBe('https://deploy.example');
    expect(capturedFallbackOpts?.roomId).toBe('!joined:example.org');
    await deleteCapture(unsetId);

    // Case 4: Unset originApiUrl + preference explicitly disabled ('') -> client: undefined.
    const disabledId = await seedRecord(undefined, '!joined:example.org');
    const store4 = createStore();
    store4.set(computerServicePreferenceAtom, '');
    await recoverDictationForAccount(store4, mx, config);
    const live4 = store4.get(liveCaptureAtom);
    expect(live4?.kind === 'dictation' && live4.session.hasClient()).toBe(false);
    if (live4?.kind === 'dictation') await live4.session.discard();
    await deleteCapture(disabledId);
  });

  it('rejects late recovery after account switch and re-recovers cleanly on A -> B -> A switch-back', async () => {
    const journal = beginDictationJournal(SESSION_A, {
      startedAt: 3_000,
      elapsedMs: 4_000,
      capReached: false,
      segments: [
        {
          index: 0,
          seconds: 2,
          overlapped: false,
          cutReason: 'natural',
          leadingQuietFrames: 2,
          trailingQuietFrames: 8,
          pauseBeforeMs: Infinity,
          status: 'completed',
          text: 'Alice dictation.',
          retryable: false,
        },
      ],
      groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' }],
    })!;
    journal.release();
    await waitForJournalSettled();

    const store = createStore();
    store.set(computerServicePreferenceAtom, '');
    const mxA = makeMatrixClient(USER_A);
    const mxB = makeMatrixClient(USER_B);

    // Start recovery for A, then immediately switch account before IDB resolves.
    const lateRecovery = recoverDictationForAccount(store, mxA, {});
    endLiveCapturesOfAccount(store);
    await lateRecovery;
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(heldLocks.has(`mindroom-voice-recording:${journal.id}`)).toBe(false);

    // Account B runs its own recovery (finds nothing).
    await recoverDictationForAccount(store, mxB, {});
    expect(store.get(liveCaptureAtom)).toBeUndefined();

    // Switch back B -> A: captureAccountGuard generation changed, so A recovers again!
    endLiveCapturesOfAccount(store);
    await recoverDictationForAccount(store, mxA, {});
    const liveA = store.get(liveCaptureAtom);
    expect(liveA?.kind).toBe('dictation');
    if (liveA?.kind !== 'dictation') throw new Error('expected dictation');
    expect(liveA.session.getSnapshot()).toMatchObject({
      phase: 'paused',
      recovered: true,
      previewText: 'Alice dictation.',
    });

    // Switching away A -> B resets A (releasing lock, keeping disk rows), then B -> A recovers again!
    endLiveCapturesOfAccount(store);
    await waitForJournalSettled();
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(heldLocks.has(`mindroom-voice-recording:${journal.id}`)).toBe(false);

    endLiveCapturesOfAccount(store);
    await recoverDictationForAccount(store, mxA, {});
    const liveA2 = store.get(liveCaptureAtom);
    expect(liveA2?.kind).toBe('dictation');
    if (liveA2?.kind === 'dictation') await liveA2.session.discard();
  });

  it('isolates same-MXID sessions on different homeservers across recovery and single-session sign-out', async () => {
    const journalA = beginDictationJournal(SESSION_A, {
      startedAt: 5_000,
      elapsedMs: 3_000,
      capReached: false,
      originApiUrl: 'https://deploy.example',
      segments: [
        {
          index: 0,
          seconds: 2,
          overlapped: false,
          cutReason: 'natural',
          leadingQuietFrames: 1,
          trailingQuietFrames: 4,
          pauseBeforeMs: Infinity,
          status: 'completed',
          text: 'Homeserver A secret transcript.',
          retryable: false,
        },
      ],
      groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' }],
    })!;
    journalA.release();

    const journalB = beginDictationJournal(SESSION_A_OTHER_HS, {
      startedAt: 6_000,
      elapsedMs: 2_000,
      capReached: false,
      segments: [
        {
          index: 0,
          seconds: 1,
          overlapped: false,
          cutReason: 'natural',
          leadingQuietFrames: 1,
          trailingQuietFrames: 4,
          pauseBeforeMs: Infinity,
          status: 'completed',
          text: 'Homeserver B transcript.',
          retryable: false,
        },
      ],
      groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' }],
    })!;
    journalB.release();
    await waitForJournalSettled();

    // Switching from HS_A to HS_B with the exact same MXID recovers only HS_B (or nothing if HS_B has none).
    const store = createStore();
    store.set(computerServicePreferenceAtom, '');
    const mxOtherHs = makeMatrixClient(USER_A, {}, HS_B);
    await clearCaptureJournal(SESSION_A_OTHER_HS);
    expect(await hasDictationJournalRecord(SESSION_A)).toBe(true);
    expect(await hasDictationJournalRecord(SESSION_A_OTHER_HS)).toBe(false);

    await recoverDictationForAccount(store, mxOtherHs, {});
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(store.get(dictationRestoresAtom).get(SESSION_A_OTHER_HS)).toBeNull();

    // Re-seed HS_B, register both sessions, then sign out HS_A: HS_A rows are deleted while HS_B survives.
    const journalB2 = beginDictationJournal(SESSION_A_OTHER_HS, {
      startedAt: 7_000,
      elapsedMs: 2_000,
      capReached: false,
      segments: [
        {
          index: 0,
          seconds: 1,
          overlapped: false,
          cutReason: 'natural',
          leadingQuietFrames: 1,
          trailingQuietFrames: 4,
          pauseBeforeMs: Infinity,
          status: 'completed',
          text: 'Homeserver B survives sign-out of A.',
          retryable: false,
        },
      ],
      groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' }],
    })!;
    journalB2.release();
    await waitForJournalSettled();

    const storedA = putSession({
      baseUrl: HS_A,
      userId: USER_A,
      deviceId: 'DEV_A',
      accessToken: 'a',
    });
    putSession({ baseUrl: HS_B, userId: USER_A, deviceId: 'DEV_B', accessToken: 'b' });
    await removeStoredSession(storedA);

    expect(await hasDictationJournalRecord(SESSION_A)).toBe(false);
    expect(await hasDictationJournalRecord(SESSION_A_OTHER_HS)).toBe(true);

    // Recover HS_B and verify its transcript survived intact.
    const storeB = createStore();
    storeB.set(computerServicePreferenceAtom, '');
    await recoverDictationForAccount(storeB, mxOtherHs, {});
    const liveB = storeB.get(liveCaptureAtom);
    expect(liveB?.kind).toBe('dictation');
    if (liveB?.kind !== 'dictation') throw new Error('expected dictation');
    expect(liveB.session.getSnapshot().previewText).toBe('Homeserver B survives sign-out of A.');
    await liveB.session.discard();
  });

  it('deduplicates boundary words across real DictationSegmenter + stitchTranscript after hard-cut crash recovery', async () => {
    let pushFrame!: (frame: Float32Array) => void;
    const captureFactory: DictationCaptureFactory = async ({ onFrame }) => {
      pushFrame = onFrame;
      return {
        readLevel: () => 0.3,
        stopAndFlush: async () => undefined,
        dispose: () => undefined,
      };
    };

    const store = createStore();
    let transcribeCalls = 0;
    const initialTranscribe = vi.fn(async () => {
      transcribeCalls += 1;
      return { text: 'please invite Sam', seconds: 25 };
    });

    const started = await startLiveDictation(store, {
      sessionId: SESSION_A,
      client: { transcribe: initialTranscribe },
      roomId: '!room:example.org',
      captureFactory,
      loadVad: async () => ({
        score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
        reset: () => undefined,
        release: async () => undefined,
      }),
    });
    expect(started).toBe(true);
    await waitForJournalSettled(20);

    // Push 260 speech frames -> real DictationSegmenter emits a hard cut at frame 250 with
    // consumedThroughFramePos=245, keeping partial tail chunk [240, 250) + [250, 260) on disk.
    for (let i = 0; i < 260; i += 1) pushFrame(makeFrame(0.3));
    await waitFor(() => expect(transcribeCalls).toBe(1));
    await waitForJournalSettled(80);

    // Crash / reload: release session lock without discarding journal.
    endLiveCapturesOfAccount(store);
    await waitForJournalSettled(40);

    // Recover via recoverDictationForAccount -> replays frames [245, 260) with initialOverlapped: true!
    const recoveredStore = createStore();
    recoveredStore.set(computerServicePreferenceAtom, '');
    await recoverDictationForAccount(recoveredStore, makeMatrixClient(USER_A), {});
    await waitForJournalSettled(60);

    const live = recoveredStore.get(liveCaptureAtom);
    expect(live?.kind).toBe('dictation');
    if (live?.kind !== 'dictation') throw new Error('expected dictation');

    // Attach client for the replayed overlap segment which starts with the boundary word "Sam".
    const recoveryTranscribe = vi.fn(async () => ({ text: 'Sam tomorrow', seconds: 1.44 }));
    live.session.attachClient({ transcribe: recoveryTranscribe }, '!room:example.org');
    await waitFor(() => expect(recoveryTranscribe).toHaveBeenCalledTimes(1));

    const finished = await live.session.finish();
    expect(finished).toMatchObject({
      status: 'completed',
      text: 'please invite Sam tomorrow',
    });
    if (finished.status === 'completed') await deleteCapture(finished.journalId);
  });

  it('does not clobber an occupied liveCaptureAtom slot and surfaces recovered dictation via DictationRecoveryFeature', async () => {
    const mx = makeMatrixClient(USER_A, {
      '!room:example.org': makeRoom('!room:example.org', KnownMembership.Join),
    });
    const config: ClientConfig = {
      mindroom: { computers: { apiUrl: 'https://deploy.example' } },
    };

    // Without a journal record, DictationRecoveryFeature skips loading/running recovery.
    const emptyStore = createStore();
    const emptyView = render(
      createElement(
        Provider,
        { store: emptyStore },
        createElement(
          ClientConfigProvider,
          { value: config },
          createElement(
            MatrixClientProvider,
            { value: mx },
            createElement(DictationRecoveryFeature)
          )
        )
      )
    );
    await waitForJournalSettled();
    expect(emptyStore.get(liveCaptureAtom)).toBeUndefined();
    expect(emptyStore.get(dictationRestoresAtom).has(SESSION_A)).toBe(false);
    emptyView.unmount();

    // Seed a persisted dictation journal, simulating a crash before reloading straight into Settings.
    const journal = beginDictationJournal(SESSION_A, {
      startedAt: 4_000,
      elapsedMs: 7_500,
      capReached: false,
      originApiUrl: 'https://deploy.example',
      originRoomId: '!room:example.org',
      segments: [
        {
          index: 0,
          seconds: 2,
          overlapped: false,
          cutReason: 'natural',
          leadingQuietFrames: 1,
          trailingQuietFrames: 4,
          pauseBeforeMs: Infinity,
          status: 'completed',
          text: 'Recovered in settings.',
          retryable: false,
        },
      ],
      groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' }],
    })!;
    journal.release();
    await waitForJournalSettled();

    // Occupied slot rejects recovery while leaving disk rows unlocked & untouched.
    const occupiedStore = createStore();
    restoreLiveCapture(occupiedStore, { kind: 'voice', session: makePausedStubSession() });
    await recoverDictationForAccount(occupiedStore, mx, config);
    expect(occupiedStore.get(liveCaptureAtom)?.kind).toBe('voice');
    expect(heldLocks.has(`mindroom-voice-recording:${journal.id}`)).toBe(false);

    // DictationRecoveryFeature hydrates directly into liveCaptureAtom.
    const settingsStore = createStore();
    const settingsView = render(
      createElement(
        Provider,
        { store: settingsStore },
        createElement(
          ClientConfigProvider,
          { value: config },
          createElement(
            MatrixClientProvider,
            { value: mx },
            createElement(DictationRecoveryFeature)
          )
        )
      )
    );

    await waitFor(() => {
      expect(settingsStore.get(liveCaptureAtom)?.kind).toBe('dictation');
    });
    const live = settingsStore.get(liveCaptureAtom);
    expect(live?.kind).toBe('dictation');
    if (live?.kind !== 'dictation') throw new Error('expected dictation');
    expect(live.session.getSnapshot()).toMatchObject({
      phase: 'paused',
      recovered: true,
      hasClient: true,
      elapsedMs: 7_500,
      previewText: 'Recovered in settings.',
    });

    await live.session.discard();
    settingsView.unmount();
  });
  it('recovers quiet-speech tail (max RMS 0.014) with Silero VAD scorer and releases VAD', async () => {
    const quietSpeechFrame = makeFrame(0.014 * Math.SQRT2);
    const decodedRms = computeFrameRms(
      decodePcm16Frames(encodePcm16Frames([quietSpeechFrame]))[0]!
    );
    expect(decodedRms).toBeGreaterThan(SILENCE_RMS_FLOOR);
    expect(decodedRms).toBeLessThan(0.015);

    const journal = beginDictationJournal(SESSION_A, {
      startedAt: 30_000,
      elapsedMs: 0,
      capReached: false,
      segments: [],
      groups: [],
    })!;
    // 4 silent lead frames + 46 quiet speech frames (~4.4s) + 4 silent trail frames.
    const frames = [
      ...Array.from({ length: 4 }, () => makeFrame(0)),
      ...Array.from({ length: 46 }, () => quietSpeechFrame),
      ...Array.from({ length: 4 }, () => makeFrame(0)),
    ];
    await journal.appendTail(0, encodePcm16Frames(frames), 5_184, 0, frames.length);
    journal.release();
    await waitForJournalSettled();

    const release = vi.fn(async () => undefined);
    const loadVad = vi.fn(async () => ({
      score: async (frame: Float32Array) => (computeFrameRms(frame) >= 0.01 ? 0.92 : 0.04),
      reset: vi.fn(),
      release,
    }));

    const store = createStore();
    store.set(computerServicePreferenceAtom, '');
    await recoverDictationForAccount(store, makeMatrixClient(USER_A), {}, { loadVad });
    await waitForJournalSettled(60);

    expect(loadVad).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(await hasDictationJournalRecord(SESSION_A)).toBe(true);

    const live = store.get(liveCaptureAtom);
    expect(live?.kind).toBe('dictation');
    if (live?.kind !== 'dictation') throw new Error('expected dictation');
    expect(live.session.getSnapshot()).toMatchObject({
      phase: 'paused',
      recovered: true,
      pendingUploads: 1,
      elapsedMs: 5_184,
    });

    const mockTranscribe = vi.fn(async () => ({ text: 'Quiet speech recovered.', seconds: 4.4 }));
    live.session.attachClient({ transcribe: mockTranscribe }, '!room:example.org');
    await waitFor(() => {
      expect(live.session.getSnapshot().previewText).toBe('Quiet speech recovered.');
    });
    await live.session.discard();
  });

  it('preserves quiet-speech tail (max RMS 0.014) as bounded fallback WAV(s) when Silero VAD load fails', async () => {
    const quietSpeechFrame = makeFrame(0.014 * Math.SQRT2);
    const decodedRms = computeFrameRms(
      decodePcm16Frames(encodePcm16Frames([quietSpeechFrame]))[0]!
    );
    expect(decodedRms).toBeGreaterThan(SILENCE_RMS_FLOOR);
    expect(decodedRms).toBeLessThan(0.015);

    const journal = beginDictationJournal(SESSION_A, {
      startedAt: 40_000,
      elapsedMs: 0,
      capReached: false,
      segments: [],
      groups: [],
    })!;
    const frames = Array.from({ length: 46 }, () => quietSpeechFrame);
    await journal.appendTail(0, encodePcm16Frames(frames), 4_416, 0, frames.length);
    journal.release();
    await waitForJournalSettled();

    const loadVad = vi.fn(async () => {
      throw new Error('WASM unavailable offline');
    });

    const store = createStore();
    store.set(computerServicePreferenceAtom, '');
    await recoverDictationForAccount(store, makeMatrixClient(USER_A), {}, { loadVad });
    await waitForJournalSettled(60);

    expect(loadVad).toHaveBeenCalledTimes(1);
    const row = await readJournalRow(journal.id);
    expect(row.recording).toBeDefined();
    expect(row.chunks.some((c) => c.seq === 0)).toBe(true);
    expect(row.chunks.some((c) => c.seq >= TAIL_SEQ_OFFSET)).toBe(false);

    const live = store.get(liveCaptureAtom);
    expect(live?.kind).toBe('dictation');
    if (live?.kind !== 'dictation') throw new Error('expected dictation');
    expect(live.session.getSnapshot()).toMatchObject({
      phase: 'paused',
      recovered: true,
      pendingUploads: 1,
      elapsedMs: 4_416,
    });

    const receivedSizes: number[] = [];
    live.session.attachClient(
      {
        transcribe: async (wav) => {
          receivedSizes.push(wav.size);
          return { text: 'Fallback quiet speech.', seconds: 4.4 };
        },
      },
      '!room:example.org'
    );
    await waitFor(() => {
      expect(live.session.getSnapshot().previewText).toBe('Fallback quiet speech.');
    });
    expect(receivedSizes).toHaveLength(1);
    expect(receivedSizes[0]).toBeLessThanOrEqual(DICTATION_MAX_SEGMENT_BYTES);
    await live.session.discard();

    // Long quiet speech (>25s) splits into multiple bounded WAV segments <= DICTATION_MAX_SEGMENT_BYTES.
    const longJournal = beginDictationJournal(SESSION_A, {
      startedAt: 41_000,
      elapsedMs: 0,
      capReached: false,
      segments: [],
      groups: [],
    })!;
    const longFrames = Array.from({ length: 280 }, () => quietSpeechFrame);
    await longJournal.appendTail(0, encodePcm16Frames(longFrames), 26_880, 0, longFrames.length);
    longJournal.release();
    await waitForJournalSettled();

    const longStore = createStore();
    longStore.set(computerServicePreferenceAtom, '');
    const capturedOpts: DictationSessionOptions[] = [];
    await recoverDictationForAccount(
      longStore,
      makeMatrixClient(USER_A),
      {},
      {
        loadVad,
        createSession: (opts) => {
          capturedOpts.push(opts);
          return makePausedStubSession();
        },
      }
    );
    const recoveredRecords = capturedOpts[0]?.recovered?.records ?? [];
    expect(recoveredRecords).toHaveLength(2);
    expect(recoveredRecords[0]?.segment.cutReason).toBe('hard');
    expect(recoveredRecords[1]?.segment.overlapped).toBe(true);
    for (const rec of recoveredRecords) {
      expect(rec.wav?.size).toBeGreaterThan(0);
      expect(rec.wav?.size).toBeLessThanOrEqual(DICTATION_MAX_SEGMENT_BYTES);
    }
    await deleteCapture(longJournal.id);
  });

  it('still deletes pure silence tail journals as empty when Silero VAD load fails or finds no speech', async () => {
    // 1. Digital zero silence with failing VAD -> deleted.
    const zeroJournal = beginDictationJournal(SESSION_A, {
      startedAt: 50_000,
      elapsedMs: 1_000,
      capReached: false,
      segments: [],
      groups: [],
    })!;
    const zeroFrames = Array.from({ length: 12 }, () => makeFrame(0));
    await zeroJournal.appendTail(0, encodePcm16Frames(zeroFrames), 1_152, 0, zeroFrames.length);
    zeroJournal.release();

    // 2. Floor noise <= SILENCE_RMS_FLOOR with failing VAD -> also deleted.
    const floorFrame = makeFrame(0.003 * Math.SQRT2);
    expect(
      computeFrameRms(decodePcm16Frames(encodePcm16Frames([floorFrame]))[0]!)
    ).toBeLessThanOrEqual(SILENCE_RMS_FLOOR);
    const floorJournal = beginDictationJournal(SESSION_A, {
      startedAt: 51_000,
      elapsedMs: 1_000,
      capReached: false,
      segments: [],
      groups: [],
    })!;
    const floorFrames = Array.from({ length: 12 }, () => floorFrame);
    await floorJournal.appendTail(0, encodePcm16Frames(floorFrames), 1_152, 0, floorFrames.length);
    floorJournal.release();
    await waitForJournalSettled();

    const failingVad = vi.fn(async () => {
      throw new Error('WASM unavailable');
    });
    const store = createStore();
    store.set(computerServicePreferenceAtom, '');
    await recoverDictationForAccount(store, makeMatrixClient(USER_A), {}, { loadVad: failingVad });
    await waitForJournalSettled();

    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect((await readJournalRow(zeroJournal.id)).recording).toBeUndefined();
    expect((await readJournalRow(floorJournal.id)).recording).toBeUndefined();
    expect(await hasDictationJournalRecord(SESSION_A)).toBe(false);
  });

  it('preserves full mixed-volume speech tail when Silero VAD load fails instead of dropping quieter portions', async () => {
    // 30 quiet speech frames (RMS ~0.010, below 0.015 RMS fallback threshold) + 10 louder frames
    // (RMS ~0.030). Without preserving the full tail on VAD failure, RMS would keep only ~0.96s.
    const quietFrame = makeFrame(0.01 * Math.SQRT2);
    const loudFrame = makeFrame(0.03 * Math.SQRT2);
    const frames = [
      ...Array.from({ length: 20 }, () => quietFrame),
      ...Array.from({ length: 10 }, () => loudFrame),
      ...Array.from({ length: 10 }, () => quietFrame),
    ];

    const journal = beginDictationJournal(SESSION_A, {
      startedAt: 60_000,
      elapsedMs: 0,
      capReached: false,
      segments: [],
      groups: [],
    })!;
    await journal.appendTail(0, encodePcm16Frames(frames), 3_840, 0, frames.length);
    journal.release();
    await waitForJournalSettled();

    const failingVad = vi.fn(async () => {
      throw new Error('WASM unavailable');
    });
    const store = createStore();
    store.set(computerServicePreferenceAtom, '');
    const capturedOpts: DictationSessionOptions[] = [];
    await recoverDictationForAccount(
      store,
      makeMatrixClient(USER_A),
      {},
      {
        loadVad: failingVad,
        createSession: (opts) => {
          capturedOpts.push(opts);
          return makePausedStubSession();
        },
      }
    );
    const recoveredRecords = capturedOpts[0]?.recovered?.records ?? [];
    expect(recoveredRecords).toHaveLength(1);
    expect(recoveredRecords[0]?.segment.seconds).toBeCloseTo(3.84, 2);
    await deleteCapture(journal.id);
  });

  it('keeps original PCM tail recoverable if IndexedDB rejects the replacement WAV write', async () => {
    const frames = Array.from({ length: 12 }, () => makeFrame(0.2));
    const journal = beginDictationJournal(SESSION_A, {
      startedAt: 61_000,
      elapsedMs: 0,
      capReached: false,
      segments: [],
      groups: [],
    })!;
    await journal.appendTail(0, encodePcm16Frames(frames), 1_152, 0, frames.length);
    journal.release();
    await waitForJournalSettled();

    // Force only the replacement WAV put (type === 'audio/wav') to fail with QuotaExceededError.
    const origPut = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'audio/wav') {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return origPut.call(this, value, key);
    });

    try {
      const store = createStore();
      store.set(computerServicePreferenceAtom, '');
      await recoverDictationForAccount(
        store,
        makeMatrixClient(USER_A),
        {},
        { loadVad: async () => { throw new Error('WASM unavailable'); } }
      );
      await waitForJournalSettled();

      // Transaction rolled back atomically: original PCM tail chunk is still on disk.
      const row = await readJournalRow(journal.id);
      expect(row.recording).toBeDefined();
      expect(row.chunks.some((c) => c.seq >= TAIL_SEQ_OFFSET)).toBe(true);
    } finally {
      putSpy.mockRestore();
      await deleteCapture(journal.id);
    }
  });
});
