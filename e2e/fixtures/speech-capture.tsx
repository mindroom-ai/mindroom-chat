import {
  startSpeechCapture,
  type SpeechStretch,
} from '../../src/app/calls/transcription/speechCapture';

/** A stretch the capture found, timed from the start of the recording. */
export type FoundStretch = { from: number; seconds: number };

declare global {
  interface Window {
    /**
     * Plays a recording (base64) into a microphone track that the app's speech capture listens
     * to, `lead` seconds after the model's files arrived, lets 2.5 s of silence follow, then stops
     * the capture; resolves with the stretches found, timed from when the lead began.
     */
    findSpeech: (recording: string, lead: number) => Promise<FoundStretch[]>;
  }
}

/** Resolves once the page has fetched a file whose URL ends with `name`. */
const fetched = (name: string) =>
  new Promise<void>((resolve) => {
    const seen = () =>
      performance.getEntriesByType('resource').some((entry) => entry.name.endsWith(name));
    if (seen()) {
      resolve();
      return;
    }
    const observer = new PerformanceObserver(() => {
      if (!seen()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe({ type: 'resource' });
  });

window.findSpeech = async (recording, lead) => {
  const context = new AudioContext();
  const bytes = Uint8Array.from(atob(recording), (character) => character.charCodeAt(0));
  const audio = await context.decodeAudioData(bytes.buffer);
  const microphone = context.createMediaStreamDestination();
  const [track] = microphone.stream.getAudioTracks();
  if (!track) throw new Error('The microphone has no track.');
  const stretches: SpeechStretch[] = [];
  const capture = await startSpeechCapture(track, (stretch) => stretches.push(stretch));
  await Promise.all([fetched('silero_vad_legacy.onnx'), fetched('ort-wasm-simd-threaded.wasm')]);
  const source = context.createBufferSource();
  source.buffer = audio;
  source.connect(microphone);
  const ended = new Promise((resolve) => {
    source.onended = resolve;
  });
  const startedAt = Date.now();
  source.start(context.currentTime + lead);
  await ended;
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await capture.stop();
  await context.close();
  return stretches.map(({ startedAt: start, seconds }) => ({
    from: (start.getTime() - startedAt) / 1000,
    seconds,
  }));
};
