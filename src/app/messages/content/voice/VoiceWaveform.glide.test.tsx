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

type FakeAnimation = {
  target: Element;
  keyframes: Keyframe[];
  cancel: ReturnType<typeof vi.fn>;
  handle: { startTime: CSSNumberish | null };
};

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
    const cancel = vi.fn();
    const handle = {
      cancel,
      effect: { getComputedTiming: () => ({ progress }) },
      startTime: null,
    };
    animations.push({ target: this, keyframes, cancel, handle });
    return handle as unknown as Animation;
  }) as unknown as HTMLElement['animate'];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'timeline');
});

describe('VoiceWaveform live glide', () => {
  it('glides the strip in from one bar step per new sample, carrying on a glide in flight', () => {
    render(1);
    expect(animations).toHaveLength(0);

    render(2);
    expect(animations).toHaveLength(1);
    expect(animations[0]!.target.className).toBe('CompactStrip');
    expect(animations[0]!.keyframes).toEqual([
      { insetInlineEnd: '-0.1875rem' },
      { insetInlineEnd: '0' },
    ]);

    progress = 0.5;
    render(3);
    expect(animations[0]!.cancel).toHaveBeenCalled();
    expect(animations[1]!.keyframes[0]).toEqual({ insetInlineEnd: '-0.2813rem' });

    // Never farther than the strip reaches past its start: many samples at once jump the rest.
    render(13);
    expect(animations[2]!.keyframes[0]).toEqual({ insetInlineEnd: '-0.375rem' });

    render(0);
    expect(animations[2]!.cancel).toHaveBeenCalled();
    expect(animations).toHaveLength(3);
  });

  it('starts each glide at the frame on screen', () => {
    Object.defineProperty(document, 'timeline', {
      configurable: true,
      value: { currentTime: 1234 },
    });
    render(1);
    render(2);
    expect(animations[0]!.handle.startTime).toBe(1234);
  });

  it('steps without gliding when reduced motion is asked for', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    );
    render(1);
    render(2);
    expect(animations).toHaveLength(0);
  });

  it('stays still without a live sample count', () => {
    render(undefined);
    render(undefined);
    expect(animations).toHaveLength(0);
  });
});
