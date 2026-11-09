import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealTimeVADOptions } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';
import { startSpeechCapture, type SpeechStretch } from './speechCapture';
import { defined } from '../../../test/utils/defined';

// The voice-activity detector without its model: MicVAD as its documentation describes it, on the
// wrapper's own FrameProcessor (the part that turns speech probabilities into stretches, with its
// default settings), fed frames whose first sample is the probability the model gives them and
// whose second is their number, so a test can tell which frames a stretch holds. Frames arrive one
// task after the other, as the wrapper's AudioWorklet posts them, and the audio clock and the wall
// clock move on 96 ms with each one heard (paused or not).

/** Samples in a frame of the wrapper's default model, at 16 kHz (96 ms). */
const FRAME = 1536;
/** A frame's number is its second sample times this, so it stays a sample's value. */
const NUMBERING = 10_000;

const detector = vi.hoisted(() => ({
  /** Every detector made, last one last. */
  made: [] as Array<{
    /** The options the capture gave it. */
    given: Partial<RealTimeVADOptions>;
    /** With the defaults for what it left out, and as changed since. */
    options: Partial<RealTimeVADOptions>;
    listening: boolean;
    destroyed: boolean;
    /** How often it was paused. */
    pauses: number;
    hear: (probability: number) => Promise<void>;
  }>,
  /** What `MicVAD.new` waits for before it is ready: the model and runtime loading. */
  loading: () => Promise.resolve(),
  /** Called as `MicVAD.new` starts, once the capture has imported the wrapper. */
  entered: () => {},
}));

vi.mock('@ricky0123/vad-web', async () => {
  const { FrameProcessor, defaultFrameProcessorOptions } = await import(
    '@ricky0123/vad-web/dist/frame-processor'
  );
  const { Message } = await import('@ricky0123/vad-web/dist/messages');
  const { encodeWAV } = await import('@ricky0123/vad-web/dist/utils');

  class FakeMicVAD {
    given: Partial<RealTimeVADOptions>;

    options: Partial<RealTimeVADOptions>;

    listening = true;

    destroyed = false;

    pauses = 0;

    private heard = 0;

    private readonly frames: InstanceType<typeof FrameProcessor>;

    constructor(options: Partial<RealTimeVADOptions>) {
      this.given = options;
      const merged = { ...defaultFrameProcessorOptions, ...options };
      this.options = merged;
      this.frames = new FrameProcessor(
        async (frame) => ({ isSpeech: frame[0] ?? 0, notSpeech: 1 - (frame[0] ?? 0) }),
        () => undefined,
        merged,
        FRAME / 16
      );
      this.frames.resume();
    }

    static async new(options: Partial<RealTimeVADOptions>) {
      detector.entered();
      await detector.loading();
      const vad = new FakeMicVAD(options);
      detector.made.push(vad);
      return vad;
    }

    private readonly handle = (event: FrameProcessorEvent) => {
      if (event.msg === Message.FrameProcessed)
        void this.options.onFrameProcessed?.(event.probs, event.frame);
      if (event.msg === Message.SpeechStart) void this.options.onSpeechStart?.();
      if (event.msg === Message.VADMisfire) void this.options.onVADMisfire?.();
      if (event.msg === Message.SpeechEnd) void this.options.onSpeechEnd?.(event.audio);
    };

    /** One frame from the microphone; none reaches a paused or destroyed detector. */
    hear = async (probability: number) => {
      this.heard += 1;
      if (!this.listening || this.destroyed) return;
      const frame = new Float32Array(FRAME);
      frame[0] = probability;
      frame[1] = this.heard / NUMBERING;
      await this.frames.process(frame, this.handle);
    };

    setOptions = (update: Partial<RealTimeVADOptions>) => {
      this.options = { ...this.options, ...update };
      this.frames.setOptions(update);
    };

    pause = async () => {
      if (!this.listening) return;
      this.listening = false;
      this.pauses += 1;
      await this.options.pauseStream?.(new MediaStream());
      this.frames.pause(this.handle);
    };

    start = async () => {
      if (this.listening || this.destroyed) return;
      this.listening = true;
      this.frames.resume();
    };

    destroy = async () => {
      if (this.listening) await this.pause();
      this.destroyed = true;
    };
  }

  return { MicVAD: FakeMicVAD, utils: { encodeWAV } };
});

class FakeAudioContext {
  static last?: FakeAudioContext;

  state: AudioContextState = 'running';

  /** The audio clock, in seconds. */
  currentTime = 10;

  onstatechange: ((event: Event) => void) | null = null;

  /** How often the page asked the context to run. */
  resumes = 0;

  constructor() {
    FakeAudioContext.last = this;
  }

  resume() {
    this.resumes += 1;
    return Promise.resolve();
  }

  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

class FakeMediaStream {
  constructor(readonly tracks: MediaStreamTrack[] = []) {}

  getTracks() {
    return this.tracks;
  }
}

const NOW = Date.UTC(2026, 10, 8, 14, 0);

const microphone = () => {
  const stop = vi.fn();
  return { track: { kind: 'audio', id: 'microphone', stop } as unknown as MediaStreamTrack, stop };
};

const start = async () => {
  const { track, stop } = microphone();
  const stretches: SpeechStretch[] = [];
  const entered = entering();
  const capture = await startSpeechCapture(track, (stretch) => stretches.push(stretch));
  await entered;
  await settle();
  const vad = defined(detector.made.at(-1), 'the detector');
  const context = defined(FakeAudioContext.last, 'the audio context');
  /** One frame's time passing, on the audio clock and the wall clock. */
  const pass = (frames = 1) => {
    context.currentTime += (frames * FRAME) / 16000;
    vi.setSystemTime(Date.now() + (frames * FRAME) / 16);
  };
  /** Frames of the given speech probability, one after the other. */
  const hear = async (count: number, probability: number) => {
    for (let index = 0; index < count; index += 1) {
      pass();
      await vad.hear(probability);
      await settle();
    }
  };
  return { capture, vad, hear, pass, stretches, track, stopTrack: stop };
};

/** The numbers of the frames a stretch holds, from its 16-bit samples. */
const framesOf = async (stretch: SpeechStretch) => {
  const view = new DataView(await stretch.wav.arrayBuffer());
  const numbers: number[] = [];
  for (let offset = 44; offset < view.byteLength; offset += FRAME * 2) {
    numbers.push(Math.round((view.getInt16(offset + 2, true) / 0x7fff) * NUMBERING));
  }
  return numbers;
};

/** Lets every step started so far finish, as the next task would. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Keeps the model loading until the returned function is called. */
const holdModel = () => {
  let loaded!: () => void;
  detector.loading = () =>
    new Promise((resolve) => {
      loaded = resolve;
    });
  return () => loaded();
};

/** Resolves once the next capture has imported the wrapper and asks it for a detector. */
const entering = () =>
  new Promise<void>((resolve) => {
    detector.entered = resolve;
  });

/** Speech probabilities the model gives a frame of speech and one of quiet. */
const SPEECH = 0.9;
const QUIET = 0.05;

describe('startSpeechCapture', () => {
  beforeEach(() => {
    // setImmediate stays real: frames come one task after the other.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('MediaStream', FakeMediaStream);
    // The page, where clicks and key presses happen.
    vi.stubGlobal('window', new EventTarget());
    FakeAudioContext.last = undefined;
    detector.made.length = 0;
    detector.loading = () => Promise.resolve();
    detector.entered = () => undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runs the wrapper's default model and settings on the call's microphone, from this app's own files", async () => {
    const { vad, track, stopTrack } = await start();
    const options = vad.given;
    expect(options.audioContext).toBe(FakeAudioContext.last);
    const stream = await defined(options.getStream, 'getStream')();
    expect(stream.getTracks()).toEqual([track]);
    // The microphone is the call's: pausing must leave it running.
    await options.pauseStream?.(stream);
    expect(stopTrack).not.toHaveBeenCalled();
    expect(await options.resumeStream?.(stream)).toBe(stream);
    // Nothing of the detector's own is set: model, thresholds and timings stay the defaults.
    expect(
      Object.keys(options)
        .filter((key) => !key.startsWith('on'))
        .sort()
    ).toEqual([
      'audioContext',
      'baseAssetPath',
      'getStream',
      'ortConfig',
      'pauseStream',
      'resumeStream',
    ]);
    // Same origin: the worklet, the model and the runtime's files come from one directory here.
    const base = defined(options.baseAssetPath, 'baseAssetPath');
    expect(base).toMatch(/^\/assets\/speech-model[^/]*\/$/);
    const ort = { env: { logLevel: 'warning', wasm: {} as Record<string, unknown> } };
    options.ortConfig?.(ort as never);
    expect(ort.env.wasm.wasmPaths).toEqual({
      mjs: `${base}ort-wasm-simd-threaded.js`,
      wasm: `${base}ort-wasm-simd-threaded.wasm`,
    });
  });

  it('hands on each stretch as a 16 kHz mono 16-bit WAV, with when it started and how long it is', async () => {
    const { hear, stretches } = await start();
    await hear(10, QUIET);
    await hear(20, SPEECH);
    expect(stretches).toEqual([]);
    await hear(20, QUIET);

    expect(stretches).toHaveLength(1);
    const [stretch] = stretches as [SpeechStretch];
    // The wrapper's 800 ms before the speech (8 frames), the speech, and its 1400 ms after (14).
    const frames = 8 + 20 + 14;
    expect(stretch.seconds).toBeCloseTo((frames * FRAME) / 16000, 6);
    // It starts with the third frame heard, 800 ms before the speech.
    expect(stretch.startedAt.getTime()).toBe(NOW + (2 * FRAME) / 16);
    expect(stretch.wav.type).toBe('audio/wav');
    const view = new DataView(await stretch.wav.arrayBuffer());
    expect(view.byteLength).toBe(44 + frames * FRAME * 2);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('dates a stretch by when its audio was heard, also when the page gets to it late', async () => {
    const { hear, pass, stretches, vad } = await start();
    await hear(10, QUIET);
    // The page stalls for 4.8 s while the microphone goes on; then it takes the frames heard
    // meanwhile one after the other.
    pass(50);
    for (let index = 0; index < 34; index += 1) {
      await vad.hear(index < 20 ? SPEECH : QUIET);
      await settle();
    }
    expect(stretches).toHaveLength(1);
    expect(defined(stretches[0], 'the stretch').startedAt.getTime()).toBe(NOW + (2 * FRAME) / 16);
  });

  it('dates the stretch after a 30-second cut by its audio too, when the page is late', async () => {
    const { hear, pass, stretches, vad } = await start();
    await hear(10, QUIET);
    // The page stalls for 38.4 s of talk, then takes its frames one after the other.
    pass(400);
    for (let index = 0; index < 350; index += 1) {
      await vad.hear(index < 330 ? SPEECH : QUIET);
      await settle();
    }
    expect(stretches).toHaveLength(2);
    const [first, second] = stretches as [SpeechStretch, SpeechStretch];
    expect(first.startedAt.getTime()).toBe(NOW + (2 * FRAME) / 16);
    // The second starts with the frame after the first's last.
    expect(second.startedAt.getTime()).toBeCloseTo(
      first.startedAt.getTime() + first.seconds * 1000,
      6
    );
  });

  it('cuts speech that goes on past 30 seconds into stretches of at most 30 seconds, losing no frame', async () => {
    const { capture, hear, stretches, vad } = await start();
    await hear(10, QUIET);
    // 48 seconds of talk without a pause.
    await hear(500, SPEECH);
    await hear(20, QUIET);

    expect(stretches.length).toBe(2);
    stretches.forEach((stretch) => expect(stretch.seconds).toBeLessThanOrEqual(30));
    expect(defined(stretches[0], 'the first stretch').seconds).toBeGreaterThan(29.5);
    const numbers = (await Promise.all(stretches.map(framesOf))).flat();
    // From the 800 ms before the talk to the quiet that ended it, each frame once.
    const first = 10 - 8 + 1;
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => first + index));
    expect(numbers.at(-1)).toBeGreaterThanOrEqual(510);
    expect(vad.listening).toBe(true);
    // A pause after a cut still drops the stretch in progress.
    await hear(20, SPEECH);
    capture.setPaused(true);
    await settle();
    expect(stretches.length).toBe(2);
  });

  it('drops the stretch a pause cuts into and hears nothing until it resumes', async () => {
    const { capture, hear, stretches, vad } = await start();
    await hear(20, SPEECH);
    capture.setPaused(true);
    await settle();
    expect(vad.listening).toBe(false);
    await hear(40, SPEECH);
    await hear(20, QUIET);
    expect(stretches).toEqual([]);

    capture.setPaused(false);
    await settle();
    expect(vad.listening).toBe(true);
    await hear(10, SPEECH);
    await hear(20, QUIET);
    expect(stretches).toHaveLength(1);
    const numbers = await framesOf(defined(stretches[0], 'the stretch'));
    // Only what was said once it resumed, dated from its first frame.
    expect(numbers[0]).toBe(81);
    expect(defined(stretches[0], 'the stretch').startedAt.getTime()).toBe(NOW + (80 * FRAME) / 16);
  });

  it('drops the stretch in progress on a pause, even one resumed at once', async () => {
    const { capture, hear, stretches } = await start();
    await hear(20, SPEECH);
    capture.setPaused(true);
    capture.setPaused(false);
    await settle();
    await hear(20, QUIET);
    expect(stretches).toEqual([]);
  });

  it('pauses and resumes in the order asked, however fast', async () => {
    const { capture, hear, stretches, vad } = await start();
    capture.setPaused(true);
    capture.setPaused(false);
    capture.setPaused(true);
    capture.setPaused(false);
    await settle();
    expect(vad.listening).toBe(true);
    // Listening for real: what is said now is found.
    await hear(10, SPEECH);
    await hear(20, QUIET);
    expect(stretches).toHaveLength(1);
    capture.setPaused(true);
    await settle();
    expect(vad.listening).toBe(false);
  });

  it('counts a sound too short for speech towards no cut', async () => {
    const { hear, stretches, vad } = await start();
    // Three frames of speech are less than the 400 ms a stretch needs; 32 seconds of quiet follow.
    await hear(3, SPEECH);
    await hear(330, QUIET);
    expect(stretches).toEqual([]);
    expect(vad.pauses).toBe(0);
  });

  it('on stop, hands on the stretch in progress, then lets go of the call’s microphone without stopping it', async () => {
    const { capture, hear, stretches, vad, stopTrack } = await start();
    await hear(20, SPEECH);
    await capture.stop();

    expect(stretches).toHaveLength(1);
    expect(vad.destroyed).toBe(true);
    expect(defined(FakeAudioContext.last, 'the audio context').state).toBe('closed');
    expect(stopTrack).not.toHaveBeenCalled();
    await hear(20, SPEECH);
    await hear(20, QUIET);
    expect(stretches).toHaveLength(1);
  });

  it('on stop while paused, hands on nothing', async () => {
    const { capture, hear, stretches } = await start();
    await hear(20, SPEECH);
    capture.setPaused(true);
    await capture.stop();
    expect(stretches).toEqual([]);
  });

  it('captures nothing when the model cannot load, and still lets go on stop', async () => {
    detector.loading = () => Promise.reject(new Error('no model'));
    const { track } = microphone();
    const entered = entering();
    const capture = await startSpeechCapture(track, () => undefined);
    await entered;
    await settle();
    expect(detector.made).toEqual([]);
    capture.setPaused(true);
    await capture.stop();
    expect(defined(FakeAudioContext.last, 'the audio context').state).toBe('closed');
  });

  it('does not wait for the model on stop, and lets go of one that loads after it', async () => {
    const loaded = holdModel();
    const { track } = microphone();
    const entered = entering();
    const capture = await startSpeechCapture(track, () => undefined);
    await capture.stop();
    await entered;
    expect(defined(FakeAudioContext.last, 'the audio context').state).toBe('closed');
    loaded();
    await settle();
    expect(defined(detector.made.at(-1), 'the detector').destroyed).toBe(true);
  });

  it('listens once the model has loaded, paused when a pause came meanwhile', async () => {
    const loaded = holdModel();
    const { track } = microphone();
    const entered = entering();
    const capture = await startSpeechCapture(track, () => undefined);
    await entered;
    capture.setPaused(true);
    loaded();
    await settle();
    const vad = defined(detector.made.at(-1), 'the detector');
    expect(vad.listening).toBe(false);
    capture.setPaused(false);
    await settle();
    expect(vad.listening).toBe(true);
  });

  it('asks a context the browser keeps suspended to run again at each click or key press', async () => {
    /** A context that runs only once the browser allows it (autoplay rules). */
    class SuspendedAudioContext extends FakeAudioContext {
      override state: AudioContextState = 'suspended';

      allowed = false;

      override resume() {
        this.resumes += 1;
        if (this.allowed) this.state = 'running';
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', SuspendedAudioContext);
    const { capture } = await start();
    const context = defined(FakeAudioContext.last, 'the audio context') as SuspendedAudioContext;
    expect(context.resumes).toBe(1);

    window.dispatchEvent(new Event('keydown'));
    expect(context.resumes).toBe(2);
    expect(context.state).toBe('suspended');

    context.allowed = true;
    window.dispatchEvent(new Event('pointerdown'));
    expect(context.state).toBe('running');
    // Running, it is left alone.
    window.dispatchEvent(new Event('click'));
    expect(context.resumes).toBe(3);

    // Suspended later (a phone call on the device), it asks again at once.
    context.state = 'suspended';
    context.onstatechange?.(new Event('statechange'));
    expect(context.resumes).toBe(4);

    await capture.stop();
    context.state = 'suspended';
    window.dispatchEvent(new Event('click'));
    expect(context.resumes).toBe(4);
  });
});
