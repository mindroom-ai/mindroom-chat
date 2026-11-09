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
 * The directory of the build that holds the detector's AudioWorklet, the model and the runtime's
 * WebAssembly (vite.config.js names it); unit tests run without the build's constants.
 */
const modelDirectory = () =>
  `${appUrl(
    typeof __MINDROOM_SPEECH_MODEL__ === 'string'
      ? __MINDROOM_SPEECH_MODEL__
      : 'assets/speech-model'
  )}/`;

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
  /** Hands on the stretch in progress, if it holds enough speech, then stops listening. */
  stop: () => Promise<void>;
};

/**
 * Listens to `track` (the microphone this device publishes to the call) with the Silero VAD model,
 * through @ricky0123/vad-web with its default model and settings, and calls `onStretch` with each
 * stretch of speech it finds. The model and its runtime (about 17 MB the first time, kept by the
 * browser after) load meanwhile, however long that takes: listening starts once they have, and
 * stopping never waits for them. One that cannot load captures nothing.
 */
export const startSpeechCapture = (
  track: MediaStreamTrack,
  onStretch: (stretch: SpeechStretch) => void
): Promise<SpeechCapture> => {
  // The context runs at the rate the browser chooses, which a microphone source needs in some
  // browsers; the wrapper's worklet brings it down to 16 kHz.
  const context = new AudioContext();
  const directory = modelDirectory();
  let encodeWav: ((samples: Float32Array, format: number) => ArrayBuffer) | undefined;
  let vad: MicVAD | undefined;
  let paused = false;
  let stopped = false;
  /** Whether a stretch is in progress, and how many frames since its speech started. */
  let speaking = false;
  let spoken = 0;
  /**
   * The audio clock's time when listening last began, and the samples heard since: the audio clock
   * dates each stretch, however late the page gets to its frames.
   */
  let listeningSince = 0;
  let heard = 0;

  /** Pausing, resuming, cutting and stopping, one after the other. */
  let steps = Promise.resolve();
  const step = (run: (detector: MicVAD) => Promise<void>) => {
    steps = steps.then(() => (vad ? run(vad) : undefined)).catch(() => undefined);
    return steps;
  };
  const follow = async (detector: MicVAD) => {
    if (paused) await detector.pause();
    else if (!detector.listening) {
      await detector.start();
      listeningSince = context.currentTime;
      heard = 0;
    }
  };
  // Listening goes on at once, so the samples heard go on counting (a pause asked for meanwhile
  // comes next).
  const cut = async (detector: MicVAD) => {
    await detector.pause();
    await detector.start();
  };

  const options: Partial<RealTimeVADOptions> = {
    audioContext: context,
    // The microphone is the call's: pausing only lets go of it, and the same track comes back.
    getStream: async () => new MediaStream([track]),
    pauseStream: async () => undefined,
    resumeStream: async (stream) => stream,
    baseAssetPath: directory,
    // Pausing ends the stretch in progress as speech ends would: a cut or a stop hands it on, and
    // onSpeechEnd drops it when the person paused.
    submitUserSpeechOnPause: true,
    ortConfig: (ort) => {
      // As the wrapper's default ortConfig, which this one replaces, sets it.
      ort.env.logLevel = 'error';
      // The runtime's module is copied as .js, which static hosts serve as JavaScript.
      ort.env.wasm.wasmPaths = {
        mjs: `${directory}ort-wasm-simd-threaded.js`,
        wasm: `${directory}ort-wasm-simd-threaded.wasm`,
      };
    },
    onSpeechStart: () => {
      speaking = true;
      spoken = 1;
    },
    onFrameProcessed: (_probabilities, frame) => {
      heard += frame.length;
      if (!speaking || !vad) return;
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
      speaking = false;
    },
    onSpeechEnd: (audio) => {
      speaking = false;
      if (paused || !encodeWav) return;
      const seconds = audio.length / SAMPLE_RATE;
      // The stretch ends with the last frame heard.
      const start = listeningSince + heard / SAMPLE_RATE - seconds;
      onStretch({
        // Format 1 is 16-bit PCM, which MindRoom takes.
        wav: new Blob([encodeWav(audio, 1)], { type: 'audio/wav' }),
        startedAt: new Date(Date.now() - (context.currentTime - start) * 1000),
        seconds,
      });
    },
  };

  void (async () => {
    const { MicVAD, utils } = await import('@ricky0123/vad-web');
    encodeWav = (samples, format) => utils.encodeWAV(samples, format, SAMPLE_RATE, 1, 16);
    return MicVAD.new(options);
  })().then(
    (detector) => {
      // Loaded after a stop: let it go at once.
      if (stopped) {
        detector.destroy().catch(() => undefined);
        return;
      }
      // It listens from the start; a pause asked for meanwhile comes next.
      vad = detector;
      listeningSince = context.currentTime;
      void step(follow);
    },
    // Nothing is captured; the next microphone the call publishes starts a capture of its own.
    () => undefined
  );

  // A suspended context hears nothing. Autoplay rules may keep it suspended until the person uses
  // the page (a call taken up again after a reload starts without a click), and a phone may
  // suspend it later (a call to the phone itself), so it asks again then and at each click or key.
  const keepRunning = () => {
    if (context.state !== 'running') context.resume().catch(() => undefined);
  };
  keepRunning();
  context.onstatechange = keepRunning;
  USER_GESTURES.forEach((type) => window.addEventListener(type, keepRunning, { capture: true }));

  let stopping: Promise<void> | undefined;
  return Promise.resolve({
    setPaused: (value) => {
      paused = value;
      void step(follow);
    },
    stop: () => {
      stopped = true;
      stopping ??= step((detector) => detector.destroy()).then(async () => {
        context.onstatechange = null;
        USER_GESTURES.forEach((type) =>
          window.removeEventListener(type, keepRunning, { capture: true })
        );
        await context.close().catch(() => undefined);
      });
      return stopping;
    },
  });
};
