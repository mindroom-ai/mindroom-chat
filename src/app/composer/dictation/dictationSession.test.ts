// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientSessions } from '../../computer/clientSessions';
import { DictationApiError, DictationClient } from './api';
import { createDictationRateBudget } from './dictationRefinement';
import { DICTATION_FRAME_SAMPLES, DICTATION_SAMPLE_RATE } from './dictationSegmenter';
import { createDictationSession, type DictationCaptureFactory } from './dictationSession';

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

    expect(session.takePartialText()).toBe('Kept text.');
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

    session.discard();
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

    session.discard();
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
        ({ getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream),
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
          ({ getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream),
        createAudioContext: () => fakeContext,
        loadVad: async () => makeVad(),
      });

      const startPromise = session.start();
      await addModuleStarted;
      expect(track.stop).not.toHaveBeenCalled();

      session.discard();
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
    transcribe: Parameters<typeof createDictationSession>[0]['client']['transcribe'],
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
    let soleSignal: AbortSignal | undefined;
    const { rig: rigSole, session: soleSess } = await startTestSession(
      (_wav: Blob, _opts?: { prompt?: string; roomId?: string }, signal?: AbortSignal) => {
        soleCall += 1;
        if (soleCall === 1) return Promise.resolve({ text: 'First.', seconds: 1 });
        soleSignal = signal;
        return new Promise<{ text: string; seconds: number }>((resolve) => {
          setTimeout(() => resolve({ text: 'First and flushed tail.', seconds: 1.5 }), 80);
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
    expect(soleSignal?.aborted).toBe(false);
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
