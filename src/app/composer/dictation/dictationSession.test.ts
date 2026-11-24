// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DictationApiError } from './api';
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

  it('serializes segment uploads with prompt chaining and stitches results on finish', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: Array<{ prompt?: string; roomId?: string }> = [];
    const responses = ['First sentence.', 'Second sentence.'];

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
    pushSpeechAndPause(rig.pushFrame);
    await flushMicrotasks(20);
    expect(session.getSnapshot().previewText).toBe('First sentence.');
    expect(session.getSnapshot().hasPartialText).toBe(true);

    const finished = await session.finish();
    expect(finished).toEqual({
      status: 'completed',
      text: 'First sentence. Second sentence.',
    });
    expect(maxInFlight).toBe(1);
    expect(calls).toEqual([
      { prompt: undefined, roomId: '!room:example.org' },
      { prompt: 'First sentence.', roomId: '!room:example.org' },
    ]);
    expect(session.getSnapshot().phase).toBe('idle');
    expect(session.getSnapshot().previewText).toBe('');
  });

  it('retains failed segment WAV for auto-retry and manual retryFailed without re-uploading completed segments', async () => {
    let seg0Attempts = 0;
    let seg1Attempts = 0;
    const sleepDelays: number[] = [];

    const transcribe = vi.fn(async (_wav: Blob, opts?: { prompt?: string }) => {
      if (!opts?.prompt) {
        seg0Attempts += 1;
        return { text: 'Hello from segment zero.', seconds: 1.0 };
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
    await flushMicrotasks(40);

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
    await flushMicrotasks(30);

    // Both seg 0's retry AND seg 1's first attempt waited 4000 ms for the queue-wide deadline.
    expect(sleepDelays).toEqual([4000, 4000]);
    expect(session.getSnapshot()).toMatchObject({
      failedSegments: 1,
      completedSegments: 1,
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
    const responses = ['First phrase.', 'Second phrase.'];
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
    await flushMicrotasks(20);
    expect(session.getSnapshot().previewText).toBe('First phrase. Second phrase.');

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
});
