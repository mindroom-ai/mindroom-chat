import {
  startSpeechCapture,
  type SpeechStretch,
} from '../../src/app/calls/transcription/speechCapture';

/** A stretch the capture found, timed from the start of the recording. */
export type FoundStretch = { from: number; seconds: number };

declare global {
  interface Window {
    /**
     * Plays recordings (base64), one after the other, into a microphone track that the app's
     * speech capture listens to, `lead` seconds after the model's files arrived, on the right
     * channel of a stereo track only when `right`; lets 2.5 s of silence follow, then stops the
     * capture. Resolves with the stretches found, timed from when the lead began.
     */
    findSpeech: (recordings: string[], lead: number, right: boolean) => Promise<FoundStretch[]>;
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

window.findSpeech = async (recordings, lead, right) => {
  const context = new AudioContext();
  const audio = await Promise.all(
    recordings.map((recording) =>
      context.decodeAudioData(
        Uint8Array.from(atob(recording), (character) => character.charCodeAt(0)).buffer
      )
    )
  );
  const microphone = context.createMediaStreamDestination();
  const [track] = microphone.stream.getAudioTracks();
  if (!track) throw new Error('The microphone has no track.');
  const stretches: SpeechStretch[] = [];
  const capture = await startSpeechCapture(track, (stretch) => stretches.push(stretch));
  await Promise.all([fetched('silero_vad_legacy.onnx'), fetched('ort-wasm-simd-threaded.wasm')]);
  // Left silent, the right channel carrying the recordings.
  const stereo = context.createChannelMerger(2);
  stereo.connect(microphone);
  const startedAt = Date.now();
  let at = context.currentTime + lead;
  const played = audio.map((buffer) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    if (right) source.connect(stereo, 0, 1);
    else source.connect(microphone);
    source.start(at);
    at += buffer.duration;
    return new Promise((resolve) => {
      source.onended = resolve;
    });
  });
  await Promise.all(played);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await capture.stop();
  await context.close();
  return stretches.map(({ startedAt: start, seconds }) => ({
    from: (start.getTime() - startedAt) / 1000,
    seconds,
  }));
};
