// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAR_REST_SCALE, SPECTRUM_BAR_COUNT } from './audioSpectrum';
import { VoiceWaveformBars } from './VoiceWaveformBars';

const makeTrack = (id: string) =>
  Object.assign(new EventTarget(), {
    id,
    kind: 'audio',
    readyState: 'live',
    stop: vi.fn(),
  }) as unknown as MediaStreamTrack & {
    readyState: MediaStreamTrackState;
    stop: ReturnType<typeof vi.fn>;
  };

const scaleOf = (el: Element | null | undefined) =>
  Number.parseFloat(
    /scaleY\(([^)]+)\)/.exec((el as HTMLElement | null | undefined)?.style.transform ?? '')?.[1] ??
      'NaN'
  );

describe('VoiceWaveformBars', () => {
  let contexts: FakeAudioContext[] = [];
  let bins = new Uint8Array(512);
  let startState: AudioContextState = 'running';
  let resumeSucceeds = true;
  let rafs = new Map<number, FrameRequestCallback>();
  let nextRaf = 1;
  let reducedMotion = false;

  class FakeMediaStream {
    constructor(readonly tracks: MediaStreamTrack[]) {}
  }

  class FakeAudioContext {
    sampleRate = 48_000;
    state: AudioContextState = startState;
    sources: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> =
      [];
    analyser = {
      fftSize: 2048,
      minDecibels: -100,
      maxDecibels: -30,
      smoothingTimeConstant: 0.8,
      get frequencyBinCount() {
        return this.fftSize / 2;
      },
      connect: vi.fn(),
      getByteFrequencyData: vi.fn((out: Uint8Array) => out.set(bins.subarray(0, out.length))),
    };
    createAnalyser = vi.fn(() => this.analyser);
    createMediaStreamSource = vi.fn(() => {
      const source = { connect: vi.fn(), disconnect: vi.fn() };
      this.sources.push(source);
      return source;
    });
    resume = vi.fn(async () => {
      if (resumeSucceeds) this.state = 'running';
    });
    close = vi.fn(async () => {
      this.state = 'closed';
    });
    constructor() {
      contexts.push(this);
    }
  }

  const flush = (now: number) => {
    const pending = [...rafs.values()];
    rafs.clear();
    pending.forEach((cb) => cb(now));
  };
  const setTone = (freqHz: number) => {
    bins.fill(0);
    bins[Math.round((freqHz * 1024) / 48_000)] = 240;
  };
  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    contexts = [];
    bins = new Uint8Array(512);
    startState = 'running';
    resumeSucceeds = true;
    rafs = new Map();
    nextRaf = 1;
    reducedMotion = false;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('MediaStream', FakeMediaStream);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextRaf++;
      rafs.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => rafs.delete(id));
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders 5 bars at rest with no AudioContext or rAF when track is absent', () => {
    const { container } = render(<VoiceWaveformBars source="none" speaking={false} />);
    const bars = container.querySelectorAll('[data-call-voice-bar]');
    expect(bars).toHaveLength(SPECTRUM_BAR_COUNT);
    expect(
      container.querySelector('[data-call-voice-bars]')?.getAttribute('data-audio-active')
    ).toBe('false');
    expect(contexts).toHaveLength(0);
    expect(rafs.size).toBe(0);
    bars.forEach((bar) => expect(scaleOf(bar)).toBeCloseTo(BAR_REST_SCALE, 3));
  });

  it('peaks leftmost bar on bass and rightmost on treble without connecting analyser to destination', () => {
    const { container } = render(
      <VoiceWaveformBars track={makeTrack('r1')} source="remote" speaking />
    );
    const root = container.querySelector<HTMLElement>('[data-call-voice-bars]');
    const bars = container.querySelectorAll('[data-call-voice-bar]');
    expect(contexts[0]?.analyser.connect).not.toHaveBeenCalled();

    setTone(120);
    flush(16);
    flush(48);
    expect(root?.dataset.audioActive).toBe('true');
    expect(scaleOf(bars[0])).toBeGreaterThan(0.6);
    expect(scaleOf(bars[4])).toBeCloseTo(BAR_REST_SCALE, 3);

    setTone(5000);
    for (let t = 80; t <= 480; t += 40) flush(t);
    expect(scaleOf(bars[4])).toBeGreaterThan(scaleOf(bars[0]));
    expect(scaleOf(bars[4])).toBeGreaterThan(0.6);
  });

  it('reuses one AudioContext across track switches, disconnects old source, and closes on unmount', () => {
    const trackA = makeTrack('a');
    const trackB = makeTrack('b');
    const { rerender, unmount } = render(
      <VoiceWaveformBars track={trackA} source="local" speaking={false} />
    );
    const ctx = contexts[0]!;
    rerender(<VoiceWaveformBars track={trackB} source="remote" speaking />);

    expect(contexts).toHaveLength(1);
    expect(ctx.sources[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(trackA.stop).not.toHaveBeenCalled();

    unmount();
    expect(ctx.sources[1]?.disconnect).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(trackB.stop).not.toHaveBeenCalled();
  });

  it('resets bars and stops rAF on ended or cleared track, and pauses rAF while hidden', () => {
    const track = makeTrack('m1');
    const { container, rerender } = render(
      <VoiceWaveformBars track={track} source="local" speaking />
    );
    const root = container.querySelector<HTMLElement>('[data-call-voice-bars]');
    const bars = container.querySelectorAll('[data-call-voice-bar]');

    setTone(1000);
    flush(16);
    expect(root?.dataset.audioActive).toBe('true');

    setHidden(true);
    expect(rafs.size).toBe(0);
    setHidden(false);
    expect(rafs.size).toBe(1);

    track.readyState = 'ended';
    track.dispatchEvent(new Event('ended'));
    expect(rafs.size).toBe(0);
    expect(root?.dataset.audioActive).toBe('false');
    bars.forEach((bar) => expect(scaleOf(bar)).toBeCloseTo(BAR_REST_SCALE, 3));

    rerender(<VoiceWaveformBars track={makeTrack('m2')} source="local" speaking />);
    expect(rafs.size).toBe(1);
    rerender(<VoiceWaveformBars track={undefined} source="none" speaking={false} />);
    expect(rafs.size).toBe(0);
    expect(root?.dataset.audioActive).toBe('false');
  });

  it('resumes a suspended AudioContext on user gesture and throttles under reduced motion', () => {
    startState = 'suspended';
    resumeSucceeds = false;
    reducedMotion = true;
    const { container } = render(
      <VoiceWaveformBars track={makeTrack('s1')} source="remote" speaking />
    );
    const bars = container.querySelectorAll('[data-call-voice-bar]');
    const ctx = contexts[0]!;

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    resumeSucceeds = true;
    window.dispatchEvent(new Event('pointerdown'));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('keydown'));
    expect(ctx.resume).toHaveBeenCalledTimes(2);

    setTone(120);
    flush(0);
    expect(scaleOf(bars[0])).toBeGreaterThan(BAR_REST_SCALE);
    setTone(5000);
    flush(50);
    expect(scaleOf(bars[4])).toBeCloseTo(BAR_REST_SCALE, 3);
    flush(100);
    expect(scaleOf(bars[4])).toBeGreaterThan(BAR_REST_SCALE);
  });
});
