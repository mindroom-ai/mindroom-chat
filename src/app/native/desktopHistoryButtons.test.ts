// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../lib/desktopBridge';
import { walkHistoryOnMouseButtons } from './desktopHistoryButtons';

const makeDesktopBridge = (): DesktopBridge => ({
  onShellEvent: vi.fn(() => () => undefined),
  setMediaSession: vi.fn(() => ({ ok: true as const, value: undefined })),
  startSignIn: vi.fn(async () => ({ ok: true as const, value: '' })),
  openSignIn: vi.fn(async () => ({ ok: true as const, value: undefined })),
  showMainWindow: vi.fn(async () => ({ ok: true as const, value: undefined })),
  setBadge: vi.fn(),
  isWindowFocused: () => true,
  screenShare: false,
  appUrl: {
    addListener: vi.fn(async () => undefined),
    getLaunchUrl: vi.fn(async () => undefined),
  },
});

const dispatchMouse = (type: 'mousedown' | 'mouseup' | 'auxclick', button: number): MouseEvent => {
  const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
};

afterEach(() => {
  Reflect.deleteProperty(window, 'mindroomDesktop');
  window.history.pushState({}, '', '/');
  vi.restoreAllMocks();
});

describe('walkHistoryOnMouseButtons', () => {
  it('walks back on button 3 mouseup, forward on button 4 mouseup, and cancels mousedown/auxclick', () => {
    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: makeDesktopBridge(),
    });
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const forwardSpy = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
    const stop = walkHistoryOnMouseButtons(window);

    try {
      const downBack = dispatchMouse('mousedown', 3);
      expect(downBack.defaultPrevented).toBe(true);
      expect(backSpy).not.toHaveBeenCalled();

      const upBack = dispatchMouse('mouseup', 3);
      expect(upBack.defaultPrevented).toBe(true);
      expect(backSpy).toHaveBeenCalledTimes(1);
      expect(forwardSpy).not.toHaveBeenCalled();

      const auxBack = dispatchMouse('auxclick', 3);
      expect(auxBack.defaultPrevented).toBe(true);
      expect(backSpy).toHaveBeenCalledTimes(1);

      const downFwd = dispatchMouse('mousedown', 4);
      expect(downFwd.defaultPrevented).toBe(true);
      expect(forwardSpy).not.toHaveBeenCalled();

      const upFwd = dispatchMouse('mouseup', 4);
      expect(upFwd.defaultPrevented).toBe(true);
      expect(forwardSpy).toHaveBeenCalledTimes(1);

      const auxFwd = dispatchMouse('auxclick', 4);
      expect(auxFwd.defaultPrevented).toBe(true);
      expect(forwardSpy).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('ignores mouse buttons 0, 1, 2, and others', () => {
    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: makeDesktopBridge(),
    });
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const forwardSpy = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
    const stop = walkHistoryOnMouseButtons(window);

    try {
      for (const button of [0, 1, 2, 5]) {
        expect(dispatchMouse('mousedown', button).defaultPrevented).toBe(false);
        expect(dispatchMouse('mouseup', button).defaultPrevented).toBe(false);
        expect(dispatchMouse('auxclick', button).defaultPrevented).toBe(false);
      }
      expect(backSpy).not.toHaveBeenCalled();
      expect(forwardSpy).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('is a no-op outside the desktop app and on /quick-capture/', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const stopWeb = walkHistoryOnMouseButtons(window);
    expect(dispatchMouse('mouseup', 3).defaultPrevented).toBe(false);
    expect(backSpy).not.toHaveBeenCalled();
    stopWeb();

    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: makeDesktopBridge(),
    });
    window.history.pushState({}, '', '/quick-capture/');
    const stopQc = walkHistoryOnMouseButtons(window);
    expect(dispatchMouse('mouseup', 3).defaultPrevented).toBe(false);
    expect(backSpy).not.toHaveBeenCalled();
    stopQc();
  });

  it('removes listeners on cleanup', () => {
    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: makeDesktopBridge(),
    });
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const stop = walkHistoryOnMouseButtons(window);
    stop();

    expect(dispatchMouse('mousedown', 3).defaultPrevented).toBe(false);
    expect(dispatchMouse('mouseup', 3).defaultPrevented).toBe(false);
    expect(dispatchMouse('auxclick', 3).defaultPrevented).toBe(false);
    expect(backSpy).not.toHaveBeenCalled();
  });
});
