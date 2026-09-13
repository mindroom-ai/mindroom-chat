import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { VoiceAudioContent } from './VoiceAudioContent';

const mocks = vi.hoisted(() => ({
  srcState: { status: 'idle' as const } as { status: string; data?: string },
  loadSrc: vi.fn(() => Promise.resolve('blob:voice')),
  playing: false,
  setPlaying: vi.fn(),
  seek: vi.fn(),
  playTimeCallback: undefined as ((duration: number, currentTime: number) => void) | undefined,
}));

vi.mock('folds', () => ({
  Icon: (props: Record<string, unknown>) => React.createElement('span', props),
  IconButton: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => React.createElement('button', { ...props, onClick }, children),
  Icons: {
    Pause: 'pause',
    Play: 'play',
  },
  Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
  Text: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('span', props, children),
}));

vi.mock('./VoiceAudioContent.css', () => ({
  Audio: 'Audio',
  Capsule: 'Capsule',
  Time: 'Time',
}));

vi.mock('../../voice/VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
  Svg: 'Svg',
  Waveform: 'Waveform',
  WaveformDimmed: 'WaveformDimmed',
  WaveformSeek: 'WaveformSeek',
}));

vi.mock('./useAudioContentSource', () => ({
  useAudioContentSource: () => [mocks.srcState, mocks.loadSrc],
}));

vi.mock('../../../hooks/media', () => ({
  useMediaLoading: () => ({ loading: false }),
  useMediaPlay: () => ({ playing: mocks.playing, setPlaying: mocks.setPlaying }),
  useMediaPlayTimeCallback: (
    _getAudio: unknown,
    callback: (duration: number, currentTime: number) => void
  ) => {
    mocks.playTimeCallback = callback;
  },
  useMediaSeek: () => ({ seek: mocks.seek }),
}));

vi.mock('../../../hooks/useThrottle', () => ({
  useThrottle: (callback: unknown) => callback,
}));

const renderVoiceAudio = () =>
  React.createElement(VoiceAudioContent, {
    mimeType: 'audio/ogg',
    url: 'mxc://mindroom/voice',
    info: {
      mimetype: 'audio/ogg',
      duration: 10000,
    },
    waveform: [0, 512, 1024],
  });

describe('VoiceAudioContent', () => {
  let renderer: ReactTestRenderer;

  beforeEach(() => {
    mocks.srcState = { status: AsyncStatus.Idle };
    mocks.loadSrc.mockReset();
    mocks.loadSrc.mockResolvedValue('blob:voice');
    mocks.playing = false;
    mocks.setPlaying.mockReset();
    mocks.seek.mockReset();
    mocks.playTimeCallback = undefined;
  });

  it('renders only play, waveform seek, and time controls', () => {
    renderer = create(renderVoiceAudio());

    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Play voice message',
      'Seek voice message',
    ]);
    expect(renderer.root.findAllByType('rect')).toHaveLength(48);
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('0:10');
    expect(rendered).not.toMatch(/download|volume|mute|speed/i);

    renderer.unmount();
  });

  it('lazily loads media on first play and autoplays once loaded', () => {
    renderer = create(renderVoiceAudio());

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    expect(mocks.loadSrc).toHaveBeenCalledOnce();
    expect(renderer.root.findByType('audio').props.autoPlay).toBe(true);

    renderer.unmount();
  });

  it('uses the media play controller after source load', () => {
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio());

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    expect(mocks.setPlaying).toHaveBeenCalledWith(true);
    expect(renderer.root.findByType('audio').props.autoPlay).toBe(false);

    renderer.unmount();
  });

  it('seeks through waveform click progress', () => {
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio());

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Seek voice message' }).props.onClick({
        clientX: 25,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
      });
    });

    expect(mocks.seek).toHaveBeenCalledWith(2.5);

    renderer.unmount();
  });

  it('loads and applies a pending seek before first playback', async () => {
    renderer = create(renderVoiceAudio(), {
      createNodeMock: (element) => (element.type === 'audio' ? { currentTime: 0 } : null),
    });

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Seek voice message' }).props.onClick({
        clientX: 50,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
      });
    });

    expect(mocks.loadSrc).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain('0:05');

    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    await act(async () => {
      renderer.update(renderVoiceAudio());
    });

    expect(mocks.seek).toHaveBeenCalledWith(5);

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    expect(mocks.setPlaying).toHaveBeenCalledWith(true);

    renderer.unmount();
  });

  it('preserves Matrix duration when browser duration is invalid', () => {
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio());

    act(() => {
      mocks.playTimeCallback?.(Number.NaN, 0);
      mocks.playTimeCallback?.(Number.POSITIVE_INFINITY, 0);
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:10');

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Seek voice message' }).props.onClick({
        clientX: 50,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
      });
    });

    expect(mocks.seek).toHaveBeenCalledWith(5);

    renderer.unmount();
  });

  it('renders fallback waveform bars for missing metadata', () => {
    renderer = create(
      React.createElement(VoiceAudioContent, {
        mimeType: 'audio/ogg',
        url: 'mxc://mindroom/voice',
        info: {
          mimetype: 'audio/ogg',
          duration: 5000,
        },
      })
    );

    expect(renderer.root.findAllByType('rect')).toHaveLength(48);

    renderer.unmount();
  });
});
