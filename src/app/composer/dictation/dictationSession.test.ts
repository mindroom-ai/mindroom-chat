// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginDictationJournal,
  clearCaptureJournal,
  deleteCapture,
  recoverDictationJournal,
  releaseCapture,
  TAIL_SEQ_OFFSET,
  type RecoveredDictationJournal,
} from '../capture/captureJournal';
import type { ClientSessions } from '../../computer/clientSessions';
import { DictationApiError, DictationClient } from './api';
import { createDictationRateBudget } from './dictationRefinement';
import {
  DICTATION_FRAME_SAMPLES,
  DICTATION_SAMPLE_RATE,
  encodePcm16Wav,
} from './dictationSegmenter';
import {
  createDictationSession,
  type DictationCaptureFactory,
  type DictationTranscriber,
} from './dictationSession';

const makeFrame = (amplitude: number): Float32Array => {
  const frame = new Float32Array(DICTATION_FRAME_SAMPLES);
  for (let i = 0; i < frame.length; i += 1) {
    frame[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / DICTATION_SAMPLE_RATE);
  }
  return frame;
};

const flushMicrotasks = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

const makeVad = (release = vi.fn(async () => undefined)) => ({
  score: async (frame: Float32Array) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
  reset: vi.fn(),
  release,
});

type FakeCaptureRig = {
  captureFactory: DictationCaptureFactory;
  pushFrame: (frame: Float32Array) => void;
  triggerTrackEnded: () => void;
  stopAndFlush: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  setTailOnStop: (frames: Float32Array[]) => void;
};

const createFakeCaptureRig = (): FakeCaptureRig => {
  let onFrameCb: ((frame: Float32Array) => void) | undefined;
  let onTrackEndedCb: (() => void) | undefined;
  let tailFrames: Float32Array[] = [];
  const stopAndFlush = vi.fn(async () => {
    for (const frame of tailFrames) onFrameCb?.(frame);
    tailFrames = [];
  });
  const dispose = vi.fn();

  const captureFactory: DictationCaptureFactory = async ({ onFrame, onTrackEnded }) => {
    onFrameCb = onFrame;
    onTrackEndedCb = onTrackEnded;
    return {
      readLevel: () => 0.25,
      stopAndFlush,
      dispose,
    };
  };

  return {
    captureFactory,
    pushFrame: (frame) => onFrameCb?.(frame),
    triggerTrackEnded: () => onTrackEndedCb?.(),
    stopAndFlush,
    dispose,
    setTailOnStop: (frames) => {
      tailFrames = frames;
    },
  };
};

const pushSpeechAndPause = (pushFrame: (frame: Float32Array) => void) => {
  for (let i = 0; i < 4; i += 1) pushFrame(makeFrame(0.3));
  for (let i = 0; i < 8; i += 1) pushFrame(makeFrame(0.001));
};

describe('createDictationSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refines live preview via rolling merge on seg1 arrival and finishes with zero extra uploads', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: Array<{ prompt?: string; roomId?: string }> = [];
    const responses = ['First clause.', 'First clause and second clause.'];

    const transcribe = vi.fn(async (_wav: Blob, opts?: { prompt?: string; roomId?: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push({ prompt: opts?.prompt, roomId: opts?.roomId });
      await Promise.resolve();
      inFlight -= 1;
      return { text: responses.shift() ?? '', seconds: 1.2 };
    });

    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      roomId: '!room:example.org',
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
    });

    expect(await session.start()).toBe(true);
    await flushMicrotasks();
    expect(session.getSnapshot().previewText).toBe('');

    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(20);
    expect(session.getSnapshot().previewText).toBe('First clause.');
    expect(session.getSnapshot().hasPartialText).toBe(true);

    // seg1 runs a single merged [seg0, seg1] live rolling upload (no isolated seg1 upload).
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    expect(session.getSnapshot().previewText).toBe('First clause and second clause.');
    expect(session.getSnapshot().completedSegments).toBe(2);
    expect(calls).toHaveLength(2);

    // Finish locks the already-refined open group immediately with zero extra uploads.
    const finished = await session.finish();
    expect(finished).toEqual({
      status: 'completed',
      text: 'First clause and second clause.',
    });
    expect(maxInFlight).toBe(1);
    expect(calls).toEqual([
      { prompt: undefined, roomId: '!room:example.org' },
      { prompt: undefined, roomId: '!room:example.org' },
    ]);
    expect(session.getSnapshot().phase).toBe('idle');
    expect(session.getSnapshot().previewText).toBe('');
  });

  it('retains failed segment WAV for auto-retry and manual retryFailed without re-uploading completed segments', async () => {
    let seg0Attempts = 0;
    let seg1Attempts = 0;
    const sleepDelays: number[] = [];

    let firstWavSize = 0;
    const transcribe = vi.fn(async (wav: Blob, opts?: { prompt?: string }) => {
      if (!opts?.prompt && (firstWavSize === 0 || wav.size === firstWavSize)) {
        firstWavSize = wav.size;
        seg0Attempts += 1;
        return { text: 'Hello from segment zero.', seconds: 1.0 };
      }
      if (!opts?.prompt) {
        // Optional merged refinement also hits 429 while backend is rate-limited; fails open.
        throw new DictationApiError('Rate limited', 429, 'too-many-requests', 2000);
      }
      seg1Attempts += 1;
      if (seg1Attempts <= 3) {
        throw new DictationApiError('Rate limited', 429, 'too-many-requests', 2000);
      }
      return { text: 'And segment one recovered.', seconds: 1.0 };
    });

    const rig = createFakeCaptureRig();
    let clock = 1_000;
    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
      now: () => clock,
      sleep: async (ms) => {
        sleepDelays.push(ms);
        clock += ms;
      },
    });

    await session.start();
    await flushMicrotasks();
    pushSpeechAndPause(rig.pushFrame);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(60);

    expect(seg0Attempts).toBe(1);
    expect(seg1Attempts).toBe(2);
    expect(sleepDelays).toContain(2000);
    expect(session.getSnapshot().failedSegments).toBe(1);

    // Finish retries transient failed segment once more (attempt 3 -> still fails -> phase failed).
    const finished = await session.finish();
    expect(finished).toMatchObject({
      status: 'failed',
      failedSegments: 1,
      completedSegments: 1,
    });
    expect(session.getSnapshot().phase).toBe('failed');
    expect(seg0Attempts).toBe(1);
    expect(seg1Attempts).toBe(3);

    // Manual retryFailed retries ONLY segment 1 and stitches both segments in order.
    const retryRes = await session.retryFailed();
    expect(retryRes).toEqual({
      status: 'completed',
      text: 'Hello from segment zero. And segment one recovered.',
    });
    expect(seg0Attempts).toBe(1);
    expect(seg1Attempts).toBe(4);
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('never auto-retries non-transient 400/403/413 errors mid-speech or on Finish', async () => {
    const transcribe = vi.fn(async () => {
      throw new DictationApiError('Audio too large', 413, 'too-large');
    });
    const rig = createFakeCaptureRig();
    const sleep = vi.fn(async () => undefined);

    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
      sleep,
    });

    await session.start();
    await flushMicrotasks();
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(20);

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();

    const finished = await session.finish();
    expect(finished.status).toBe('failed');
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('applies 429 Retry-After queue-wide to subsequent queued segments', async () => {
    let call = 0;
    const sleepDelays: number[] = [];
    let clock = 5_000;

    const transcribe = vi.fn(async () => {
      call += 1;
      if (call <= 2) {
        throw new DictationApiError('Too many requests', 429, 'too-many-requests', 4000);
      }
      return { text: 'Second segment ok.', seconds: 1.0 };
    });

    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
      now: () => clock,
      sleep: async (ms) => {
        sleepDelays.push(ms);
        clock += ms;
      },
    });

    await session.start();
    await flushMicrotasks();
    // Enqueue 2 segments; seg 0 gets 429 twice (auto-retry + fail), setting retryNotBeforeMs.
    pushSpeechAndPause(rig.pushFrame);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(50);

    // Both seg 0's retry AND the live rolling [0..1] upload waited 4000 ms for the queue-wide deadline.
    expect(sleepDelays).toEqual([4000, 4000]);
    expect(session.getSnapshot()).toMatchObject({
      failedSegments: 0,
      completedSegments: 2,
    });
  });

  it('supports takePartialText when some segments succeeded and others failed', async () => {
    let count = 0;
    const transcribe = vi.fn(async () => {
      count += 1;
      if (count === 1) return { text: 'Kept text.', seconds: 1.0 };
      throw new DictationApiError('Backend down', 503, 'unavailable');
    });

    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
      sleep: async () => undefined,
    });

    await session.start();
    await flushMicrotasks();
    pushSpeechAndPause(rig.pushFrame);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);

    const finished = await session.finish();
    expect(finished.status).toBe('failed');
    expect(session.getSnapshot().hasPartialText).toBe(true);
    expect(session.getSnapshot().previewText).toBe('Kept text.');

    expect(session.takePartialText()).toEqual({ text: 'Kept text.' });
    expect(session.getSnapshot().phase).toBe('idle');
    expect(session.getSnapshot().previewText).toBe('');
  });

  it('updates previewText as each segment completes and resets it on discard', async () => {
    const responses = ['First phrase.', 'First phrase and second phrase.'];
    const transcribe = vi.fn(async () => ({ text: responses.shift() ?? '', seconds: 0.8 }));
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
    });

    expect(session.getSnapshot().previewText).toBe('');
    await session.start();
    await flushMicrotasks();
    expect(session.getSnapshot().previewText).toBe('');

    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(20);
    expect(session.getSnapshot().previewText).toBe('First phrase.');
    expect(session.getSnapshot().hasPartialText).toBe(true);

    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    expect(session.getSnapshot().previewText).toBe('First phrase and second phrase.');

    await session.discard();
    expect(session.getSnapshot().phase).toBe('idle');
    expect(session.getSnapshot().previewText).toBe('');
    expect(session.getSnapshot().hasPartialText).toBe(false);
  });

  it('aborts in-flight uploads and disposes capture immediately on discard', async () => {
    let capturedSignal: AbortSignal | undefined;
    const transcribe = vi.fn(
      (_wav: Blob, _opts: unknown, signal?: AbortSignal) =>
        new Promise<{ text: string; seconds: number }>((_resolve, reject) => {
          capturedSignal = signal;
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );

    const vadRelease = vi.fn(async () => undefined);
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(vadRelease),
      captureFactory: rig.captureFactory,
    });

    await session.start();
    await flushMicrotasks();
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(15);
    expect(transcribe).toHaveBeenCalledTimes(1);

    await session.discard();
    expect(capturedSignal?.aborted).toBe(true);
    expect(rig.dispose).toHaveBeenCalledTimes(1);
    expect(rig.stopAndFlush).not.toHaveBeenCalled();
    expect(vadRelease).toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('awaits worklet stop tail flush on Pause and Finish so the final syllable is not clipped', async () => {
    const transcribe = vi.fn(async () => ({ text: 'Tail captured.', seconds: 0.3 }));
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
    });

    await session.start();
    await flushMicrotasks();

    // Only 1 voiced frame reached main thread before Finish; the 2nd frame arrives in the worklet stop tail.
    rig.pushFrame(makeFrame(0.3));
    rig.setTailOnStop([makeFrame(0.3)]);

    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Tail captured.',
    });
    expect(rig.stopAndFlush).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('pauses visibly and flushes captured speech when track.onended fires unexpectedly', async () => {
    const transcribe = vi.fn(async () => ({ text: 'Captured before disconnect.', seconds: 0.6 }));
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
    });

    await session.start();
    await flushMicrotasks();

    for (let i = 0; i < 4; i += 1) rig.pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);
    rig.triggerTrackEnded();
    await flushMicrotasks(20);

    expect(session.getSnapshot()).toMatchObject({
      phase: 'paused',
      interrupted: true,
      completedSegments: 1,
    });
    expect(transcribe).toHaveBeenCalledTimes(1);

    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Captured before disconnect.',
    });
  });

  it('flushes speech on Pause so it transcribes while paused, then resumes cleanly', async () => {
    let call = 0;
    const transcribe = vi.fn(async () => {
      call += 1;
      return { text: call === 1 ? 'Before pause' : 'after resume.', seconds: 0.5 };
    });
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
    });

    await session.start();
    await flushMicrotasks();
    for (let i = 0; i < 4; i += 1) rig.pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);

    await session.pause();
    await flushMicrotasks(15);
    expect(session.getSnapshot().phase).toBe('paused');
    expect(transcribe).toHaveBeenCalledTimes(1);

    expect(await session.resume()).toBe(true);
    await flushMicrotasks();
    for (let i = 0; i < 4; i += 1) rig.pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);

    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Before pause after resume.',
    });
  });

  it('reports a clear audio capture error when audioWorklet.addModule fails instead of blaming mic permissions', async () => {
    const track = {
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const fakeContext = {
      state: 'running',
      sampleRate: 48_000,
      destination: {},
      onstatechange: null,
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      createAnalyser: vi.fn(() => ({
        fftSize: 2048,
        getByteTimeDomainData: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() })),
      audioWorklet: {
        addModule: vi.fn(async () => {
          throw new Error('CSP blocked module');
        }),
      },
    } as unknown as AudioContext;

    const session = createDictationSession({
      client: { transcribe: vi.fn() },
      getUserMedia: async () =>
        ({ getAudioTracks: () => [track], getTracks: () => [track] }) as unknown as MediaStream,
      createAudioContext: () => fakeContext,
      loadVad: async () => makeVad(),
    });

    expect(await session.start()).toBe(false);
    expect(session.getSnapshot().phase).toBe('idle');
    expect(session.getSnapshot().errorMessage).toBe(
      'Could not initialize dictation audio capture.'
    );
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops mic tracks and closes AudioContext immediately when discarded during pending addModule', async () => {
    const track = {
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack;
    const close = vi.fn(async () => undefined);
    let addModuleCalled!: () => void;
    const addModuleStarted = new Promise<void>((resolve) => {
      addModuleCalled = resolve;
    });
    const fakeContext = {
      state: 'running',
      sampleRate: 48_000,
      destination: {},
      onstatechange: null,
      resume: vi.fn(async () => undefined),
      close,
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      createAnalyser: vi.fn(() => ({
        fftSize: 2048,
        getByteTimeDomainData: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() })),
      audioWorklet: {
        addModule: vi.fn(() => {
          addModuleCalled();
          return new Promise<void>(() => undefined);
        }),
      },
    } as unknown as AudioContext;

    const prevWorkletNode = globalThis.AudioWorkletNode;
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: vi.fn(),
    });
    try {
      const session = createDictationSession({
        client: { transcribe: vi.fn() },
        getUserMedia: async () =>
          ({ getAudioTracks: () => [track], getTracks: () => [track] }) as unknown as MediaStream,
        createAudioContext: () => fakeContext,
        loadVad: async () => makeVad(),
      });

      const startPromise = session.start();
      await addModuleStarted;
      expect(track.stop).not.toHaveBeenCalled();

      await session.discard();
      expect(track.stop).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(session.getSnapshot().phase).toBe('idle');
      void startPromise;
    } finally {
      Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        value: prevWorkletNode,
      });
    }
  });

  const startTestSession = async (
    transcribe: DictationTranscriber['transcribe'],
    extra: Partial<Parameters<typeof createDictationSession>[0]> = {}
  ) => {
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
      ...extra,
    });
    await session.start();
    await flushMicrotasks();
    return { rig, session };
  };

  it('coalesces slow-speaker pauses live with capped silence and locks on 8 s idle silence and Finish with zero extra uploads', async () => {
    const calls: Array<{ size: number; prompt?: string }> = [];
    const responses = [
      'Go back.',
      'Go back and re-transcribe',
      'certain parts.',
      'certain parts when it makes sense.',
    ];
    const { rig, session } = await startTestSession(async (wav, opts) => {
      calls.push({ size: wav.size, prompt: opts?.prompt });
      return { text: responses.shift() ?? '', seconds: 1.0 };
    });

    // Clause 0 + 5 s thinking pause (52 quiet frames) + Clause 1 -> live rolling merge caps 5 s gap to 288 ms.
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    expect(session.getSnapshot().previewText).toBe('Go back.');

    for (let i = 0; i < 52; i += 1) rig.pushFrame(makeFrame(0.001));
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(80);
    expect(session.getSnapshot().previewText).toBe('Go back and re-transcribe');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toBeUndefined();
    expect(calls[1]!.size).toBeLessThan(60_000);

    // ~8 s total silence (8 redemption + 75 idle frames) locks [0..1] with zero extra uploads.
    for (let i = 0; i < 75; i += 1) rig.pushFrame(makeFrame(0.001));
    await flushMicrotasks(120);
    expect(calls).toHaveLength(2);

    // Group [2..3] chains prompt from the locked group and finishes with zero extra uploads.
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    expect(calls).toHaveLength(4);
    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Go back and re-transcribe certain parts when it makes sense.',
    });
    expect(calls).toHaveLength(4);
    expect(calls[2]!.prompt).toBe('Go back and re-transcribe');
    expect(calls[3]!.prompt).toBe('Go back and re-transcribe');
  });

  it('skips uploading the trailing primary on Finish and falls back to it if merged refinement fails', async () => {
    const okResponses = ['First half.', 'First half and final clause.'];
    const okTranscribe = vi.fn(async () => ({ text: okResponses.shift() ?? '', seconds: 1.0 }));
    const { rig: rigA, session: sessionA } = await startTestSession(okTranscribe);
    pushSpeechAndPause(rigA.pushFrame);
    await flushMicrotasks(25);
    for (let i = 0; i < 4; i += 1) rigA.pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);
    await expect(sessionA.finish()).resolves.toEqual({
      status: 'completed',
      text: 'First half and final clause.',
    });
    expect(okTranscribe).toHaveBeenCalledTimes(2);

    let call = 0;
    const fallbackTranscribe = vi.fn(async () => {
      call += 1;
      if (call === 1) return { text: 'First half.', seconds: 1.0 };
      if (call === 2) throw new DictationApiError('Unavailable', 503, 'unavailable');
      return { text: 'Final clause.', seconds: 1.0 };
    });
    const { rig: rigB, session: sessionB } = await startTestSession(fallbackTranscribe);
    pushSpeechAndPause(rigB.pushFrame);
    await flushMicrotasks(25);
    for (let i = 0; i < 4; i += 1) rigB.pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);
    await expect(sessionB.finish()).resolves.toEqual({
      status: 'completed',
      text: 'First half. Final clause.',
    });
    expect(fallbackTranscribe).toHaveBeenCalledTimes(3);
  });

  it('skips refinement for single utterances and 25 s hard cuts while preserving overlap deduplication', async () => {
    const singleTranscribe = vi.fn(async () => ({ text: 'One clean sentence.', seconds: 1.0 }));
    const { rig: rigS, session: single } = await startTestSession(singleTranscribe);
    pushSpeechAndPause(rigS.pushFrame);
    await flushMicrotasks(25);
    await expect(single.finish()).resolves.toEqual({
      status: 'completed',
      text: 'One clean sentence.',
    });
    expect(singleTranscribe).toHaveBeenCalledTimes(1);

    const hardResponses = [
      'Long continuous speech ending alpha beta',
      'alpha beta first pause.',
      'alpha beta first pause and ending.',
    ];
    const hardTranscribe = vi.fn(async () => ({ text: hardResponses.shift() ?? '', seconds: 2.0 }));
    const { rig: rigH, session: hard } = await startTestSession(hardTranscribe);
    for (let i = 0; i < 262; i += 1) rigH.pushFrame(makeFrame(0.3));
    for (let i = 0; i < 8; i += 1) rigH.pushFrame(makeFrame(0.001));
    await flushMicrotasks(300);
    for (let i = 0; i < 4; i += 1) rigH.pushFrame(makeFrame(0.3));
    await flushMicrotasks(15);
    await expect(hard.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Long continuous speech ending alpha beta first pause and ending.',
    });
    expect(hardTranscribe).toHaveBeenCalledTimes(3);
  });

  it('locks open groups with zero extra upload on 16 s duration and 4-segment caps', async () => {
    // 16 s cap: seg0 (~7.7 s) + seg1 (~7.7 s) live-refines [0..1]; seg2 (~4 s) locks [0..1] as-is.
    const durResponses = ['Part A.', 'Part A and Part B.', 'Part C.'];
    const durPrompts: Array<string | undefined> = [];
    const { rig: rigD, session: durSession } = await startTestSession(async (_wav, opts) => {
      durPrompts.push(opts?.prompt);
      return { text: durResponses.shift() ?? '', seconds: 2.0 };
    });
    const pushClause = (voicedFrames: number) => {
      for (let i = 0; i < voicedFrames; i += 1) rigD.pushFrame(makeFrame(0.3));
      for (let i = 0; i < 8; i += 1) rigD.pushFrame(makeFrame(0.001));
    };
    pushClause(80);
    await flushMicrotasks(110);
    pushClause(80);
    await flushMicrotasks(110);
    expect(durSession.getSnapshot().previewText).toBe('Part A and Part B.');
    pushClause(40);
    await flushMicrotasks(70);
    expect(durSession.getSnapshot().previewText).toBe('Part A and Part B. Part C.');
    expect(durPrompts).toEqual([undefined, undefined, 'Part A and Part B.']);
    await expect(durSession.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Part A and Part B. Part C.',
    });
    expect(durPrompts).toHaveLength(3);

    // 4-segment cap: 5th segment locks [0..3] with zero extra upload and opens a fresh group.
    const segResponses = ['One.', 'One two.', 'One two three.', 'One two three four.', 'Five.'];
    const segPrompts: Array<string | undefined> = [];
    const { rig: rigS, session: segSession } = await startTestSession(async (_wav, opts) => {
      segPrompts.push(opts?.prompt);
      return { text: segResponses.shift() ?? '', seconds: 1.0 };
    });
    for (let i = 0; i < 5; i += 1) {
      pushSpeechAndPause(rigS.pushFrame);
      await flushMicrotasks(25);
    }
    await expect(segSession.finish()).resolves.toEqual({
      status: 'completed',
      text: 'One two three four. Five.',
    });
    expect(segPrompts).toEqual([undefined, undefined, undefined, undefined, 'One two three four.']);
  });

  it('fails open on refinement 503, empty text, 429 Retry-After, and Finish polish timeout', async () => {
    const emptyResponses = ['Alpha.', '   ', 'Beta.', '   '];
    const { rig: rigE, session: emptySess } = await startTestSession(async () => ({
      text: emptyResponses.shift() ?? '',
      seconds: 1,
    }));
    pushSpeechAndPause(rigE.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rigE.pushFrame);
    await flushMicrotasks(25);
    await expect(emptySess.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Alpha. Beta.',
    });

    let call429 = 0;
    let clock = 10_000;
    const sleepDelays: number[] = [];
    const { rig: rig429, session: sess429 } = await startTestSession(
      async () => {
        call429 += 1;
        if (call429 === 1) return { text: 'Part one.', seconds: 1 };
        if (call429 === 2)
          throw new DictationApiError('Rate limited', 429, 'too-many-requests', 1500);
        return { text: 'Part two.', seconds: 1 };
      },
      {
        now: () => clock,
        sleep: async (ms) => {
          sleepDelays.push(ms);
          clock += ms;
        },
      }
    );
    pushSpeechAndPause(rig429.pushFrame);
    await flushMicrotasks(25);
    for (let i = 0; i < 4; i += 1) rig429.pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);
    await expect(sess429.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Part one. Part two.',
    });
    expect(sleepDelays).toEqual([1500]);

    // Polish timeout aborts optional Finish merge once every uncovered primary is already completed.
    let polishCall = 0;
    let polishAborted = false;
    const { rig: rigT, session: timeoutSess } = await startTestSession(
      (_wav: Blob, _opts?: { prompt?: string; roomId?: string }, signal?: AbortSignal) => {
        polishCall += 1;
        if (polishCall === 1) return Promise.resolve({ text: 'One.', seconds: 1 });
        if (polishCall === 2)
          return Promise.reject(new DictationApiError('Unavailable', 503, 'unavailable'));
        if (polishCall === 3) return Promise.resolve({ text: 'Two.', seconds: 1 });
        return new Promise<{ text: string; seconds: number }>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            polishAborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      },
      { finishPolishTimeoutMs: 50 }
    );
    pushSpeechAndPause(rigT.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rigT.pushFrame);
    await flushMicrotasks(40);
    await expect(timeoutSess.finish()).resolves.toEqual({ status: 'completed', text: 'One. Two.' });
    expect(polishAborted).toBe(true);

    // Finish refinement that is the sole transcription for a flushed segment is NOT aborted.
    let soleCall = 0;
    let soleAbortedDuringUpload: boolean | undefined;
    const { rig: rigSole, session: soleSess } = await startTestSession(
      (_wav: Blob, _opts?: { prompt?: string; roomId?: string }, signal?: AbortSignal) => {
        soleCall += 1;
        if (soleCall === 1) return Promise.resolve({ text: 'First.', seconds: 1 });
        return new Promise<{ text: string; seconds: number }>((resolve) => {
          setTimeout(() => {
            soleAbortedDuringUpload = signal?.aborted;
            resolve({ text: 'First and flushed tail.', seconds: 1.5 });
          }, 80);
        });
      },
      { finishPolishTimeoutMs: 30 }
    );
    pushSpeechAndPause(rigSole.pushFrame);
    await flushMicrotasks(25);
    for (let i = 0; i < 4; i += 1) rigSole.pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);
    await expect(soleSess.finish()).resolves.toEqual({
      status: 'completed',
      text: 'First and flushed tail.',
    });
    expect(soleAbortedDuringUpload).toBe(false);
  });

  it('self-heals an earlier failed primary when merged group refinement succeeds on Finish', async () => {
    let call = 0;
    const transcribe = vi.fn(async () => {
      call += 1;
      if (call === 1) return { text: 'Clause one.', seconds: 1.0 };
      if (call <= 4) throw new DictationApiError('Transient', 503, 'unavailable');
      return { text: 'Clause one and healed clause two.', seconds: 2.0 };
    });
    const { rig, session } = await startTestSession(transcribe, { sleep: async () => undefined });
    pushSpeechAndPause(rig.pushFrame);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(60);
    expect(session.getSnapshot().failedSegments).toBe(1);

    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Clause one and healed clause two.',
    });
    expect(transcribe).toHaveBeenCalledTimes(5);
  });

  it('skips optional live and Finish refinements when the rolling 1-minute request budget is full', async () => {
    let count = 0;
    const transcribe = vi.fn(async () => ({ text: `Clip ${(count += 1)}.`, seconds: 1.0 }));
    const { rig, session } = await startTestSession(transcribe, { now: () => 50_000 });

    // Burn 23 primary requests inside the rolling 60 s window via quick single-utterance runs.
    for (let i = 0; i < 23; i += 1) {
      if (i > 0) {
        await session.start();
        await flushMicrotasks();
      }
      pushSpeechAndPause(rig.pushFrame);
      await flushMicrotasks(25);
      await session.finish();
    }
    expect(transcribe).toHaveBeenCalledTimes(23);

    // Next session's seg0 hits 24 RPM; seg1 live rolling and Finish refinement both fail open cleanly.
    await session.start();
    await flushMicrotasks();
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Clip 24. Clip 25.',
    });
    expect(transcribe).toHaveBeenCalledTimes(25);
  });

  it('seals a singleton group on ~8 s idle silence so speech after a long pause does not merge across it', async () => {
    const responses = ['First thought.', 'Later thought.'];
    const transcribe = vi.fn(async () => ({ text: responses.shift() ?? '', seconds: 1.0 }));
    const { rig, session } = await startTestSession(transcribe);

    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    // 75 idle frames (~8 s total silence after speech) seals [0..0] as fallback with 0 extra calls.
    for (let i = 0; i < 75; i += 1) rig.pushFrame(makeFrame(0.001));
    await flushMicrotasks(110);

    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'First thought. Later thought.',
    });
    // Zero refinement calls: neither singleton merged across the 8 s silence boundary.
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('shares rolling rate budget across replacement DictationClient/DictationSession instances', async () => {
    let callCount = 0;
    const send = vi.fn(async () => {
      callCount += 1;
      return Response.json({ text: `Turn ${callCount}.`, seconds: 1.0 });
    });
    const sharedSessions = { send } as unknown as ClientSessions;

    // 23 replacement sessions (as Finish & Send creates fresh DictationClient + DictationSession).
    for (let i = 0; i < 23; i += 1) {
      const rig = createFakeCaptureRig();
      const session = createDictationSession({
        client: new DictationClient(sharedSessions),
        loadVad: async () => makeVad(),
        captureFactory: rig.captureFactory,
        now: () => 50_000,
      });
      await session.start();
      await flushMicrotasks();
      pushSpeechAndPause(rig.pushFrame);
      await flushMicrotasks(25);
      await session.finish();
    }
    expect(send).toHaveBeenCalledTimes(23);

    // Next replacement session's seg0 hits 24 RPM; seg1 fails open to primary and Finish skips refinement.
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: new DictationClient(sharedSessions),
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
      now: () => 50_000,
    });
    await session.start();
    await flushMicrotasks();
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Turn 24. Turn 25.',
    });
    expect(send).toHaveBeenCalledTimes(25);
  });

  it('carries 429 Retry-After from a Finish refinement into the next replacement session', async () => {
    const rateBudget = createDictationRateBudget();
    let clock = 20_000;
    const sleepDelays: number[] = [];
    const sleep = async (ms: number) => {
      sleepDelays.push(ms);
      clock += ms;
    };

    // Session 1: live rolling fails open, both primaries succeed, Finish refinement hits 429 (3000 ms).
    let s1Calls = 0;
    const { rig: rig1, session: session1 } = await startTestSession(
      async () => {
        s1Calls += 1;
        if (s1Calls === 1) return { text: 'First.', seconds: 1.0 };
        if (s1Calls === 2) throw new DictationApiError('Unavailable', 503, 'unavailable');
        if (s1Calls === 3) return { text: 'Second.', seconds: 1.0 };
        throw new DictationApiError('Rate limited', 429, 'too-many-requests', 3000);
      },
      { rateBudget, now: () => clock, sleep }
    );
    pushSpeechAndPause(rig1.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rig1.pushFrame);
    await flushMicrotasks(40);
    await expect(session1.finish()).resolves.toEqual({
      status: 'completed',
      text: 'First. Second.',
    });
    expect(sleepDelays).toEqual([]);

    // Replacement Session 2 starts immediately; its first primary waits the remaining 3000 ms cooldown.
    const { rig: rig2, session: session2 } = await startTestSession(
      async () => ({ text: 'Next turn.', seconds: 1.0 }),
      { rateBudget, now: () => clock, sleep }
    );
    pushSpeechAndPause(rig2.pushFrame);
    await flushMicrotasks(25);
    await expect(session2.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Next turn.',
    });
    expect(sleepDelays).toEqual([3000]);
  });

  it('updates preview cleanly when seg2 arrives mid-flight and chains [0..2] automatically', async () => {
    let call = 0;
    let resolveLive01!: (value: { text: string; seconds: number }) => void;
    let resolveLive02!: (value: { text: string; seconds: number }) => void;
    const transcribe = vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ text: 'One.', seconds: 1.0 });
      if (call === 2) {
        return new Promise<{ text: string; seconds: number }>((resolve) => {
          resolveLive01 = resolve;
        });
      }
      return new Promise<{ text: string; seconds: number }>((resolve) => {
        resolveLive02 = resolve;
      });
    });
    const { rig, session } = await startTestSession(transcribe);

    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    expect(session.getSnapshot().previewText).toBe('One.');

    // seg1 starts live [0..1]; seg2 arrives before [0..1] finishes.
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    expect(transcribe).toHaveBeenCalledTimes(2);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().pendingUploads).toBe(1);

    // Resolving [0..1] updates preview cleanly and immediately queues [0..2].
    resolveLive01({ text: 'One two', seconds: 1.5 });
    await flushMicrotasks(10);
    expect(session.getSnapshot().previewText).toBe('One two');
    expect(transcribe).toHaveBeenCalledTimes(3);

    resolveLive02({ text: 'One two three.', seconds: 2.0 });
    await flushMicrotasks(10);
    expect(session.getSnapshot().previewText).toBe('One two three.');
    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'One two three.',
    });
    expect(transcribe).toHaveBeenCalledTimes(3);
  });

  it('handles sealing while a live upload is in flight both at and behind group.endIndex', async () => {
    // Case 1: uploadingEnd === endIndex -> transitions straight to refined with zero extra uploads.
    let callA = 0;
    let resolveA!: (value: { text: string; seconds: number }) => void;
    const transcribeA = vi.fn(() => {
      callA += 1;
      if (callA === 1) return Promise.resolve({ text: 'Start.', seconds: 1.0 });
      return new Promise<{ text: string; seconds: number }>((resolve) => {
        resolveA = resolve;
      });
    });
    const { rig: rigA, session: sessA } = await startTestSession(transcribeA);
    pushSpeechAndPause(rigA.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rigA.pushFrame);
    await flushMicrotasks(25);
    const finishA = sessA.finish();
    await flushMicrotasks(15);
    expect(transcribeA).toHaveBeenCalledTimes(2);
    resolveA({ text: 'Start and finish.', seconds: 1.5 });
    await expect(finishA).resolves.toEqual({ status: 'completed', text: 'Start and finish.' });
    expect(transcribeA).toHaveBeenCalledTimes(2);

    // Case 2: seg2 arrives before seal (uploadingEnd < endIndex) -> queues one final [0..2] merge.
    let callB = 0;
    let resolveB!: (value: { text: string; seconds: number }) => void;
    const transcribeB = vi.fn(() => {
      callB += 1;
      if (callB === 1) return Promise.resolve({ text: 'One.', seconds: 1.0 });
      if (callB === 2) {
        return new Promise<{ text: string; seconds: number }>((resolve) => {
          resolveB = resolve;
        });
      }
      return Promise.resolve({ text: 'One two three.', seconds: 2.0 });
    });
    const { rig: rigB, session: sessB } = await startTestSession(transcribeB);
    pushSpeechAndPause(rigB.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rigB.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rigB.pushFrame);
    await flushMicrotasks(25);
    const finishB = sessB.finish();
    await flushMicrotasks(15);
    expect(transcribeB).toHaveBeenCalledTimes(2);
    resolveB({ text: 'One two', seconds: 1.5 });
    await expect(finishB).resolves.toEqual({ status: 'completed', text: 'One two three.' });
    expect(transcribeB).toHaveBeenCalledTimes(3);
  });

  it('preserves earlier refinedText when a later rolling merge fails and retries only the uncovered WAV', async () => {
    let call = 0;
    const prompts: Array<string | undefined> = [];
    const transcribe = vi.fn(async (_wav: Blob, opts?: { prompt?: string }) => {
      call += 1;
      prompts.push(opts?.prompt);
      if (call === 1) return { text: 'Alpha.', seconds: 1.0 };
      if (call === 2) return { text: 'Alpha and beta', seconds: 1.5 };
      if (call <= 7) throw new DictationApiError('Unavailable', 503, 'unavailable');
      return { text: 'and gamma.', seconds: 1.0 };
    });
    const { rig, session } = await startTestSession(transcribe, { sleep: async () => undefined });

    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    expect(session.getSnapshot().previewText).toBe('Alpha and beta');

    // seg2 live [0..2] fails open -> primary seg2 fails twice, preserving refined [0..1].
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(50);
    expect(session.getSnapshot()).toMatchObject({
      previewText: 'Alpha and beta',
      completedSegments: 2,
      failedSegments: 1,
    });

    // Finish tries sealed [0..2] (fails open) + retries primary seg2 (fails) -> keeps seg2 WAV.
    const finished = await session.finish();
    expect(finished).toMatchObject({ status: 'failed', failedSegments: 1, completedSegments: 2 });

    // Manual retryFailed retries ONLY seg2 with the preserved refined prompt.
    await expect(session.retryFailed()).resolves.toEqual({
      status: 'completed',
      text: 'Alpha and beta and gamma.',
    });
    expect(transcribe).toHaveBeenCalledTimes(8);
    expect(prompts[3]).toBe('Alpha and beta');
    expect(prompts[7]).toBe('Alpha and beta');
  });
});

describe('createDictationSession checkpointing, recovery, and lifecycle', () => {
  const USER = '@dictation-session-test:example.org';
  let heldLocks: Set<string>;

  const installFakeLocks = () => {
    heldLocks = new Set<string>();
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: {
        request: async <T>(
          name: string,
          _options: LockOptions,
          callback: LockGrantedCallback<T>
        ) => {
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
  };

  const readJournalRow = async (id: string) => {
    const db = await openDB('mindroom-voice-journal', 1);
    try {
      const recording = (await db.get('recordings', id)) as Record<string, unknown> | undefined;
      const chunks = (await db.getAll(
        'chunks',
        IDBKeyRange.bound([id, 0], [id, Infinity])
      )) as Array<{
        seq: number;
        bytes: ArrayBuffer;
        startFramePos?: number;
        endFramePos?: number;
      }>;
      return { recording, chunks };
    } finally {
      db.close();
    }
  };

  const waitForJournalSettled = async (ms = 40) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  const makeJournal = (originApiUrl = 'https://dictation.example', roomId = '!room:example.org') =>
    beginDictationJournal(USER, {
      startedAt: 1_000,
      elapsedMs: 0,
      capReached: false,
      originApiUrl,
      originRoomId: roomId,
      segments: [],
      groups: [],
    })!;

  beforeEach(() => {
    installFakeLocks();
  });

  afterEach(async () => {
    await clearCaptureJournal(USER);
    vi.restoreAllMocks();
  });

  it('flushes ~1 s PCM tail chunks mid-utterance and recovers audio before the first segment', async () => {
    let clock = 1_000;
    const journal = makeJournal();
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe: vi.fn(async () => ({ text: 'Never called', seconds: 1 })) },
      roomId: '!room:example.org',
      originApiUrl: 'https://dictation.example',
      journal,
      now: () => clock,
      // Keep VAD unresolved so frames stay buffered without cutting a segment.
      loadVad: () => new Promise(() => undefined),
      captureFactory: rig.captureFactory,
    });

    expect(await session.start()).toBe(true);
    clock = 1_960;
    for (let i = 0; i < 10; i += 1) rig.pushFrame(makeFrame(0.3));
    let beforeCrash = await readJournalRow(journal.id);
    await vi.waitFor(async () => {
      beforeCrash = await readJournalRow(journal.id);
      expect(beforeCrash.chunks).toHaveLength(1);
    });
    expect(beforeCrash.recording).toBeDefined();
    expect(beforeCrash.chunks[0]?.seq).toBe(TAIL_SEQ_OFFSET);
    expect(beforeCrash.chunks[0]?.startFramePos).toBe(0);
    expect(beforeCrash.chunks[0]?.endFramePos).toBe(10);
    expect(beforeCrash.chunks[0]?.bytes.byteLength).toBe(10 * DICTATION_FRAME_SAMPLES * 2);

    // Simulate reload/account-switch release: lock drops, tail chunk stays recoverable.
    session.reset();
    await waitForJournalSettled();

    let recovered: RecoveredDictationJournal | undefined;
    await recoverDictationJournal(USER, (item) => {
      recovered = item;
      return true;
    });
    expect(recovered?.id).toBe(journal.id);
    expect(recovered?.meta.segments).toHaveLength(0);
    expect(recovered?.tailChunks).toHaveLength(1);
    expect(recovered?.tailChunks[0]?.elapsedMs).toBe(960);
    recovered?.journal.release();
  });

  it('commits segments atomically, preserves hard-cut overlap tail, and retains WAVs until settlement', async () => {
    let clock = 5_000;
    const journal = makeJournal();
    let callCount = 0;
    const transcribe = vi.fn(async (_wav: Blob) => {
      callCount += 1;
      if (callCount === 1) return { text: 'Long utterance part one.', seconds: 25 };
      if (callCount === 2) return { text: 'Part two.', seconds: 2 };
      return { text: 'Part two and three.', seconds: 4 };
    });
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      roomId: '!room:example.org',
      originApiUrl: 'https://dictation.example',
      journal,
      now: () => clock,
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
    });

    expect(await session.start()).toBe(true);
    await flushMicrotasks();

    // Push 260 continuous speech frames to trigger a hard cut at 25 s (retaining 6 overlap frames).
    for (let i = 0; i < 260; i += 1) {
      clock += 96;
      rig.pushFrame(makeFrame(0.3));
    }
    let afterHardCut = await readJournalRow(journal.id);
    await vi.waitFor(async () => {
      afterHardCut = await readJournalRow(journal.id);
      expect(afterHardCut.recording?.consumedThroughFramePos).toBe(245);
    });
    const tailAfterHard = afterHardCut.chunks.filter((c) => c.seq >= TAIL_SEQ_OFFSET);
    // Hard cut emitted seg 0; its WAV stays persisted in IndexedDB until terminal settlement.
    expect(afterHardCut.chunks.some((c) => c.seq === 0)).toBe(true);
    expect(tailAfterHard.length).toBeGreaterThan(0);
    expect(tailAfterHard[0]?.startFramePos).toBe(240);
    expect(tailAfterHard[tailAfterHard.length - 1]?.endFramePos).toBe(260);

    // Finish the overlapped continuation (seg 1) and pause -> tail cleared, both segment WAVs retained until finish.
    for (let i = 0; i < 8; i += 1) rig.pushFrame(makeFrame(0.001));
    await session.pause();
    await waitForJournalSettled(60);

    const afterPause = await readJournalRow(journal.id);
    expect(afterPause.chunks.filter((c) => c.seq >= TAIL_SEQ_OFFSET)).toHaveLength(0);
    expect(
      afterPause.chunks
        .filter((c) => c.seq < TAIL_SEQ_OFFSET)
        .map((c) => c.seq)
        .sort((a, b) => a - b)
    ).toEqual([0, 1]);
    expect(session.getSnapshot().previewText).toBe('Long utterance part one. Part two.');

    // Finish returns journalId WITHOUT deleting the journal!
    const finished = await session.finish();
    expect(finished).toEqual({
      status: 'completed',
      text: 'Long utterance part one. Part two.',
      journalId: journal.id,
    });
    const stillOnDisk = await readJournalRow(journal.id);
    expect(stillOnDisk.recording).toBeDefined();
    expect(heldLocks.has(`mindroom-voice-recording:${journal.id}`)).toBe(true);

    // Caller deletes the journal only after inserting the text.
    await deleteCapture(finished.status === 'completed' ? finished.journalId : undefined);
    const afterDelete = await readJournalRow(journal.id);
    expect(afterDelete.recording).toBeUndefined();
  });

  it('supports text-only offline recovery with 0 remaining WAVs and returns journalId on finish without deleting', async () => {
    const journal = makeJournal();
    const session = createDictationSession({
      client: undefined,
      journal,
      recovered: {
        startedAt: 1_000,
        elapsedMs: 12_000,
        capReached: false,
        originApiUrl: 'https://dictation.example',
        records: [
          {
            segment: {
              index: 0,
              seconds: 4,
              overlapped: false,
              cutReason: 'natural',
              leadingQuietFrames: 2,
              trailingQuietFrames: 8,
              pauseBeforeMs: Infinity,
            },
            wav: undefined,
            status: 'completed',
            text: 'Already transcribed.',
            retryable: false,
          },
        ],
        groups: [
          {
            startIndex: 0,
            endIndex: 0,
            state: 'refined',
            refinedText: 'Already transcribed.',
            refinedEndIndex: 0,
          },
        ],
        initialSegmentIndex: 1,
        initialActiveFrames: 125,
      },
    });

    expect(session.getSnapshot()).toMatchObject({
      phase: 'paused',
      recovered: true,
      hasClient: false,
      elapsedMs: 12_000,
      previewText: 'Already transcribed.',
      completedSegments: 1,
      pendingUploads: 0,
    });
    expect(session.hasClient()).toBe(false);
    expect(session.getJournalId()).toBe(journal.id);
    // Resume without a client is refused.
    expect(await session.resume()).toBe(false);

    // Offline finish succeeds cleanly when 0 WAVs need transcription, returning journalId intact.
    const result = await session.finish();
    expect(result).toEqual({
      status: 'completed',
      text: 'Already transcribed.',
      journalId: journal.id,
    });
    expect((await readJournalRow(journal.id)).recording).toBeDefined();
    await deleteCapture(journal.id);
  });

  it('fails offline finish with actionable error when WAVs need a server, and recovers via attachClient + retryFailed or takePartialText', async () => {
    const journal = makeJournal();
    const wav = new Blob([new Uint8Array(64)], { type: 'audio/wav' });
    const session = createDictationSession({
      client: undefined,
      journal,
      recovered: {
        startedAt: 1_000,
        elapsedMs: 8_000,
        capReached: false,
        records: [
          {
            segment: {
              index: 0,
              seconds: 2,
              overlapped: false,
              cutReason: 'natural',
              leadingQuietFrames: 2,
              trailingQuietFrames: 8,
              pauseBeforeMs: Infinity,
            },
            wav: undefined,
            status: 'completed',
            text: 'Done part.',
            retryable: false,
          },
          {
            segment: {
              index: 1,
              seconds: 2,
              overlapped: false,
              cutReason: 'flush',
              leadingQuietFrames: 2,
              trailingQuietFrames: 0,
              pauseBeforeMs: 500,
            },
            wav,
            status: 'queued',
            retryable: true,
          },
        ],
        groups: [
          { startIndex: 0, endIndex: 0, state: 'fallback' },
          { startIndex: 1, endIndex: 1, state: 'fallback' },
        ],
        initialSegmentIndex: 2,
        initialActiveFrames: 83,
      },
    });

    const failed = await session.finish();
    expect(failed).toEqual({
      status: 'failed',
      failedSegments: 1,
      completedSegments: 1,
      errorMessage: 'Open a room with dictation to retry.',
    });
    expect(session.getSnapshot()).toMatchObject({
      phase: 'failed',
      hasClient: false,
      errorMessage: 'Open a room with dictation to retry.',
    });
    expect(session.getJournalId()).toBe(journal.id);

    // Retrying while still offline keeps the actionable message and journal intact.
    const stillFailed = await session.retryFailed();
    expect(stillFailed).toMatchObject({
      status: 'failed',
      errorMessage: 'Open a room with dictation to retry.',
    });

    // Attaching a client enables retryFailed() to transcribe the remaining WAV with roomId.
    const calls: Array<{ roomId?: string }> = [];
    const transcribe = vi.fn(async (_blob: Blob, opts?: { roomId?: string }) => {
      calls.push({ roomId: opts?.roomId });
      return { text: 'Uploaded later.', seconds: 2 };
    });
    session.attachClient({ transcribe }, '!attached:example.org');
    expect(session.hasClient()).toBe(true);
    expect(session.getSnapshot().hasClient).toBe(true);

    const completed = await session.retryFailed();
    expect(completed).toEqual({
      status: 'completed',
      text: 'Done part. Uploaded later.',
      journalId: journal.id,
    });
    expect(calls).toEqual([{ roomId: '!attached:example.org' }]);
    await deleteCapture(journal.id);

    // takePartialText() also detaches and returns journalId without deleting the journal.
    const journal2 = makeJournal();
    const session2 = createDictationSession({
      client: undefined,
      journal: journal2,
      recovered: {
        startedAt: 1_000,
        elapsedMs: 5_000,
        capReached: false,
        records: [
          {
            segment: {
              index: 0,
              seconds: 2,
              overlapped: false,
              cutReason: 'natural',
              leadingQuietFrames: 2,
              trailingQuietFrames: 8,
              pauseBeforeMs: Infinity,
            },
            wav: undefined,
            status: 'completed',
            text: 'Partial kept.',
            retryable: false,
          },
          {
            segment: {
              index: 1,
              seconds: 2,
              overlapped: false,
              cutReason: 'flush',
              leadingQuietFrames: 2,
              trailingQuietFrames: 0,
              pauseBeforeMs: 500,
            },
            wav,
            status: 'failed',
            error: 'Offline',
            retryable: true,
          },
        ],
        groups: [{ startIndex: 0, endIndex: 1, state: 'fallback' }],
        initialSegmentIndex: 2,
        initialActiveFrames: 50,
      },
    });
    await waitForJournalSettled();
    const partial = session2.takePartialText();
    expect(partial).toEqual({ text: 'Partial kept.', journalId: journal2.id });
    expect(session2.getSnapshot().phase).toBe('idle');
    expect(heldLocks.has(`mindroom-voice-recording:${journal2.id}`)).toBe(true);
    expect((await readJournalRow(journal2.id)).recording).toBeDefined();
    await deleteCapture(journal2.id);
  });

  it('pumps queued WAVs on attachClient while paused and clears recovered + continues indices on resume', async () => {
    const journal = makeJournal();
    const wav = new Blob([new Uint8Array(64)], { type: 'audio/wav' });
    const rig = createFakeCaptureRig();
    let calls = 0;
    const transcribe = vi.fn(async () => {
      calls += 1;
      return { text: calls === 1 ? 'Recovered chunk.' : 'Resumed chunk.', seconds: 1 };
    });

    const session = createDictationSession({
      client: undefined,
      journal,
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
      recovered: {
        startedAt: 1_000,
        elapsedMs: 4_000,
        capReached: false,
        records: [
          {
            segment: {
              index: 0,
              seconds: 1,
              overlapped: false,
              cutReason: 'flush',
              leadingQuietFrames: 2,
              trailingQuietFrames: 0,
              pauseBeforeMs: Infinity,
            },
            wav,
            status: 'queued',
            retryable: true,
          },
        ],
        groups: [{ startIndex: 0, endIndex: 0, state: 'fallback' }],
        initialSegmentIndex: 1,
        initialActiveFrames: 42,
      },
    });

    // Attaching a client pumps queued WAVs while staying paused (no mic started).
    session.attachClient({ transcribe }, '!room:example.org');
    // Second attachClient call is ignored once bound.
    const otherTranscribe = vi.fn();
    session.attachClient({ transcribe: otherTranscribe }, '!other:example.org');
    await flushMicrotasks(20);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(otherTranscribe).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      phase: 'paused',
      recovered: true,
      previewText: 'Recovered chunk.',
    });

    // Resume clears recovered and continues segment indices at 1 (never overwriting [id, 0]).
    expect(await session.resume()).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ phase: 'recording', recovered: false });
    await flushMicrotasks();
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    await waitForJournalSettled();

    const row = await readJournalRow(journal.id);
    const persistedSegments = (row.recording?.segments ?? []) as Array<{ index: number }>;
    expect(persistedSegments.map((s) => s.index)).toEqual([0, 1]);

    const finished = await session.finish();
    expect(finished).toEqual({
      status: 'completed',
      text: 'Recovered chunk. Resumed chunk.',
      journalId: journal.id,
    });
    await deleteCapture(journal.id);
  });

  it('handles park() cleanly across initial requesting, resume requesting, recording, paused, finishing, and failed', async () => {
    // 1. Initial requesting -> cancels to idle and deletes journal.
    const initJournal = makeJournal();
    let resolveMic!: (handle: {
      readLevel: () => number;
      stopAndFlush: () => Promise<void>;
      dispose: () => void;
    }) => void;
    const lateDispose = vi.fn();
    const initSession = createDictationSession({
      client: { transcribe: vi.fn(async () => ({ text: '', seconds: 1 })) },
      journal: initJournal,
      captureFactory: () =>
        new Promise((resolve) => {
          resolveMic = resolve;
        }),
    });
    const startPromise = initSession.start();
    expect(initSession.getSnapshot().phase).toBe('requesting');
    initSession.park();
    expect(initSession.getSnapshot().phase).toBe('idle');
    resolveMic({ readLevel: () => 0, stopAndFlush: async () => undefined, dispose: lateDispose });
    expect(await startPromise).toBe(false);
    expect(lateDispose).toHaveBeenCalledTimes(1);
    await waitForJournalSettled();
    expect((await readJournalRow(initJournal.id)).recording).toBeUndefined();

    // 2. Recording -> pauses, flushes & seals to journal, keeps lock held.
    const recJournal = makeJournal();
    let resolveResumeMic:
      | ((handle: {
          readLevel: () => number;
          stopAndFlush: () => Promise<void>;
          dispose: () => void;
        }) => void)
      | undefined;
    const rig = createFakeCaptureRig();
    let captureCall = 0;
    let resolveUpload!: (res: { text: string; seconds: number }) => void;
    const transcribe = vi.fn(
      () =>
        new Promise<{ text: string; seconds: number }>((resolve) => {
          resolveUpload = resolve;
        })
    );
    const recSession = createDictationSession({
      client: { transcribe },
      journal: recJournal,
      loadVad: async () => makeVad(),
      captureFactory: (opts) => {
        captureCall += 1;
        if (captureCall === 1) return rig.captureFactory(opts);
        return new Promise((resolve) => {
          resolveResumeMic = resolve;
        });
      },
    });
    expect(await recSession.start()).toBe(true);
    await flushMicrotasks();
    for (let i = 0; i < 4; i += 1) rig.pushFrame(makeFrame(0.3));
    recSession.park();
    expect(recSession.getSnapshot().phase).toBe('paused');
    await waitForJournalSettled(60);
    expect((await readJournalRow(recJournal.id)).chunks.some((c) => c.seq === 0)).toBe(true);
    expect(heldLocks.has(`mindroom-voice-recording:${recJournal.id}`)).toBe(true);

    // 3. Paused -> no-op.
    recSession.park();
    expect(recSession.getSnapshot().phase).toBe('paused');

    // 4. Resume-requesting -> cancels mic request, returns to paused, keeps journal & in-flight upload.
    const resumePromise = recSession.resume();
    await flushMicrotasks();
    expect(recSession.getSnapshot().phase).toBe('requesting');
    recSession.park();
    expect(recSession.getSnapshot().phase).toBe('paused');
    const lateResumeDispose = vi.fn();
    resolveResumeMic?.({
      readLevel: () => 0,
      stopAndFlush: async () => undefined,
      dispose: lateResumeDispose,
    });
    expect(await resumePromise).toBe(false);
    expect(lateResumeDispose).toHaveBeenCalledTimes(1);
    expect(heldLocks.has(`mindroom-voice-recording:${recJournal.id}`)).toBe(true);

    // 5. Finishing -> no-op (does NOT abort in-flight finish).
    const finishPromise = recSession.finish();
    await flushMicrotasks();
    expect(recSession.getSnapshot().phase).toBe('finishing');
    recSession.park();
    expect(recSession.getSnapshot().phase).toBe('finishing');
    resolveUpload({ text: 'Finished safely.', seconds: 0.4 });
    await expect(finishPromise).resolves.toEqual({
      status: 'completed',
      text: 'Finished safely.',
      journalId: recJournal.id,
    });
    await deleteCapture(recJournal.id);
  });

  it('differentiates reset() (preserves disk rows & releases lock) from async discard() (deletes disk rows)', async () => {
    const resetJournal = makeJournal();
    const rigA = createFakeCaptureRig();
    const sessA = createDictationSession({
      client: {
        transcribe: vi.fn(() => new Promise<{ text: string; seconds: number }>(() => undefined)),
      },
      journal: resetJournal,
      loadVad: async () => makeVad(),
      captureFactory: rigA.captureFactory,
    });
    expect(await sessA.start()).toBe(true);
    await flushMicrotasks();
    pushSpeechAndPause(rigA.pushFrame);
    await waitForJournalSettled(60);

    sessA.reset();
    expect(sessA.getSnapshot().phase).toBe('idle');
    expect(rigA.dispose).toHaveBeenCalledTimes(1);
    await waitForJournalSettled();
    // Disk row stays intact and lock is released so recovery can pick it up.
    expect((await readJournalRow(resetJournal.id)).recording).toBeDefined();
    expect(heldLocks.has(`mindroom-voice-recording:${resetJournal.id}`)).toBe(false);
    await deleteCapture(resetJournal.id);

    const discardJournal = makeJournal();
    const rigB = createFakeCaptureRig();
    const sessB = createDictationSession({
      client: {
        transcribe: vi.fn(() => new Promise<{ text: string; seconds: number }>(() => undefined)),
      },
      journal: discardJournal,
      loadVad: async () => makeVad(),
      captureFactory: rigB.captureFactory,
    });
    expect(await sessB.start()).toBe(true);
    await flushMicrotasks();
    pushSpeechAndPause(rigB.pushFrame);
    await waitForJournalSettled(60);

    await sessB.discard();
    expect(sessB.getSnapshot().phase).toBe('idle');
    expect((await readJournalRow(discardJournal.id)).recording).toBeUndefined();
    expect(heldLocks.has(`mindroom-voice-recording:${discardJournal.id}`)).toBe(false);

    // Verify helper releaseCapture cleans up cleanly if used directly.
    const j3 = makeJournal();
    await waitForJournalSettled();
    releaseCapture(j3.id);
    await waitForJournalSettled();
    expect(heldLocks.has(`mindroom-voice-recording:${j3.id}`)).toBe(false);
    await deleteCapture(j3.id);
  });

  it('retains refined group WAVs on seal alongside failed WAVs for full-session voice fallback, and preserves failed/idle on park()', async () => {
    const journal = makeJournal();
    let call = 0;
    const transcribe = vi.fn(async () => {
      call += 1;
      if (call === 1) return { text: 'First.', seconds: 1 };
      if (call === 2) return { text: 'First and second.', seconds: 2 };
      throw new DictationApiError('Bad request', 400, 'invalid');
    });
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe },
      journal,
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
    });

    // park() while idle is a no-op.
    session.park();
    expect(session.getSnapshot().phase).toBe('idle');

    expect(await session.start()).toBe(true);
    await flushMicrotasks();

    // Seg 0 + Seg 1 live-refine inside open group [0, 1] -> both WAVs stay until group seals.
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(25);
    await waitForJournalSettled(60);
    expect(session.getSnapshot().previewText).toBe('First and second.');
    const beforeSeal = await readJournalRow(journal.id);
    expect(beforeSeal.chunks.map((c) => c.seq).sort((a, b) => a - b)).toEqual([0, 1]);

    // Pause seals group [0, 1] -> refined -> retains [0, 1] WAVs so later partial failure still exports full audio.
    await session.pause();
    await waitForJournalSettled(60);
    const afterSeal = await readJournalRow(journal.id);
    expect(
      afterSeal.chunks
        .filter((c) => c.seq < TAIL_SEQ_OFFSET)
        .map((c) => c.seq)
        .sort((a, b) => a - b)
    ).toEqual([0, 1]);

    // Resume and record seg 2 which fails non-transiently -> all 3 WAVs stay on disk, park() is no-op in failed phase.
    expect(await session.resume()).toBe(true);
    await flushMicrotasks();
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(30);
    const finished = await session.finish();
    expect(finished).toMatchObject({ status: 'failed', failedSegments: 1, completedSegments: 2 });
    await waitForJournalSettled(60);

    session.park();
    expect(session.getSnapshot().phase).toBe('failed');
    expect(session.getSnapshot().hasVoiceAudio).toBe(true);
    const afterFail = await readJournalRow(journal.id);
    expect(afterFail.chunks.map((c) => c.seq).sort((a, b) => a - b)).toEqual([0, 1, 2]);

    // buildVoiceAudio() is non-destructive and exports all 3 segments; completeVoiceFallback() clears state and returns journalId.
    const voiceAudio = await session.buildVoiceAudio();
    expect(voiceAudio).toBeDefined();
    expect(voiceAudio!.missingAudioPartialText).toBeUndefined();
    expect(voiceAudio!.duration).toBeGreaterThan(1_000);
    expect(voiceAudio!.waveform).toHaveLength(48);
    expect(session.getSnapshot().phase).toBe('failed');
    expect(session.getSnapshot().hasVoiceAudio).toBe(true);

    const completedFallback = session.completeVoiceFallback();
    expect(completedFallback).toEqual({ journalId: journal.id });
    expect(session.getSnapshot().phase).toBe('idle');
    expect(session.getSnapshot().hasVoiceAudio).toBe(false);
    expect(await session.buildVoiceAudio()).toBeUndefined();
    // Caller still owns journal deletion after completeVoiceFallback().
    expect((await readJournalRow(journal.id)).recording).toBeDefined();
    await deleteCapture(journal.id);
  });

  it('honors initialActiveFrames cap across resumed recovered sessions', async () => {
    const journal = makeJournal();
    const rig = createFakeCaptureRig();
    const session = createDictationSession({
      client: { transcribe: vi.fn(async () => ({ text: 'Capped.', seconds: 1 })) },
      journal,
      maxActiveFrames: 25,
      loadVad: async () => makeVad(),
      captureFactory: rig.captureFactory,
      recovered: {
        startedAt: 1_000,
        elapsedMs: 2_000,
        capReached: false,
        records: [],
        groups: [],
        initialSegmentIndex: 2,
        initialActiveFrames: 20,
      },
    });

    expect(await session.resume()).toBe(true);
    await flushMicrotasks();
    // 5 frames hit maxActiveFrames = 25 -> auto-pauses with capReached: true and refuses further resume.
    for (let i = 0; i < 6; i += 1) rig.pushFrame(makeFrame(0.3));
    await waitForJournalSettled(60);

    expect(session.getSnapshot()).toMatchObject({ phase: 'paused', capReached: true });
    expect(await session.resume()).toBe(false);
    const row = await readJournalRow(journal.id);
    expect(row.recording?.capReached).toBe(true);
    await session.discard();
  });

  it('preserves queued refinement group across offline finish so attaching a client refines all segments', async () => {
    const journal = makeJournal();
    const wav0 = encodePcm16Wav([makeFrame(0.3), makeFrame(0.3), makeFrame(0.3)]);
    const wav1 = encodePcm16Wav([makeFrame(0.3), makeFrame(0.3), makeFrame(0.3)]);
    const session = createDictationSession({
      client: undefined,
      journal,
      recovered: {
        startedAt: 1_000,
        elapsedMs: 6_000,
        capReached: false,
        records: [
          {
            segment: {
              index: 0,
              seconds: 0.288,
              overlapped: false,
              cutReason: 'natural',
              leadingQuietFrames: 0,
              trailingQuietFrames: 0,
              pauseBeforeMs: Infinity,
            },
            wav: wav0,
            status: 'completed',
            text: 'first rough',
            retryable: false,
          },
          {
            segment: {
              index: 1,
              seconds: 0.288,
              overlapped: false,
              cutReason: 'flush',
              leadingQuietFrames: 0,
              trailingQuietFrames: 0,
              pauseBeforeMs: 300,
            },
            wav: wav1,
            status: 'queued',
            retryable: true,
          },
        ],
        groups: [{ startIndex: 0, endIndex: 1, state: 'queued' }],
        initialSegmentIndex: 2,
        initialActiveFrames: 60,
      },
    });

    const failed = await session.finish();
    expect(failed).toMatchObject({
      status: 'failed',
      failedSegments: 1,
      completedSegments: 1,
      errorMessage: 'Open a room with dictation to retry.',
    });

    // Attaching a client and retrying runs the queued multi-segment refinement (single merged upload).
    const transcribe = vi.fn(async () => ({ text: 'First and second, polished.', seconds: 0.6 }));
    session.attachClient({ transcribe }, '!room:example.org');
    const completed = await session.retryFailed();
    expect(completed).toEqual({
      status: 'completed',
      text: 'First and second, polished.',
      journalId: journal.id,
    });
    expect(transcribe).toHaveBeenCalledTimes(1);
    await deleteCapture(journal.id);
  });
});
