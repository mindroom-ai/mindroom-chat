import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { VOICE_WAVEFORM_BAR_COUNT } from '../../utils/audioWaveform';
import { VoiceWaveform } from './VoiceWaveform';

vi.mock('./VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
  BarCompact: 'BarCompact',
  BarCompactUnrecorded: 'BarCompactUnrecorded',
  Svg: 'Svg',
  SvgCompact: 'SvgCompact',
  Waveform: 'Waveform',
  WaveformCompact: 'WaveformCompact',
  WaveformDimmed: 'WaveformDimmed',
  WaveformSeek: 'WaveformSeek',
}));

describe('VoiceWaveform', () => {
  it('renders normalized SVG bars with active progress bars', () => {
    const renderer = create(
      React.createElement(VoiceWaveform, {
        waveform: [0, 512, 1024],
        progress: 0.5,
      })
    );

    const rects = renderer.root.findAllByType('rect');
    const svg = renderer.root.findByType('svg');
    const container = renderer.root.findByType('div');

    expect(rects).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(rects.filter((rect) => String(rect.props.className).includes('BarActive')).length).toBe(
      24
    );
    expect(container.props.className).toBe('Waveform');
    expect(svg.props.className).toBe('Svg');
    expect(svg.props.preserveAspectRatio).toBe('none');
    expect(svg.props.width).toBeUndefined();
    expect(svg.props.height).toBeUndefined();

    renderer.unmount();
  });

  it('maps click and keyboard input to seek progress', () => {
    const onSeekProgress = vi.fn();
    const renderer = create(
      React.createElement(VoiceWaveform, {
        waveform: [100, 200],
        progress: 0.5,
        onSeekProgress,
      })
    );

    const button = renderer.root.findByType('button');

    act(() => {
      button.props.onClick({
        clientX: 25,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
      });
    });
    act(() => {
      button.props.onKeyDown({
        key: 'ArrowRight',
        preventDefault: vi.fn(),
      });
    });
    act(() => {
      button.props.onKeyDown({
        key: 'Home',
        preventDefault: vi.fn(),
      });
    });

    expect(onSeekProgress).toHaveBeenNthCalledWith(1, 0.25);
    expect(onSeekProgress).toHaveBeenNthCalledWith(2, 0.55);
    expect(onSeekProgress).toHaveBeenNthCalledWith(3, 0);

    renderer.unmount();
  });

  it('right-anchors compact recording bars without resampling them to Matrix width', () => {
    const renderer = create(
      React.createElement(VoiceWaveform, {
        waveform: Array.from({ length: 96 }, (_value, index) => index),
        compact: true,
      })
    );

    const container = renderer.root.findByType('div');
    const svg = renderer.root.findByType('svg');
    const rects = renderer.root.findAllByType('rect');

    expect(container.props.className).toContain('WaveformCompact');
    expect(svg.props.className).toContain('SvgCompact');
    expect(rects).toHaveLength(96);
    expect(svg.props.viewBox).toBe('0 0 287 32');
    expect(svg.props.width).toBe(287);
    expect(svg.props.height).toBe(32);
    expect(svg.props.preserveAspectRatio).toBe('none');
    expect(svg.props.shapeRendering).toBe('crispEdges');

    renderer.unmount();
  });

  it('left-pads early compact recording samples with visible silence bars', () => {
    const renderer = create(
      React.createElement(VoiceWaveform, {
        waveform: [0, 512],
        compact: true,
      })
    );

    const svg = renderer.root.findByType('svg');
    const rects = renderer.root.findAllByType('rect');

    expect(rects).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(svg.props.viewBox).toBe('0 0 143 32');
    expect(rects.slice(0, -1).every((rect) => rect.props.height === 3)).toBe(true);
    expect(rects[0].props.className).toContain('BarCompact');
    expect(rects[0].props.className).toContain('BarCompactUnrecorded');
    expect(rects[45].props.className).toContain('BarCompactUnrecorded');
    expect(rects[46].props.className).not.toContain('BarCompactUnrecorded');
    expect(rects[47].props.height).toBeCloseTo(22.627);
    expect(rects[47].props.y).toBeCloseTo(4.686);

    renderer.unmount();
  });

  it('boosts quiet compact recording samples without expanding peak samples past the viewbox', () => {
    const renderer = create(
      React.createElement(VoiceWaveform, {
        waveform: [256, 1024],
        compact: true,
      })
    );

    const rects = renderer.root.findAllByType('rect');

    expect(rects[46].props.height).toBeCloseTo(16);
    expect(rects[47].props.height).toBe(32);
    expect(rects[47].props.y).toBe(0);

    renderer.unmount();
  });

  it('keeps non-compact playback waveform amplitude unchanged', () => {
    const renderer = create(
      React.createElement(VoiceWaveform, {
        waveform: [512],
      })
    );

    const rects = renderer.root.findAllByType('rect');

    expect(rects).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(rects[0].props.height).toBe(16);
    expect(rects[0].props.className).not.toContain('BarCompact');

    renderer.unmount();
  });
});
