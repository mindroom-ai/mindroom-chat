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

/** Forwards macOS trackpad gesture boundaries and discrete AppKit swipes to the renderer. */
export const attachTrackpadSwipe = (
  win: TrackpadSwipeWindow,
  options: { platform?: NodeJS.Platform; isSwipeTrackingEnabled?: () => boolean } = {}
): void => {
  if ((options.platform ?? process.platform) !== 'darwin') return;
  const isEnabled =
    options.isSwipeTrackingEnabled ??
    (() => systemPreferences.isSwipeTrackingFromScrollEventsEnabled());
  const send = (payload: DesktopShellEvent): void => {
    if (!win.isDestroyed()) win.webContents.send('desktop:shell-event', payload);
  };
  const sync = (): boolean => {
    const enabled = isEnabled();
    send({ type: 'swipe-tracking', enabled });
    return enabled;
  };
  win.webContents.on('did-finish-load', sync);
  win.on('focus', sync);
  win.webContents.on('input-event', (_e, input) => {
    if (input.type === 'gestureScrollBegin') {
      if (sync()) send({ type: 'scroll-gesture', phase: 'begin' });
    } else if (input.type === 'gestureScrollEnd') send({ type: 'scroll-gesture', phase: 'end' });
  });
  win.on('swipe', (_e, direction) => {
    if (direction === 'left' || direction === 'right') send({ type: 'swipe', direction });
  });
};
