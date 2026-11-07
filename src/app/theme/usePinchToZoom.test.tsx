// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePinchToZoom } from './usePinchToZoom';

type Point = [x: number, y: number];

/** Dispatches a touch event from the page body, with `touches` listing every finger down. */
const touch = (type: 'touchstart' | 'touchmove' | 'touchend', points: Point[]) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: points.map(([x, y], identifier) => ({ identifier, clientX: x, clientY: y })),
  });
  document.body.dispatchEvent(event);
  return event;
};

/** Safari's gesture events: `scale` is the fingers' spread against the gesture's start. */
const gesture = (type: 'gesturestart' | 'gesturechange' | 'gestureend', scale: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  document.body.dispatchEvent(event);
  return event;
};

const wheel = (init: WheelEventInit) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
};

describe('usePinchToZoom', () => {
  let frames: FrameRequestCallback[];

  const flushFrames = () => {
    const pending = frames;
    frames = [];
    pending.forEach((frame) => frame(0));
  };

  const mount = (pageZoom = 100) => {
    const setPageZoom = vi.fn<(zoom: number) => void>();
    const hook = renderHook(() => usePinchToZoom(pageZoom, setPageZoom));
    return { setPageZoom, unmount: hook.unmount };
  };

  beforeEach(() => {
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
      frames.push(frame);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('sets the page zoom by how far a two-finger pinch spreads, once per frame', () => {
    const { setPageZoom } = mount(100);

    touch('touchstart', [[0, 0]]);
    touch('touchstart', [
      [0, 0],
      [0, 100],
    ]);
    touch('touchmove', [
      [0, 0],
      [0, 120],
    ]);
    const move = touch('touchmove', [
      [0, 0],
      [0, 150],
    ]);
    // The pinch is the app's: the web view neither scrolls nor magnifies.
    expect(move.defaultPrevented).toBe(true);
    expect(setPageZoom).not.toHaveBeenCalled();

    flushFrames();
    expect(setPageZoom).toHaveBeenCalledTimes(1);
    expect(setPageZoom).toHaveBeenCalledWith(150);
  });

  it('keeps a zoom the fingers reach while the last one is being stored', () => {
    const setPageZoom = vi.fn<(zoom: number) => void>();
    const { rerender } = renderHook(({ zoom }) => usePinchToZoom(zoom, setPageZoom), {
      initialProps: { zoom: 100 },
    });

    touch('touchstart', [
      [0, 0],
      [0, 100],
    ]);
    touch('touchmove', [
      [0, 0],
      [0, 140],
    ]);
    flushFrames();
    // The fingers move on before the stored 140 comes back as the page zoom.
    touch('touchmove', [
      [0, 0],
      [0, 150],
    ]);
    rerender({ zoom: 140 });
    flushFrames();

    expect(setPageZoom.mock.calls).toEqual([[140], [150]]);
  });

  it('keeps a pinch inside the page zoom range', () => {
    const { setPageZoom } = mount(100);

    touch('touchstart', [
      [0, 0],
      [0, 100],
    ]);
    touch('touchmove', [
      [0, 0],
      [0, 10],
    ]);
    flushFrames();

    expect(setPageZoom).toHaveBeenCalledWith(50);
  });

  it('leaves a one-finger move alone', () => {
    const { setPageZoom } = mount(100);

    touch('touchstart', [[0, 0]]);
    const move = touch('touchmove', [[0, 80]]);
    flushFrames();

    expect(move.defaultPrevented).toBe(false);
    expect(setPageZoom).not.toHaveBeenCalled();
  });

  it("follows Safari's gesture scale from the zoom the gesture started at", () => {
    const { setPageZoom } = mount(120);

    const start = gesture('gesturestart', 1);
    gesture('gesturechange', 0.75);
    flushFrames();
    gesture('gestureend', 0.75);

    expect(start.defaultPrevented).toBe(true);
    expect(setPageZoom).toHaveBeenCalledWith(90);
  });

  it('does not compound when iOS sends both the touches and the gesture of one pinch', () => {
    const { setPageZoom } = mount(100);

    touch('touchstart', [
      [0, 0],
      [0, 100],
    ]);
    gesture('gesturestart', 1);
    touch('touchmove', [
      [0, 0],
      [0, 130],
    ]);
    gesture('gesturechange', 1.3);
    flushFrames();
    touch('touchmove', [
      [0, 0],
      [0, 150],
    ]);
    gesture('gesturechange', 1.5);
    flushFrames();

    expect(setPageZoom.mock.calls).toEqual([[130], [150]]);
  });

  it('steps the page zoom with ctrl and the wheel, as a trackpad pinch sends it', () => {
    const { setPageZoom } = mount(100);

    const plain = wheel({ deltaY: -50 });
    flushFrames();
    expect(plain.defaultPrevented).toBe(false);
    expect(setPageZoom).not.toHaveBeenCalled();

    const pinch = wheel({ ctrlKey: true, deltaY: -50 });
    flushFrames();
    expect(pinch.defaultPrevented).toBe(true);
    expect(setPageZoom).toHaveBeenCalledWith(101);
  });

  it('leaves the pinch to an open image viewer', () => {
    const viewer = document.createElement('div');
    viewer.dataset.imageViewer = 'true';
    document.body.append(viewer);
    const { setPageZoom } = mount(100);

    touch('touchstart', [
      [0, 0],
      [0, 100],
    ]);
    const move = touch('touchmove', [
      [0, 0],
      [0, 150],
    ]);
    const start = gesture('gesturestart', 1);
    gesture('gesturechange', 1.5);
    flushFrames();

    expect(move.defaultPrevented).toBe(false);
    expect(start.defaultPrevented).toBe(false);
    expect(setPageZoom).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', () => {
    const { setPageZoom, unmount } = mount(100);
    unmount();

    touch('touchstart', [
      [0, 0],
      [0, 100],
    ]);
    touch('touchmove', [
      [0, 0],
      [0, 150],
    ]);
    flushFrames();

    expect(setPageZoom).not.toHaveBeenCalled();
  });
});
