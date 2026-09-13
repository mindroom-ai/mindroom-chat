import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { VOICE_WAVEFORM_BAR_COUNT } from '../../utils/audioWaveform';
import { VoiceWaveform } from './VoiceWaveform';

vi.mock('./VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
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

  it('bounds and right-anchors the SVG in compact recording mode', () => {
    const renderer = create(
      React.createElement(VoiceWaveform, {
        waveform: [100, 200],
        compact: true,
      })
    );

    const container = renderer.root.findByType('div');
    const svg = renderer.root.findByType('svg');

    expect(container.props.className).toContain('WaveformCompact');
    expect(svg.props.className).toContain('SvgCompact');
    expect(svg.props.width).toBe(143);
    expect(svg.props.height).toBe(32);
    expect(svg.props.preserveAspectRatio).toBe('xMaxYMid meet');

    renderer.unmount();
  });
});
