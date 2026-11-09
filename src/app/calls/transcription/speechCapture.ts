import type { MicVAD, RealTimeVADOptions } from '@ricky0123/vad-web';
import { appUrl } from '../../lib/basePath';

/** The model hears 16 kHz mono audio, and stretches are sent at that rate. */
const SAMPLE_RATE = 16000;
/**
 * MindRoom refuses a stretch longer than 30 seconds (`_MAX_SPEECH_SECONDS` in
 * src/mindroom/call_transcripts/service.py), so talk that goes on longer is cut into stretches of
 * at most that.
 */
const LONGEST_STRETCH_SECONDS = 30;
/** What a person does that lets a page start sound (browsers' autoplay rules). */
const USER_GESTURES = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'] as const;

declare const __MINDROOM_SPEECH_MODEL__: string;

/**
 * Loads of the runtime's module that failed in this page. The runtime keeps a start that failed
 * failed for good, so the capture loads its module and WebAssembly before it starts; the browser
 * keeps a module that failed to load failed too, so each load after such a failure asks for the
 * module by a URL of its own.
 */
let failedModuleLoads = 0;

/** The runtime's module, loaded, and its WebAssembly from `directory`. */
const loadRuntime = async (directory: string) => {
  const moduleUrl = `${directory}ort-wasm-simd-threaded.js${
    failedModuleLoads ? `?retry=${failedModuleLoads}` : ''
  }`;
  const [wasm] = await Promise.all([
    fetch(`${directory}ort-wasm-simd-threaded.wasm`).then((response) => {
      if (!response.ok) throw new Error(`The speech runtime answered ${response.status}.`);
      return response.arrayBuffer();
    }),
    import(/* @vite-ignore */ moduleUrl).catch((error: unknown) => {
      failedModuleLoads += 1;
      throw error;
    }),
  ]);
  return { moduleUrl, wasm };
};

/** One stretch of speech from this device's microphone. */
export type SpeechStretch = {
  /** The stretch as a WAV file. */
  wav: Blob;
  /** When its first sound was heard. */
  startedAt: Date;
  /** How long it is. */
  seconds: number;
};

export type SpeechCapture = {
  /** Pausing drops the stretch in progress; nothing is captured until it resumes. */
  setPaused: (paused: boolean) => void;
  /** Muting hands on the stretch in progress, as stopping does; nothing is captured until unmuted. */
  setMuted: (muted: boolean) => void;
  /** Hands on the stretch in progress, if it holds enough speech, then stops listening. */
  stop: () => Promise<void>;
};

/**
 * Listens to `track` (the microphone this device publishes to the call) with the Silero VAD model,
 * through @ricky0123/vad-web with its default model and settings, and calls `onStretch` with each
 * stretch of speech it finds. The model and its runtime (about 17 MB the first time, kept by the
 * browser after) load meanwhile, however long that takes: listening starts once they have, and
 * stopping never waits for them. After they could not, they load again at the next pause, mute,
 * resume or unmute, and on the next capture start.
 */
export const startSpeechCapture = async (
  track: MediaStreamTrack,
  onStretch: (stretch: SpeechStretch) => void
): Promise<SpeechCapture> => {
  // The context runs at the rate the browser chooses, which a microphone source needs in some
  // browsers; the wrapper's worklet brings it down to 16 kHz.
  const context = new AudioContext();
  // The build's directory of the detector's AudioWorklet, the model and the runtime's WebAssembly
  // (vite.config.js names it); unit tests run without the build's constants.
  const directory = `${appUrl(
    typeof __MINDROOM_SPEECH_MODEL__ === 'string'
      ? __MINDROOM_SPEECH_MODEL__
      : 'assets/speech-model'
  )}/`;
  /** 16 kHz mono 16-bit PCM, which MindRoom takes; set as the wrapper loads, before it hears. */
  let wavOf: (samples: Float32Array) => Blob;
  let vad: MicVAD | undefined;
  /** The model and runtime are loading or loaded. */
  let loading = false;
  let paused = false;
  let muted = false;
  let stopping: Promise<void> | undefined;
  /** Frames since the speech of the stretch in progress started; 0 without one. */
  let spoken = 0;
  /**
   * The audio clock's time when listening last began, and the samples heard since: the audio clock
   * dates each stretch, however late the page gets to its frames.
   */
  let listeningSince = 0;
  let heard = 0;
  /**
   * Listening resumed after a pause. The wrapper's worklet keeps the part of a frame it heard as the
   * pause came, so the first frame after the resume starts with audio from before it.
   */
  let resumed = false;

  /** Pausing, resuming, cutting and stopping, one after the other. */
  let steps = Promise.resolve();
  const step = (run: (detector: MicVAD) => Promise<void>) => {
    steps = steps.then(() => (vad ? run(vad) : undefined)).catch(() => undefined);
    return steps;
  };
  /** Pausing with submitUserSpeechOnPause hands on the stretch in progress instead of dropping it. */
  const handingOn = async (detector: MicVAD, end: () => Promise<void>) => {
    detector.setOptions({ submitUserSpeechOnPause: true });
    await end();
    detector.setOptions({ submitUserSpeechOnPause: false });
  };
  // Each pause, mute or resume as it was asked for, in order: a pause drops the stretch in
  // progress, a mute hands it on.
  const follow = async (detector: MicVAD, wanted = { paused, muted }) => {
    if (wanted.paused || wanted.muted) {
      await (wanted.paused ? detector.pause() : handingOn(detector, detector.pause));
      spoken = 0;
    } else if (!detector.listening) {
      await detector.start();
      listeningSince = context.currentTime;
      heard = 0;
      resumed = true;
    }
  };
  // Pausing drops that first frame, as a pause drops what it cuts into, and what the worklet keeps
  // this time was heard after the resume.
  const dropFirstFrame = async (detector: MicVAD) => {
    await follow(detector, { paused: true, muted: false });
    await follow(detector, { paused: false, muted: false });
    resumed = false;
  };
  // Listening goes on at once, so the samples heard go on counting.
  const cut = async (detector: MicVAD) => {
    await handingOn(detector, detector.pause);
    await detector.start();
  };

  const options: Partial<RealTimeVADOptions> = {
    audioContext: context,
    // The microphone is the call's: pausing only lets go of it, and the same track comes back.
    getStream: async () => new MediaStream([track]),
    pauseStream: async () => undefined,
    resumeStream: async (stream) => stream,
    // The wrapper's worklet reads the first channel only: a stereo microphone is mixed to one.
    workletOptions: {
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    },
    baseAssetPath: directory,
    onSpeechStart: () => {
      spoken = 1;
    },
    onFrameProcessed: (_probabilities, frame) => {
      heard += frame.length;
      if (resumed) {
        void step(dropFirstFrame);
        return;
      }
      if (!spoken || !vad) return;
      spoken += 1;
      // The stretch holds up to preSpeechPadMs before its speech, and every frame since. It ends
      // with this frame when the next would take it past the limit.
      const padFrames = Math.floor(
        vad.options.preSpeechPadMs / ((frame.length / SAMPLE_RATE) * 1000)
      );
      if ((padFrames + spoken + 1) * frame.length > LONGEST_STRETCH_SECONDS * SAMPLE_RATE) {
        void step(cut);
      }
    },
    onVADMisfire: () => {
      spoken = 0;
    },
    onSpeechEnd: (audio) => {
      spoken = 0;
      const seconds = audio.length / SAMPLE_RATE;
      // The stretch ends with the last frame heard.
      const start = listeningSince + heard / SAMPLE_RATE - seconds;
      onStretch({
        wav: wavOf(audio),
        startedAt: new Date(Date.now() - (context.currentTime - start) * 1000),
        seconds,
      });
    },
  };

  const load = () => {
    loading = true;
    void (async () => {
      const { MicVAD, utils } = await import('@ricky0123/vad-web');
      wavOf = (samples) =>
        new Blob([utils.encodeWAV(samples, 1, SAMPLE_RATE, 1, 16)], { type: 'audio/wav' });
      const { moduleUrl, wasm } = await loadRuntime(directory);
      return MicVAD.new({
        ...options,
        ortConfig: (ort) => {
          // As the wrapper's default ortConfig, which this one replaces, sets it.
          ort.env.logLevel = 'error';
          // The runtime starts with its files loaded already.
          ort.env.wasm.wasmPaths = { mjs: moduleUrl };
          ort.env.wasm.wasmBinary = wasm;
        },
      });
    })().then(
      (detector) => {
        // Loaded after a stop: let it go at once.
        if (stopping) {
          detector.destroy().catch(() => undefined);
          return;
        }
        // It listens from the start; a pause or mute asked for meanwhile comes next.
        vad = detector;
        listeningSince = context.currentTime;
        void step(follow);
      },
      // Nothing is captured until the next pause, mute, resume or unmute loads them again.
      () => {
        loading = false;
      }
    );
  };
  load();
  /** Follows a pause or mute asked for, and loads again what could not load before. */
  const set = (wanted: { paused: boolean; muted: boolean }) => {
    if (wanted.paused === paused && wanted.muted === muted) return;
    ({ paused, muted } = wanted);
    void step((detector) => follow(detector, wanted));
    if (!loading && !stopping) load();
  };

  // A suspended context hears nothing. Autoplay rules may keep it suspended until the person uses
  // the page (a call taken up again after a reload starts without a click), and a phone may
  // suspend it later (a call to the phone itself), so it asks again then and at each click or key.
  const keepRunning = () => {
    if (context.state !== 'running') context.resume().catch(() => undefined);
  };
  keepRunning();
  context.onstatechange = keepRunning;
  USER_GESTURES.forEach((type) => window.addEventListener(type, keepRunning, { capture: true }));

  return {
    setPaused: (value) => set({ paused: value, muted }),
    setMuted: (value) => set({ paused, muted: value }),
    stop: () => {
      stopping ??= step((detector) => handingOn(detector, detector.destroy)).then(async () => {
        context.onstatechange = null;
        USER_GESTURES.forEach((type) =>
          window.removeEventListener(type, keepRunning, { capture: true })
        );
        await context.close().catch(() => undefined);
      });
      return stopping;
    },
  };
};
