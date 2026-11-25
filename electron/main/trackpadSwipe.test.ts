import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopShellEvent } from '../../src/app/lib/desktopBridge';

const systemPreferencesMock = vi.hoisted(() => ({
  isSwipeTrackingFromScrollEventsEnabled: vi.fn(() => true),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false },
  systemPreferences: systemPreferencesMock,
}));

import {
  TRACKPAD_SWIPE_ADDON_NAME,
  attachTrackpadSwipe,
  resolveTrackpadSwipeAddonPath,
  setTrackpadSwipeRecorder,
  type TrackpadSwipePhase,
  type TrackpadSwipeStatus,
} from './trackpadSwipe';

const makeWin = () => {
  const sent: DesktopShellEvent[] = [];
  const handle = Buffer.alloc(8, 0x2a);
  const webContents = Object.assign(new EventEmitter(), {
    send: vi.fn((_ch: string, payload: DesktopShellEvent) => sent.push(payload)),
  });
  const win = Object.assign(new EventEmitter(), {
    destroyed: false,
    sent,
    handle,
    isDestroyed: () => win.destroyed,
    getNativeWindowHandle: vi.fn(() => handle),
    webContents,
  });
  return win;
};

afterEach(() => {
  setTrackpadSwipeRecorder(undefined);
  vi.clearAllMocks();
});

describe('resolveTrackpadSwipeAddonPath', () => {
  it('resolves packaged and unpackaged addon paths', () => {
    expect(
      resolveTrackpadSwipeAddonPath({
        isPackaged: true,
        resourcesPath: '/Applications/MindRoom Chat.app/Contents/Resources',
        unpackagedDir: '/repo/build/electron',
      })
    ).toBe(
      path.join('/Applications/MindRoom Chat.app/Contents/Resources', TRACKPAD_SWIPE_ADDON_NAME)
    );
    expect(
      resolveTrackpadSwipeAddonPath({
        isPackaged: false,
        resourcesPath: '/ignored',
        unpackagedDir: '/repo/build/electron',
      })
    ).toBe(path.join('/repo/build/electron', TRACKPAD_SWIPE_ADDON_NAME));
  });
});

describe('attachTrackpadSwipe', () => {
  it('is a no-op outside darwin and for an already-destroyed window', () => {
    const isEnabled = vi.fn(() => true);
    const attachNativeMonitor = vi.fn(() => vi.fn());
    for (const platform of ['linux', 'win32'] as const) {
      const win = makeWin();
      attachTrackpadSwipe(win, {
        platform,
        isSwipeTrackingEnabled: isEnabled,
        attachNativeMonitor,
      });
      win.webContents.emit('did-finish-load');
      win.emit('focus');
      win.emit('swipe', {}, 'left');
      expect(win.sent).toEqual([]);
    }
    const destroyed = makeWin();
    destroyed.destroyed = true;
    attachTrackpadSwipe(destroyed, {
      platform: 'darwin',
      isSwipeTrackingEnabled: isEnabled,
      attachNativeMonitor,
    });
    expect(destroyed.getNativeWindowHandle).not.toHaveBeenCalled();
    expect(attachNativeMonitor).not.toHaveBeenCalled();
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('forwards native begin/end/cancel phases, ignores input-event, and detaches on closed', () => {
    let enabled = true;
    let emitPhase: ((phase: TrackpadSwipePhase) => void) | undefined;
    const statuses: TrackpadSwipeStatus[] = [];
    setTrackpadSwipeRecorder((status) => statuses.push(status));
    const detach = Object.assign(vi.fn(), {
      _emitForTest: (phase: TrackpadSwipePhase) => emitPhase?.(phase),
    });
    const attachNativeMonitor = vi.fn(
      (_handle: Buffer, onPhase: (phase: TrackpadSwipePhase) => void) => {
        emitPhase = onPhase;
        return detach;
      }
    );
    const win = makeWin();
    attachTrackpadSwipe(win, {
      platform: 'darwin',
      isSwipeTrackingEnabled: () => enabled,
      attachNativeMonitor,
    });
    expect(statuses).toEqual([{ attached: true, emitForTest: detach._emitForTest }]);

    expect(attachNativeMonitor).toHaveBeenCalledTimes(1);
    expect(attachNativeMonitor).toHaveBeenCalledWith(win.handle, expect.any(Function));
    expect(win.webContents.listenerCount('input-event')).toBe(0);

    win.webContents.emit('did-finish-load');
    enabled = false;
    win.emit('focus');
    emitPhase?.('begin');
    enabled = true;
    emitPhase?.('begin');
    emitPhase?.('end');
    emitPhase?.('begin');
    emitPhase?.('cancel');
    expect(win.sent).toEqual([
      { type: 'swipe-tracking', enabled: true },
      { type: 'swipe-tracking', enabled: false },
      { type: 'swipe-tracking', enabled: false },
      { type: 'swipe-tracking', enabled: true },
      { type: 'scroll-gesture', phase: 'begin' },
      { type: 'scroll-gesture', phase: 'end' },
      { type: 'swipe-tracking', enabled: true },
      { type: 'scroll-gesture', phase: 'begin' },
      { type: 'scroll-gesture', phase: 'cancel' },
    ]);

    win.emit('closed');
    win.emit('closed');
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it('fails closed with one warning when addon is missing or attach throws, while keeping discrete swipe active', () => {
    const statuses: TrackpadSwipeStatus[] = [];
    setTrackpadSwipeRecorder((s) => statuses.push(s));

    for (const opts of [
      { addonPath: '/nonexistent/mindroom-trackpad-swipe.node' },
      {
        attachNativeMonitor: () => {
          throw new Error('NSWindow missing');
        },
      },
    ]) {
      const warn = vi.fn();
      const isEnabled = vi.fn(() => true);
      const win = makeWin();
      attachTrackpadSwipe(win, {
        platform: 'darwin',
        isSwipeTrackingEnabled: isEnabled,
        warn,
        ...opts,
      });
      win.webContents.emit('did-finish-load');
      win.emit('focus');
      ['left', 'right', 'up', 'down'].forEach((dir) => win.emit('swipe', {}, dir));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(isEnabled).not.toHaveBeenCalled();
      expect(win.webContents.listenerCount('input-event')).toBe(0);
      expect(win.sent).toEqual([
        { type: 'swipe-tracking', enabled: false },
        { type: 'swipe-tracking', enabled: false },
        { type: 'swipe', direction: 'left' },
        { type: 'swipe', direction: 'right' },
      ]);
    }
    expect(statuses).toEqual([
      { attached: false, warning: expect.stringContaining('Missing native addon') },
      { attached: false, warning: expect.stringContaining('NSWindow missing') },
    ]);
  });

  it('uses systemPreferences by default on darwin and skips sends once destroyed', () => {
    systemPreferencesMock.isSwipeTrackingFromScrollEventsEnabled.mockReturnValue(true);
    let emitPhase: ((phase: TrackpadSwipePhase) => void) | undefined;
    const win = makeWin();
    attachTrackpadSwipe(win, {
      platform: 'darwin',
      attachNativeMonitor: (_h, cb) => {
        emitPhase = cb;
        return () => undefined;
      },
    });
    win.webContents.emit('did-finish-load');
    expect(systemPreferencesMock.isSwipeTrackingFromScrollEventsEnabled).toHaveBeenCalledTimes(1);
    expect(win.sent).toEqual([{ type: 'swipe-tracking', enabled: true }]);
    win.destroyed = true;
    win.emit('focus');
    emitPhase?.('begin');
    emitPhase?.('end');
    emitPhase?.('cancel');
    win.emit('swipe', {}, 'left');
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });
});
