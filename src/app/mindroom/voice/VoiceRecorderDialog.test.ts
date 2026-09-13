import React, { useState } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorderComposer } from './VoiceRecorderDialog';

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
    Button,
    Dialog: Wrapper,
    Icon: (props: Record<string, unknown>) => React.createElement('span', props),
    IconButton: Button,
    Icons: new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
    Line: Wrapper,
    Overlay: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
      open ? React.createElement('div', null, children) : null,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
    Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
    Text: Wrapper,
    config: {
      space: new Proxy(
        {},
        {
          get: () => '0px',
        }
      ),
    },
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
  Svg: 'Svg',
  SvgCompact: 'SvgCompact',
  Waveform: 'Waveform',
  WaveformCompact: 'WaveformCompact',
  WaveformDimmed: 'WaveformDimmed',
  WaveformSeek: 'WaveformSeek',
}));

vi.mock('../../utils/dom', () => ({
  pauseAllMediaElements: vi.fn(),
}));

function OverviewHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return React.createElement('div', null, 'closed');
  }

  return React.createElement(VoiceRecorderComposer, {
    active: open,
    onClose: () => {
      onClose();
      setOpen(false);
    },
    onSendRecording: vi.fn(),
  });
}

describe('VoiceRecorderComposer', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      isSecureContext: true,
    });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('MediaRecorder', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps an overview recorder error visible until the user dismisses it', async () => {
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(React.createElement(OverviewHarness, { onClose }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('Voice Recording Error');
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Voice recording is not supported in this browser.'
    );

    const okButton = renderer.root
      .findAllByType('button')
      .find((button) => button.props.children === 'OK');
    expect(okButton).toBeTruthy();

    await act(async () => {
      okButton?.props.onClick();
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain('closed');

    renderer.unmount();
  });
});
