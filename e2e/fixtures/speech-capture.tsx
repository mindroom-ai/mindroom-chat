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
     * to, `lead` seconds after silence starts, lets 2.5 s of silence follow, then stops the
     * capture; resolves with the stretches found, timed from when the silence started.
     */
    findSpeech: (recording: string, lead: number) => Promise<FoundStretch[]>;
  }
}

window.findSpeech = async (recording, lead) => {
  const context = new AudioContext();
  const bytes = Uint8Array.from(atob(recording), (character) => character.charCodeAt(0));
  const audio = await context.decodeAudioData(bytes.buffer);
  const microphone = context.createMediaStreamDestination();
  const [track] = microphone.stream.getAudioTracks();
  if (!track) throw new Error('The microphone has no track.');
  const stretches: SpeechStretch[] = [];
  const capture = await startSpeechCapture(track, (stretch) => stretches.push(stretch));
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
