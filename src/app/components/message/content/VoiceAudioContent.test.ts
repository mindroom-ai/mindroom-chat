import React from 'react';
import { Provider, createStore, type Store } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { voiceMessagePlaybackRateAtom } from '../../../state/voiceMessageSettings';
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

vi.mock('../../voice/VoicePlaybackRateButton.css', () => ({
  Button: 'Button',
  Label: 'Label',
  Placeholder: 'Placeholder',
}));

vi.mock('../../voice/VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
  Svg: 'Svg',
  SvgCompact: 'SvgCompact',
  Waveform: 'Waveform',
  WaveformCompact: 'WaveformCompact',
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

type StorageListener = (event: StorageEvent) => void;

type AudioMock = HTMLAudioElement & {
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

const createAudioMock = (): AudioMock =>
  ({
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: false,
    mozPreservesPitch: false,
    webkitPreservesPitch: false,
  } as AudioMock);

const renderVoiceAudioContent = (props?: Partial<React.ComponentProps<typeof VoiceAudioContent>>) =>
  React.createElement(VoiceAudioContent, {
    mimeType: 'audio/ogg',
    url: props?.url ?? 'mxc://mindroom/voice',
    info: {
      mimetype: 'audio/ogg',
      duration: 10000,
      ...props?.info,
    },
    waveform: props?.waveform ?? [0, 512, 1024],
    encInfo: props?.encInfo,
  });

const renderVoiceAudio = (
  store: Store = createStore(),
  props?: Partial<React.ComponentProps<typeof VoiceAudioContent>>
) =>
  React.createElement(
    Provider,
    { store },
    renderVoiceAudioContent(props)
  );

describe('VoiceAudioContent', () => {
  let renderer: ReactTestRenderer;
  const storageListeners = new Set<StorageListener>();

  beforeEach(() => {
    mocks.srcState = { status: AsyncStatus.Idle };
    mocks.loadSrc.mockReset();
    mocks.loadSrc.mockResolvedValue('blob:voice');
    mocks.playing = false;
    mocks.setPlaying.mockReset();
    mocks.seek.mockReset();
    mocks.playTimeCallback = undefined;
    storageListeners.clear();
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: StorageListener) => {
        if (type === 'storage') storageListeners.delete(listener);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storageListeners.clear();
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

    act(() => {
      renderer.unmount();
    });
  });

  it('hides the playback speed pill initially with a placeholder occupying the rate column', () => {
    renderer = create(renderVoiceAudio());

    expect(renderer.root.findAllByProps({ 'aria-hidden': 'true' })).toHaveLength(2);
    expect(
      renderer.root.findAllByProps({
        'aria-label': 'Playback speed, currently 1×, click to cycle',
      })
    ).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('1.5×');

    act(() => {
      renderer.unmount();
    });
  });

  it('lazily loads media on first play and autoplays once loaded', () => {
    renderer = create(renderVoiceAudio());

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    expect(mocks.loadSrc).toHaveBeenCalledOnce();
    expect(renderer.root.findByType('audio').props.autoPlay).toBe(true);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
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
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
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
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('keeps the playback speed pill visible after pause once revealed', () => {
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio());

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });
    mocks.playing = true;
    act(() => {
      renderer.update(renderVoiceAudio());
    });
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Pause voice message' }).props.onClick();
    });

    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('loads and applies a pending seek before first playback', async () => {
    renderer = create(renderVoiceAudio(), {
      createNodeMock: (element) => (element.type === 'audio' ? createAudioMock() : null),
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

    act(() => {
      renderer.unmount();
    });
  });

  it('applies playback rate and pitch preservation on rate change', () => {
    const store = createStore();
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };

    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 2);
    });

    expect(audio.playbackRate).toBe(2);
    expect(audio.preservesPitch).toBe(true);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(audio.mozPreservesPitch).toBe(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('applies playback rate when the source value changes', () => {
    const store = createStore();
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice-a',
    };

    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 1.5);
    });
    audio.playbackRate = 1;

    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice-b',
    };
    act(() => {
      renderer.update(renderVoiceAudio(store));
    });

    expect(audio.playbackRate).toBe(1.5);

    act(() => {
      renderer.unmount();
    });
  });

  it('applies playback rate in the onPlay handler', () => {
    const store = createStore();
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 2);
    });
    audio.playbackRate = 1;
    act(() => {
      renderer.root.findByType('audio').props.onPlay();
    });

    expect(audio.playbackRate).toBe(2);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 2×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('applies playback rate on loadedmetadata before pending seek handling', () => {
    const store = createStore();
    const audio = createAudioMock();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    act(() => {
      renderer = create(renderVoiceAudio(store), {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      });
    });

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 1.5);
    });
    audio.playbackRate = 1;
    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });

    expect(audio.playbackRate).toBe(1.5);
    expect(audio.preservesPitch).toBe(true);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(audio.mozPreservesPitch).toBe(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('cycles the global playback rate from the visible pill', () => {
    const store = createStore();
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(renderVoiceAudio(store));

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1.5);

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Playback speed, currently 1.5×, click to cycle' })
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(2);

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Playback speed, currently 2×, click to cycle' })
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1);

    act(() => {
      renderer.unmount();
    });
  });

  it('updates all mounted voice players and audio elements when one pill changes the rate', () => {
    const store = createStore();
    const audioA = createAudioMock();
    const audioB = createAudioMock();
    const audioMocks = [audioA, audioB];
    let audioIndex = 0;
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };

    act(() => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(React.Fragment, null, [
            React.cloneElement(renderVoiceAudioContent({ url: 'mxc://mindroom/voice-a' }), {
              key: 'voice-a',
            }),
            React.cloneElement(renderVoiceAudioContent({ url: 'mxc://mindroom/voice-b' }), {
              key: 'voice-b',
            }),
          ])
        ),
        {
          createNodeMock: (element) => {
            if (element.type !== 'audio') return null;
            const audio = audioMocks[audioIndex];
            audioIndex += 1;
            return audio;
          },
        },
      );
    });

    act(() => {
      renderer.root.findAllByProps({ 'aria-label': 'Play voice message' })[0].props.onClick();
    });
    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
        .props.onClick();
    });

    expect(audioA.playbackRate).toBe(1.5);
    expect(audioB.playbackRate).toBe(1.5);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1.5×, click to cycle' })
    ).toBeTruthy();
    expect(
      renderer.root.findAllByProps({
        'aria-label': 'Playback speed, currently 1.5×, click to cycle',
      })
    ).toHaveLength(1);

    act(() => {
      renderer.root.findAllByType('audio')[1].props.onPlay();
    });

    expect(
      renderer.root.findAllByProps({
        'aria-label': 'Playback speed, currently 1.5×, click to cycle',
      })
    ).toHaveLength(2);

    act(() => {
      renderer.unmount();
    });
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

    act(() => {
      renderer.unmount();
    });
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

    act(() => {
      renderer.unmount();
    });
  });
});
