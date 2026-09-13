import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { AudioContent } from './AudioContent';

const mocks = vi.hoisted(() => ({
  srcState: { status: 'idle' as const },
  loadSrc: vi.fn(() => Promise.resolve('blob:audio')),
  setPlaying: vi.fn(),
  seek: vi.fn(),
  setMute: vi.fn(),
  setVolume: vi.fn(),
}));

vi.mock('folds', () => ({
  Badge: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  Chip: ({ children, onClick, ...props }: { children?: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { ...props, 'data-chip': 'true', onClick }, children),
  Icon: (props: Record<string, unknown>) => React.createElement('span', props),
  IconButton: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => React.createElement('button', { ...props, 'data-icon-button': 'true', onClick }, children),
  Icons: {
    Pause: 'pause',
    Play: 'play',
    VolumeMute: 'volume-mute',
    VolumeHigh: 'volume-high',
  },
  ProgressBar: (props: Record<string, unknown>) => React.createElement('div', props),
  Spinner: (props: Record<string, unknown>) => React.createElement('div', props),
  Text: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('span', props, children),
  toRem: (value: number) => `${value}rem`,
}));

vi.mock('react-range', () => ({
  Range: () => React.createElement('div', { 'data-range': 'true' }),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../../hooks/useAsyncCallback', async () => {
  const actual = await vi.importActual<typeof import('../../../hooks/useAsyncCallback')>(
    '../../../hooks/useAsyncCallback'
  );

  return {
    ...actual,
    useAsyncCallback: () => [mocks.srcState, mocks.loadSrc],
  };
});

vi.mock('../../../hooks/useBlobUrlCleanup', () => ({
  useBlobUrlCleanup: () => undefined,
}));

vi.mock('../../../hooks/media', () => ({
  useMediaLoading: () => ({ loading: false }),
  useMediaPlay: () => ({ playing: false, setPlaying: mocks.setPlaying }),
  useMediaPlayTimeCallback: () => undefined,
  useMediaSeek: () => ({ seek: mocks.seek }),
  useMediaVolume: () => ({
    volume: 1,
    mute: false,
    setMute: mocks.setMute,
    setVolume: mocks.setVolume,
  }),
}));

vi.mock('../../../utils/matrix', () => ({
  decryptFile: vi.fn(),
  downloadEncryptedMedia: vi.fn(),
  downloadMedia: vi.fn(),
  mxcUrlToHttp: () => 'https://example.test/audio',
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

const renderMediaControl = ({
  after,
  leftControl,
  rightControl,
  children,
}: {
  after: React.ReactNode;
  leftControl: React.ReactNode;
  rightControl: React.ReactNode;
  children: React.ReactNode;
}) => React.createElement('div', null, children, leftControl, rightControl, after);

const renderAudioContent = () =>
  React.createElement(AudioContent, {
    mimeType: 'audio/ogg',
    url: 'mxc://mindroom/audio',
    info: {
      mimetype: 'audio/ogg',
      duration: 5000,
    },
    renderMediaControl,
  });

describe('AudioContent', () => {
  let renderer: ReactTestRenderer;

  beforeEach(() => {
    mocks.srcState = { status: AsyncStatus.Idle };
    mocks.loadSrc.mockReset();
    mocks.loadSrc.mockImplementation(() => Promise.resolve('blob:audio'));
    mocks.setPlaying.mockReset();
    mocks.seek.mockReset();
    mocks.setMute.mockReset();
    mocks.setVolume.mockReset();
  });

  it('clears autoplay after the initial user-requested playback starts', () => {
    act(() => {
      renderer = create(renderAudioContent());
    });

    let audio = renderer.root.findByType('audio');
    expect(audio.props.autoPlay).toBe(false);

    const playButton = renderer.root.findAll((node) => node.props?.['data-chip'] === 'true')[0];
    act(() => {
      playButton.props.onClick();
    });

    expect(mocks.loadSrc).toHaveBeenCalledOnce();
    audio = renderer.root.findByType('audio');
    expect(audio.props.autoPlay).toBe(true);

    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:audio',
    };

    act(() => {
      renderer.update(renderAudioContent());
    });

    audio = renderer.root.findByType('audio');
    expect(audio.props.autoPlay).toBe(true);

    act(() => {
      audio.props.onPlay();
    });

    audio = renderer.root.findByType('audio');
    expect(audio.props.autoPlay).toBe(false);
  });

  it('uses the media play controller once the source has already loaded', () => {
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:audio',
    };

    act(() => {
      renderer = create(renderAudioContent());
    });

    const playButton = renderer.root.findAll((node) => node.props?.['data-chip'] === 'true')[0];
    act(() => {
      playButton.props.onClick();
    });

    expect(mocks.setPlaying).toHaveBeenCalledWith(true);
    expect(renderer.root.findByType('audio').props.autoPlay).toBe(false);
  });
});
