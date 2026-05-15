import { StatusBar } from '@capacitor/status-bar';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNativeIOS } from '../../mindroom/native/nativeSso';
import {
  DEFAULT_MINDROOM_SPLASH_MESSAGES,
  MindRoomSplashScreen,
  pickMindRoomSplashMessage,
} from './MindRoomSplashScreen';

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: {
    setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../mindroom/native/nativeSso', () => ({
  isNativeIOS: vi.fn(),
}));

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Box: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Spinner: () => reactModule.createElement('div', null, 'spinner'),
    Text: ({ children }: { children?: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

vi.mock('../particle-background', () => ({
  MindRoomParticleBackground: () => React.createElement('div', null, 'particle background'),
}));

vi.mock('./SplashScreen', () => ({
  SplashScreen: ({
    children,
    background,
  }: {
    children?: React.ReactNode;
    background?: React.ReactNode;
  }) => React.createElement('div', { 'data-has-background': Boolean(background) }, children),
}));

describe('MindRoomSplashScreen', () => {
  beforeEach(() => {
    vi.mocked(isNativeIOS).mockReset();
    vi.mocked(isNativeIOS).mockReturnValue(false);
    vi.mocked(StatusBar.setOverlaysWebView).mockReset();
    vi.mocked(StatusBar.setOverlaysWebView).mockResolvedValue(undefined);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('chooses a configured loading message from the deployment list', () => {
    const message = pickMindRoomSplashMessage(['One', 'Two', 'Three'], () => 0.7);

    expect(message).toBe('Three');
  });

  it('falls back to the default loading message when deployment messages are empty', () => {
    const message = pickMindRoomSplashMessage(['', '  '], () => 0.7);

    expect(message).toBe(DEFAULT_MINDROOM_SPLASH_MESSAGES[0]);
  });

  it('renders the selected loading message with the shared particle background', () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        React.createElement(MindRoomSplashScreen, {
          loadingMessages: ['Alpha', 'Beta'],
          random: () => 0.1,
        })
      );
    });

    expect(renderer!.root.findByProps({ 'data-has-background': true })).toBeDefined();
    expect(
      renderer!.root.findAll(
        (node) => typeof node.type === 'string' && node.children.includes('Alpha')
      )
    ).toHaveLength(1);
  });

  it('enables the native splash overlay on mount and disables it after unmount', () => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    let renderer: ReactTestRenderer;

    act(() => {
      renderer = create(React.createElement(MindRoomSplashScreen));
    });

    expect(StatusBar.setOverlaysWebView).toHaveBeenNthCalledWith(1, { overlay: true });

    act(() => {
      renderer!.unmount();
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(StatusBar.setOverlaysWebView).toHaveBeenNthCalledWith(2, { overlay: false });
  });

  it('keeps nested native splash mounts on a single overlay acquire', () => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    let firstRenderer: ReactTestRenderer;
    let secondRenderer: ReactTestRenderer;

    act(() => {
      firstRenderer = create(React.createElement(MindRoomSplashScreen));
      secondRenderer = create(React.createElement(MindRoomSplashScreen));
    });

    expect(StatusBar.setOverlaysWebView).toHaveBeenCalledTimes(1);
    expect(StatusBar.setOverlaysWebView).toHaveBeenLastCalledWith({ overlay: true });

    act(() => {
      firstRenderer!.unmount();
    });

    expect(StatusBar.setOverlaysWebView).toHaveBeenCalledTimes(1);

    act(() => {
      secondRenderer!.unmount();
    });

    expect(StatusBar.setOverlaysWebView).toHaveBeenCalledTimes(2);
    expect(StatusBar.setOverlaysWebView).toHaveBeenLastCalledWith({ overlay: false });
  });
});
