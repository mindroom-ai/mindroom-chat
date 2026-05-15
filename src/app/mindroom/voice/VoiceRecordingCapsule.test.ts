import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createFallbackWaveform } from '../../utils/audioWaveform';
import { VoiceRecordingCapsule } from './VoiceRecordingCapsule';

vi.mock('folds', () => {
  const Wrapper = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children);
  const Button = ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => React.createElement('button', { ...props, onClick }, children);

  return {
    Box: Wrapper,
    Icon: (props: Record<string, unknown>) => React.createElement('span', props),
    IconButton: Button,
    Icons: new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
    Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
    Text: Wrapper,
  };
});

vi.mock('./VoiceRecordingCapsule.css', () => ({
  Capsule: 'Capsule',
  HiddenStatus: 'HiddenStatus',
  Timer: 'Timer',
}));

vi.mock('../../components/voice/VoiceWaveform.css', () => ({
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

describe('VoiceRecordingCapsule', () => {
  it('renders only discard, waveform, timer, pause, and send controls', () => {
    const renderer = create(
      React.createElement(VoiceRecordingCapsule, {
        phase: 'recording',
        elapsedMs: 12000,
        waveform: createFallbackWaveform(),
        canPause: true,
        onDiscard: vi.fn(),
        onPause: vi.fn(),
        onResume: vi.fn(),
        onSend: vi.fn(),
      })
    );

    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Discard voice recording',
      'Pause voice recording',
      'Send voice recording',
    ]);
    expect(renderer.toJSON()).toEqual(expect.not.stringContaining('Add to uploads'));
    expect(renderer.toJSON()).toEqual(expect.not.stringContaining('Record again'));
    expect(renderer.root.findAllByType('rect')).toHaveLength(48);

    renderer.unmount();
  });

  it('toggles pause/resume and calls send/discard handlers', () => {
    const onDiscard = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onSend = vi.fn();
    const renderer = create(
      React.createElement(VoiceRecordingCapsule, {
        phase: 'paused',
        elapsedMs: 3000,
        waveform: createFallbackWaveform(),
        canPause: true,
        onDiscard,
        onPause,
        onResume,
        onSend,
      })
    );

    const buttons = renderer.root.findAllByType('button');
    expect(buttons[1].props['aria-label']).toBe('Resume voice recording');

    act(() => {
      buttons[0].props.onClick();
      buttons[1].props.onClick();
      buttons[2].props.onClick();
    });

    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledOnce();
    expect(onPause).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledOnce();

    renderer.unmount();
  });

  it('disables discard while a send stop is processing', () => {
    const renderer = create(
      React.createElement(VoiceRecordingCapsule, {
        phase: 'processing',
        elapsedMs: 3000,
        waveform: createFallbackWaveform(),
        canPause: true,
        onDiscard: vi.fn(),
        onPause: vi.fn(),
        onResume: vi.fn(),
        onSend: vi.fn(),
      })
    );

    const discardButton = renderer.root.findByProps({
      'aria-label': 'Discard voice recording',
    });
    expect(discardButton.props.disabled).toBe(true);

    renderer.unmount();
  });

  it('reuses the capsule controls for a pending recording ready to retry', () => {
    const onDiscard = vi.fn();
    const onPause = vi.fn();
    const onSend = vi.fn();
    const renderer = create(
      React.createElement(VoiceRecordingCapsule, {
        phase: 'idle',
        elapsedMs: 4200,
        waveform: createFallbackWaveform(),
        canPause: true,
        hasPendingSend: true,
        onDiscard,
        onPause,
        onResume: vi.fn(),
        onSend,
      })
    );

    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Discard voice recording',
      'Pause voice recording',
      'Retry sending voice recording',
    ]);
    expect(buttons[1].props.disabled).toBe(true);
    expect(buttons[2].props.disabled).toBeFalsy();
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice recording ready to retry');

    act(() => {
      buttons[0].props.onClick();
      buttons[2].props.onClick();
    });

    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onPause).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledOnce();

    renderer.unmount();
  });
});
