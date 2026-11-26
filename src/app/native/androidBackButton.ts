import { App } from '@capacitor/app';
import { flushSync } from 'react-dom';
import type { PluginListenerHandle } from '@capacitor/core';
import { OVERLAY_SELECTOR } from '../lib/openOverlay';
import { modalSheetOpen, portalContainer } from '../lib/portalOverlay';
import { previousHistoryPathname } from '../routes/historyStack';
import { isNativeAndroid } from './nativeSso';

const IMAGE_VIEWER_HISTORY_MARKER = '__mindroomImageViewer';
const DISMISSIBLE_OVERLAY_SELECTOR = `${OVERLAY_SELECTOR}, [data-popout], [data-modal-layer], [data-conversation-cover]`;

export type AndroidBackButtonDelegates = {
  isCommandPaletteOpen: () => boolean;
  closeCommandPalette: () => void;
  isImageViewerOpen: () => boolean;
  closeImageViewer: () => void;
  isSettingsOpen: () => boolean;
  stepBackSettings: () => boolean;
  closeSettings: () => void;
  isPhoneNavDrawerOpen: () => boolean;
  closePhoneNavDrawer: () => void;
  closeSidePanel: () => boolean;
  exitRootPage: () => boolean;
};

const isActiveLayer = (element: Element): boolean =>
  !element.closest('[inert], [aria-hidden="true"]') && !element.matches('[data-incoming-call]');

const getOpenOverlays = (): Element[] => {
  if (typeof document === 'undefined') return [];
  const matched = Array.from(document.querySelectorAll(DISMISSIBLE_OVERLAY_SELECTOR)).filter(
    isActiveLayer
  );
  // Drop a `[data-popout]` or `[data-modal-layer]` wrapper when it already contains a more
  // specific matched overlay (such as `role="menu"` or `role="dialog"`), so Escape targets the
  // inner overlay directly and never dispatches twice for the same layer.
  const overlays = matched.filter(
    (element) =>
      !(
        element.matches('[data-popout], [data-modal-layer]') &&
        matched.some((other) => other !== element && element.contains(other))
      )
  );
  const portal = portalContainer ?? document.getElementById('portalContainer');
  if (portal) {
    for (const child of Array.from(portal.children)) {
      if (
        child.getAttribute('role') !== 'tooltip' &&
        isActiveLayer(child) &&
        !overlays.some((existing) => child === existing || child.contains(existing))
      ) {
        overlays.push(child);
      }
    }
  }
  overlays.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
  return overlays;
};

/**
 * Dispatches a synthetic Escape keydown and returns `true` only when a layer actually handled it
 * (`preventDefault` or `stopPropagation`). Unless `allowWindow` is set (for window-level overlays
 * like QuickAccountMenu), stops propagation on `document` before reaching `window` so room-level
 * Escape shortcuts (like `ShortcutRoot`'s focus-composer) never fire for a non-Escape overlay.
 */
const dispatchEscape = (target: EventTarget, allowWindow = false): boolean => {
  let handled = false;
  let reachedDocument = false;
  let reachedWindow = false;

  const onDocumentKeyDown = (event: KeyboardEvent) => {
    reachedDocument = true;
    if (event.defaultPrevented || event.cancelBubble) {
      handled = true;
    }
    if (!allowWindow) {
      event.stopPropagation();
    }
  };
  const onWindowKeyDown = (event: KeyboardEvent) => {
    reachedWindow = true;
    if (event.defaultPrevented || event.cancelBubble) {
      handled = true;
    }
  };

  document.addEventListener('keydown', onDocumentKeyDown);
  if (allowWindow) {
    window.addEventListener('keydown', onWindowKeyDown);
  }

  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });

  try {
    flushSync(() => {
      target.dispatchEvent(event);
    });
  } finally {
    document.removeEventListener('keydown', onDocumentKeyDown);
    if (allowWindow) {
      window.removeEventListener('keydown', onWindowKeyDown);
    }
  }

  if (event.defaultPrevented) return true;
  if (allowWindow) return handled || !reachedWindow;
  return handled || !reachedDocument;
};

const controlsOverlay = (element: Element, overlay: Element): boolean => {
  const id = overlay.id;
  if (!id || element.closest('[inert], [aria-hidden="true"]')) return false;
  const controlled = element.getAttribute('aria-controls');
  return controlled !== null && controlled.trim().split(/\s+/).includes(id);
};

const dismissOverlay = (overlay: Element): boolean => {
  const active = document.activeElement;
  const target =
    active && (overlay.contains(active) || controlsOverlay(active, overlay)) ? active : overlay;
  const allowWindow = overlay.matches('[data-quick-account-menu]');
  return dispatchEscape(target, allowWindow) || !overlay.isConnected;
};

const hasImageViewerHistoryMarker = (): boolean => {
  const state: unknown = window.history.state;
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)[IMAGE_VIEWER_HISTORY_MARKER] === true
  );
};

const getHistoryIndex = (): number | undefined => {
  const state: unknown = window.history.state;
  if (typeof state === 'object' && state !== null && 'idx' in state) {
    const idx = (state as { idx?: unknown }).idx;
    if (typeof idx === 'number' && Number.isFinite(idx)) return idx;
  }
  return undefined;
};

const canNavigateBack = (canGoBack: boolean): boolean => {
  const idx = getHistoryIndex();
  if (idx !== undefined && idx > 0) return true;
  if (previousHistoryPathname() !== undefined) return true;
  return canGoBack && idx === undefined;
};

/**
 * Resolves one Android hardware/gesture back press using existing app overlays,
 * Settings, phone navigation drawer, covering side panels, browser history,
 * and finally minimizing the app at root.
 */
export const handleAndroidBackButton = (
  { canGoBack }: { canGoBack: boolean },
  delegates: AndroidBackButtonDelegates
): void => {
  const settingsOpen = delegates.isSettingsOpen();

  // 1. Topmost dismissible overlay / dialog / menu / popover / sheet / viewer.
  //    If Settings' own dialog is the topmost remaining layer, defer to step 2 so
  //    mobile Settings subpages can step back to the menu. Overlays that ignore Escape
  //    (such as non-modal IncomingCalls cards or non-closable covers) are skipped rather
  //    than swallowing Back.
  const overlays = getOpenOverlays();
  for (let i = overlays.length - 1; i >= 0; i -= 1) {
    const overlay = overlays[i]!;
    if (settingsOpen && overlay.querySelector('[data-settings-modal]') !== null) {
      break;
    }
    if (dismissOverlay(overlay)) {
      return;
    }
  }

  if (modalSheetOpen()) {
    if (typeof document !== 'undefined' && dispatchEscape(document.activeElement ?? document)) {
      return;
    }
  }

  if (delegates.isCommandPaletteOpen()) {
    delegates.closeCommandPalette();
    return;
  }

  if (delegates.isImageViewerOpen()) {
    if (hasImageViewerHistoryMarker()) {
      window.history.back();
    } else {
      delegates.closeImageViewer();
    }
    return;
  }

  // 2. Open Settings modal -> step back from a mobile subpage, or close Settings.
  if (settingsOpen) {
    if (!delegates.stepBackSettings()) {
      delegates.closeSettings();
    }
    return;
  }

  // 3. Open PhoneNavDrawer -> close drawer.
  if (delegates.isPhoneNavDrawerOpen()) {
    delegates.closePhoneNavDrawer();
    return;
  }

  // 4. Covering mobile side panel (or sub-panel), then in-app history back.
  if (delegates.closeSidePanel()) {
    return;
  }

  if (canNavigateBack(canGoBack)) {
    window.history.back();
    return;
  }

  // Deep-linked thread at history root: exit to its room instead of minimizing.
  if (delegates.exitRootPage()) {
    return;
  }

  // 5. At root with nothing open -> minimize the app so the user is never trapped.
  void App.minimizeApp().catch(() => undefined);
};

/** Installs the Android back button listener and returns its cleanup function. */
export const installAndroidBackButton = (delegates: AndroidBackButtonDelegates): (() => void) => {
  if (!isNativeAndroid()) return () => undefined;

  let disposed = false;
  let listenerHandle: PluginListenerHandle | undefined;

  void App.addListener('backButton', (event) => {
    if (!disposed) handleAndroidBackButton(event, delegates);
  })
    .then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      listenerHandle = handle;
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    const handle = listenerHandle;
    listenerHandle = undefined;
    void handle?.remove();
  };
};
