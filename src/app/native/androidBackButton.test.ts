// @vitest-environment jsdom

import React from 'react';
import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandPaletteOpenAtom } from '../command-palette/commandPaletteState';
import { holdModalSheet } from '../lib/portalOverlay';
import { imageViewerOpenAtom } from '../navigation/imageViewerState';
import { SWIPE_PRIORITY, useInteractiveSwipe } from '../navigation/interactiveSwipe';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { registerSettingsStepBack, settingsModalAtom } from '../navigation/settingsModal';
import { createAndroidBackButtonDelegates } from '../shell/androidBackDelegates';
import {
  handleAndroidBackButton,
  installAndroidBackButton,
  useAndroidBackButton,
} from './androidBackButton';

const previousHistoryPathnameMock = vi.hoisted(() => vi.fn<() => string | undefined>());

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'android'),
    isNativePlatform: vi.fn(() => true),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(),
    minimizeApp: vi.fn(),
  },
}));

vi.mock('../routes/historyStack', () => ({
  previousHistoryPathname: previousHistoryPathnameMock,
}));

describe('androidBackButton', () => {
  let backListener: ((event: { canGoBack: boolean }) => void) | undefined;
  let removeListener: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let historyBackSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
    backListener = undefined;
    removeListener = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    previousHistoryPathnameMock.mockReturnValue(undefined);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    vi.mocked(App.minimizeApp).mockResolvedValue(undefined);
    vi.mocked(App.addListener).mockImplementation((eventName, listener) => {
      if (eventName === 'backButton') {
        backListener = listener;
      }
      return Promise.resolve({ remove: removeListener });
    });
    historyBackSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  });

  afterEach(() => {
    historyBackSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it.each([
    ['web', false],
    ['ios', true],
  ] as const)('does not attach a listener on %s', (platform, native) => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(native);

    const stop = installAndroidBackButton(createAndroidBackButtonDelegates(createStore()));
    expect(App.addListener).not.toHaveBeenCalled();
    stop();
  });

  it('registers the backButton listener on Android and removes it on unmount', async () => {
    const delegates = createAndroidBackButtonDelegates(createStore());

    function Harness() {
      useAndroidBackButton(delegates);
      return null;
    }

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    expect(App.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    expect(backListener).toBeDefined();

    backListener?.({ canGoBack: false });
    expect(App.minimizeApp).toHaveBeenCalledOnce();

    await act(async () => {
      renderer.unmount();
    });
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it('removes the listener if unmounted before App.addListener resolves', async () => {
    let resolveHandle!: (handle: PluginListenerHandle) => void;
    vi.mocked(App.addListener).mockReturnValueOnce(
      new Promise<PluginListenerHandle>((resolve) => {
        resolveHandle = resolve;
      })
    );

    const stop = installAndroidBackButton(createAndroidBackButtonDelegates(createStore()));
    stop();

    resolveHandle({ remove: removeListener });
    await Promise.resolve();

    expect(removeListener).toHaveBeenCalledOnce();
  });

  it('dispatches Escape to the topmost non-inert DOM overlay and ignores tooltips and inert dialogs', () => {
    const store = createStore();
    const delegates = createAndroidBackButtonDelegates(store);
    store.set(phoneNavDrawerOpenAtom, true);

    const inertDialog = document.createElement('div');
    inertDialog.setAttribute('role', 'dialog');
    inertDialog.setAttribute('inert', '');
    const baseDialog = document.createElement('div');
    baseDialog.setAttribute('role', 'dialog');
    const topMenu = document.createElement('div');
    topMenu.setAttribute('role', 'menu');
    const menuItem = document.createElement('button');
    topMenu.appendChild(menuItem);
    const portal = document.createElement('div');
    portal.id = 'portalContainer';
    const tooltip = document.createElement('div');
    tooltip.setAttribute('role', 'tooltip');
    portal.appendChild(tooltip);
    document.body.append(inertDialog, baseDialog, topMenu, portal);
    menuItem.focus();

    const baseEscape = vi.fn();
    const topEscape = vi.fn();
    baseDialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') baseEscape();
    });
    topMenu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') topEscape(event.target);
    });

    handleAndroidBackButton({ canGoBack: true }, delegates);

    expect(topEscape).toHaveBeenCalledWith(menuItem);
    expect(baseEscape).not.toHaveBeenCalled();
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(App.minimizeApp).not.toHaveBeenCalled();
  });

  it('dismisses a nested overlay over Settings before stepping back or closing Settings', () => {
    const store = createStore();
    const delegates = createAndroidBackButtonDelegates(store);
    store.set(settingsModalAtom, {});
    const stepBack = vi.fn();
    const stopStepBack = registerSettingsStepBack(stepBack);

    const settingsDialog = document.createElement('div');
    settingsDialog.setAttribute('role', 'dialog');
    const marker = document.createElement('div');
    marker.setAttribute('data-settings-modal', '');
    settingsDialog.appendChild(marker);

    const logoutDialog = document.createElement('div');
    logoutDialog.setAttribute('role', 'dialog');
    const logoutEscape = vi.fn();
    logoutDialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') logoutEscape();
    });
    document.body.append(settingsDialog, logoutDialog);

    try {
      handleAndroidBackButton({ canGoBack: true }, delegates);
      expect(logoutEscape).toHaveBeenCalledOnce();
      expect(stepBack).not.toHaveBeenCalled();
      expect(store.get(settingsModalAtom)).toEqual({});

      logoutDialog.remove();
      handleAndroidBackButton({ canGoBack: true }, delegates);
      expect(stepBack).toHaveBeenCalledOnce();
      expect(store.get(settingsModalAtom)).toEqual({});

      stopStepBack();
      handleAndroidBackButton({ canGoBack: true }, delegates);
      expect(store.get(settingsModalAtom)).toBeUndefined();
    } finally {
      stopStepBack();
    }
  });

  it('dismisses BottomSheet, CommandPalette, and ImageOverlay ahead of drawer and history', () => {
    const store = createStore();
    const delegates = createAndroidBackButtonDelegates(store);
    store.set(phoneNavDrawerOpenAtom, true);

    // BottomSheet held open without a matching dialog role still gets Escape.
    const releaseSheet = holdModalSheet();
    const docEscape = vi.fn();
    const onDocKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') docEscape();
    };
    document.addEventListener('keydown', onDocKey);
    try {
      handleAndroidBackButton({ canGoBack: true }, delegates);
      expect(docEscape).toHaveBeenCalledOnce();
    } finally {
      releaseSheet();
      document.removeEventListener('keydown', onDocKey);
    }

    // CommandPalette atom closes before drawer.
    store.set(commandPaletteOpenAtom, 'all');
    handleAndroidBackButton({ canGoBack: true }, delegates);
    expect(store.get(commandPaletteOpenAtom)).toBeUndefined();
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);

    // ImageOverlay atom with viewer history marker pops history once.
    store.set(imageViewerOpenAtom, true);
    window.history.replaceState({ __mindroomImageViewer: true }, '', '/home/room');
    handleAndroidBackButton({ canGoBack: true }, delegates);
    expect(historyBackSpy).toHaveBeenCalledOnce();
    expect(store.get(phoneNavDrawerOpenAtom)).toBe(true);

    // ImageOverlay atom without history marker clears atom directly.
    historyBackSpy.mockClear();
    window.history.replaceState(null, '', '/home/room');
    handleAndroidBackButton({ canGoBack: true }, delegates);
    expect(store.get(imageViewerOpenAtom)).toBe(false);
    expect(historyBackSpy).not.toHaveBeenCalled();
  });

  it('closes PhoneNavDrawer before navigating history', () => {
    const store = createStore();
    const delegates = createAndroidBackButtonDelegates(store);
    store.set(phoneNavDrawerOpenAtom, true);

    handleAndroidBackButton({ canGoBack: true }, delegates);

    expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(App.minimizeApp).not.toHaveBeenCalled();
  });

  it('closes covering mobile side panels before navigating history and exits deep-linked threads at root', () => {
    const store = createStore();
    const delegates = createAndroidBackButtonDelegates(store);
    const closePanel = vi.fn();
    const exitThread = vi.fn();

    function PanelAndThreadHarness({ panelOpen }: { panelOpen: boolean }) {
      useInteractiveSwipe({
        zone: 'edge',
        edge: 'start',
        direction: 'inward',
        priority: SWIPE_PRIORITY.PAGE,
        enabled: true,
        onCommit: exitThread,
      });
      useInteractiveSwipe({
        zone: 'edge',
        edge: 'start',
        direction: 'inward',
        priority: SWIPE_PRIORITY.PANEL,
        enabled: panelOpen,
        onCommit: closePanel,
      });
      return null;
    }

    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(PanelAndThreadHarness, { panelOpen: true }));
    });

    handleAndroidBackButton({ canGoBack: true }, delegates);
    expect(closePanel).toHaveBeenCalledOnce();
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(exitThread).not.toHaveBeenCalled();

    act(() => {
      renderer.update(React.createElement(PanelAndThreadHarness, { panelOpen: false }));
    });

    // At history root (canGoBack=false), a deep-linked thread exits to its room instead of minimizing.
    window.history.replaceState({ idx: 0 }, '', '/home/!room:example.org/?threadId=$root');
    handleAndroidBackButton({ canGoBack: false }, delegates);
    expect(exitThread).toHaveBeenCalledOnce();
    expect(App.minimizeApp).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it('calls window.history.back() when in-app history can go back', () => {
    const delegates = createAndroidBackButtonDelegates(createStore());

    window.history.replaceState({ idx: 2 }, '', '/home/!room:example.org/');
    handleAndroidBackButton({ canGoBack: true }, delegates);
    expect(historyBackSpy).toHaveBeenCalledOnce();
    expect(App.minimizeApp).not.toHaveBeenCalled();

    historyBackSpy.mockClear();
    window.history.replaceState({ idx: 0 }, '', '/home/!room:example.org/');
    previousHistoryPathnameMock.mockReturnValue('/home/');
    handleAndroidBackButton({ canGoBack: false }, delegates);
    expect(historyBackSpy).toHaveBeenCalledOnce();
  });

  it('minimizes the app at root when nothing is open and history cannot go back', () => {
    const delegates = createAndroidBackButtonDelegates(createStore());
    window.history.replaceState({ idx: 0 }, '', '/home/');

    handleAndroidBackButton({ canGoBack: false }, delegates);
    expect(historyBackSpy).not.toHaveBeenCalled();
    expect(App.minimizeApp).toHaveBeenCalledOnce();
  });
});
