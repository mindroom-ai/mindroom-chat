import React from 'react';
import { Provider, createStore, type Store } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import {
  voiceMessagePlaybackRateAtom,
  voiceMessageVolumeAtom,
} from '../../../state/voiceMessageSettings';
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
    VolumeHigh: 'volume-high',
    VolumeMute: 'volume-mute',
  },
  Menu: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('div', props, children),
  PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
    anchor ? React.createElement('div', { 'data-popout': 'true' }, content) : null,
  Spinner: (props: Record<string, unknown>) => React.createElement('span', props),
  Text: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('span', props, children),
}));

vi.mock('./VoiceAudioContent.css', () => ({
  Audio: 'Audio',
  Capsule: 'Capsule',
  Controls: 'Controls',
  Time: 'Time',
  WaveformSlot: 'WaveformSlot',
}));

vi.mock('../../voice/VoiceVolumeButton.css', () => ({
  Button: 'Button',
  Menu: 'Menu',
  Thumb: 'Thumb',
  Track: 'Track',
  TrackLine: 'TrackLine',
}));

vi.mock('../../voice/VoicePlaybackRateButton.css', () => ({
  Button: 'Button',
  Label: 'Label',
  Placeholder: 'Placeholder',
}));

vi.mock('../../voice/VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
  BarCompactUnrecorded: 'BarCompactUnrecorded',
  Svg: 'Svg',
  Waveform: 'Waveform',
  WaveformDimmed: 'WaveformDimmed',
  WaveformSeek: 'WaveformSeek',
}));

vi.mock('focus-trap-react', () => ({
  default: ({
    children,
    focusTrapOptions,
  }: {
    children?: React.ReactNode;
    focusTrapOptions?: Record<string, unknown>;
  }) => React.createElement('div', { 'data-focus-trap': true, focusTrapOptions }, children),
}));

vi.mock('react-range', () => ({
  Range: ({
    values,
    onChange,
    renderTrack,
    renderThumb,
  }: {
    values: number[];
    onChange: (values: number[]) => void;
    renderTrack: (params: {
      props: Record<string, unknown>;
      children: React.ReactNode;
    }) => React.ReactNode;
    renderThumb: (params: { props: Record<string, unknown> }) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-range': 'true' },
      renderTrack({
        props: {},
        children: renderThumb({
          props: {
            style: {
              position: 'absolute',
              transform: 'translate(118px, 8px)',
            },
          },
        }),
      }),
      React.createElement('input', {
        'aria-label': 'Voice volume slider',
        type: 'range',
        value: values[0],
        onChange: (event: { currentTarget: { value: string } }) =>
          onChange([Number(event.currentTarget.value)]),
      })
    ),
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
    duration: 10,
    muted: false,
    playbackRate: 1,
    preservesPitch: false,
    volume: 1,
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
) => React.createElement(Provider, { store }, renderVoiceAudioContent(props));

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

  it('renders play, waveform seek, timer, and volume controls before interaction', () => {
    renderer = create(renderVoiceAudio());

    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Play voice message',
      'Seek voice message',
      'Voice volume, currently 100%',
    ]);
    expect(renderer.root.findAllByType('rect')).toHaveLength(48);
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('0:00 / 0:10');
    expect(rendered).not.toMatch(/download|mute|speed/i);

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
    expect(JSON.stringify(renderer.toJSON())).toContain('0:05 / 0:10');

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

  it('clears current time and pending seek when the media identity changes', async () => {
    const store = createStore();
    renderer = create(renderVoiceAudio(store, { url: 'mxc://mindroom/voice-a' }));

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Seek voice message' }).props.onClick({
        clientX: 50,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
      });
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:05 / 0:10');

    await act(async () => {
      renderer.update(
        renderVoiceAudio(store, {
          url: 'mxc://mindroom/voice-b',
          info: { mimetype: 'audio/ogg', duration: 4000 },
        })
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:04');

    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice-b',
    };
    await act(async () => {
      renderer.update(
        renderVoiceAudio(store, {
          url: 'mxc://mindroom/voice-b',
          info: { mimetype: 'audio/ogg', duration: 4000 },
        })
      );
    });

    expect(mocks.seek).not.toHaveBeenCalled();

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

  it('applies volume changes to the audio element and unmutes non-zero volume', () => {
    const store = createStore();
    const audio = createAudioMock();
    audio.muted = true;
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
      store.set(voiceMessageVolumeAtom, 0.4);
    });

    expect(audio.volume).toBe(0.4);
    expect(audio.muted).toBe(false);

    act(() => {
      renderer.unmount();
    });
  });

  it('mutes the audio element when volume is set to zero', () => {
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
      store.set(voiceMessageVolumeAtom, 0);
    });

    expect(audio.volume).toBe(0);
    expect(audio.muted).toBe(true);

    act(() => {
      renderer.unmount();
    });
  });

  it('updates all mounted voice players and audio elements when one volume slider changes', () => {
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
        }
      );
    });

    act(() => {
      renderer.root
        .findAllByProps({ 'aria-label': 'Voice volume, currently 100%' })[0]
        .props.onClick({
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
          },
        });
    });
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Voice volume slider' }).props.onChange({
        currentTarget: { value: '0.25' },
      });
    });

    expect(store.get(voiceMessageVolumeAtom)).toBe(0.25);
    expect(audioA.volume).toBe(0.25);
    expect(audioB.volume).toBe(0.25);
    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Voice volume, currently 25%' })
    ).toHaveLength(2);

    act(() => {
      renderer.unmount();
    });
  });

  it('closes the volume popover when the trigger is clicked again', () => {
    class TestNode {
      contains(target: unknown) {
        return target === this;
      }

      getBoundingClientRect() {
        return { left: 0, top: 0, width: 44, height: 44 } as DOMRect;
      }
    }
    vi.stubGlobal('Node', TestNode);
    const volumeTriggerNode = new TestNode() as unknown as HTMLButtonElement;

    renderer = create(renderVoiceAudio(), {
      createNodeMock: (element) => {
        if (
          element.type === 'button' &&
          typeof element.props['aria-label'] === 'string' &&
          element.props['aria-label'].startsWith('Voice volume')
        ) {
          return volumeTriggerNode;
        }
        return null;
      },
    });

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' }).props.onClick({
        currentTarget: volumeTriggerNode,
      });
    });

    expect(renderer.root.findAllByProps({ 'data-popout': 'true' })).toHaveLength(1);
    const focusTrapOptions = renderer.root.findByProps({ 'data-focus-trap': true }).props
      .focusTrapOptions as {
      clickOutsideDeactivates: (event: Pick<MouseEvent, 'target'>) => boolean;
      allowOutsideClick: (event: Pick<MouseEvent, 'target'>) => boolean;
    };
    expect(focusTrapOptions.clickOutsideDeactivates({ target: volumeTriggerNode })).toBe(false);
    expect(focusTrapOptions.allowOutsideClick({ target: volumeTriggerNode })).toBe(true);

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' }).props.onClick({
        currentTarget: volumeTriggerNode,
      });
    });

    expect(renderer.root.findAllByProps({ 'data-popout': 'true' })).toHaveLength(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('centers the volume slider thumb on the track centerline', () => {
    renderer = create(renderVoiceAudio());

    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' }).props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
        },
      });
    });

    const thumb = renderer.root.findByProps({ 'aria-label': 'Voice volume' });
    const thumbStyle = thumb.props.style as React.CSSProperties;
    expect(thumbStyle.marginTop).toBe(-16);
    expect(thumbStyle.transform).toBe('translate(118px, 8px)');

    const trackNode = {
      getBoundingClientRect: () => ({ top: 615, bottom: 621 }),
    };
    const thumbNode = {
      getBoundingClientRect: () => {
        const uncenteredThumbTop = 626;
        const thumbHeight = 16;
        const marginTop =
          typeof thumbStyle.marginTop === 'number'
            ? thumbStyle.marginTop
            : Number.parseFloat(String(thumbStyle.marginTop ?? 0));
        const top = uncenteredThumbTop + marginTop;

        return { top, bottom: top + thumbHeight };
      },
    };
    const getYCenter = (node: { getBoundingClientRect: () => { top: number; bottom: number } }) => {
      const rect = node.getBoundingClientRect();
      return rect.top + (rect.bottom - rect.top) / 2;
    };

    expect(Math.abs(getYCenter(thumbNode) - getYCenter(trackNode))).toBeLessThanOrEqual(1);

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

  it('applies playback rate and volume in the onPlay handler', () => {
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
      store.set(voiceMessageVolumeAtom, 0);
    });
    audio.playbackRate = 1;
    audio.volume = 1;
    act(() => {
      renderer.root.findByType('audio').props.onPlay();
    });

    expect(audio.playbackRate).toBe(2);
    expect(audio.volume).toBe(0);
    expect(audio.muted).toBe(true);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 2×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer.unmount();
    });
  });

  it('applies playback rate, volume, and play time on loadedmetadata before pending seek handling', () => {
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
      store.set(voiceMessageVolumeAtom, 0.5);
    });
    audio.playbackRate = 1;
    audio.volume = 1;
    audio.currentTime = 3;
    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });

    expect(audio.playbackRate).toBe(1.5);
    expect(audio.volume).toBe(0.5);
    expect(audio.preservesPitch).toBe(true);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(audio.mozPreservesPitch).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('0:03 / 0:10');

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
        }
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

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:10');

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

  it('falls back to browser duration when Matrix duration is missing', () => {
    const audio = createAudioMock();
    audio.duration = 8;
    audio.currentTime = 2;
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(
      renderVoiceAudio(createStore(), { info: { mimetype: 'audio/ogg', duration: undefined } }),
      {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      }
    );

    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:02 / 0:08');

    act(() => {
      renderer.unmount();
    });
  });

  it('syncs Matrix duration when metadata arrives after the initial render', () => {
    const store = createStore();
    renderer = create(
      renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: undefined } })
    );

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:00');

    act(() => {
      renderer.update(renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: 7000 } }));
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:07');

    act(() => {
      renderer.unmount();
    });
  });

  it('keeps browser duration when Matrix duration arrives after loaded metadata', () => {
    const store = createStore();
    const audio = createAudioMock();
    audio.duration = 8.52;
    audio.currentTime = 0;
    mocks.srcState = {
      status: AsyncStatus.Success,
      data: 'blob:voice',
    };
    renderer = create(
      renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: undefined } }),
      {
        createNodeMock: (element) => (element.type === 'audio' ? audio : null),
      }
    );

    act(() => {
      renderer.root.findByType('audio').props.onLoadedMetadata();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:08');

    act(() => {
      renderer.update(renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: 7000 } }));
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:08');
    act(() => {
      renderer.root.findByProps({ 'aria-label': 'Seek voice message' }).props.onClick({
        clientX: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
      });
    });

    expect(mocks.seek).toHaveBeenCalledWith(8.52);

    act(() => {
      renderer.unmount();
    });
  });

  it('clears the previous duration when media changes to an item without Matrix duration', async () => {
    const store = createStore();
    renderer = create(renderVoiceAudio(store, { url: 'mxc://mindroom/voice-a' }));

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:10');

    await act(async () => {
      renderer.update(
        renderVoiceAudio(store, {
          url: 'mxc://mindroom/voice-b',
          info: { mimetype: 'audio/ogg', duration: undefined },
        })
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:00');

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
