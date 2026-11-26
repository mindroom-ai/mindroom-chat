// @vitest-environment jsdom

import React from 'react';
import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { createStore } from 'jotai';
import { cleanup, render } from '@testing-library/react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandPaletteOpenAtom } from '../command-palette/commandPaletteState';
import { holdModalSheet } from '../lib/portalOverlay';
import { imageViewerOpenAtom } from '../navigation/imageViewerState';
import { SWIPE_PRIORITY, useInteractiveSwipe } from '../navigation/interactiveSwipe';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { registerSettingsStepBack, settingsModalAtom } from '../navigation/settingsModal';
import { createAndroidBackButtonDelegates } from '../shell/androidBackDelegates';
import { ModalLayer } from '../ui/ModalLayer';
import { PopOut } from '../ui/directional';
import { handleAndroidBackButton, installAndroidBackButton } from './androidBackButton';

const previousHistoryPathnameMock = vi.hoisted(() => vi.fn<() => string | undefined>());

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'android'),
    isNativePlatform: vi.fn(() => true),
  },
  registerPlugin: vi.fn(),
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
    cleanup();
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

  it('registers the backButton listener on Android and removes it on cleanup', async () => {
    const delegates = createAndroidBackButtonDelegates(createStore());

    const stop = installAndroidBackButton(delegates);
    await Promise.resolve();

    expect(App.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    expect(backListener).toBeDefined();

    backListener?.({ canGoBack: false });
    expect(App.minimizeApp).toHaveBeenCalledOnce();

    stop();
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
      if (event.key === 'Escape') {
        event.preventDefault();
        topEscape(event.target);
      }
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
      if (event.key === 'Escape') {
        event.preventDefault();
        logoutEscape();
      }
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
      if (event.key === 'Escape') {
        event.preventDefault();
        docEscape();
      }
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

  it('dismisses a DateFormatSetting-style body-portaled role="none" PopOut before leaving a Settings subpage', () => {
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
    document.body.append(settingsDialog);

    let closePopover!: () => void;
    const popoverClosed = vi.fn();
    let popoverOpen = true;

    function DateFormatPopoverHarness() {
      const [open, setOpen] = React.useState(true);
      closePopover = () => setOpen(false);
      popoverOpen = open;
      React.useEffect(() => {
        if (!open) return undefined;
        // Mirrors DateFormatSetting's FocusTrap document Escape listener.
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          event.preventDefault();
          popoverClosed();
          setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [open]);

      return React.createElement(PopOut, {
        anchor: open ? { x: 100, y: 100, width: 24, height: 24 } : undefined,
        position: 'Bottom',
        align: 'End',
        content: React.createElement(
          'div',
          { 'data-format-hints': '', tabIndex: -1 },
          React.createElement('div', { role: 'none' }, 'Formatting tokens')
        ),
      });
    }

    let unmount: (() => void) | undefined;
    try {
      ({ unmount } = render(React.createElement(DateFormatPopoverHarness)));
      expect(document.querySelector('[data-popout] [role="none"]')).not.toBeNull();

      // First Back dismisses only the PopOut and stays on the Settings subpage.
      act(() => {
        handleAndroidBackButton({ canGoBack: true }, delegates);
      });
      expect(popoverClosed).toHaveBeenCalledOnce();
      expect(popoverOpen).toBe(false);
      expect(document.querySelector('[data-popout]')).toBeNull();
      expect(stepBack).not.toHaveBeenCalled();
      expect(store.get(settingsModalAtom)).toEqual({});

      // Second Back steps back out of the Settings subpage.
      handleAndroidBackButton({ canGoBack: true }, delegates);
      expect(stepBack).toHaveBeenCalledOnce();
      expect(store.get(settingsModalAtom)).toEqual({});
    } finally {
      closePopover?.();
      unmount?.();
      stopStepBack();
    }
  });

  it('does not swallow Back on IncomingCalls-style alertdialogs or non-closable conversation covers', () => {
    const store = createStore();
    const delegates = createAndroidBackButtonDelegates(store);
    const windowEscapeShortcut = vi.fn((event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    });
    window.addEventListener('keydown', windowEscapeShortcut);

    try {
      // 1. Generic non-Escape role="alertdialog" (no Escape handler) -> proceeds to history back
      //    and does not leak synthetic Escape to window-level shortcuts (e.g. ShortcutRoot).
      const alertDialog = document.createElement('div');
      alertDialog.setAttribute('role', 'alertdialog');
      document.body.append(alertDialog);
      window.history.replaceState({ idx: 2 }, '', '/home/!room:example.org/');

      handleAndroidBackButton({ canGoBack: true }, delegates);
      expect(historyBackSpy).toHaveBeenCalledOnce();
      expect(windowEscapeShortcut).not.toHaveBeenCalled();

      // 2. IncomingCalls card (role="alertdialog" + data-incoming-call) -> proceeds to drawer / minimize.
      historyBackSpy.mockClear();
      alertDialog.setAttribute('data-incoming-call', '!call:example.org');
      store.set(phoneNavDrawerOpenAtom, true);
      handleAndroidBackButton({ canGoBack: false }, delegates);
      expect(store.get(phoneNavDrawerOpenAtom)).toBe(false);
      expect(App.minimizeApp).not.toHaveBeenCalled();

      // At root with IncomingCalls still ringing -> minimizes instead of trapping the user.
      window.history.replaceState({ idx: 0 }, '', '/home/');
      handleAndroidBackButton({ canGoBack: false }, delegates);
      expect(App.minimizeApp).toHaveBeenCalledOnce();

      // 3. Non-closable [data-conversation-cover] (ignores Escape) -> proceeds to history back;
      //    closable [data-conversation-cover] (handles Escape) -> closes cover without navigating.
      alertDialog.remove();
      historyBackSpy.mockClear();
      const nonClosableCover = document.createElement('div');
      nonClosableCover.setAttribute('data-conversation-cover', '');
      document.body.append(nonClosableCover);
      window.history.replaceState({ idx: 2 }, '', '/home/!room:example.org/');

      handleAndroidBackButton({ canGoBack: true }, delegates);
      expect(historyBackSpy).toHaveBeenCalledOnce();
      expect(windowEscapeShortcut).not.toHaveBeenCalled();

      historyBackSpy.mockClear();
      const closeCover = vi.fn();
      nonClosableCover.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeCover();
        }
      });
      handleAndroidBackButton({ canGoBack: true }, delegates);
      expect(closeCover).toHaveBeenCalledOnce();
      expect(historyBackSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowEscapeShortcut);
    }
  });

  it('flushes React state on Escape so pinned cards closing without preventDefault do not also navigate or minimize', () => {
    const store = createStore();
    const delegates = createAndroidBackButtonDelegates(store);
    const triggerRef = React.createRef<HTMLButtonElement>();

    function PinnedTipCardHarness() {
      const [open, setOpen] = React.useState(true);
      React.useEffect(() => {
        if (!open) return undefined;
        // Mirrors useAnchoredCard.ts when focus is on the trigger: closes via React setState
        // on document Escape without calling preventDefault() or stopPropagation().
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key !== 'Escape') return;
          setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [open]);

      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', { type: 'button', ref: triggerRef }, 'Show tip'),
        React.createElement(PopOut, {
          anchor: open ? { x: 100, y: 100, width: 24, height: 24 } : undefined,
          position: 'Top',
          align: 'Start',
          content: React.createElement('div', { role: 'tooltip' }, 'Pinned summary tip'),
        })
      );
    }

    const { unmount } = render(React.createElement(PinnedTipCardHarness));
    try {
      triggerRef.current?.focus();
      expect(document.querySelector('[data-popout]')).not.toBeNull();
      window.history.replaceState({ idx: 2 }, '', '/home/!room:example.org/thread');

      // Back dismisses the pinned card synchronously via flushSync and must not also go back or minimize.
      React.act(() => {
        handleAndroidBackButton({ canGoBack: true }, delegates);
      });
      expect(document.querySelector('[data-popout]')).toBeNull();
      expect(historyBackSpy).not.toHaveBeenCalled();
      expect(App.minimizeApp).not.toHaveBeenCalled();

      // A second Back press now navigates back normally.
      handleAndroidBackButton({ canGoBack: true }, delegates);
      expect(historyBackSpy).toHaveBeenCalledOnce();
    } finally {
      unmount();
    }

    // At history root, dismissing a pinned card also must not fall through to minimizeApp().
    window.history.replaceState({ idx: 0 }, '', '/home/');
    const rootRender = render(React.createElement(PinnedTipCardHarness));
    try {
      triggerRef.current?.focus();
      expect(document.querySelector('[data-popout]')).not.toBeNull();
      React.act(() => {
        handleAndroidBackButton({ canGoBack: false }, delegates);
      });
      expect(document.querySelector('[data-popout]')).toBeNull();
      expect(App.minimizeApp).not.toHaveBeenCalled();
    } finally {
      rootRender.unmount();
    }
  });

  it('routes Escape on a listbox to its owning combobox via aria-controls so CommandPalette steps back instead of closing', () => {
    const store = createStore();
    const delegates = createAndroidBackButtonDelegates(store);
    store.set(commandPaletteOpenAtom, 'all');
    const goBack = vi.fn();
    const closeDialog = vi.fn();
    const comboboxRef = React.createRef<HTMLInputElement>();
    let currentPage: 'theme' | undefined = 'theme';

    function CommandPaletteSubpageHarness() {
      const [open, setOpen] = React.useState(true);
      const [page, setPage] = React.useState<'theme' | undefined>('theme');
      currentPage = page;

      if (!open) return null;
      return React.createElement(
        'div',
        {
          role: 'dialog',
          onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeDialog();
            setOpen(false);
            store.set(commandPaletteOpenAtom, undefined);
          },
        },
        React.createElement('input', {
          ref: comboboxRef,
          role: 'combobox',
          'aria-controls': 'status results',
          onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            if (page) {
              goBack();
              setPage(undefined);
            } else {
              closeDialog();
              setOpen(false);
              store.set(commandPaletteOpenAtom, undefined);
            }
          },
        }),
        React.createElement(
          'div',
          { role: 'listbox', id: 'results' },
          React.createElement('div', { role: 'option', 'aria-selected': true }, 'Light')
        )
      );
    }

    const { unmount } = render(React.createElement(CommandPaletteSubpageHarness));
    try {
      comboboxRef.current?.focus();
      expect(document.activeElement).toBe(comboboxRef.current);

      // First Back routes Escape to the combobox input, stepping back from the subpage without closing the dialog.
      React.act(() => {
        handleAndroidBackButton({ canGoBack: true }, delegates);
      });
      expect(goBack).toHaveBeenCalledOnce();
      expect(currentPage).toBeUndefined();
      expect(closeDialog).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(store.get(commandPaletteOpenAtom)).toBe('all');
      expect(historyBackSpy).not.toHaveBeenCalled();
      expect(App.minimizeApp).not.toHaveBeenCalled();

      // Second Back closes the CommandPalette from the root page.
      React.act(() => {
        handleAndroidBackButton({ canGoBack: true }, delegates);
      });
      expect(closeDialog).toHaveBeenCalledOnce();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(store.get(commandPaletteOpenAtom)).toBeUndefined();
      expect(historyBackSpy).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('dismisses a real ModalLayer dialog on Back without navigating or minimizing', () => {
    const store = createStore();
    const delegates = createAndroidBackButtonDelegates(store);
    const onClose = vi.fn();
    const rectsSpy = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
      () =>
        ({
          length: 1,
          0: new DOMRect(0, 0, 40, 20),
          item: () => new DOMRect(0, 0, 40, 20),
          [Symbol.iterator]: function* rects() {
            yield new DOMRect(0, 0, 40, 20);
          },
        }) as unknown as DOMRectList
    );

    function ModalLayerHarness() {
      const [open, setOpen] = React.useState(true);
      return React.createElement(
        ModalLayer,
        {
          open,
          onClose: () => {
            onClose();
            setOpen(false);
          },
        },
        React.createElement('div', null, React.createElement('button', { type: 'button' }, 'OK'))
      );
    }

    const { unmount } = render(React.createElement(ModalLayerHarness));
    try {
      expect(document.querySelector('[data-modal-layer]')).not.toBeNull();
      handleAndroidBackButton({ canGoBack: false }, delegates);
      expect(onClose).toHaveBeenCalledOnce();
      expect(document.querySelector('[data-modal-layer]')).toBeNull();
      expect(historyBackSpy).not.toHaveBeenCalled();
      expect(App.minimizeApp).not.toHaveBeenCalled();
    } finally {
      unmount();
      rectsSpy.mockRestore();
    }
  });
});
