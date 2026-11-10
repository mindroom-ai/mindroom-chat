// @vitest-environment jsdom

import { cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from '../messages/viewers/ImageViewer';
import { PINCH_SURFACE_ATTRIBUTE, usePinchToZoom } from './usePinchToZoom';

/** A finger: where it is, and the element it landed on (the page body unless given). */
type Point = [x: number, y: number, target?: Element];

/**
 * Dispatches a touch event at `at`, by default the last finger's element, with `touches` listing
 * every finger down; a touch's identifier is its place in the list.
 */
const touch = (
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  points: Point[],
  at?: Element
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = points.map(([x, y, target = document.body], identifier) => ({
    identifier,
    clientX: x,
    clientY: y,
    target,
  }));
  Object.defineProperty(event, 'touches', { value: touches });
  (at ?? touches[touches.length - 1]?.target ?? document.body).dispatchEvent(event);
  return event;
};

/** Safari's gesture events: `scale` is the fingers' spread against the gesture's start. */
const gesture = (
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  at: Element = document.body
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  at.dispatchEvent(event);
  return event;
};

// jsdom has no PointerEvent.
const pointer = (
  type: 'pointerdown' | 'pointerup' | 'pointercancel',
  at: Element = document.body,
  pointerType = 'touch'
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  at.dispatchEvent(event);
};

const wheel = (init: WheelEventInit, at: Element = document.body) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  at.dispatchEvent(event);
  return event;
};

/** A marked element with something inside it, and an element beside it. */
const pinchSurface = () => {
  const surface = document.createElement('div');
  surface.setAttribute(PINCH_SURFACE_ATTRIBUTE, '');
  const inside = document.createElement('p');
  surface.append(inside);
  const outside = document.createElement('div');
  document.body.append(surface, outside);
  return { surface, inside, outside };
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
    cleanup();
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

  it('ignores a gesture change whose start it never saw, wherever it is', () => {
    const { setPageZoom } = mount(100);

    const change = gesture('gesturechange', 1.8);
    flushFrames();

    expect(change.defaultPrevented).toBe(false);
    expect(setPageZoom).not.toHaveBeenCalled();
  });

  describe('a pinch surface', () => {
    const spread = (a: Element, b: Element, distance: number): Point[] => [
      [0, 0, a],
      [0, distance, b],
    ];

    it('keeps a pinch whose fingers all land on it, and the gestures with it', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside } = pinchSurface();

      touch('touchstart', [[0, 0, inside]]);
      touch('touchstart', spread(inside, surface, 100));
      const move = touch('touchmove', spread(inside, surface, 150));
      const start = gesture('gesturestart', 1, inside);
      const change = gesture('gesturechange', 1.5, inside);
      flushFrames();

      expect(move.defaultPrevented).toBe(false);
      expect(start.defaultPrevented).toBe(false);
      expect(change.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it.each([
      ['on the surface', true],
      ['beside it', false],
    ])('leaves the app a pinch whose first finger lands %s and the other not', (_, insideFirst) => {
      const { setPageZoom } = mount(100);
      const { inside, outside } = pinchSurface();
      const [first, second] = insideFirst ? [inside, outside] : [outside, inside];

      touch('touchstart', [[0, 0, first]]);
      touch('touchstart', spread(first, second, 100));
      const move = touch('touchmove', spread(first, second, 150));
      flushFrames();

      expect(move.defaultPrevented).toBe(true);
      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    // WebKit sends one touchstart per element when fingers land in the same frame, each listing
    // both fingers; pointerdown comes before or after them.
    it.each([
      ['touch events first', 'both on the surface', true],
      ['pointer events first', 'both on the surface', true],
      ['touch events first', 'one beside it', false],
      ['pointer events first', 'one beside it', false],
    ])('judges fingers that land in one frame, with %s, %s', (order, _, bothInside) => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();
      const other = bothInside ? surface : outside;
      const landTouches = () => {
        touch('touchstart', spread(inside, other, 100), inside);
        touch('touchstart', spread(inside, other, 100), other);
      };
      const landPointers = () => {
        pointer('pointerdown', inside);
        pointer('pointerdown', other);
      };
      if (order === 'touch events first') {
        landTouches();
        landPointers();
      } else {
        landPointers();
        landTouches();
      }
      const move = touch('touchmove', spread(inside, other, 150));
      flushFrames();

      expect(move.defaultPrevented).toBe(!bothInside);
      if (bothInside) expect(setPageZoom).not.toHaveBeenCalled();
      else expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it('keeps its pinch when the element under a finger goes, and lets go after it', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();

      touch('touchstart', [[0, 0, inside]]);
      touch('touchstart', spread(inside, surface, 100));
      inside.remove();
      // The first finger's events go to the removed element and never reach the window; the
      // second finger's still list both, and a third finger lands on the surface.
      touch('touchmove', spread(inside, surface, 150), surface);
      touch('touchstart', [...spread(inside, surface, 150), [100, 0, surface]], surface);
      const move = touch(
        'touchmove',
        [...spread(inside, surface, 180), [100, 0, surface]],
        surface
      );
      // Its gesturestart went to the removed element too.
      const change = gesture('gesturechange', 1.8, surface);
      flushFrames();

      expect(move.defaultPrevented).toBe(false);
      expect(change.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();

      // The surface's fingers come up, the removed element's unseen, and the next pinch is the app's.
      touch('touchend', [[0, 0, inside]], surface);
      touch('touchstart', [[0, 0, outside]]);
      touch('touchstart', spread(outside, outside, 100));
      touch('touchmove', spread(outside, outside, 150));
      flushFrames();
      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it('lets a trackpad pinch beside it zoom after a pinch whose ends it never saw', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();

      touch('touchstart', [[0, 0, inside]]);
      touch('touchstart', spread(inside, inside, 100));
      // Every later touch event of both fingers goes to the removed element.
      inside.remove();

      // A trackpad pinch over the surface is its own, and one beside it is the app's.
      const onSurface = gesture('gesturestart', 1, surface);
      gesture('gesturechange', 1.5, surface);
      gesture('gestureend', 1.5, surface);
      flushFrames();
      expect(onSurface.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();

      const beside = gesture('gesturestart', 1, outside);
      gesture('gesturechange', 1.5, outside);
      flushFrames();
      expect(beside.defaultPrevented).toBe(true);
      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it.each(['pointerup', 'pointercancel'] as const)(
      'lets go of its pinch once each finger sends %s, though their touch ends were lost',
      (type) => {
        const { setPageZoom } = mount(100);
        const { inside, outside } = pinchSurface();

        touch('touchstart', [[0, 0, inside]]);
        touch('touchstart', spread(inside, inside, 100));
        inside.remove();
        // Pointer events reach the window once the element they went to is gone.
        pointer(type);
        pointer(type);

        gesture('gesturestart', 1, outside);
        gesture('gesturechange', 1.5, outside);
        flushFrames();
        expect(setPageZoom).toHaveBeenCalledWith(150);
      }
    );

    it.each(['touchend', 'touchcancel'] as const)(
      'lets go of its pinch at the %s that leaves one finger',
      (type) => {
        const { setPageZoom } = mount(100);
        const { surface, inside, outside } = pinchSurface();

        touch('touchstart', [[0, 0, inside]]);
        touch('touchstart', spread(inside, surface, 100));
        touch(type, [[0, 0, inside]], surface);
        touch(type, [], inside);

        gesture('gesturestart', 1, outside);
        gesture('gesturechange', 1.5, outside);
        flushFrames();
        expect(setPageZoom).toHaveBeenCalledWith(150);
      }
    );

    it('zooms nothing from an earlier pinch of the page whose ends were lost', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();

      // The page's pinch: both fingers' element goes, and only their pointers end.
      touch('touchstart', [[0, 0, outside]]);
      touch('touchstart', spread(outside, outside, 100));
      outside.remove();
      pointer('pointerup');
      pointer('pointerup');
      // Two fingers land on the surface in one frame.
      touch('touchstart', spread(inside, surface, 100), inside);
      touch('touchstart', spread(inside, surface, 100), surface);
      const move = touch('touchmove', spread(inside, surface, 150));
      flushFrames();

      expect(move.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('lets the app take fingers whose pointers the browser cancelled without a jump', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside } = pinchSurface();

      touch('touchstart', [[0, 0, inside]]);
      touch('touchstart', spread(inside, surface, 100));
      inside.remove();
      pointer('pointercancel', surface);
      pointer('pointercancel', surface);
      // The app judges the pinch again, and the removed element is on no surface now: the
      // page's pinch, which zooms only from a touch of its own.
      const move = touch('touchmove', spread(inside, surface, 150), surface);
      flushFrames();

      expect(move.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('takes no start from an earlier page pinch when the browser cancels the surface pinch', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();

      // The page's pinch: both fingers' element goes, and only their pointers end.
      touch('touchstart', [[0, 0, outside]]);
      touch('touchstart', spread(outside, outside, 100));
      outside.remove();
      pointer('pointerup');
      pointer('pointerup');
      // Two fingers land on the surface in one frame, its element goes, and the browser cancels
      // their pointers: the app judges the pinch again and finds it its own.
      touch('touchstart', spread(inside, surface, 100), inside);
      touch('touchstart', spread(inside, surface, 100), surface);
      inside.remove();
      pointer('pointercancel', surface);
      pointer('pointercancel', surface);
      touch('touchmove', spread(inside, surface, 150), surface);
      flushFrames();

      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('keeps its pinch while a finger beside it or a mouse comes and goes', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();

      touch('touchstart', [[0, 0, inside]]);
      touch('touchstart', spread(inside, surface, 100));
      pointer('pointerup', outside, 'mouse');
      pointer('pointerdown', outside);
      touch('touchstart', [...spread(inside, surface, 100), [200, 0, outside]], outside);
      const move = touch('touchmove', [...spread(inside, surface, 150), [200, 0, outside]]);
      // One of the surface's fingers comes up: two fingers stay down, one of them beside it.
      pointer('pointerup', surface);
      touch(
        'touchend',
        [
          [0, 0, inside],
          [200, 0, outside],
        ],
        surface
      );
      const later = touch('touchmove', [
        [0, 0, inside],
        [250, 0, outside],
      ]);
      flushFrames();

      expect(move.defaultPrevented).toBe(false);
      expect(later.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('leaves the app a pinch that starts with a finger beside it, after that finger comes up', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();

      touch('touchstart', [[200, 0, outside]]);
      touch('touchstart', [
        [200, 0, outside],
        [0, 0, inside],
      ]);
      touch('touchstart', [[200, 0, outside], ...spread(inside, surface, 100)], surface);
      pointer('pointerup', outside);
      touch('touchend', spread(inside, surface, 100), outside);
      const move = touch('touchmove', spread(inside, surface, 150));
      flushFrames();

      expect(move.defaultPrevented).toBe(true);
      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it('gives the surface the gestures of its pinch, wherever they are sent', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside } = pinchSurface();

      // A gesture that starts before the pinch is the surface's stops at it.
      touch('touchstart', [[0, 0, inside]]);
      gesture('gesturestart', 1);
      touch('touchstart', spread(inside, surface, 100));
      const change = gesture('gesturechange', 1.5);
      gesture('gestureend', 1.5);
      // One that starts during it never starts.
      touch('touchstart', spread(inside, surface, 100));
      const start = gesture('gesturestart', 1);
      gesture('gesturechange', 1.8);
      flushFrames();

      expect(change.defaultPrevented).toBe(false);
      expect(start.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('starts no trackpad pinch over it from the zoom of an earlier one that never ended', () => {
      const { setPageZoom } = mount(100);
      const { inside, outside } = pinchSurface();

      gesture('gesturestart', 1, outside);
      gesture('gesturechange', 1.5, outside);
      flushFrames();
      gesture('gesturestart', 1, inside);
      gesture('gesturechange', 1.2, inside);
      flushFrames();

      expect(setPageZoom.mock.calls).toEqual([[150]]);
    });

    it("gives iOS's gesture, which starts before the second finger's touch, to the surface", () => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();

      touch('touchstart', [[0, 0, inside]]);
      const start = gesture('gesturestart', 1, inside);
      touch('touchstart', spread(inside, surface, 100));
      touch('touchmove', spread(inside, surface, 150));
      gesture('gesturechange', 1.5, inside);
      // A third finger lands beside the surface.
      touch('touchstart', [...spread(inside, surface, 150), [200, 0, outside]], outside);
      touch('touchmove', [...spread(inside, surface, 180), [220, 0, outside]]);
      const change = gesture('gesturechange', 1.8, inside);
      flushFrames();

      expect(start.defaultPrevented).toBe(false);
      expect(change.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('leaves ctrl and the wheel over it alone, and zooms the page beside it', () => {
      const { setPageZoom } = mount(100);
      const { inside, outside } = pinchSurface();

      const over = wheel({ ctrlKey: true, deltaY: -50 }, inside);
      flushFrames();
      expect(over.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();

      const beside = wheel({ ctrlKey: true, deltaY: -50 }, outside);
      flushFrames();
      expect(beside.defaultPrevented).toBe(true);
      expect(setPageZoom).toHaveBeenCalledWith(101);
    });

    it('is what the image viewer is, so a pinch on the picture zooms the picture alone', () => {
      const { setPageZoom } = mount(100);
      const { getByRole } = render(
        <ImageViewer alt="harbor.jpg" src="blob:harbor" requestClose={() => undefined} />
      );
      const picture = getByRole('img', { name: 'harbor.jpg' });

      touch('touchstart', [[0, 0, picture]]);
      touch('touchstart', spread(picture, picture, 100));
      touch('touchmove', spread(picture, picture, 150));
      gesture('gesturestart', 1, picture);
      gesture('gesturechange', 1.5, picture);
      wheel({ ctrlKey: true, deltaY: -50 }, picture);
      flushFrames();

      expect(setPageZoom).not.toHaveBeenCalled();
    });
  });
});
