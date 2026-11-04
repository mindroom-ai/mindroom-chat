/**
 * The incoming call ring, synthesized with Web Audio so it needs no sound file and, like the
 * message chime, leaves other apps' audio playing on iOS: two rising pairs of soft bell tones
 * (B5 then E6, the notes of the message chime), then a pause, over and over until stopped.
 */

/** One note: when it starts in the cycle (seconds) and its pitch (Hz). */
type Note = { at: number; frequency: number };

const CYCLE_SECONDS = 2.6;
const NOTES: Note[] = [
  { at: 0, frequency: 987.77 },
  { at: 0.17, frequency: 1318.51 },
  { at: 0.55, frequency: 987.77 },
  { at: 0.72, frequency: 1318.51 },
];
/** How long a note takes to fade out. */
const NOTE_SECONDS = 0.45;
/** Loudness of the ring, below a chime's full scale so it does not startle. */
const VOLUME = 0.18;
/** Notes are scheduled this far ahead, so a busy main thread cannot leave gaps. */
const LOOKAHEAD_SECONDS = 2 * CYCLE_SECONDS;

/** Plays one bell-like note: a sine with a soft octave overtone, struck and fading out. */
const strike = (context: AudioContext, output: AudioNode, { at, frequency }: Note) => {
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.exponentialRampToValueAtTime(1, at + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS);
  envelope.connect(output);
  [
    { multiple: 1, level: 1 },
    { multiple: 2, level: 0.2 },
  ].forEach(({ multiple, level }) => {
    const partial = context.createOscillator();
    partial.type = 'sine';
    partial.frequency.value = frequency * multiple;
    const partialLevel = context.createGain();
    partialLevel.gain.value = level;
    partial.connect(partialLevel).connect(envelope);
    partial.start(at);
    partial.stop(at + NOTE_SECONDS + 0.05);
  });
};

/**
 * Starts ringing and returns the function that stops it. A browser that blocks sound until the
 * page was clicked keeps it silent; the ring card and the system notification still show.
 */
export const startRingtone = (): (() => void) => {
  if (typeof AudioContext === 'undefined') return () => undefined;
  const context = new AudioContext();
  const output = context.createGain();
  output.gain.value = VOLUME;
  output.connect(context.destination);

  let nextCycle = context.currentTime + 0.05;
  const scheduleAhead = () => {
    while (nextCycle < context.currentTime + LOOKAHEAD_SECONDS) {
      const start = nextCycle;
      NOTES.forEach((note) => strike(context, output, { ...note, at: start + note.at }));
      nextCycle += CYCLE_SECONDS;
    }
  };
  // A suspended context's clock stands still, so the first ring waits for it rather than passing.
  context.resume().catch(() => undefined);
  scheduleAhead();
  const timer = window.setInterval(scheduleAhead, 500);

  return () => {
    window.clearInterval(timer);
    context.close().catch(() => undefined);
  };
};
