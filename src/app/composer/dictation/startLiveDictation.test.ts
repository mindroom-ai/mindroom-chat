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
  DICTATION_FRAME_SAMPLES,
  DICTATION_SAMPLE_RATE,
  encodePcm16Frames,
  encodePcm16WavBuffer,
} from './dictationSegmenter';
import type { DictationCaptureFactory, DictationSessionOptions } from './dictationSession';
import {
  dictationRestoresAtom,
  recoverDictationForAccount,
  startLiveDictation,
  useRecoverDictation,
} from './startLiveDictation';

const USER_A = '@alice-dictation:example.org';
const USER_B = '@bob-dictation:example.org';

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

const makeMatrixClient = (userId: string, rooms: Record<string, Room> = {}): MatrixClient =>
  ({
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
    await clearCaptureJournal(USER_A);
    await clearCaptureJournal(USER_B);
    vi.restoreAllMocks();
  });

  it('starts live dictation in liveCaptureAtom with a journal and blocks concurrent starts', async () => {
    const store = createStore();
    const transcribe = vi.fn(async () => ({ text: 'ok', seconds: 1 }));

    const started = await startLiveDictation(store, {
      userId: USER_A,
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
    expect(await hasDictationJournalRecord(USER_A)).toBe(true);

    // Concurrent start while occupied is rejected without touching the active slot.
    const second = await startLiveDictation(store, {
      userId: USER_A,
      client: { transcribe },
      captureFactory: makeFakeCapture(),
    });
    expect(second).toBe(false);
    expect(store.get(liveCaptureAtom)).toBe(live);

    if (live?.kind === 'dictation') await live.session.discard();
  });

  it('recovers mid-utterance PCM tail chunks via RMS fallback into liveCaptureAtom (paused, recovered: true)', async () => {
    const journal = beginDictationJournal(USER_A, {
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
    const journal2 = beginDictationJournal(USER_A, {
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
    const emptyJournal = beginDictationJournal(USER_A, {
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
    const textOnlyJournal = beginDictationJournal(USER_A, {
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
          hasWav: false,
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
            hasWav: true,
          },
        ],
        groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' as const }],
      };
      const j = beginDictationJournal(USER_A, { ...baseMeta, segments: [], groups: [] })!;
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
    const journal = beginDictationJournal(USER_A, {
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
          hasWav: false,
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

  it('does not clobber an occupied liveCaptureAtom slot and supports useRecoverDictation hook', async () => {
    const journal = beginDictationJournal(USER_A, {
      startedAt: 4_000,
      elapsedMs: 3_000,
      capReached: false,
      segments: [
        {
          index: 0,
          seconds: 1,
          overlapped: false,
          cutReason: 'natural',
          leadingQuietFrames: 1,
          trailingQuietFrames: 8,
          pauseBeforeMs: Infinity,
          status: 'completed',
          text: 'Hook recovered.',
          retryable: false,
          hasWav: false,
        },
      ],
      groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' }],
    })!;
    journal.release();
    await waitForJournalSettled();

    // Occupied slot rejects recovery while leaving disk rows unlocked & untouched.
    const occupiedStore = createStore();
    restoreLiveCapture(occupiedStore, { kind: 'voice', session: makePausedStubSession() });
    await recoverDictationForAccount(occupiedStore, makeMatrixClient(USER_A), {});
    expect(occupiedStore.get(liveCaptureAtom)?.kind).toBe('voice');
    expect(heldLocks.has(`mindroom-voice-recording:${journal.id}`)).toBe(false);

    // React hook respects enabled=false, then hydrates once when enabled=true.
    const hookStore = createStore();
    hookStore.set(computerServicePreferenceAtom, '');
    const mx = makeMatrixClient(USER_A);

    function Harness({ enabled }: { enabled: boolean }) {
      useRecoverDictation(mx, enabled);
      return null;
    }

    const renderTree = (enabled: boolean) =>
      createElement(
        Provider,
        { store: hookStore },
        createElement(ClientConfigProvider, { value: {} }, createElement(Harness, { enabled }))
      );

    const view = render(renderTree(false));
    await waitForJournalSettled();
    expect(hookStore.get(dictationRestoresAtom).has(USER_A)).toBe(false);
    expect(hookStore.get(liveCaptureAtom)).toBeUndefined();

    view.rerender(renderTree(true));
    await waitFor(() => {
      expect(hookStore.get(liveCaptureAtom)?.kind).toBe('dictation');
    });
    expect(hookStore.get(dictationRestoresAtom).get(USER_A)).toBeNull();
    const live = hookStore.get(liveCaptureAtom);
    if (live?.kind === 'dictation') await live.session.discard();
    view.unmount();
  });

  it('surfaces recovered dictation in Settings via DictationRecoveryFeature only when a journal record exists', async () => {
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
    expect(emptyStore.get(dictationRestoresAtom).has(USER_A)).toBe(false);
    emptyView.unmount();

    // Seed a persisted dictation journal, simulating a crash before reloading straight into Settings.
    const journal = beginDictationJournal(USER_A, {
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
          hasWav: false,
        },
      ],
      groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' }],
    })!;
    journal.release();
    await waitForJournalSettled();

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
});
