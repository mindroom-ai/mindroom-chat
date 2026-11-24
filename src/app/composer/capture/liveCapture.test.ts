import { createStore } from 'jotai';
import { describe, expect, it, vi } from 'vitest';
import type { DictationSession, DictationSnapshot } from '../dictation/dictationSession';
import type { VoiceCaptureSession, VoiceCaptureSnapshot } from '../voice/voiceCaptureSession';
import {
  beginLiveCapture,
  captureAccountGuard,
  claimLiveDictation,
  claimLiveVoice,
  clearLiveCapture,
  discardLiveCapture,
  endLiveCapturesOfAccount,
  liveCaptureAtom,
  liveCaptureErrorAtom,
  parkLiveCapture,
  restoreLiveCapture,
} from './liveCapture';

const mockVoice = (initial: Partial<VoiceCaptureSnapshot> = {}) => {
  let snapshot: VoiceCaptureSnapshot = {
    phase: 'recording',
    elapsedMs: 1_000,
    waveform: [],
    sampleCount: 0,
    canPause: true,
    errorMessage: undefined,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const start = vi.fn(async () => true);
  const discard = vi.fn(async () => undefined);
  const park = vi.fn();
  const reset = vi.fn();
  const canStop = vi.fn(() => snapshot.phase === 'recording' || snapshot.phase === 'paused');
  const session = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    canStop,
    discard,
    park,
    reset,
  } as unknown as VoiceCaptureSession;
  const emit = (next: Partial<VoiceCaptureSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };
  return { session, emit, start, discard, park, reset };
};

const mockDictation = (initial: Partial<DictationSnapshot> = {}) => {
  let snapshot: DictationSnapshot = {
    phase: 'recording',
    elapsedMs: 2_000,
    waveform: [],
    sampleCount: 0,
    pendingUploads: 0,
    failedSegments: 0,
    completedSegments: 0,
    hasPartialText: false,
    previewText: '',
    capReached: false,
    interrupted: false,
    errorMessage: undefined,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const start = vi.fn(async () => true);
  const discard = vi.fn(async () => undefined);
  const park = vi.fn();
  const reset = vi.fn();
  const session = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    discard,
    park,
    reset,
  } as unknown as DictationSession;
  const emit = (next: Partial<DictationSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };
  return { session, emit, start, discard, park, reset };
};

describe('liveCapture', () => {
  it('enforces mutual exclusion between voice and dictation and surfaces spontaneous errors', async () => {
    const store = createStore();
    const voice = mockVoice();
    const dictation = mockDictation();

    expect(await beginLiveCapture(store, 'voice', () => voice.session)).toBe(true);
    expect(store.get(liveCaptureAtom)).toEqual({ kind: 'voice', session: voice.session });
    // Dictation cannot start while voice occupies the single live capture slot.
    expect(await beginLiveCapture(store, 'dictation', () => dictation.session)).toBe(false);
    expect(dictation.start).not.toHaveBeenCalled();

    // Spontaneous return to idle clears the slot and publishes the typed error.
    voice.emit({ phase: 'idle', errorMessage: 'No audio data was captured.' });
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(store.get(liveCaptureErrorAtom)).toEqual({
      kind: 'voice',
      message: 'No audio data was captured.',
    });

    // Now dictation can start and clears the previous error.
    expect(await beginLiveCapture(store, 'dictation', () => dictation.session)).toBe(true);
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
    expect(store.get(liveCaptureAtom)).toEqual({ kind: 'dictation', session: dictation.session });
  });

  it('restores paused captures without calling start and rejects occupied or idle slots', () => {
    const store = createStore();
    const idle = mockDictation({ phase: 'idle' });
    expect(restoreLiveCapture(store, { kind: 'dictation', session: idle.session })).toBe(false);

    const recovered = mockDictation({ phase: 'paused' });
    expect(restoreLiveCapture(store, { kind: 'dictation', session: recovered.session })).toBe(true);
    expect(recovered.start).not.toHaveBeenCalled();
    expect(store.get(liveCaptureAtom)).toEqual({ kind: 'dictation', session: recovered.session });

    const second = mockVoice({ phase: 'paused' });
    expect(restoreLiveCapture(store, { kind: 'voice', session: second.session })).toBe(false);
  });

  it('claims by kind synchronously, guards clear/discard by expected session, and resets on account exit', async () => {
    const store = createStore();
    const dictation = mockDictation({ phase: 'paused' });
    const other = mockDictation({ phase: 'paused' });
    restoreLiveCapture(store, { kind: 'dictation', session: dictation.session });

    // Voice claim ignores dictation; mismatched expected session is ignored.
    expect(claimLiveVoice(store)).toBeUndefined();
    expect(claimLiveDictation(store, other.session)).toBeUndefined();
    expect(clearLiveCapture(store, other.session)).toBe(false);
    await discardLiveCapture(store, other.session);
    expect(dictation.discard).not.toHaveBeenCalled();

    const sameAccount = captureAccountGuard(store);
    expect(sameAccount()).toBe(true);
    expect(claimLiveDictation(store, dictation.session)).toBe(dictation.session);
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    // Second claim sees nothing.
    expect(claimLiveDictation(store)).toBeUndefined();

    // Another live voice session starts while the claimed dictation is still finishing.
    const voice = mockVoice({ phase: 'recording' });
    expect(await beginLiveCapture(store, 'voice', () => voice.session)).toBe(true);
    store.set(liveCaptureErrorAtom, { kind: 'voice', message: 'Example' });

    // Account exit resets both live and claimed sessions, invalidates guards, clears error.
    endLiveCapturesOfAccount(store);
    expect(sameAccount()).toBe(false);
    expect(voice.reset).toHaveBeenCalledOnce();
    expect(dictation.reset).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
  });

  it('parks live captures and clears ones that transition synchronously to idle', async () => {
    const store = createStore();
    const voice = mockVoice({ phase: 'requesting' });
    voice.park.mockImplementation(() => voice.emit({ phase: 'idle' }));
    expect(await beginLiveCapture(store, 'voice', () => voice.session)).toBe(true);

    parkLiveCapture(store);
    expect(voice.park).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureAtom)).toBeUndefined();

    const dictation = mockDictation({ phase: 'recording' });
    dictation.park.mockImplementation(() => dictation.emit({ phase: 'paused' }));
    expect(await beginLiveCapture(store, 'dictation', () => dictation.session)).toBe(true);

    parkLiveCapture(store);
    expect(dictation.park).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureAtom)).toEqual({ kind: 'dictation', session: dictation.session });
  });
});
