// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DictationApiError } from './api';
import { DICTATION_FRAME_SAMPLES, DICTATION_SAMPLE_RATE } from './dictationSegmenter';
import { createDictationSession } from './dictationSession';

const makeFrame = (amp: number): Float32Array => {
  const frame = new Float32Array(DICTATION_FRAME_SAMPLES);
  for (let i = 0; i < frame.length; i += 1) {
    frame[i] = amp * Math.sin((2 * Math.PI * 440 * i) / DICTATION_SAMPLE_RATE);
  }
  return frame;
};

const createFakeTrack = () => {
  const endedListeners = new Set<() => void>();
  const stop = vi.fn();
  const track = {
    stop,
    addEventListener: (event: string, fn: () => void) => {
      if (event === 'ended') endedListeners.add(fn);
    },
    removeEventListener: (event: string, fn: () => void) => {
      if (event === 'ended') endedListeners.delete(fn);
    },
  } as unknown as MediaStreamTrack;
  const triggerEnded = () => endedListeners.forEach((fn) => fn());
  return { track, stop, triggerEnded };
};

const createFakeAudioContext = () => {
  const close = vi.fn(async () => undefined);
  const resume = vi.fn(async () => undefined);
  const context = {
    state: 'running',
    sampleRate: 16_000,
    onstatechange: null,
    destination: {},
    resume,
    close,
    createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    createAnalyser: () => ({
      fftSize: 2048,
      getByteTimeDomainData: (buf: Uint8Array) => buf.fill(140),
    }),
    createGain: () => ({
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
  } as unknown as AudioContext;
  return { context, close, resume };
};

const flushMicrotasks = async (turns = 6) => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

const pushSpeechAndPause = (pushFrame: (f: Float32Array) => void) => {
  for (let i = 0; i < 4; i += 1) pushFrame(makeFrame(0.3));
  for (let i = 0; i < 8; i += 1) pushFrame(makeFrame(0.0005));
};

describe('createDictationSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chains prompts serially across segments (concurrency = 1) and omits prompt on segment 0', async () => {
    const calls: Array<{ prompt?: string; roomId?: string; wavSize: number }> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let resolveFirst!: (res: { text: string; seconds: number }) => void;

    const transcribe = vi.fn(async (wav: Blob, opts: { prompt?: string; roomId?: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push({ prompt: opts.prompt, roomId: opts.roomId, wavSize: wav.size });
      try {
        if (calls.length === 1) {
          return await new Promise<{ text: string; seconds: number }>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return { text: 'second part.', seconds: 1.1 };
      } finally {
        inFlight -= 1;
      }
    });

    const { track, stop } = createFakeTrack();
    const { context, close } = createFakeAudioContext();
    let pushFrame!: (frame: Float32Array) => void;

    const session = createDictationSession({
      client: { transcribe },
      roomId: '!room:example.org',
      getUserMedia: async () =>
        ({ getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream),
      createAudioContext: () => context,
      loadVad: async () => ({
        score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
        reset: vi.fn(),
        release: vi.fn(async () => undefined),
      }),
      sleep: async () => undefined,
      onCaptureReady: (push) => {
        pushFrame = push;
      },
    });

    expect(await session.start()).toBe(true);
    await flushMicrotasks();

    // Emit two natural-pause segments while segment 0 is still uploading.
    pushSpeechAndPause(pushFrame);
    pushSpeechAndPause(pushFrame);
    await flushMicrotasks(35);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBeUndefined();
    expect(calls[0]?.roomId).toBe('!room:example.org');
    expect(session.getSnapshot().pendingUploads).toBe(2);

    resolveFirst({ text: 'First sentence', seconds: 1.1 });
    await flushMicrotasks(20);

    expect(maxInFlight).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.prompt).toBe('First sentence');

    const result = await session.finish();
    expect(result).toEqual({ status: 'completed', text: 'First sentence second part.' });
    expect(stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('auto-retries mid-speech failures with Retry-After, retains WAVs, and supports retryFailed and takePartialText', async () => {
    const sleep = vi.fn(async () => undefined);
    let seg0Attempts = 0;
    let seg1Attempts = 0;
    const transcribe = vi.fn(async (_wav: Blob, opts: { prompt?: string }) => {
      // Segment 0 succeeds on its first attempt; segment 1 fails mid-speech (twice) and on Finish retry, then succeeds on manual retryFailed.
      if (!opts.prompt) {
        seg0Attempts += 1;
        return { text: 'Hello from segment zero.', seconds: 1.0 };
      }
      seg1Attempts += 1;
      if (seg1Attempts <= 3) {
        throw new DictationApiError('Rate limited', 429, 'too-many-requests', 2500);
      }
      return { text: 'And segment one recovered.', seconds: 1.0 };
    });

    const { track } = createFakeTrack();
    const { context } = createFakeAudioContext();
    let pushFrame!: (frame: Float32Array) => void;

    const session = createDictationSession({
      client: { transcribe },
      getUserMedia: async () =>
        ({ getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream),
      createAudioContext: () => context,
      loadVad: async () => ({
        score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
        reset: vi.fn(),
        release: vi.fn(async () => undefined),
      }),
      sleep,
      onCaptureReady: (push) => {
        pushFrame = push;
      },
    });

    await session.start();
    await flushMicrotasks();

    pushSpeechAndPause(pushFrame);
    pushSpeechAndPause(pushFrame);
    await flushMicrotasks(30);

    // Mid-speech failure auto-retried once with 2500 ms Retry-After, then stayed recording with 1 failed segment.
    expect(sleep).toHaveBeenCalledWith(2500, expect.any(AbortSignal));
    expect(session.getSnapshot()).toMatchObject({
      phase: 'recording',
      completedSegments: 1,
      failedSegments: 1,
      hasPartialText: true,
    });

    // Finish retries the failed segment once; still failing -> enters 'failed' recovery state with WAV intact.
    const finishRes = await session.finish();
    expect(finishRes).toMatchObject({
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

  it('supports takePartialText when some segments succeeded and others failed', async () => {
    let count = 0;
    const transcribe = vi.fn(async () => {
      count += 1;
      if (count === 1) return { text: 'Kept text.', seconds: 1.0 };
      throw new DictationApiError('Backend down', 503, 'unavailable');
    });

    const { track } = createFakeTrack();
    const { context } = createFakeAudioContext();
    let pushFrame!: (frame: Float32Array) => void;

    const session = createDictationSession({
      client: { transcribe },
      getUserMedia: async () =>
        ({ getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream),
      createAudioContext: () => context,
      loadVad: async () => ({
        score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
        reset: vi.fn(),
        release: vi.fn(async () => undefined),
      }),
      sleep: async () => undefined,
      onCaptureReady: (push) => {
        pushFrame = push;
      },
    });

    await session.start();
    await flushMicrotasks();
    pushSpeechAndPause(pushFrame);
    pushSpeechAndPause(pushFrame);
    await flushMicrotasks(25);

    const finished = await session.finish();
    expect(finished.status).toBe('failed');
    expect(session.getSnapshot().hasPartialText).toBe(true);

    expect(session.takePartialText()).toBe('Kept text.');
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('aborts in-flight uploads and releases mic on discard', async () => {
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

    const { track, stop } = createFakeTrack();
    const { context, close } = createFakeAudioContext();
    const vadRelease = vi.fn(async () => undefined);
    let pushFrame!: (frame: Float32Array) => void;

    const session = createDictationSession({
      client: { transcribe },
      getUserMedia: async () =>
        ({ getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream),
      createAudioContext: () => context,
      loadVad: async () => ({
        score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
        reset: vi.fn(),
        release: vadRelease,
      }),
      onCaptureReady: (push) => {
        pushFrame = push;
      },
    });

    await session.start();
    await flushMicrotasks();
    pushSpeechAndPause(pushFrame);
    await flushMicrotasks(15);
    expect(transcribe).toHaveBeenCalledTimes(1);

    session.discard();
    expect(capturedSignal?.aborted).toBe(true);
    expect(stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(vadRelease).toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('pauses visibly and flushes captured speech when track.onended fires unexpectedly', async () => {
    const transcribe = vi.fn(async () => ({ text: 'Captured before disconnect.', seconds: 0.6 }));
    const { track, triggerEnded } = createFakeTrack();
    const { context } = createFakeAudioContext();
    let pushFrame!: (frame: Float32Array) => void;

    const session = createDictationSession({
      client: { transcribe },
      getUserMedia: async () =>
        ({ getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream),
      createAudioContext: () => context,
      loadVad: async () => ({
        score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
        reset: vi.fn(),
        release: vi.fn(async () => undefined),
      }),
      onCaptureReady: (push) => {
        pushFrame = push;
      },
    });

    await session.start();
    await flushMicrotasks();

    // Speak 4 frames without pausing, then simulate headset disconnect.
    for (let i = 0; i < 4; i += 1) pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);
    triggerEnded();
    await flushMicrotasks(20);

    expect(session.getSnapshot()).toMatchObject({
      phase: 'paused',
      interrupted: true,
      completedSegments: 1,
    });
    expect(transcribe).toHaveBeenCalledTimes(1);

    // User can still click Finish and get all captured text.
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
    const { track: track1 } = createFakeTrack();
    const { track: track2 } = createFakeTrack();
    let micCalls = 0;
    let pushFrame!: (frame: Float32Array) => void;

    const session = createDictationSession({
      client: { transcribe },
      getUserMedia: async () => {
        micCalls += 1;
        const t = micCalls === 1 ? track1 : track2;
        return { getAudioTracks: () => [t], getTracks: () => [t] } as unknown as MediaStream;
      },
      createAudioContext: () => createFakeAudioContext().context,
      loadVad: async () => ({
        score: async (frame) => (Math.abs(frame[10] ?? 0) > 0.05 ? 0.9 : 0.05),
        reset: vi.fn(),
        release: vi.fn(async () => undefined),
      }),
      onCaptureReady: (push) => {
        pushFrame = push;
      },
    });

    await session.start();
    await flushMicrotasks();
    for (let i = 0; i < 4; i += 1) pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);

    await session.pause();
    await flushMicrotasks(15);
    expect(session.getSnapshot().phase).toBe('paused');
    expect(transcribe).toHaveBeenCalledTimes(1);

    expect(await session.resume()).toBe(true);
    await flushMicrotasks();
    for (let i = 0; i < 4; i += 1) pushFrame(makeFrame(0.3));
    await flushMicrotasks(10);

    await expect(session.finish()).resolves.toEqual({
      status: 'completed',
      text: 'Before pause after resume.',
    });
  });
});
