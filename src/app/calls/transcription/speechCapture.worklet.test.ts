import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { defined } from '../../../test/utils/defined';

/** The worklet's source, run in a scope with stand-ins for the AudioWorklet globals. */
const SOURCE = readFileSync(
  new URL('../../../../public/calls/speech-worklet.js', import.meta.url),
  'utf8'
);
const BLOCK = 128;
const OUTPUT_RATE = 16000;

/** A spoken question (e2e/fixtures/README.md), 16 kHz mono 16-bit, in its `data` chunk. */
const QUESTION = readFileSync(
  new URL('../../../../e2e/fixtures/agent-call-question.wav', import.meta.url)
);
const QUESTION_DATA = QUESTION.indexOf('data', 12) + 8;
const QUESTION_SAMPLES = Int16Array.from(
  { length: QUESTION.readUInt32LE(QUESTION_DATA - 4) / 2 },
  (_, i) => QUESTION.readInt16LE(QUESTION_DATA + 2 * i)
);

/** White noise up to `amplitude`, the same every run (a 32-bit linear congruential generator). */
const room = (amplitude: number, seed = 3) => {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 2 ** 32 - 0.5) * 2 * amplitude;
  };
};

type Message = { type: string; samples?: ArrayLike<number>; startTime?: number };
type Port = {
  postMessage: (message: Message) => void;
  onmessage: ((event: { data: unknown }) => void) | null;
};
type Processor = {
  port: Port;
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};
type Signal = (t: number) => number;

/** A stretch the worklet posted: its start (context seconds), length and 16-bit samples. */
type Stretch = { start: number; seconds: number; samples: number[] };

/**
 * Loads the worklet as an AudioContext running at `rate` would, and drives it 128 samples at a
 * time: `feed` plays `seconds` of `signal` (given the time since that call began) over a faint
 * hiss, and `tell` posts a message to it between two blocks, as a browser does.
 */
const loadWorklet = (rate: number) => {
  const sent: Message[] = [];
  const registered = new Map<string, new (options: object) => Processor>();
  class AudioWorkletProcessor {
    port: Port = { postMessage: (message) => sent.push(message), onmessage: null };
  }
  const scope = createContext({
    sampleRate: rate,
    currentTime: 0,
    AudioWorkletProcessor,
    registerProcessor: (name: string, processor: new (options: object) => Processor) =>
      registered.set(name, processor),
  });
  runInContext(SOURCE, scope);
  const Finder = defined(registered.get('speech-finder'), 'the registered speech finder');
  const processor = new Finder({});

  const hiss = room(0.0003, 7);
  let played = 0;
  const pending = new Float32Array(BLOCK);
  let pendingLength = 0;
  /** Hands the worklet what was played since it last heard (short only before a message). */
  const render = () => {
    scope.currentTime = (played - pendingLength) / rate;
    const block = pending.slice(0, pendingLength);
    pendingLength = 0;
    expect(processor.process([[block]], [[new Float32Array(block.length)]])).toBe(true);
  };
  const now = () => played / rate;
  /** Plays `seconds` of `signal` without the hiss: digital silence, as a silent source gives. */
  const feedExact = (seconds: number, signal: Signal) => feed(seconds, signal, false);
  function feed(seconds: number, signal: Signal, withHiss = true) {
    const samples = Math.round(seconds * rate);
    for (let i = 0; i < samples; i += 1) {
      pending[pendingLength] = signal(i / rate) + (withHiss ? hiss() : 0);
      pendingLength += 1;
      played += 1;
      if (pendingLength === BLOCK) render();
    }
  }
  /** Plays `seconds` with no input at all, as the source of a muted microphone gives. */
  const mute = (seconds: number) => {
    if (pendingLength > 0) render();
    for (let block = 0; block < Math.round((seconds * rate) / BLOCK); block += 1) {
      scope.currentTime = played / rate;
      expect(processor.process([[]], [[new Float32Array(BLOCK)]])).toBe(true);
      played += BLOCK;
    }
  };
  const tell = (data: unknown) => {
    if (pendingLength > 0) render();
    defined(processor.port.onmessage, 'a message handler')({ data });
  };
  const stretches = (): Stretch[] =>
    sent
      .filter((message) => message.type === 'stretch')
      .map((message) => {
        const samples = Array.from(defined(message.samples, 'samples'));
        return {
          start: defined(message.startTime, 'a start time'),
          seconds: samples.length / OUTPUT_RATE,
          samples,
        };
      });
  return { sent, feed, feedExact, mute, tell, now, stretches };
};

const quiet: Signal = () => 0;
const tone =
  (frequency: number, amplitude: number): Signal =>
  (t) =>
    amplitude * Math.sin(2 * Math.PI * frequency * t);
/** Speech-like sound: 200 ms syllables with 100 ms dips between them. */
const voice: Signal = (t) => (t % 0.3 < 0.2 ? tone(220, 0.3)(t) : 0);
const both =
  (...signals: Signal[]): Signal =>
  (t) =>
    signals.reduce((sum, signal) => sum + signal(t), 0);
/** A noisy room: white noise up to `amplitude`. */
/** The spoken question, played at any rate. */
const question: Signal = (t) => {
  const position = t * OUTPUT_RATE;
  const index = Math.floor(position);
  const before = QUESTION_SAMPLES[index] ?? 0;
  const after = QUESTION_SAMPLES[index + 1] ?? before;
  return (before + (after - before) * (position - index)) / 32768;
};
const QUESTION_SECONDS = QUESTION_SAMPLES.length / OUTPUT_RATE;
/** Its first word starts 80 ms into the recording. */
const FIRST_WORD = 0.08;

/** The loudest sample (of 32767) among `samples` from `from` to `to` seconds into the stretch. */
const peak = (samples: number[], from: number, to: number) =>
  Math.max(
    ...samples.slice(Math.round(from * OUTPUT_RATE), Math.round(to * OUTPUT_RATE)).map(Math.abs)
  );

/** The amplitude (of 32767) of `frequency` in `samples` from `from` to `to` seconds in. */
const amplitudeAt = (samples: number[], frequency: number, from: number, to: number) => {
  const part = samples.slice(Math.round(from * OUTPUT_RATE), Math.round(to * OUTPUT_RATE));
  let re = 0;
  let im = 0;
  part.forEach((sample, n) => {
    const phase = (2 * Math.PI * frequency * n) / OUTPUT_RATE;
    re += sample * Math.cos(phase);
    im += sample * Math.sin(phase);
  });
  return (2 * Math.hypot(re, im)) / part.length;
};

describe('the speech worklet', () => {
  it('cuts speech between quiet into one stretch, from 300 ms before it to 200 ms after', () => {
    const worklet = loadWorklet(48000);
    worklet.feed(2, quiet);
    worklet.feed(1.5, voice); // the last syllable ends at 3.4 s
    worklet.feed(0.55, quiet);
    expect(worklet.stretches()).toEqual([]); // 650 ms of quiet does not end it yet

    worklet.feed(0.15, quiet);
    const [stretch, ...others] = worklet.stretches();
    expect(others).toEqual([]);
    const { start, seconds, samples } = defined(stretch, 'a stretch');
    expect(start).toBeCloseTo(1.7, 2);
    expect(Math.abs(seconds - 1.9)).toBeLessThan(0.02);
    expect(peak(samples, 0, 0.29)).toBeLessThan(100); // the quiet before the first syllable
    expect(peak(samples, 0.31, 0.5)).toBeGreaterThan(9000);
    expect(peak(samples, seconds - 0.19, seconds)).toBeLessThan(100); // the quiet after the last
  });

  it('keeps a spoken question whole, in one stretch', () => {
    const worklet = loadWorklet(48000);
    worklet.feed(2, quiet);
    worklet.feed(QUESTION_SECONDS, question);
    worklet.feed(1, quiet);
    const [stretch, ...others] = worklet.stretches();
    expect(others).toEqual([]);
    // Its first word starts 70 ms into the recording, and its last ends about 4.3 seconds in.
    const { start, seconds } = defined(stretch, 'the question');
    expect(start).toBeCloseTo(2.07 - 0.3, 1);
    expect(start + seconds).toBeGreaterThan(2 + 4.3);
    expect(start + seconds).toBeLessThan(2 + 4.3 + 0.3);
  });

  it('finds speech after digital silence from 300 ms before its first word, at any rate', () => {
    for (const rate of [16000, 44100, 48000]) {
      const worklet = loadWorklet(rate);
      worklet.feedExact(2, quiet);
      worklet.feedExact(QUESTION_SECONDS, question);
      worklet.feedExact(1, quiet);
      const [stretch, ...others] = worklet.stretches();
      expect(others, `at ${rate} Hz`).toEqual([]);
      const { start, seconds } = defined(stretch, `the question at ${rate} Hz`);
      expect(start, `at ${rate} Hz`).toBeGreaterThanOrEqual(2 + FIRST_WORD - 0.32);
      expect(start, `at ${rate} Hz`).toBeLessThanOrEqual(2 + FIRST_WORD);
      expect(start + seconds, `at ${rate} Hz`).toBeGreaterThan(2 + 4.3);
    }
  });

  it('keeps a 300 ms sound said after digital silence', () => {
    const worklet = loadWorklet(48000);
    worklet.feedExact(2, quiet);
    worklet.feedExact(0.3, tone(300, 0.5));
    worklet.feedExact(1, quiet);
    const [stretch, ...others] = worklet.stretches();
    expect(others).toEqual([]);
    expect(defined(stretch, 'the sound').start).toBeCloseTo(1.7, 2);
  });

  it('finds speech heard from the very first frame, its first word and all', () => {
    for (const from of [0, FIRST_WORD]) {
      const worklet = loadWorklet(48000);
      worklet.feed(QUESTION_SECONDS - from, (t) => question(t + from));
      worklet.feed(1, quiet);
      const [stretch, ...others] = worklet.stretches();
      expect(others, `from ${from} s`).toEqual([]);
      const { start, samples } = defined(stretch, `the question from ${from} s`);
      expect(start, `from ${from} s`).toBe(0);
      // The first word, "What", is loud from 10 ms in.
      expect(peak(samples, FIRST_WORD - from + 0.02, FIRST_WORD - from + 0.2)).toBeGreaterThan(
        3000
      );
    }
  });

  it('takes a loud room heard from the start for background', () => {
    for (const amplitude of [0.04, 0.06, 0.1]) {
      const worklet = loadWorklet(48000);
      worklet.feed(10, room(amplitude));
      expect(worklet.stretches(), `a room at ${amplitude}`).toEqual([]);
    }
  });

  it('takes a loud room for background when the microphone fades in at the start', () => {
    for (const amplitude of [0.06, 0.1]) {
      const worklet = loadWorklet(48000);
      const noisy = room(amplitude);
      worklet.feed(10, (t) => Math.min(1, t / 0.05) * noisy()); // 50 ms from silence to the room
      expect(worklet.stretches(), `a room at ${amplitude}`).toEqual([]);
    }
  });

  it('finds speech that starts 300 ms in over a loud room, and what came before it', () => {
    for (const amplitude of [0.04, 0.06, 0.1]) {
      const worklet = loadWorklet(48000);
      const noisy = room(amplitude);
      worklet.feed(0.3, noisy);
      worklet.feed(1.5, both(noisy, voice)); // the last syllable ends at 1.7 s
      worklet.feed(1, noisy);
      const [stretch, ...others] = worklet.stretches();
      expect(others).toEqual([]);
      const { start, seconds } = defined(stretch, `speech over a room at ${amplitude}`);
      expect(start).toBeCloseTo(0, 2);
      expect(Math.abs(seconds - 1.9)).toBeLessThan(0.02);
    }
  });

  it('finds speech heard from the very first sound, first syllable and all', () => {
    const worklet = loadWorklet(48000);
    worklet.feed(1.5, voice);
    worklet.feed(1, quiet);
    const [stretch, ...others] = worklet.stretches();
    expect(others).toEqual([]);
    const { start, seconds, samples } = defined(stretch, 'speech from the start');
    expect(start).toBe(0);
    expect(Math.abs(seconds - 1.6)).toBeLessThan(0.02);
    expect(peak(samples, 0.01, 0.19)).toBeGreaterThan(9000);
  });

  it('posts 16-bit samples at 16 kHz whatever rate the audio runs at', () => {
    for (const rate of [16000, 44100, 48000]) {
      const worklet = loadWorklet(rate);
      worklet.feed(1, quiet);
      worklet.feed(0.6, tone(1000, 0.4));
      worklet.feed(1, quiet);
      const sent = defined(
        worklet.sent.find((message) => message.type === 'stretch'),
        `a stretch at ${rate} Hz`
      );
      expect(Object.prototype.toString.call(sent.samples)).toBe('[object Int16Array]');
      const { start, seconds, samples } = defined(worklet.stretches()[0], 'a stretch');
      expect(start).toBeCloseTo(0.7, 2);
      expect(Math.abs(seconds - 1.1)).toBeLessThan(0.02);
      // The tone keeps its pitch and level: 0.4 of full scale at 1 kHz.
      expect(amplitudeAt(samples, 1000, 0.4, 0.8) / 32767).toBeCloseTo(0.4, 1);
    }
  });

  it('keeps sound above 8 kHz from folding into what it posts', () => {
    const worklet = loadWorklet(48000);
    worklet.feed(1, quiet);
    worklet.feed(0.6, both(tone(1000, 0.2), tone(14000, 0.2)));
    worklet.feed(1, quiet);
    const { samples } = defined(worklet.stretches()[0], 'a stretch');
    const kept = amplitudeAt(samples, 1000, 0.4, 0.8);
    const folded = amplitudeAt(samples, 2000, 0.4, 0.8); // 14 kHz would fold to 2 kHz
    expect(kept / 32767).toBeCloseTo(0.2, 1);
    expect(folded / kept).toBeLessThan(0.1);
  });

  it('ends a stretch at 25 seconds and goes on with the same speech in the next one', () => {
    const worklet = loadWorklet(48000);
    worklet.feed(1, quiet);
    worklet.feed(40, voice); // the last syllable ends at 41 s
    worklet.feed(1, quiet);
    const [first, second, ...others] = worklet.stretches();
    expect(others).toEqual([]);
    expect(defined(first, 'the first stretch').samples).toHaveLength(25 * OUTPUT_RATE);
    expect(defined(first, 'the first stretch').start).toBeCloseTo(0.7, 2);
    expect(defined(second, 'the second stretch').start).toBeCloseTo(25.7, 2);
    expect(Math.abs(defined(second, 'the second stretch').seconds - 15.5)).toBeLessThan(0.02);
  });

  it('drops a short sound such as a click or a cough, and keeps one of 300 ms', () => {
    const worklet = loadWorklet(48000);
    worklet.feed(1, quiet);
    worklet.feed(0.1, tone(1000, 0.5));
    worklet.feed(1, quiet);
    worklet.feed(0.15, tone(300, 0.5));
    worklet.feed(1, quiet);
    expect(worklet.stretches()).toEqual([]);

    worklet.feed(0.3, tone(300, 0.5));
    worklet.feed(1, quiet);
    expect(worklet.stretches()).toHaveLength(1);
  });

  it('does not take typing for speech: no keystroke lasts 60 ms', () => {
    const worklet = loadWorklet(48000);
    const clatter = room(0.3);
    worklet.feed(1, quiet);
    worklet.feed(3, (t) => (t % 0.125 < 0.04 ? clatter() : 0)); // eight 40 ms keystrokes a second
    worklet.feed(1, quiet);
    expect(worklet.stretches()).toEqual([]);
  });

  it('captures nothing while paused, and drops the stretch a pause cuts into', () => {
    const worklet = loadWorklet(48000);
    worklet.feed(1, quiet);
    worklet.feed(1, voice);
    worklet.tell({ type: 'pause', paused: true });
    worklet.feed(1, voice);
    worklet.feed(1, quiet);
    worklet.feed(2, voice);
    worklet.feed(1, quiet);
    expect(worklet.stretches()).toEqual([]);

    const resumed = worklet.now();
    worklet.tell({ type: 'pause', paused: false });
    worklet.feed(1, voice);
    worklet.feed(1, quiet);
    const [stretch, ...others] = worklet.stretches();
    expect(others).toEqual([]);
    // Nothing from before the pause ended, not even as the 300 ms kept before speech.
    expect(defined(stretch, 'a stretch').start).toBeGreaterThanOrEqual(resumed);
    expect(defined(stretch, 'a stretch').start).toBeLessThan(resumed + 0.02);
  });

  it('stops counting a long steady tone as speech, and still finds speech over it', () => {
    const worklet = loadWorklet(48000);
    worklet.feed(1, quiet);
    worklet.feed(60, tone(440, 0.3));
    const toneStretches = worklet.stretches();
    expect(toneStretches.length).toBeLessThanOrEqual(1);
    toneStretches.forEach(({ start, seconds }) => expect(start + seconds).toBeLessThan(15));

    const hum = tone(100, 0.03);
    const humStart = worklet.now();
    worklet.feed(30, hum);
    expect(worklet.stretches().filter(({ start }) => start >= humStart - 0.5)).toEqual([]);

    const speechStart = worklet.now();
    worklet.feed(1.5, both(hum, voice));
    worklet.feed(1, hum);
    const [stretch, ...others] = worklet.stretches().filter(({ start }) => start >= humStart);
    expect(others).toEqual([]);
    expect(defined(stretch, 'speech over the hum').start).toBeCloseTo(speechStart - 0.3, 2);
  });

  it('ends the stretch when the microphone is muted, and hears the room as before after it', () => {
    const worklet = loadWorklet(48000);
    const noisy = room(0.02);
    worklet.feed(3, noisy);
    worklet.feed(1, both(noisy, voice)); // the last syllable ends at 4 s
    worklet.mute(3);
    const [muted, ...others] = worklet.stretches();
    expect(others).toEqual([]);
    expect(defined(muted, 'the speech before muting').start).toBeCloseTo(2.7, 2);
    expect(Math.abs(defined(muted, 'the speech before muting').seconds - 1.5)).toBeLessThan(0.02);

    worklet.feed(3, noisy);
    expect(worklet.stretches()).toHaveLength(1); // the room is still background
    const spoken = worklet.now();
    worklet.feed(1, both(noisy, voice));
    worklet.feed(1, noisy);
    const [, after, ...more] = worklet.stretches();
    expect(more).toEqual([]);
    expect(defined(after, 'the speech after muting').start).toBeCloseTo(spoken - 0.3, 2);
  });

  it('on flush, posts the stretch in progress and then says it is done', () => {
    const worklet = loadWorklet(48000);
    worklet.feed(1, quiet);
    worklet.feed(1, voice);
    worklet.feed(0.4, quiet); // the last syllable ended at 2 s; 200 ms of the quiet is kept
    worklet.tell({ type: 'flush' });
    expect(worklet.sent.map(({ type }) => type)).toEqual(['stretch', 'flushed']);
    const { start, seconds } = defined(worklet.stretches()[0], 'a stretch');
    expect(start).toBeCloseTo(0.7, 2);
    expect(Math.abs(seconds - 1.5)).toBeLessThan(0.02);

    worklet.feed(0.1, tone(1000, 0.5)); // too short to keep
    worklet.tell({ type: 'flush' });
    worklet.tell({ type: 'flush' });
    expect(worklet.sent.map(({ type }) => type)).toEqual([
      'stretch',
      'flushed',
      'flushed',
      'flushed',
    ]);
  });
});
