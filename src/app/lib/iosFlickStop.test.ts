// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIOSFlickStopped, restoreIOSFlick, stopIOSFlick } from './iosFlickStop';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0.0.0';

const createFrameQueue = () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const view = {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      nextId += 1;
      frames.set(nextId, callback);
      return nextId;
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id);
    },
  };
  const stepFrame = () => {
    const due = [...frames.values()];
    frames.clear();
    due.forEach((callback) => callback(0));
  };
  return { view, frames, stepFrame };
};

const stubUserAgent = (userAgent: string) => {
  vi.stubGlobal('navigator', { userAgent, platform: '', maxTouchPoints: 0 });
};

describe('iosFlickStop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hides overflowY for two frames on iOS, tracks state, and restores the original value', () => {
    stubUserAgent(IPHONE);
    const { view, frames, stepFrame } = createFrameQueue();
    const element = document.createElement('div');
    element.style.overflowY = 'auto';

    expect(isIOSFlickStopped(element)).toBe(false);
    stopIOSFlick(element, view);
    expect(element.style.overflowY).toBe('hidden');
    expect(isIOSFlickStopped(element)).toBe(true);
    expect(frames.size).toBe(1);

    stepFrame();
    expect(element.style.overflowY).toBe('hidden');
    expect(isIOSFlickStopped(element)).toBe(true);
    expect(frames.size).toBe(1);

    stepFrame();
    expect(element.style.overflowY).toBe('auto');
    expect(isIOSFlickStopped(element)).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('preserves the true original overflowY across overlapping calls from two callers', () => {
    stubUserAgent(IPHONE);
    const { view, frames, stepFrame } = createFrameQueue();
    const element = document.createElement('div');
    element.style.overflowY = 'scroll';

    stopIOSFlick(element, view);
    stepFrame();
    expect(element.style.overflowY).toBe('hidden');

    // A second caller stops the same element before the first two-frame window ends.
    stopIOSFlick(element, view);
    expect(element.style.overflowY).toBe('hidden');
    expect(frames.size).toBe(1);

    // One frame after the second stop, the first stop's cancelled frame must not restore early.
    stepFrame();
    expect(element.style.overflowY).toBe('hidden');
    expect(isIOSFlickStopped(element)).toBe(true);

    // Two frames after the second stop, the true original value (not hidden) is restored.
    stepFrame();
    expect(element.style.overflowY).toBe('scroll');
    expect(isIOSFlickStopped(element)).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('prevents a stale cleanup from clobbering a newer flick-stop on the same element', () => {
    stubUserAgent(IPHONE);
    const { view, frames, stepFrame } = createFrameQueue();
    const element = document.createElement('div');
    element.style.overflowY = '';

    const cleanupFirst = stopIOSFlick(element, view);
    const cleanupSecond = stopIOSFlick(element, view);

    // Unmounting or cleaning up the first caller leaves the second caller's stop active.
    cleanupFirst();
    expect(element.style.overflowY).toBe('hidden');
    expect(isIOSFlickStopped(element)).toBe(true);
    expect(frames.size).toBe(1);

    // The active cleanup restores immediately and cancels its pending frame.
    cleanupSecond();
    expect(element.style.overflowY).toBe('');
    expect(isIOSFlickStopped(element)).toBe(false);
    expect(frames.size).toBe(0);

    // Re-stopping and restoring directly via restoreIOSFlick also clears cleanly.
    stopIOSFlick(element, view);
    expect(isIOSFlickStopped(element)).toBe(true);
    restoreIOSFlick(element);
    expect(element.style.overflowY).toBe('');
    expect(isIOSFlickStopped(element)).toBe(false);
    stepFrame();
    expect(frames.size).toBe(0);
  });

  it('is a no-op on non-iOS platforms without touching overflowY', () => {
    stubUserAgent(DESKTOP);
    const { view, frames } = createFrameQueue();
    const element = document.createElement('div');
    const overflowWrites = vi.fn();
    Object.defineProperty(element.style, 'overflowY', {
      get: () => 'auto',
      set: overflowWrites,
      configurable: true,
    });

    const cleanup = stopIOSFlick(element, view);
    expect(overflowWrites).not.toHaveBeenCalled();
    expect(isIOSFlickStopped(element)).toBe(false);
    expect(frames.size).toBe(0);

    cleanup();
    expect(overflowWrites).not.toHaveBeenCalled();
  });

  it('invokes onRestore exactly once on two-frame completion, supersession, and explicit cleanup', () => {
    stubUserAgent(IPHONE);
    const { view, stepFrame } = createFrameQueue();
    const element = document.createElement('div');
    element.style.overflowY = 'auto';

    // 1. Two-frame completion.
    const onRestoreComplete = vi.fn();
    const cleanupComplete = stopIOSFlick(element, view, onRestoreComplete);
    stepFrame();
    expect(onRestoreComplete).not.toHaveBeenCalled();
    stepFrame();
    expect(onRestoreComplete).toHaveBeenCalledTimes(1);
    cleanupComplete();
    expect(onRestoreComplete).toHaveBeenCalledTimes(1);

    // 2. Supersession by a second stopIOSFlick on the same element.
    const onRestoreFirst = vi.fn();
    const onRestoreSecond = vi.fn();
    const cleanupFirst = stopIOSFlick(element, view, onRestoreFirst);
    expect(onRestoreFirst).not.toHaveBeenCalled();
    const cleanupSecond = stopIOSFlick(element, view, onRestoreSecond);
    expect(onRestoreFirst).toHaveBeenCalledTimes(1);
    expect(onRestoreSecond).not.toHaveBeenCalled();
    // Stale first cleanup does not re-fire either callback.
    cleanupFirst();
    expect(onRestoreFirst).toHaveBeenCalledTimes(1);
    expect(onRestoreSecond).not.toHaveBeenCalled();

    // 3. Explicit cleanup on the active stop.
    cleanupSecond();
    expect(onRestoreSecond).toHaveBeenCalledTimes(1);
    cleanupSecond();
    stepFrame();
    stepFrame();
    expect(onRestoreSecond).toHaveBeenCalledTimes(1);
    expect(element.style.overflowY).toBe('auto');
  });
});
