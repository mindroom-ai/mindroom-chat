// @vitest-environment jsdom

import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  voiceMessagePlaybackRateAtom,
  voiceMessageVolumeAtom,
} from '../../preferences/voiceMessageSettings';
import { stopVoiceAudioPlayback } from './voice/voiceAudioPlayback';
import { VoiceAudioContent } from './VoiceAudioContent';

const mocks = vi.hoisted(() => ({
  downloadCachedAttachment: vi.fn(),
}));

vi.mock('folds', () => ({
  Icon: (props: Record<string, unknown>) => React.createElement('span', props),
  IconButton: React.forwardRef<
    HTMLButtonElement,
    { children?: React.ReactNode; onClick?: () => void }
  >(({ children, onClick, ...props }, ref) =>
    React.createElement('button', { ...props, onClick, ref }, children)
  ),
  Icons: {
    Download: 'download',
    Pause: 'pause',
    Play: 'play',
    VerticalDots: 'vertical-dots',
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
  Title: 'Title',
  Controls: 'Controls',
  Error: 'Error',
  Capsule: 'Capsule',
  MoreCell: 'MoreCell',
  MoreMenu: 'MoreMenu',
  MoreMenuAction: 'MoreMenuAction',
  MoreMenuMeta: 'MoreMenuMeta',
  MoreMenuMetaLabel: 'MoreMenuMetaLabel',
  MoreMenuMetaValue: 'MoreMenuMetaValue',
  PlayCell: 'PlayCell',
  PlayButton: 'PlayButton',
  RateCell: 'RateCell',
  Root: 'Root',
  Time: 'Time',
  WaveformCell: 'WaveformCell',
}));

vi.mock('./voice/VoiceVolumeButton.css', () => ({
  Menu: 'Menu',
  Thumb: 'Thumb',
  Track: 'Track',
  TrackLine: 'TrackLine',
}));

vi.mock('./voice/VoicePlaybackRateButton.css', () => ({
  Button: 'Button',
  Label: 'Label',
}));

vi.mock('./voice/VoiceWaveform.css', () => ({
  Bar: 'Bar',
  BarActive: 'BarActive',
  BarCompactUnrecorded: 'BarCompactUnrecorded',
  Svg: 'Svg',
  Waveform: 'Waveform',
  WaveformDimmed: 'WaveformDimmed',
  WaveformSeek: 'WaveformSeek',
  SeekInput: 'SeekInput',
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

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));

vi.mock('./FileHeader', () => ({
  FileDownloadButton: ({ filename, mimeType }: { filename: string; mimeType: string }) =>
    React.createElement('button', {
      'aria-label': `Download ${filename}`,
      'data-download-filename': filename,
      'data-download-mime': mimeType,
    }),
}));

type PitchAudio = HTMLAudioElement & {
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const getSharedAudio = (): PitchAudio | null =>
  document.querySelector<PitchAudio>('audio[data-voice-audio-player="true"]');

const setAudioProps = (
  audio: HTMLAudioElement,
  props: { duration?: number; readyState?: number; currentTime?: number }
) => {
  if ('duration' in props) {
    Object.defineProperty(audio, 'duration', { configurable: true, value: props.duration });
  }
  if ('readyState' in props) {
    Object.defineProperty(audio, 'readyState', { configurable: true, value: props.readyState });
  }
  if ('currentTime' in props && props.currentTime !== undefined) {
    audio.currentTime = props.currentTime;
  }
};

const renderVoiceAudioContent = (props?: Partial<React.ComponentProps<typeof VoiceAudioContent>>) =>
  React.createElement(VoiceAudioContent, {
    mimeType: 'audio/ogg',
    url: props?.url ?? 'mxc://mindroom/voice',
    info: {
      mimetype: 'audio/ogg',
      duration: 10000,
      size: 12000,
      ...props?.info,
    },
    filename: props?.filename ?? 'voice.ogg',
    waveform: props?.waveform ?? [0, 512, 1024],
    encInfo: props?.encInfo,
    label: props?.label,
    isVoiceMessage: props?.isVoiceMessage,
  });

const renderVoiceAudio = (
  store: ReturnType<typeof createStore> = createStore(),
  props?: Partial<React.ComponentProps<typeof VoiceAudioContent>>
) => React.createElement(Provider, { store }, renderVoiceAudioContent(props));

const openAudioOptions = (renderer: ReactTestRenderer, index = 0) => {
  act(() => {
    renderer.root
      .findAllByType('button')
      .filter((button) => button.props['aria-label'] === 'More audio options')
      [index]!.props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 24, height: 24 }),
        },
      });
  });
};

describe('VoiceAudioContent', () => {
  let renderer: ReactTestRenderer | undefined;
  const createMounted: typeof create = (...args) => {
    let next!: ReactTestRenderer;
    act(() => {
      next = create(...args);
    });
    return next;
  };
  let nextBlobId: number;
  let pausedState: WeakMap<HTMLMediaElement, boolean>;
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    stopVoiceAudioPlayback();
    nextBlobId = 1;
    pausedState = new WeakMap();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => {
        const url = `blob:voice-${nextBlobId}`;
        nextBlobId += 1;
        return url;
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (
      this: HTMLMediaElement
    ) {
      return pausedState.get(this) ?? true;
    });
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement
    ) {
      pausedState.set(this, false);
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    });
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement
    ) {
      const wasPlaying = !(pausedState.get(this) ?? true);
      pausedState.set(this, true);
      if (wasPlaying) this.dispatchEvent(new Event('pause'));
    });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (
      this: HTMLMediaElement
    ) {
      pausedState.set(this, true);
      Object.defineProperty(this, 'readyState', { configurable: true, value: 0 });
      Object.defineProperty(this, 'duration', { configurable: true, value: Number.NaN });
      this.currentTime = 0;
    });

    mocks.downloadCachedAttachment.mockReset();
    mocks.downloadCachedAttachment.mockImplementation(
      async (_mx: unknown, source: { mxcUri: string }) =>
        new Blob([source.mxcUri], { type: 'audio/ogg' })
    );
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
    stopVoiceAudioPlayback();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const playAndLoad = async (
    target: ReactTestRenderer,
    metadata?: { duration?: number; readyState?: number; currentTime?: number }
  ) => {
    await act(async () => {
      target.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      await flushAsync();
    });
    const audio = getSharedAudio()!;
    if (metadata) {
      setAudioProps(audio, metadata);
      act(() => {
        audio.dispatchEvent(new Event('loadedmetadata'));
      });
    }
    return audio;
  };

  it('renders play, waveform seek, timer, and speed before interaction', () => {
    renderer = createMounted(renderVoiceAudio());

    expect(renderer.root.findByProps({ className: 'Root' })).toBeTruthy();
    expect(renderer.root.findByProps({ className: 'WaveformCell' })).toBeTruthy();
    const buttons = renderer.root.findAllByType('button');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Play voice message',
      'Playback speed, currently 1×, click to cycle',
      'More audio options',
    ]);
    // Each bar twice: the base layer and the played fill above it.
    expect(renderer.root.findAllByType('rect')).toHaveLength(96);
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('0:00 / 0:10');
    expect(rendered).not.toMatch(/download|mute/i);
  });

  it('keeps volume, download, and attachment metadata in the More menu', () => {
    renderer = createMounted(renderVoiceAudio(createStore(), { filename: 'clip.ogg' }));

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'More audio options' }).props.onClick({
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
        },
      });
    });

    expect(
      renderer.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' })
    ).toBeTruthy();
    expect(renderer.root.findByProps({ 'data-download-filename': 'clip.ogg' })).toBeTruthy();
    expect(JSON.stringify(renderer.toJSON())).toContain('clip.ogg');
    expect(JSON.stringify(renderer.toJSON())).toContain('audio/ogg');
    expect(JSON.stringify(renderer.toJSON())).toContain('12.0 KB');
    expect(JSON.stringify(renderer.toJSON())).toContain('0:10');
  });

  it('opens More after play without reading a cleared event target from the state updater', async () => {
    renderer = createMounted(renderVoiceAudio(createStore(), { filename: 'clip.ogg' }));

    const moreTriggerTarget = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
    };
    let currentTarget: typeof moreTriggerTarget | null = moreTriggerTarget;
    const moreClickEvent = {
      get currentTarget() {
        return currentTarget;
      },
    };

    expect(() => {
      act(() => {
        renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
        renderer!.root
          .findByProps({ 'aria-label': 'More audio options' })
          .props.onClick(moreClickEvent);
        currentTarget = null;
      });
    }).not.toThrow();
    await act(async () => {
      await flushAsync();
    });

    expect(renderer.root.findByProps({ 'data-download-filename': 'clip.ogg' })).toBeTruthy();
  });

  it('reopens volume during deactivation without reading a cleared event target', () => {
    renderer = createMounted(renderVoiceAudio());

    openAudioOptions(renderer);

    const volumeTriggerTarget = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
    };

    act(() => {
      renderer!.root
        .findByProps({ 'aria-label': 'Voice volume, currently 100%' })
        .props.onClick({ currentTarget: volumeTriggerTarget });
    });

    const focusTrapOptions = renderer.root.findAllByProps({ 'data-focus-trap': true })[1]!.props
      .focusTrapOptions as {
      onDeactivate: () => void;
    };
    let currentTarget: typeof volumeTriggerTarget | null = volumeTriggerTarget;
    const volumeClickEvent = {
      get currentTarget() {
        return currentTarget;
      },
    };

    expect(() => {
      act(() => {
        focusTrapOptions.onDeactivate();
        renderer!.root
          .findByProps({ 'aria-label': 'Voice volume, currently 100%' })
          .props.onClick(volumeClickEvent);
        currentTarget = null;
      });
    }).not.toThrow();

    expect(renderer.root.findAllByProps({ 'data-popout': 'true' })).toHaveLength(2);
  });

  it('lets listeners set playback speed before loading audio', () => {
    const store = createStore();
    renderer = createMounted(renderVoiceAudio(store));
    act(() => {
      renderer!.root
        .findByProps({
          'aria-label': 'Playback speed, currently 1×, click to cycle',
        })
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1.5);
    expect(mocks.downloadCachedAttachment).not.toHaveBeenCalled();
  });

  it('shows an audio filename without opening the options menu', () => {
    renderer = createMounted(
      renderVoiceAudio(createStore(), {
        filename: 'Interview.mp3',
        label: 'audio',
        isVoiceMessage: false,
      })
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('Interview.mp3');
  });

  it('shows an audio filename with its direction controls as code points', () => {
    renderer = createMounted(
      renderVoiceAudio(createStore(), {
        filename: 'Interview‮3pm.exe',
        label: 'audio',
        isVoiceMessage: false,
      })
    );
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Interview<U+202E>3pm.exe');
    expect(renderer.root.findAllByProps({ title: 'Interview<U+202E>3pm.exe' })).not.toHaveLength(0);
    expect(text).not.toMatch(/‮/);
  });

  it('explains source loading failures and allows another play attempt', async () => {
    mocks.downloadCachedAttachment.mockRejectedValueOnce(new Error('network error'));
    renderer = createMounted(renderVoiceAudio());

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      await flushAsync();
    });

    expect(
      renderer.root
        .findAllByType('span')
        .find((node) => node.props.role === 'status')
        ?.children.join('')
    ).toContain('Unable to load audio');

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      await flushAsync();
    });

    expect(mocks.downloadCachedAttachment).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByProps({ 'aria-label': 'Pause voice message' })).toBeTruthy();
  });

  it('lazily loads media on first play, autoplays once loaded, and toggles pause/play', async () => {
    renderer = createMounted(renderVoiceAudio());

    const audio = await playAndLoad(renderer);
    expect(mocks.downloadCachedAttachment).toHaveBeenCalledOnce();
    expect(playSpy).toHaveBeenCalledOnce();
    expect(audio.paused).toBe(false);
    expect(renderer.root.findByProps({ 'aria-label': 'Pause voice message' })).toBeTruthy();
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'Pause voice message' }).props.onClick();
    });
    expect(pauseSpy).toHaveBeenCalled();
    expect(audio.paused).toBe(true);
    expect(renderer.root.findByProps({ 'aria-label': 'Play voice message' })).toBeTruthy();
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(mocks.downloadCachedAttachment).toHaveBeenCalledOnce();
  });

  it('seeks through waveform click progress once metadata is ready', async () => {
    renderer = createMounted(renderVoiceAudio());
    const audio = await playAndLoad(renderer, { duration: 10, readyState: 1 });

    act(() => {
      renderer!.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '25' } });
    });

    expect(audio.currentTime).toBe(2.5);
    expect(
      renderer.root.findByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })
    ).toBeTruthy();
  });

  it('keeps the latest pending seek until metadata is ready before first playback', async () => {
    renderer = createMounted(renderVoiceAudio());

    await act(async () => {
      renderer!.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '50' } });
      await flushAsync();
    });

    expect(mocks.downloadCachedAttachment).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain('0:05 / 0:10');
    const audio = getSharedAudio()!;
    setAudioProps(audio, { readyState: 0, duration: 10 });
    expect(audio.currentTime).toBe(0);

    act(() => {
      renderer!.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '75' } });
    });
    expect(audio.currentTime).toBe(0);

    setAudioProps(audio, { readyState: 1, duration: 10 });
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(audio.currentTime).toBe(7.5);
    expect(playSpy).not.toHaveBeenCalled();

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it('clears current time and pending seek when the media identity changes in-place', async () => {
    const store = createStore();
    renderer = createMounted(renderVoiceAudio(store, { url: 'mxc://mindroom/voice-a' }));

    await act(async () => {
      renderer!.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '50' } });
      await flushAsync();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:05 / 0:10');

    await act(async () => {
      renderer!.update(
        renderVoiceAudio(store, {
          url: 'mxc://mindroom/voice-b',
          info: { mimetype: 'audio/ogg', duration: 4000 },
        })
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:04');
    expect(renderer.root.findByProps({ title: '0:00 / 0:04' }).props.children).toBe('0:04');

    const audio = await playAndLoad(renderer, { duration: 4, readyState: 1 });
    expect(audio.currentTime).toBe(0);
  });

  it('applies playback rate, pitch preservation, and volume changes (including mute at 0)', async () => {
    const store = createStore();
    renderer = createMounted(renderVoiceAudio(store));
    const audio = await playAndLoad(renderer, { duration: 10, readyState: 1 });

    act(() => {
      store.set(voiceMessagePlaybackRateAtom, 2);
      store.set(voiceMessageVolumeAtom, 0);
    });
    expect(audio.playbackRate).toBe(2);
    expect(audio.preservesPitch).toBe(true);
    expect(audio.webkitPreservesPitch).toBe(true);
    expect(audio.mozPreservesPitch).toBe(true);
    expect(audio.volume).toBe(0);
    expect(audio.muted).toBe(true);

    act(() => {
      store.set(voiceMessageVolumeAtom, 0.4);
    });
    expect(audio.volume).toBe(0.4);
    expect(audio.muted).toBe(false);

    // Reapplied on play and loadedmetadata even if the browser resets properties.
    audio.playbackRate = 1;
    audio.volume = 1;
    audio.currentTime = 3;
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(audio.playbackRate).toBe(2);
    expect(audio.volume).toBe(0.4);
    expect(JSON.stringify(renderer.toJSON())).toContain('0:03 / 0:10');

    audio.playbackRate = 1;
    audio.volume = 1;
    act(() => {
      audio.dispatchEvent(new Event('play'));
    });
    expect(audio.playbackRate).toBe(2);
    expect(audio.volume).toBe(0.4);
  });

  it('updates all mounted voice players and the shared audio element when rate or volume changes', async () => {
    const store = createStore();
    renderer = createMounted(
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
      )
    );

    await act(async () => {
      renderer!.root.findAllByProps({ 'aria-label': 'Play voice message' })[0]!.props.onClick();
      await flushAsync();
    });
    const audio = getSharedAudio()!;

    // Cycle rate from the second player while the first is playing.
    act(() => {
      renderer!.root
        .findAllByProps({ 'aria-label': 'Playback speed, currently 1×, click to cycle' })[1]!
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1.5);
    expect(audio.playbackRate).toBe(1.5);
    expect(
      renderer.root.findAllByProps({
        'aria-label': 'Playback speed, currently 1.5×, click to cycle',
      })
    ).toHaveLength(2);

    act(() => {
      renderer!.root
        .findAllByProps({ 'aria-label': 'Playback speed, currently 1.5×, click to cycle' })[0]!
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(2);
    act(() => {
      renderer!.root
        .findAllByProps({ 'aria-label': 'Playback speed, currently 2×, click to cycle' })[0]!
        .props.onClick();
    });
    expect(store.get(voiceMessagePlaybackRateAtom)).toBe(1);

    // Update volume from the first player and verify both menus and the shared audio update.
    openAudioOptions(renderer, 0);
    openAudioOptions(renderer, 1);
    act(() => {
      renderer!.root
        .findAllByProps({ 'aria-label': 'Voice volume, currently 100%' })[0]!
        .props.onClick({
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }),
          },
        });
    });
    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'Voice volume slider' }).props.onChange({
        currentTarget: { value: '0.25' },
      });
    });

    expect(store.get(voiceMessageVolumeAtom)).toBe(0.25);
    expect(audio.volume).toBe(0.25);
    expect(
      renderer.root.findAllByProps({ 'aria-label': 'Voice volume, currently 25%' })
    ).toHaveLength(2);
  });

  it('closes the volume popover when the trigger is clicked again', () => {
    const volumeTriggerNode = document.createElement('button');
    volumeTriggerNode.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 44, height: 44 }) as DOMRect;

    renderer = createMounted(renderVoiceAudio(), {
      createNodeMock: (element: React.ReactElement<Record<string, unknown>>) => {
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

    openAudioOptions(renderer);

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' }).props.onClick({
        currentTarget: volumeTriggerNode,
      });
    });

    expect(renderer.root.findAllByProps({ 'data-popout': 'true' })).toHaveLength(2);
    const focusTrapOptions = renderer.root.findAllByProps({ 'data-focus-trap': true })[1]!.props
      .focusTrapOptions as {
      clickOutsideDeactivates: (event: Pick<MouseEvent, 'target'>) => boolean;
      allowOutsideClick: (event: Pick<MouseEvent, 'target'>) => boolean;
    };
    expect(focusTrapOptions.clickOutsideDeactivates({ target: volumeTriggerNode })).toBe(false);
    expect(focusTrapOptions.allowOutsideClick({ target: volumeTriggerNode })).toBe(true);

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' }).props.onClick({
        currentTarget: volumeTriggerNode,
      });
    });

    expect(renderer.root.findAllByProps({ 'data-popout': 'true' })).toHaveLength(1);
  });

  it('centers the volume slider thumb on the track centerline', () => {
    renderer = createMounted(renderVoiceAudio());

    openAudioOptions(renderer);

    act(() => {
      renderer!.root.findByProps({ 'aria-label': 'Voice volume, currently 100%' }).props.onClick({
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
  });

  it('preserves Matrix duration when browser duration is invalid', async () => {
    renderer = createMounted(renderVoiceAudio());
    const audio = await playAndLoad(renderer, { duration: Number.NaN, readyState: 1 });

    setAudioProps(audio, { duration: Number.POSITIVE_INFINITY, currentTime: 0 });
    act(() => {
      audio.dispatchEvent(new Event('durationchange'));
    });

    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:10');

    act(() => {
      renderer!.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '50' } });
    });

    expect(audio.currentTime).toBe(5);
  });

  it('falls back to browser duration when Matrix duration is missing and prefers browser duration when both exist', async () => {
    const store = createStore();
    renderer = createMounted(
      renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: undefined } })
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:00');

    const audio = await playAndLoad(renderer, { duration: 8.52, readyState: 1, currentTime: 2 });
    expect(JSON.stringify(renderer.toJSON())).toContain('0:02 / 0:08');

    // Matrix duration arriving later must not override the browser-measured duration.
    act(() => {
      renderer!.update(
        renderVoiceAudio(store, { info: { mimetype: 'audio/ogg', duration: 7000 } })
      );
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('0:02 / 0:08');

    act(() => {
      renderer!.root
        .findByProps({ 'aria-label': 'Seek voice message' })
        .props.onChange({ currentTarget: { value: '100' } });
    });
    expect(audio.currentTime).toBe(8.52);
  });

  it('syncs Matrix duration when metadata arrives after initial render and clears it on media change', async () => {
    const store = createStore();
    renderer = createMounted(
      renderVoiceAudio(store, {
        url: 'mxc://mindroom/voice-a',
        info: { mimetype: 'audio/ogg', duration: undefined },
      })
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:00');

    act(() => {
      renderer!.update(
        renderVoiceAudio(store, {
          url: 'mxc://mindroom/voice-a',
          info: { mimetype: 'audio/ogg', duration: 7000 },
        })
      );
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:07');

    await act(async () => {
      renderer!.update(
        renderVoiceAudio(store, {
          url: 'mxc://mindroom/voice-b',
          info: { mimetype: 'audio/ogg', duration: undefined },
        })
      );
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('0:00 / 0:00');
  });

  it('renders fallback waveform bars for missing metadata', () => {
    renderer = createMounted(
      React.createElement(
        Provider,
        { store: createStore() },
        React.createElement(VoiceAudioContent, {
          mimeType: 'audio/ogg',
          url: 'mxc://mindroom/voice',
          info: {
            mimetype: 'audio/ogg',
            duration: 5000,
          },
        })
      )
    );

    // Each bar twice: the base layer and the played fill above it.
    expect(renderer.root.findAllByType('rect')).toHaveLength(96);
  });
});
