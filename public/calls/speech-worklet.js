// Finds speech in the call's microphone: an AudioWorklet that turns what it hears into 16 kHz mono
// 16-bit audio and cuts it into stretches of speech, which the page uploads to be transcribed
// (src/app/calls/transcription/speechCapture.ts loads it and is its only reader).
//
// From the page: { type: 'pause', paused } (nothing is kept while paused, and pausing drops the
// stretch in progress) and { type: 'flush' } (ends the stretch in progress now; answered with
// { type: 'flushed' }). To the page: { type: 'stretch', samples, startTime }: the stretch's samples
// (an Int16Array) and when its first one was heard, in the AudioContext's seconds.

/* global sampleRate, currentTime -- the AudioWorklet's scope gives these */

/** The rate stretches are posted at. */
const OUTPUT_RATE = 16000;
/** Speech is told from quiet 10 ms at a time. */
const FRAME = OUTPUT_RATE / 100;
/** A stretch starts once speech has lasted 60 ms... */
const START_FRAMES = 6;
/** ...and keeps the 300 ms before it, so the first syllable isn't clipped. */
const BEFORE_FRAMES = 30;
/** It ends after 700 ms of quiet... */
const END_FRAMES = 70;
/** ...keeping 200 ms of it. */
const AFTER_FRAMES = 20;
/** A stretch with less than 200 ms of speech (a cough, a click) is dropped. */
const LEAST_SPEECH_FRAMES = 20;
/** At 25 seconds a stretch ends, and longer speech goes on in the next one. */
const MOST_FRAMES = 2500;

/** A frame is speech when it is this far (dB) above the noise floor... */
const START_MARGIN_DB = 10;
/** ...or, once a stretch has started, this far. */
const KEEP_MARGIN_DB = 6;
/** Nothing quieter than this (dB of full scale) is speech, however quiet the room. */
const QUIETEST_SPEECH_DB = -60;
/** Quieter than this is digital silence (a muted microphone), which says nothing of the room. */
const SILENCE_DB = -100;
/**
 * The floor starts at the median level of the first 250 ms heard (digital silence aside): a loud
 * room is background from the start, even behind a microphone fading in.
 */
const FIRST_FLOOR_FRAMES = 25;
/**
 * Until then the floor is taken to be this level (dB of full scale), and it starts no higher:
 * speech heard first, from the first frame or after digital silence, is found from its first
 * syllable instead of being learned as the floor.
 */
const FIRST_FLOOR_MOST_DB = -30;
/** The noise floor follows quieter frames within about 50 ms... */
const FLOOR_FALL = 1 - Math.exp(-0.01 / 0.05);
/** ...and louder ones over about 3 seconds: a steady tone becomes background, speech does not. */
const FLOOR_RISE = 1 - Math.exp(-0.01 / 3);

/** Sound above this is filtered out before the rate is lowered, so it cannot fold into speech. */
const CUTOFF_HZ = 6400;
/** Two second-order sections make a fourth-order Butterworth low-pass filter. */
const BUTTERWORTH_Q = [0.5412, 1.3066];

/** A second-order low-pass section (a biquad, in transposed direct form II). */
class LowPass {
  constructor(rate, q) {
    const w = (2 * Math.PI * CUTOFF_HZ) / rate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    this.reset();
  }

  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }

  /** Filters `samples` in place. */
  run(samples) {
    for (let i = 0; i < samples.length; i += 1) {
      const x = samples[i];
      const y = this.b0 * x + this.z1;
      this.z1 = this.b1 * x - this.a1 * y + this.z2;
      this.z2 = this.b2 * x - this.a2 * y;
      samples[i] = y;
    }
  }
}

/** Turns audio at the AudioContext's rate into audio at 16 kHz, a block at a time. */
class Resampler {
  constructor(rate) {
    /** How far apart, in input samples, the output samples are. */
    this.step = rate / OUTPUT_RATE;
    this.filters = rate > OUTPUT_RATE ? BUTTERWORTH_Q.map((q) => new LowPass(rate, q)) : [];
    this.filtered = new Float32Array(0);
    this.reset();
  }

  /** Starts again, as if nothing had been heard. */
  reset() {
    /** Where the next output sample falls, in input samples from the next block's first. */
    this.position = 0;
    /** The last input sample of the block before, for an output sample falling before this one. */
    this.previous = 0;
    this.filters.forEach((filter) => filter.reset());
  }

  /** Calls `take` with each 16 kHz sample that `block` completes, by linear interpolation. */
  push(block, take) {
    if (this.filtered.length !== block.length) this.filtered = new Float32Array(block.length);
    const samples = this.filtered;
    samples.set(block);
    this.filters.forEach((filter) => filter.run(samples));
    const last = samples.length - 1;
    let position = this.position;
    while (position <= last) {
      const index = Math.floor(position);
      const before = index < 0 ? this.previous : samples[index];
      const after = index < last ? samples[index + 1] : before;
      take(before + (after - before) * (position - index));
      position += this.step;
    }
    this.position = position - samples.length;
    this.previous = samples[last];
  }
}

/** A sample of -1 to 1 as a 16-bit one. */
const toInt16 = (sample) => {
  const clipped = Math.max(-1, Math.min(1, sample));
  return Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff);
};

class SpeechFinder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.resampler = new Resampler(sampleRate);
    /** The 10 ms being heard, as it arrives. */
    this.frame = new Float32Array(FRAME);
    this.frameLength = 0;
    this.frameSamples = new Int16Array(FRAME);
    /** The last frames heard outside a stretch (oldest at `recentFirst`), to start the next. */
    this.recent = new Int16Array((BEFORE_FRAMES + START_FRAMES) * FRAME);
    this.recentFrames = 0;
    this.recentFirst = 0;
    this.stretch = new Int16Array(MOST_FRAMES * FRAME);
    this.floor = null;
    /** The levels of the first frames heard, until the floor is known. */
    this.firstLevels = new Float64Array(FIRST_FLOOR_FRAMES);
    this.firstLevelCount = 0;
    this.paused = false;
    /** Silence stands in for the microphone while it is muted, so the stretch in progress ends. */
    this.silence = new Float32Array(0);
    this.take = (sample) => this.hear(sample);
    this.restart();
    this.port.onmessage = (event) => this.receive(event.data);
  }

  /** Forgets everything heard but the noise floor; the next block starts the clock again. */
  restart() {
    this.clockStart = null;
    this.heard = 0;
    this.frameLength = 0;
    this.recentFrames = 0;
    this.speechRun = 0;
    this.endStretch();
  }

  receive(message) {
    if (message.type === 'pause') {
      // Pausing forgets everything heard; the first block after it starts the clock again.
      if (message.paused && !this.paused) this.restart();
      this.paused = message.paused;
    } else if (message.type === 'flush') {
      if (this.inStretch) this.finish(Math.max(0, this.quietRun - AFTER_FRAMES));
      this.recentFrames = 0;
      this.speechRun = 0;
      this.port.postMessage({ type: 'flushed' });
    }
  }

  process(inputs, outputs) {
    if (this.paused) return true;
    let block = inputs[0] && inputs[0][0];
    if (!block) {
      const length = (outputs[0] && outputs[0][0] && outputs[0][0].length) || 128;
      if (this.silence.length !== length) this.silence = new Float32Array(length);
      block = this.silence;
    }
    if (this.clockStart === null) {
      this.clockStart = currentTime;
      this.resampler.reset();
    }
    this.resampler.push(block, this.take);
    return true;
  }

  /** When the 16 kHz sample `index` (counted from the clock's start) was heard. */
  timeOf(index) {
    return this.clockStart + index / OUTPUT_RATE;
  }

  hear(sample) {
    this.frame[this.frameLength] = sample;
    this.frameLength += 1;
    this.heard += 1;
    if (this.frameLength < FRAME) return;
    this.frameLength = 0;
    this.judge();
  }

  /** Decides whether the frame just heard is speech, and starts, grows or ends a stretch. */
  judge() {
    let energy = 0;
    for (let i = 0; i < FRAME; i += 1) {
      const sample = this.frame[i];
      energy += sample * sample;
      this.frameSamples[i] = toInt16(sample);
    }
    const speech = this.isSpeech(10 * Math.log10(energy / FRAME));
    if (!this.inStretch) {
      this.remember(this.frameSamples);
      this.speechRun = speech ? this.speechRun + 1 : 0;
      if (this.speechRun >= START_FRAMES) this.begin();
      return;
    }
    this.stretch.set(this.frameSamples, this.stretchFrames * FRAME);
    this.stretchFrames += 1;
    if (speech) {
      this.speechFrames += 1;
      this.quietRun = 0;
    } else {
      this.quietRun += 1;
    }
    if (this.quietRun >= END_FRAMES) this.finish(this.quietRun - AFTER_FRAMES);
    else if (this.stretchFrames >= MOST_FRAMES) this.split();
  }

  /** Whether a frame at `level` (dB of full scale) is speech; the floor learns from it too. */
  isSpeech(level) {
    if (!(level > SILENCE_DB)) return false;
    const margin = this.inStretch ? KEEP_MARGIN_DB : START_MARGIN_DB;
    if (this.floor === null) {
      this.firstLevels[this.firstLevelCount] = level;
      this.firstLevelCount += 1;
      if (this.firstLevelCount === FIRST_FLOOR_FRAMES) {
        const median = this.firstLevels.sort()[Math.floor(FIRST_FLOOR_FRAMES / 2)];
        this.floor = Math.min(median, FIRST_FLOOR_MOST_DB);
      }
      return level >= FIRST_FLOOR_MOST_DB + margin;
    }
    const speech = level >= QUIETEST_SPEECH_DB && level >= this.floor + margin;
    this.floor += (level - this.floor) * (level < this.floor ? FLOOR_FALL : FLOOR_RISE);
    return speech;
  }

  /** Keeps `samples` among the recent frames, forgetting the oldest. */
  remember(samples) {
    const slots = this.recent.length / FRAME;
    const slot = (this.recentFirst + this.recentFrames) % slots;
    this.recent.set(samples, slot * FRAME);
    if (this.recentFrames < slots) this.recentFrames += 1;
    else this.recentFirst = (this.recentFirst + 1) % slots;
  }

  /** Starts a stretch with the recent frames: the speech so far and what came before it. */
  begin() {
    const slots = this.recent.length / FRAME;
    for (let i = 0; i < this.recentFrames; i += 1) {
      const slot = (this.recentFirst + i) % slots;
      this.stretch.set(this.recent.subarray(slot * FRAME, (slot + 1) * FRAME), i * FRAME);
    }
    this.inStretch = true;
    this.stretchFrames = this.recentFrames;
    this.stretchStart = this.timeOf(this.heard - this.stretchFrames * FRAME);
    this.speechFrames = this.speechRun;
    this.quietRun = 0;
    this.recentFrames = 0;
    this.speechRun = 0;
  }

  /**
   * Ends the stretch without its last `dropFrames` frames of quiet, posts it if it holds enough
   * speech, and keeps the quiet it dropped as what comes before the next one.
   */
  finish(dropFrames) {
    const kept = this.stretchFrames - Math.min(dropFrames, this.stretchFrames);
    if (this.speechFrames >= LEAST_SPEECH_FRAMES && kept > 0) this.post(kept);
    this.recentFrames = 0;
    this.recentFirst = 0;
    const slots = this.recent.length / FRAME;
    for (let i = Math.max(kept, this.stretchFrames - slots); i < this.stretchFrames; i += 1) {
      this.remember(this.stretch.subarray(i * FRAME, (i + 1) * FRAME));
    }
    this.endStretch();
  }

  /** Posts the 25 seconds heard so far, and goes on with the same speech in a new stretch. */
  split() {
    if (this.speechFrames >= LEAST_SPEECH_FRAMES) this.post(this.stretchFrames);
    this.stretchStart = this.timeOf(this.heard);
    this.stretchFrames = 0;
    this.speechFrames = 0;
  }

  endStretch() {
    this.inStretch = false;
    this.stretchFrames = 0;
    this.speechFrames = 0;
    this.quietRun = 0;
  }

  post(frames) {
    const samples = this.stretch.slice(0, frames * FRAME);
    this.port.postMessage({ type: 'stretch', samples, startTime: this.stretchStart }, [
      samples.buffer,
    ]);
  }
}

registerProcessor('speech-finder', SpeechFinder);
