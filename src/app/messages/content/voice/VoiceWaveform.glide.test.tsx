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

type FakeAnimation = { target: Element; keyframes: Keyframe[]; cancel: ReturnType<typeof vi.fn> };

let host: HTMLDivElement;
let root: Root;
let animations: FakeAnimation[];
let progress: number | null;

const render = (liveSampleCount: number | undefined) =>
  act(() => {
    root.render(<VoiceWaveform waveform={[100, 200]} liveSampleCount={liveSampleCount} compact />);
  });

beforeEach(() => {
  animations = [];
  progress = null;
  // jsdom has no Web Animations; record what the waveform asks for.
  HTMLElement.prototype.animate = vi.fn(function animate(
    this: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions
  ) {
    expect(options).toEqual({ duration: 80, easing: 'linear' });
    const animation: FakeAnimation = { target: this, keyframes, cancel: vi.fn() };
    animations.push(animation);
    return {
      cancel: animation.cancel,
      effect: { getComputedTiming: () => ({ progress }) },
    } as unknown as Animation;
  }) as unknown as HTMLElement['animate'];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

describe('VoiceWaveform live glide', () => {
  it('glides the strip in from one bar step per new sample, carrying on a glide in flight', () => {
    render(1);
    expect(animations).toHaveLength(0);

    render(2);
    expect(animations).toHaveLength(1);
    expect(animations[0]!.target.className).toBe('CompactStrip');
    expect(animations[0]!.keyframes).toEqual([
      { transform: 'translateX(3px)' },
      { transform: 'none' },
    ]);

    progress = 0.5;
    render(3);
    expect(animations[0]!.cancel).toHaveBeenCalled();
    expect(animations[1]!.keyframes[0]).toEqual({ transform: 'translateX(4.5px)' });

    // Never farther than the strip reaches past its start: many samples at once jump the rest.
    render(13);
    expect(animations[2]!.keyframes[0]).toEqual({ transform: 'translateX(6px)' });

    render(0);
    expect(animations[2]!.cancel).toHaveBeenCalled();
    expect(animations).toHaveLength(3);
  });

  it('stays still without a live sample count', () => {
    render(undefined);
    render(undefined);
    expect(animations).toHaveLength(0);
  });
});
