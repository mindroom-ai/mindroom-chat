import { systemPreferences, type InputEvent } from 'electron';
import type { DesktopShellEvent } from '../../src/app/lib/desktopBridge';

export type TrackpadSwipeWindow = {
  isDestroyed(): boolean;
  on(event: 'focus', listener: () => void): unknown;
  on(event: 'swipe', listener: (event: unknown, direction: string) => void): unknown;
  webContents: {
    send(channel: string, payload: DesktopShellEvent): void;
    on(event: 'did-finish-load', listener: () => void): unknown;
    on(event: 'input-event', listener: (event: unknown, input: InputEvent) => void): unknown;
  };
};

export type TrackpadSwipeOptions = {
  platform?: NodeJS.Platform;
  isSwipeTrackingEnabled?: () => boolean;
};

/**
 * Forwards macOS trackpad gesture boundaries and discrete AppKit swipe events to the main window
 * renderer over `desktop:shell-event`. No-op outside darwin.
 */
export const attachTrackpadSwipe = (
  win: TrackpadSwipeWindow,
  options: TrackpadSwipeOptions = {}
): void => {
  if ((options.platform ?? process.platform) !== 'darwin') return;

  const isEnabled =
    options.isSwipeTrackingEnabled ??
    (() => systemPreferences.isSwipeTrackingFromScrollEventsEnabled());
  const send = (payload: DesktopShellEvent): void => {
    if (!win.isDestroyed()) win.webContents.send('desktop:shell-event', payload);
  };
  let lastEnabled: boolean | undefined;
  const syncTracking = (): void => {
    lastEnabled = isEnabled();
    send({ type: 'swipe-tracking', enabled: lastEnabled });
  };

  let scrollGestureActive = false;
  win.webContents.on('did-finish-load', syncTracking);
  win.on('focus', syncTracking);

  win.webContents.on('input-event', (_event, input) => {
    if (input.type === 'gestureScrollBegin') {
      const enabled = isEnabled();
      scrollGestureActive = enabled;
      if (enabled) {
        if (lastEnabled === false) send({ type: 'swipe-tracking', enabled: true });
        lastEnabled = true;
        send({ type: 'scroll-gesture', phase: 'begin' });
      } else {
        lastEnabled = false;
        send({ type: 'swipe-tracking', enabled: false });
      }
      return;
    }
    if (!scrollGestureActive) return;
    if (input.type === 'gestureFlingStart') {
      send({ type: 'scroll-gesture', phase: 'fling' });
    } else if (input.type === 'gestureScrollEnd' || input.type === 'gestureFlingCancel') {
      scrollGestureActive = false;
      send({ type: 'scroll-gesture', phase: input.type === 'gestureScrollEnd' ? 'end' : 'cancel' });
    }
  });

  win.on('swipe', (_event, direction) => {
    if (direction === 'left' || direction === 'right') send({ type: 'swipe', direction });
  });
};
