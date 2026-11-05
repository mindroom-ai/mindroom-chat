import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRingtone } from './ringtone';
import { defined } from '../../test/utils/defined';

/** A Web Audio stand-in that records the notes started and whether the context closed. */
class FakeAudioContext {
  static last?: FakeAudioContext;

  currentTime = 10;

  destination = {};

  started: Array<{ frequency: number; at: number }> = [];

  closed = false;

  resumed = false;

  constructor() {
    FakeAudioContext.last = this;
  }

  private node() {
    return { connect: (next: unknown) => next ?? this.node() };
  }

  createGain() {
    const param = {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    };
    return { ...this.node(), gain: param };
  }

  createOscillator() {
    const oscillator = {
      ...this.node(),
      type: '',
      frequency: { value: 0 },
      start: (at: number) => this.started.push({ frequency: oscillator.frequency.value, at }),
      stop: vi.fn(),
    };
    return oscillator;
  }

  resume() {
    this.resumed = true;
    return Promise.resolve();
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

describe('startRingtone', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rings in repeating cycles of rising bell pairs, scheduled ahead, until stopped', () => {
    const stop = startRingtone();
    const context = FakeAudioContext.last as FakeAudioContext;
    expect(context.resumed).toBe(true);
    // Each note starts its fundamental, then a soft overtone an octave up.
    const fundamentals = context.started.filter((_note, index) => index % 2 === 0);
    const overtones = context.started.filter((_note, index) => index % 2 === 1);
    overtones.forEach(({ frequency }, index) =>
      expect(frequency).toBeCloseTo(2 * defined(fundamentals[index], 'a fundamental').frequency)
    );
    // Two cycles are scheduled ahead, each B5, E6, B5, E6.
    expect(fundamentals.map(({ frequency }) => frequency)).toEqual([
      987.77, 1318.51, 987.77, 1318.51, 987.77, 1318.51, 987.77, 1318.51,
    ]);
    expect(
      defined(fundamentals[4], 'the second cycle').at -
        defined(fundamentals[0], 'the first note').at
    ).toBeCloseTo(2.6);

    const scheduled = context.started.length;
    context.currentTime += 2.6;
    vi.advanceTimersByTime(500);
    expect(context.started.length).toBeGreaterThan(scheduled);

    stop();
    expect(context.closed).toBe(true);
    const afterStop = context.started.length;
    context.currentTime += 10;
    vi.advanceTimersByTime(5000);
    expect(context.started.length).toBe(afterStop);
  });

  it('does nothing where Web Audio is missing', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => startRingtone()()).not.toThrow();
  });
});
