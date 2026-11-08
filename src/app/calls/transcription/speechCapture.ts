import { APP_BUILD_VERSION } from '../../config/appVersion';
import { appUrl } from '../../lib/basePath';

/** Speech is sent as 16 kHz mono 16-bit PCM, the rate the worklet posts. */
const SAMPLE_RATE = 16000;
/** How long `stop` waits for the worklet to hand on the stretch in progress. */
const FLUSH_TIMEOUT_MS = 1000;
/** A worklet not loaded after this long failed to load, so ending a call never waits on it. */
const LOAD_TIMEOUT_MS = 10_000;
/** What a person does that lets a page start sound (browsers' autoplay rules). */
const USER_GESTURES = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'] as const;

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

/** What public/calls/speech-worklet.js posts. */
type WorkletMessage =
  | { type: 'stretch'; samples: Int16Array; startTime: number }
  | { type: 'flushed' };

/**
 * The worklet's file is in public/, so its name stays the same from one build to the next; the
 * URL names the build, so a page never runs an earlier build's copy from a long-lived cache.
 */
const workletUrl = () =>
  `${appUrl('calls/speech-worklet.js')}?v=${encodeURIComponent(APP_BUILD_VERSION)}`;

/** `samples` (16 kHz mono) as a WAV file. */
export const encodeWav = (samples: Int16Array): Blob => {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const write = (offset: number, text: string) =>
    [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return new Blob([view.buffer], { type: 'audio/wav' });
};

/**
 * Listens to `track` (the microphone this device publishes to the call) and calls `onStretch`
 * with each stretch of speech found in it. Rejects when the worklet cannot be loaded, or has not
 * loaded after 10 seconds.
 */
export const startSpeechCapture = async (
  track: MediaStreamTrack,
  onStretch: (stretch: SpeechStretch) => void
): Promise<SpeechCapture> => {
  // The context runs at the rate the browser chooses, which a microphone source needs in some
  // browsers; the worklet lowers it to 16 kHz.
  const context = new AudioContext();
  let node: AudioWorkletNode;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.audioWorklet.addModule(workletUrl()),
      new Promise<never>((_resolve, reject) => {
        loadTimer = setTimeout(
          () => reject(new Error('The speech worklet did not load in time.')),
          LOAD_TIMEOUT_MS
        );
      }),
    ]).finally(() => clearTimeout(loadTimer));
    node = new AudioWorkletNode(context, 'speech-finder', {
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
  const source = context.createMediaStreamSource(new MediaStream([track]));
  source.connect(node);
  // The worklet writes only silence; reaching the speakers keeps every browser running it.
  node.connect(context.destination);
  // A suspended context hears nothing. Autoplay rules may keep it suspended until the person uses
  // the page (a call taken up again after a reload starts without a click), and a phone may suspend
  // it later (a call to the phone itself), so it asks again then and at every click or key press.
  const keepRunning = () => {
    if (context.state !== 'running') context.resume().catch(() => undefined);
  };
  keepRunning();
  context.onstatechange = keepRunning;
  USER_GESTURES.forEach((type) => window.addEventListener(type, keepRunning, { capture: true }));

  let paused = false;
  let stopped = false;
  let flushed: (() => void) | undefined;
  let stopping: Promise<void> | undefined;

  node.port.onmessage = ({ data }: MessageEvent<WorkletMessage>) => {
    if (data.type === 'flushed') {
      flushed?.();
      return;
    }
    // A stretch posted just before a pause reached the worklet is dropped too.
    if (stopped || paused) return;
    onStretch({
      wav: encodeWav(data.samples),
      startedAt: new Date(Date.now() - (context.currentTime - data.startTime) * 1000),
      seconds: data.samples.length / SAMPLE_RATE,
    });
  };

  const finish = async () => {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, FLUSH_TIMEOUT_MS);
      flushed = () => {
        clearTimeout(timeout);
        resolve();
      };
      node.port.postMessage({ type: 'flush' });
    });
    stopped = true;
    node.port.onmessage = null;
    context.onstatechange = null;
    USER_GESTURES.forEach((type) =>
      window.removeEventListener(type, keepRunning, { capture: true })
    );
    source.disconnect();
    node.disconnect();
    await context.close().catch(() => undefined);
  };

  return {
    setPaused: (value) => {
      paused = value;
      node.port.postMessage({ type: 'pause', paused: value });
    },
    stop: () => {
      stopping ??= finish();
      return stopping;
    },
  };
};
