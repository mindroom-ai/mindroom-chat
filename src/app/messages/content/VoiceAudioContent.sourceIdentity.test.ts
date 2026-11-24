// @vitest-environment jsdom

import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopVoiceAudioPlayback } from './voice/voiceAudioPlayback';
import { VoiceAudioContent } from './VoiceAudioContent';

const mocks = vi.hoisted(() => ({
  downloadedMediaUrls: [] as string[],
  downloadMedia: vi.fn(async (mediaUrl: string) => {
    mocks.downloadedMediaUrls.push(mediaUrl);
    return new Blob([mediaUrl], { type: 'audio/ogg' });
  }),
}));

vi.mock('folds', () => ({
  Icon: (props: Record<string, unknown>) => React.createElement('span', props),
  IconButton: ({
    children,
    onClick,
    ref,
    ...props
  }: { children?: React.ReactNode; onClick?: () => void } & {
    ref?: React.Ref<HTMLButtonElement>;
  }) => React.createElement('button', { ...props, onClick, ref }, children),
  Icons: {
    Pause: 'pause',
    Play: 'play',
    VerticalDots: 'vertical-dots',
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

vi.mock('./voice/VoicePlaybackRateButton', () => ({
  VoicePlaybackRateButton: () => React.createElement('button', { 'aria-label': 'Playback speed' }),
}));

vi.mock('./voice/VoiceVolumeButton', () => ({
  VoiceVolumeButton: () => React.createElement('button', { 'aria-label': 'Voice volume' }),
}));

vi.mock('./voice/VoiceWaveform', () => ({
  VoiceWaveform: ({
    label,
    onSeekProgress,
  }: {
    label: string;
    onSeekProgress: (progress: number) => void;
  }) =>
    React.createElement('button', {
      'aria-label': label,
      onClick: () => onSeekProgress(0.25),
    }),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('./FileHeader', () => ({
  FileDownloadButton: () => React.createElement('button', { 'aria-label': 'Download audio' }),
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: (_mx: unknown, source: { mxcUri: string }) =>
    mocks.downloadMedia(`https://media.example/${source.mxcUri}`),
}));

const renderVoiceAudioContent = (
  url: string,
  store: ReturnType<typeof createStore> = createStore()
) =>
  React.createElement(
    Provider,
    { store },
    React.createElement(VoiceAudioContent, {
      mimeType: 'audio/ogg',
      url,
      info: {
        mimetype: 'audio/ogg',
        duration: 10000,
      },
      waveform: [0, 512, 1024],
    })
  );

const flushAsyncSource = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const getSharedAudio = (): HTMLAudioElement | null =>
  document.querySelector<HTMLAudioElement>('audio[data-voice-audio-player="true"]');

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

describe('VoiceAudioContent media identity', () => {
  let renderer: ReactTestRenderer | undefined;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let pausedState: WeakMap<HTMLMediaElement, boolean>;
  let playSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    stopVoiceAudioPlayback();
    pausedState = new WeakMap();
    mocks.downloadedMediaUrls = [];
    mocks.downloadMedia.mockReset();
    mocks.downloadMedia.mockImplementation(async (mediaUrl: string) => {
      mocks.downloadedMediaUrls.push(mediaUrl);
      return new Blob([mediaUrl], { type: 'audio/ogg' });
    });
    createObjectURL = vi.fn(() => `blob:${mocks.downloadedMediaUrls.at(-1)}`);
    revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

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
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
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

  it('stops and loads the new voice blob after a mounted player changes media identity in-place', async () => {
    const store = createStore();
    await act(async () => {
      renderer = create(renderVoiceAudioContent('mxc://mindroom/voice-a', store));
    });

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      await flushAsyncSource();
    });

    expect(mocks.downloadedMediaUrls).toEqual(['https://media.example/mxc://mindroom/voice-a']);
    expect(getSharedAudio()?.getAttribute('src')).toBe(
      'blob:https://media.example/mxc://mindroom/voice-a'
    );

    await act(async () => {
      renderer!.update(renderVoiceAudioContent('mxc://mindroom/voice-b', store));
      await flushAsyncSource();
    });

    expect(revokeObjectURL).toHaveBeenCalledWith(
      'blob:https://media.example/mxc://mindroom/voice-a'
    );
    expect(getSharedAudio()?.getAttribute('src')).toBeNull();

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      await flushAsyncSource();
    });

    expect(mocks.downloadedMediaUrls).toEqual([
      'https://media.example/mxc://mindroom/voice-a',
      'https://media.example/mxc://mindroom/voice-b',
    ]);
    expect(getSharedAudio()?.getAttribute('src')).toBe(
      'blob:https://media.example/mxc://mindroom/voice-b'
    );
  });

  it('loads the new voice blob for a first seek after media identity changes in-place', async () => {
    const store = createStore();
    await act(async () => {
      renderer = create(renderVoiceAudioContent('mxc://mindroom/voice-a', store));
    });

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      await flushAsyncSource();
    });

    await act(async () => {
      renderer!.update(renderVoiceAudioContent('mxc://mindroom/voice-b', store));
      await flushAsyncSource();
    });

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Seek voice message' }).props.onClick();
      await flushAsyncSource();
    });

    expect(mocks.downloadedMediaUrls).toEqual([
      'https://media.example/mxc://mindroom/voice-a',
      'https://media.example/mxc://mindroom/voice-b',
    ]);
    expect(getSharedAudio()?.getAttribute('src')).toBe(
      'blob:https://media.example/mxc://mindroom/voice-b'
    );
  });

  it('keeps the new media play and seek intent when a stale source load rejects', async () => {
    const store = createStore();
    const voiceA = createDeferred<Blob>();
    const voiceB = createDeferred<Blob>();
    mocks.downloadMedia.mockImplementation((mediaUrl: string) => {
      mocks.downloadedMediaUrls.push(mediaUrl);
      if (mediaUrl.includes('voice-a')) return voiceA.promise;
      if (mediaUrl.includes('voice-b')) return voiceB.promise;
      return Promise.resolve(new Blob([mediaUrl], { type: 'audio/ogg' }));
    });

    await act(async () => {
      renderer = create(renderVoiceAudioContent('mxc://mindroom/voice-a', store));
    });

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
    });

    await act(async () => {
      renderer!.update(renderVoiceAudioContent('mxc://mindroom/voice-b', store));
    });

    expect(playSpy).not.toHaveBeenCalled();

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Play voice message' }).props.onClick();
      renderer!.root.findByProps({ 'aria-label': 'Seek voice message' }).props.onClick();
    });

    await act(async () => {
      voiceA.reject(new Error('stale voice source replaced'));
      await flushAsyncSource();
    });

    await act(async () => {
      voiceB.resolve(new Blob(['voice-b'], { type: 'audio/ogg' }));
      await flushAsyncSource();
    });

    const audio = getSharedAudio()!;
    expect(playSpy).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
    Object.defineProperty(audio, 'readyState', { configurable: true, value: 1 });
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(audio.currentTime).toBe(2.5);
    expect(audio.getAttribute('src')).toBe('blob:https://media.example/mxc://mindroom/voice-b');
  });

  it('does not disturb an active track when an unrelated idle player changes media identity', async () => {
    const store = createStore();
    const renderPair = (secondUrl: string) =>
      React.createElement(
        Provider,
        { store },
        React.createElement(
          React.Fragment,
          null,
          React.createElement(VoiceAudioContent, {
            key: 'first',
            mimeType: 'audio/ogg',
            url: 'mxc://mindroom/voice-active',
            info: { mimetype: 'audio/ogg', duration: 10000 },
            waveform: [0, 512, 1024],
          }),
          React.createElement(VoiceAudioContent, {
            key: 'second',
            mimeType: 'audio/ogg',
            url: secondUrl,
            info: { mimetype: 'audio/ogg', duration: 10000 },
            waveform: [0, 512, 1024],
          })
        )
      );

    await act(async () => {
      renderer = create(renderPair('mxc://mindroom/voice-idle-1'));
    });

    await act(async () => {
      renderer!.root.findAllByProps({ 'aria-label': 'Play voice message' })[0]!.props.onClick();
      await flushAsyncSource();
    });

    const audio = getSharedAudio()!;
    expect(audio.paused).toBe(false);
    expect(audio.getAttribute('src')).toBe(
      'blob:https://media.example/mxc://mindroom/voice-active'
    );

    await act(async () => {
      renderer!.update(renderPair('mxc://mindroom/voice-idle-2'));
    });

    expect(audio.paused).toBe(false);
    expect(audio.getAttribute('src')).toBe(
      'blob:https://media.example/mxc://mindroom/voice-active'
    );
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
