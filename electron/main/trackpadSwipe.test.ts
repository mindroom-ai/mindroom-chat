import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopShellEvent } from '../../src/app/lib/desktopBridge';

const systemPreferencesMock = vi.hoisted(() => ({
  isSwipeTrackingFromScrollEventsEnabled: vi.fn(() => true),
}));

vi.mock('electron', () => ({ systemPreferences: systemPreferencesMock }));

import { attachTrackpadSwipe, type TrackpadSwipeWindow } from './trackpadSwipe';

type FakeWindow = EventEmitter &
  TrackpadSwipeWindow & {
    destroyed: boolean;
    sent: DesktopShellEvent[];
    webContents: EventEmitter & TrackpadSwipeWindow['webContents'];
  };

const makeFakeWindow = (): FakeWindow => {
  const sent: DesktopShellEvent[] = [];
  const webContents = Object.assign(new EventEmitter(), {
    send: vi.fn((_channel: string, payload: DesktopShellEvent) => {
      sent.push(payload);
    }),
  });
  const win = Object.assign(new EventEmitter(), {
    destroyed: false,
    sent,
    isDestroyed: () => win.destroyed,
    webContents,
  });
  return win;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('attachTrackpadSwipe', () => {
  it('is a no-op outside darwin', () => {
    const isEnabled = vi.fn(() => true);
    for (const platform of ['linux', 'win32'] as const) {
      const win = makeFakeWindow();
      attachTrackpadSwipe(win, { platform, isSwipeTrackingEnabled: isEnabled });
      win.webContents.emit('did-finish-load');
      win.emit('focus');
      win.webContents.emit('input-event', {}, { type: 'gestureScrollBegin' });
      win.emit('swipe', {}, 'left');
      expect(win.sent).toEqual([]);
    }
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('syncs swipe-tracking on load and focus, and checks the setting live on gestureScrollBegin', () => {
    let enabled = true;
    const win = makeFakeWindow();
    attachTrackpadSwipe(win, { platform: 'darwin', isSwipeTrackingEnabled: () => enabled });

    win.webContents.emit('did-finish-load');
    enabled = false;
    win.emit('focus');
    win.webContents.emit('input-event', {}, { type: 'gestureScrollBegin' });
    win.webContents.emit('input-event', {}, { type: 'gestureFlingStart' });
    win.webContents.emit('input-event', {}, { type: 'gestureScrollEnd' });

    expect(win.sent).toEqual([
      { type: 'swipe-tracking', enabled: true },
      { type: 'swipe-tracking', enabled: false },
      { type: 'swipe-tracking', enabled: false },
    ]);

    enabled = true;
    win.webContents.emit('input-event', {}, { type: 'gestureScrollBegin' });
    expect(win.sent.slice(-2)).toEqual([
      { type: 'swipe-tracking', enabled: true },
      { type: 'scroll-gesture', phase: 'begin' },
    ]);
  });

  it('forwards active scroll gesture phases and never forwards mouseWheel or stray endings', () => {
    const win = makeFakeWindow();
    attachTrackpadSwipe(win, { platform: 'darwin', isSwipeTrackingEnabled: () => true });

    // Stray events before begin are ignored.
    win.webContents.emit('input-event', {}, { type: 'mouseWheel' });
    win.webContents.emit('input-event', {}, { type: 'gestureFlingStart' });
    win.webContents.emit('input-event', {}, { type: 'gestureScrollEnd' });
    win.webContents.emit('input-event', {}, { type: 'gestureFlingCancel' });
    expect(win.sent).toEqual([]);

    // Active gesture: begin -> (mouseWheel ignored) -> fling -> end -> (stray fling ignored).
    win.webContents.emit('input-event', {}, { type: 'gestureScrollBegin' });
    win.webContents.emit('input-event', {}, { type: 'mouseWheel' });
    win.webContents.emit('input-event', {}, { type: 'gestureFlingStart' });
    win.webContents.emit('input-event', {}, { type: 'gestureScrollEnd' });
    win.webContents.emit('input-event', {}, { type: 'gestureFlingStart' });

    // Second gesture cancelled via gestureFlingCancel.
    win.webContents.emit('input-event', {}, { type: 'gestureScrollBegin' });
    win.webContents.emit('input-event', {}, { type: 'gestureFlingCancel' });
    win.webContents.emit('input-event', {}, { type: 'gestureScrollEnd' });

    expect(win.sent).toEqual([
      { type: 'scroll-gesture', phase: 'begin' },
      { type: 'scroll-gesture', phase: 'fling' },
      { type: 'scroll-gesture', phase: 'end' },
      { type: 'scroll-gesture', phase: 'begin' },
      { type: 'scroll-gesture', phase: 'cancel' },
    ]);
  });

  it('forwards horizontal AppKit swipe events even when two-finger scroll tracking is disabled', () => {
    const win = makeFakeWindow();
    attachTrackpadSwipe(win, { platform: 'darwin', isSwipeTrackingEnabled: () => false });

    win.emit('swipe', {}, 'left');
    win.emit('swipe', {}, 'right');
    win.emit('swipe', {}, 'up');
    win.emit('swipe', {}, 'down');

    expect(win.sent).toEqual([
      { type: 'swipe', direction: 'left' },
      { type: 'swipe', direction: 'right' },
    ]);
  });

  it('uses systemPreferences by default on darwin and skips sends once the window is destroyed', () => {
    systemPreferencesMock.isSwipeTrackingFromScrollEventsEnabled.mockReturnValue(true);
    const win = makeFakeWindow();
    attachTrackpadSwipe(win, { platform: 'darwin' });

    win.webContents.emit('did-finish-load');
    expect(systemPreferencesMock.isSwipeTrackingFromScrollEventsEnabled).toHaveBeenCalledTimes(1);
    expect(win.sent).toEqual([{ type: 'swipe-tracking', enabled: true }]);

    win.destroyed = true;
    win.emit('focus');
    win.webContents.emit('input-event', {}, { type: 'gestureScrollBegin' });
    win.emit('swipe', {}, 'left');
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });
});
