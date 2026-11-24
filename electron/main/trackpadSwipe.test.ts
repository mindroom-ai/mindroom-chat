import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopShellEvent } from '../../src/app/lib/desktopBridge';

const systemPreferencesMock = vi.hoisted(() => ({
  isSwipeTrackingFromScrollEventsEnabled: vi.fn(() => true),
}));
vi.mock('electron', () => ({ systemPreferences: systemPreferencesMock }));

import { attachTrackpadSwipe } from './trackpadSwipe';

const makeWin = () => {
  const sent: DesktopShellEvent[] = [];
  const webContents = Object.assign(new EventEmitter(), {
    send: vi.fn((_ch: string, payload: DesktopShellEvent) => sent.push(payload)),
  });
  const win = Object.assign(new EventEmitter(), {
    destroyed: false,
    sent,
    isDestroyed: () => win.destroyed,
    webContents,
  });
  return win;
};
const input = (win: ReturnType<typeof makeWin>, ...types: string[]) =>
  types.forEach((type) => win.webContents.emit('input-event', {}, { type }));

afterEach(() => vi.clearAllMocks());

describe('attachTrackpadSwipe', () => {
  it('is a no-op outside darwin', () => {
    const isEnabled = vi.fn(() => true);
    for (const platform of ['linux', 'win32'] as const) {
      const win = makeWin();
      attachTrackpadSwipe(win, { platform, isSwipeTrackingEnabled: isEnabled });
      win.webContents.emit('did-finish-load');
      win.emit('focus');
      input(win, 'gestureScrollBegin', 'gestureScrollEnd');
      win.emit('swipe', {}, 'left');
      expect(win.sent).toEqual([]);
    }
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('syncs swipe-tracking on load, focus, and live changes on gestureScrollBegin', () => {
    let enabled = true;
    const win = makeWin();
    attachTrackpadSwipe(win, { platform: 'darwin', isSwipeTrackingEnabled: () => enabled });
    win.webContents.emit('did-finish-load');
    enabled = false;
    win.emit('focus');
    input(win, 'gestureScrollBegin');
    enabled = true;
    input(win, 'gestureScrollBegin', 'gestureScrollBegin');
    expect(win.sent).toEqual([
      { type: 'swipe-tracking', enabled: true },
      { type: 'swipe-tracking', enabled: false },
      { type: 'swipe-tracking', enabled: true },
      { type: 'scroll-gesture', phase: 'begin' },
      { type: 'scroll-gesture', phase: 'begin' },
    ]);
  });

  it('forwards begin/end, ignores mouseWheel/fling, and forwards horizontal swipes even when disabled', () => {
    const win = makeWin();
    attachTrackpadSwipe(win, { platform: 'darwin', isSwipeTrackingEnabled: () => true });
    win.webContents.emit('did-finish-load');
    win.sent.length = 0;
    input(
      win,
      'mouseWheel',
      'gestureScrollBegin',
      'mouseWheel',
      'gestureFlingStart',
      'gestureFlingCancel',
      'gestureScrollEnd'
    );
    expect(win.sent).toEqual([
      { type: 'scroll-gesture', phase: 'begin' },
      { type: 'scroll-gesture', phase: 'end' },
    ]);
    const off = makeWin();
    attachTrackpadSwipe(off, { platform: 'darwin', isSwipeTrackingEnabled: () => false });
    ['left', 'right', 'up', 'down'].forEach((dir) => off.emit('swipe', {}, dir));
    expect(off.sent).toEqual([
      { type: 'swipe', direction: 'left' },
      { type: 'swipe', direction: 'right' },
    ]);
  });

  it('uses systemPreferences by default on darwin and skips sends once destroyed', () => {
    systemPreferencesMock.isSwipeTrackingFromScrollEventsEnabled.mockReturnValue(true);
    const win = makeWin();
    attachTrackpadSwipe(win, { platform: 'darwin' });
    win.webContents.emit('did-finish-load');
    expect(systemPreferencesMock.isSwipeTrackingFromScrollEventsEnabled).toHaveBeenCalledTimes(1);
    expect(win.sent).toEqual([{ type: 'swipe-tracking', enabled: true }]);
    win.destroyed = true;
    win.emit('focus');
    input(win, 'gestureScrollBegin', 'gestureScrollEnd');
    win.emit('swipe', {}, 'left');
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });
});
