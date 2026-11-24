// @vitest-environment jsdom

import React, { act } from 'react';
import { Provider, createStore } from 'jotai';
import { createRoot, Root } from 'react-dom/client';
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
  Icon: ({ filled: _filled, ...props }: Record<string, unknown>) =>
    React.createElement('span', props),
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
  Text: ({
    children,
    truncate: _truncate,
    ...props
  }: {
    children?: React.ReactNode;
    truncate?: boolean;
  }) => React.createElement('span', props, children),
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
  VoiceWaveform: ({ disabled }: { disabled?: boolean }) =>
    React.createElement('button', { 'aria-label': 'Seek voice message', disabled }),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({}),
}));

vi.mock('../../event-store/cache/attachmentRepository', () => ({
  downloadCachedAttachment: mocks.downloadCachedAttachment,
}));

vi.mock('./FileHeader', () => ({
  FileDownloadButton: () => React.createElement('button', { 'aria-label': 'Download audio' }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const getSharedAudio = (): HTMLAudioElement | null =>
  document.querySelector<HTMLAudioElement>('audio[data-voice-audio-player="true"]');

const renderPlayer = (url: string, store: ReturnType<typeof createStore> = createStore()) =>
  React.createElement(
    Provider,
    { store },
    React.createElement(VoiceAudioContent, {
      key: url,
      mimeType: 'audio/ogg',
      url,
      info: {
        mimetype: 'audio/ogg',
        duration: 10000,
      },
      waveform: [0, 512, 1024],
    })
  );

describe('VoiceAudioContent shared media element', () => {
  let container: HTMLDivElement;
  let root: Root;
  let nextBlobId: number;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let pausedState: WeakMap<HTMLMediaElement, boolean>;

  beforeEach(() => {
    localStorage.clear();
    stopVoiceAudioPlayback();
    nextBlobId = 1;
    pausedState = new WeakMap();
    createObjectURL = vi.fn(() => {
      const url = `blob:voice-${nextBlobId}`;
      nextBlobId += 1;
      return url;
    });
    revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (
      this: HTMLMediaElement
    ) {
      return pausedState.get(this) ?? true;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
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

    mocks.downloadCachedAttachment.mockReset();
    mocks.downloadCachedAttachment.mockImplementation(
      async (_mx: unknown, source: { mxcUri: string }) =>
        new Blob([source.mxcUri], { type: 'audio/ogg' })
    );

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    stopVoiceAudioPlayback();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows playback failures on active audio error and disables play/seek without disabling More', async () => {
    await act(async () => {
      root.render(renderPlayer('mxc://mindroom/voice-a'));
    });

    // No inline <audio> exists inside the row before interaction.
    expect(container.querySelector('audio')).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Play voice message"]')!.click();
      await flushAsync();
    });

    const audio = getSharedAudio()!;
    expect(audio).not.toBeNull();
    expect(audio.hidden).toBe(true);
    expect(audio.getAttribute('src')).toBe('blob:voice-1');

    act(() => {
      audio.dispatchEvent(new Event('error'));
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'This audio cannot be played here'
    );
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Play voice message"]')?.disabled
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Seek voice message"]')?.disabled
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="More audio options"]')?.disabled
    ).toBe(false);
  });

  it('keeps audio playing across unmount and remount (virtualized scroll) and reflects live time and settings', async () => {
    const store = createStore();
    await act(async () => {
      root.render(renderPlayer('mxc://mindroom/voice-a', store));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Play voice message"]')!.click();
      await flushAsync();
    });

    const audio = getSharedAudio()!;
    expect(audio.paused).toBe(false);
    expect(
      container.querySelector('[data-audio-capsule="true"]')?.getAttribute('data-playing')
    ).toBe('true');
    expect(container.querySelector('[aria-label="Pause voice message"]')).not.toBeNull();

    // Unmount Voice A completely (simulating scrolling far away in a virtualized timeline).
    await act(async () => {
      root.render(React.createElement(Provider, { store }, null));
    });
    expect(container.querySelector('[data-audio-capsule="true"]')).toBeNull();
    expect(audio.isConnected).toBe(true);
    expect(audio.paused).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    // Mount a different voice row while Voice A stays unmounted.
    await act(async () => {
      root.render(renderPlayer('mxc://mindroom/voice-b', store));
    });

    // Voice A must keep playing untouched and its blob URL must not be revoked.
    expect(audio.isConnected).toBe(true);
    expect(audio.paused).toBe(false);
    expect(audio.getAttribute('src')).toBe('blob:voice-1');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    // Playback advances while Voice A is unmounted, and rate/volume changes apply immediately.
    Object.defineProperty(audio, 'duration', { configurable: true, value: 12 });
    audio.currentTime = 5;
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'));
      store.set(voiceMessagePlaybackRateAtom, 1.5);
      store.set(voiceMessageVolumeAtom, 0.4);
    });
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.volume).toBe(0.4);

    // Remount Voice A (user scrolls back): immediately restores Pause button, playing state, and live time.
    await act(async () => {
      root.render(renderPlayer('mxc://mindroom/voice-a', store));
    });

    expect(
      container.querySelector('[data-audio-capsule="true"]')?.getAttribute('data-playing')
    ).toBe('true');
    expect(container.querySelector('[aria-label="Pause voice message"]')).not.toBeNull();
    expect(container.querySelector('[title="0:05 / 0:12"]')?.textContent).toBe('0:05');

    // Clicking Pause pauses the shared audio element.
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Pause voice message"]')!.click();
    });
    expect(audio.paused).toBe(true);
    expect(container.querySelector('[aria-label="Play voice message"]')).not.toBeNull();
  });

  it('switches between two mounted players cleanly without re-rendering idle siblings on timeupdate', async () => {
    const store = createStore();
    let idleRenders = 0;

    function TrackedIdlePlayer() {
      idleRenders += 1;
      return React.createElement(VoiceAudioContent, {
        mimeType: 'audio/ogg',
        url: 'mxc://mindroom/voice-idle',
        info: { mimetype: 'audio/ogg', duration: 10000 },
        waveform: [0, 512, 1024],
      });
    }

    await act(async () => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(
            'div',
            null,
            React.createElement(VoiceAudioContent, {
              mimeType: 'audio/ogg',
              url: 'mxc://mindroom/voice-a',
              info: { mimetype: 'audio/ogg', duration: 10000 },
              waveform: [0, 512, 1024],
            }),
            React.createElement(VoiceAudioContent, {
              mimeType: 'audio/ogg',
              url: 'mxc://mindroom/voice-b',
              info: { mimetype: 'audio/ogg', duration: 10000 },
              waveform: [0, 512, 1024],
            }),
            React.createElement(TrackedIdlePlayer)
          )
        )
      );
    });

    const playButtons = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('[aria-label$="voice message"]')
      ).filter((button) => button.getAttribute('aria-label') !== 'Seek voice message');

    await act(async () => {
      playButtons()[0]!.click();
      await flushAsync();
    });

    expect(playButtons()[0]!.getAttribute('aria-label')).toBe('Pause voice message');
    expect(playButtons()[1]!.getAttribute('aria-label')).toBe('Play voice message');

    const idleRendersBeforeTimeUpdate = idleRenders;
    const audio = getSharedAudio()!;
    audio.currentTime = 3;
    act(() => {
      audio.dispatchEvent(new Event('timeupdate'));
    });
    expect(idleRenders).toBe(idleRendersBeforeTimeUpdate);

    // Starting Player B pauses/detaches Player A, revokes its blob URL, and resets Player A UI.
    await act(async () => {
      playButtons()[1]!.click();
      await flushAsync();
    });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-1');
    expect(audio.getAttribute('src')).toBe('blob:voice-2');
    expect(playButtons()[0]!.getAttribute('aria-label')).toBe('Play voice message');
    expect(playButtons()[1]!.getAttribute('aria-label')).toBe('Pause voice message');

    // Account cleanup stops playback, clears src, revokes blob URL, and resets UI.
    act(() => {
      stopVoiceAudioPlayback();
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice-2');
    expect(audio.getAttribute('src')).toBeNull();
    expect(playButtons()[1]!.getAttribute('aria-label')).toBe('Play voice message');
  });
});
