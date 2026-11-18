// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceWaveform } from './VoiceWaveform';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
  BarCompact: 'BarCompact',
  BarCompactUnrecorded: 'BarCompactUnrecorded',
  CompactLine: 'CompactLine',
  Svg: 'Svg',
  SvgCompact: 'SvgCompact',
  Waveform: 'Waveform',
  WaveformCompact: 'WaveformCompact',
  WaveformDimmed: 'WaveformDimmed',
  WaveformSeek: 'WaveformSeek',
  SeekInput: 'SeekInput',
}));

let host: HTMLDivElement;
let root: Root;
// The time of the frame on screen, and the frame callbacks waiting for the next one.
let now: number;
let frames: Map<number, FrameRequestCallback>;

const render = (liveSampleCount: number | undefined) =>
  act(() => {
    root.render(<VoiceWaveform waveform={[100, 200]} liveSampleCount={liveSampleCount} compact />);
  });

const runFrame = (time: number) => {
  now = time;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(time));
};

const offset = () => host.querySelector('g')!.getAttribute('transform');

const renderSamples = (waveform: number[], liveSampleCount: number) =>
  act(() => {
    root.render(<VoiceWaveform waveform={waveform} liveSampleCount={liveSampleCount} compact />);
  });

// Where a bar is drawn: its x plus the glide's offset.
const drawnX = (index: number) =>
  Number(host.querySelectorAll('rect')[index]!.getAttribute('x')) +
  Number(/translate\(([\d.]+)/.exec(offset() ?? '')?.[1] ?? 0);

const samples = (length: number, first = 0) =>
  Array.from({ length }, (_value, index) => (first + index) % 1000);

beforeEach(() => {
  now = 1000;
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    })
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((frame: number) => frames.delete(frame))
  );
  Object.defineProperty(document, 'timeline', {
    configurable: true,
    get: () => ({ currentTime: now }),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'timeline');
});

describe('VoiceWaveform live glide', () => {
  it('glides the bars in from one bar step per new sample, carrying on a glide in flight', () => {
    render(1);
    expect(offset()).toBeNull();

    // Placed a step right at the frame on screen, then back over the sample interval.
    render(2);
    expect(offset()).toBe('translate(3 0)');
    runFrame(1040);
    expect(offset()).toBe('translate(1.5 0)');

    render(3);
    expect(offset()).toBe('translate(4.5 0)');

    // Never farther than two steps: many samples at once jump the rest.
    render(13);
    expect(offset()).toBe('translate(6 0)');
    runFrame(1120);
    expect(offset()).toBeNull();
    expect(frames.size).toBe(0);

    render(14);
    render(0);
    expect(offset()).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('keeps a bar where it was as a new sample glides in, then rests it a step left', () => {
    renderSamples(samples(100), 100);
    const before = drawnX(50);

    renderSamples(samples(101), 101);
    expect(drawnX(50)).toBe(before);
    runFrame(1080);
    expect(offset()).toBeNull();
    expect(drawnX(50)).toBe(before - 3);
  });

  it('glides a full rolling buffer, whose bars move to the index before them', () => {
    renderSamples(samples(1200), 1200);
    const before = drawnX(600);

    // The buffer keeps its last 1200 samples: the bar at 600 is now at 599.
    renderSamples(samples(1200, 1), 1201);
    expect(drawnX(599)).toBe(before);

    // A frame long after the glide's end, as in a tab coming back, puts the bars at rest.
    runFrame(5000);
    expect(offset()).toBeNull();
    expect(drawnX(599)).toBe(before - 3);
    expect(frames.size).toBe(0);
  });

  it('stops a glide when the count goes away, and starts afresh from the next one', () => {
    render(1);
    render(2);
    expect(offset()).toBe('translate(3 0)');

    // Paused: the capsule passes no count.
    render(undefined);
    expect(offset()).toBeNull();
    expect(frames.size).toBe(0);

    render(9);
    expect(offset()).toBeNull();
    render(10);
    expect(offset()).toBe('translate(3 0)');
  });

  it('stops asking for frames when unmounted mid-glide', () => {
    render(1);
    render(2);
    expect(frames.size).toBe(1);
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    root = createRoot(host);
  });

  it('steps without gliding when reduced motion is asked for', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    );
    render(1);
    render(2);
    expect(offset()).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('stays still without a live sample count', () => {
    render(undefined);
    render(undefined);
    expect(offset()).toBeNull();
    expect(frames.size).toBe(0);
  });
});
