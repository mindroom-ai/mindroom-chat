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
  CompactStrip: 'CompactStrip',
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
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

const runFrame = () => {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(0)));
};

const fillWidth = () => Number(host.querySelectorAll('svg')[1]!.getAttribute('width'));
const fullWidth = () => Number(host.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('VoiceWaveform played fill', () => {
  it('follows the media every frame while playing, and the reported progress otherwise', () => {
    let position = 0.25;
    const getProgress = () => position;
    act(() =>
      root.render(<VoiceWaveform waveform={[100, 200]} progress={0.2} getProgress={getProgress} />)
    );

    // A render from a stale report still shows the media's position.
    expect(fillWidth()).toBeCloseTo(fullWidth() * 0.25);
    position = 0.2601;
    runFrame();
    expect(fillWidth()).toBeCloseTo(fullWidth() * 0.2601);

    // A later render from a report older than the last frame does not pull the fill back.
    act(() =>
      root.render(<VoiceWaveform waveform={[100, 200]} progress={0.22} getProgress={getProgress} />)
    );
    expect(fillWidth()).toBeCloseTo(fullWidth() * 0.2601);

    act(() => root.render(<VoiceWaveform waveform={[100, 200]} progress={0.3} />));
    expect(fillWidth()).toBeCloseTo(fullWidth() * 0.3);
    expect(frames.size).toBe(0);
  });

  it('schedules no frame after unmounting while playing', () => {
    act(() =>
      root.render(<VoiceWaveform waveform={[100, 200]} progress={0.2} getProgress={() => 0.5} />)
    );
    expect(frames.size).toBe(1);
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    root = createRoot(host);
  });
});
