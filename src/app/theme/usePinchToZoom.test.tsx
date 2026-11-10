// @vitest-environment jsdom

import { cleanup, render, renderHook } from '@testing-library/react';
import type FocusTrap from 'focus-trap-react';
import { type ComponentProps, type ReactNode, type RefObject, StrictMode, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageOverlay } from '../messages/content/ImageOverlay';
import {
  PINCH_SURFACE_ATTRIBUTE,
  type SurfacePinch,
  usePinchSurface,
  usePinchToZoom,
} from './usePinchToZoom';

// JSDOM lays nothing out, so every element counts as shown for the image viewer's focus trap.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});

/**
 * A finger: where it is, the element it landed on (the page body unless given), and its
 * identifier (its place in the list unless given).
 */
type Point = [x: number, y: number, target?: Element, identifier?: number];

/**
 * Dispatches a touch event at `at`, by default the last finger's element, with `touches` listing
 * every finger down.
 */
const touch = (
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  points: Point[],
  at?: Element
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = points.map(([x, y, target = document.body, identifier], place) => ({
    identifier: identifier ?? place,
    clientX: x,
    clientY: y,
    target,
  }));
  Object.defineProperty(event, 'touches', { value: touches });
  (at ?? touches[touches.length - 1]?.target ?? document.body).dispatchEvent(event);
  return event;
};

/**
 * Safari's gesture events: `scale` is the fingers' spread against the gesture's start, and
 * `clientX` and `clientY` where the gesture is.
 */
const gesture = (
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  at: Element = document.body,
  [clientX, clientY] = [0, 0]
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  at.dispatchEvent(event);
  return event;
};

// jsdom has no PointerEvent.
const pointer = (
  type: 'pointerdown' | 'pointerup' | 'pointercancel',
  at: Element = document.body,
  pointerId = 1,
  pointerType = 'touch'
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  at.dispatchEvent(event);
};

const wheel = (init: WheelEventInit, at: Element = document.body) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  at.dispatchEvent(event);
  return event;
};

/** Two fingers, one on `a` and one `distance` px below it on `b`. */
const spread = (a: Element, b: Element, distance: number): Point[] => [
  [0, 0, a],
  [0, distance, b],
];

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
    vi.useRealTimers();
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
        pointer('pointerdown', inside, 1);
        pointer('pointerdown', other, 2);
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
        pointer(type, document.body, 1);
        pointer(type, document.body, 2);

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
      pointer('pointerup', document.body, 1);
      pointer('pointerup', document.body, 2);
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
      pointer('pointercancel', surface, 1);
      pointer('pointercancel', surface, 2);
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
      pointer('pointerup', document.body, 1);
      pointer('pointerup', document.body, 2);
      // Two fingers land on the surface in one frame, its element goes, and the browser cancels
      // their pointers: the app judges the pinch again and finds it its own.
      touch('touchstart', spread(inside, surface, 100), inside);
      touch('touchstart', spread(inside, surface, 100), surface);
      inside.remove();
      pointer('pointercancel', surface, 1);
      pointer('pointercancel', surface, 2);
      touch('touchmove', spread(inside, surface, 150), surface);
      flushFrames();

      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('lets go of a pinch whose ends were lost after earlier pointer ends the window missed', () => {
      const { setPageZoom } = mount(100);
      const { inside, outside } = pinchSurface();

      // Two taps whose pointerups something stopped before the window.
      pointer('pointerdown', outside, 8);
      touch('touchstart', [[0, 0, outside]]);
      touch('touchend', [], outside);
      pointer('pointerdown', outside, 9);
      touch('touchstart', [[0, 0, outside]]);
      touch('touchend', [], outside);
      pointer('pointerdown', inside, 1);
      pointer('pointerdown', inside, 2);
      touch('touchstart', [[0, 0, inside]]);
      touch('touchstart', spread(inside, inside, 100));
      inside.remove();
      pointer('pointerup', document.body, 1);
      pointer('pointerup', document.body, 2);

      gesture('gesturestart', 1, outside);
      gesture('gesturechange', 1.5, outside);
      flushFrames();
      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it('lets go of its pinch when a finger whose element went lifts, and a finger beside it starts the next', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();

      pointer('pointerdown', inside, 1);
      touch('touchstart', [[0, 0, inside]]);
      pointer('pointerdown', surface, 2);
      touch('touchstart', spread(inside, surface, 100));
      inside.remove();
      // The first finger lifts: its pointer ends on the window, its touch end is lost.
      pointer('pointerup', document.body, 1);
      pointer('pointerdown', outside, 3);
      touch(
        'touchstart',
        [
          [0, 0, surface],
          [0, 100, outside],
        ],
        outside
      );
      const move = touch('touchmove', [
        [0, 0, surface],
        [0, 150, outside],
      ]);
      flushFrames();

      expect(move.defaultPrevented).toBe(true);
      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it('starts no gesture from the start of one whose ends were lost', () => {
      const { setPageZoom } = mount(100);
      const { inside } = pinchSurface();
      const page = document.createElement('div');
      const row = document.createElement('p');
      page.append(row);
      document.body.append(page);

      // The page's pinch: its gesture starts, then the element under both fingers goes.
      pointer('pointerdown', row, 1);
      pointer('pointerdown', row, 2);
      touch('touchstart', [[0, 0, row]]);
      touch('touchstart', spread(row, row, 100));
      gesture('gesturestart', 1, row);
      row.remove();
      pointer('pointerup', document.body, 1);
      pointer('pointerup', document.body, 2);
      // A later pinch's gesturestart goes to an element that goes at once.
      const change = gesture('gesturechange', 1.5, inside);
      flushFrames();

      expect(change.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('starts no gesture from the start of a pinch that the next touch shows ended', () => {
      const { setPageZoom } = mount(100);
      const { inside, outside } = pinchSurface();

      // The page's pinch and its gesture; their ends are lost, and no pointer event comes.
      touch('touchstart', [[0, 0, outside]]);
      touch('touchstart', spread(outside, outside, 100));
      gesture('gesturestart', 1, outside);
      // A finger lands alone: that pinch is over.
      touch('touchstart', [[0, 0, inside]]);
      const change = gesture('gesturechange', 1.5, inside);
      flushFrames();

      expect(change.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('keeps zooming the page through a trackpad pinch while a mouse button comes and goes', () => {
      const { setPageZoom } = mount(100);
      const { outside } = pinchSurface();

      gesture('gesturestart', 1, outside);
      pointer('pointerdown', outside, 7, 'mouse');
      pointer('pointerup', outside, 7, 'mouse');
      gesture('gesturechange', 1.5, outside);
      flushFrames();

      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it('keeps its pinch while a finger beside it or a mouse comes and goes', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside, outside } = pinchSurface();

      pointer('pointerdown', inside, 1);
      touch('touchstart', [[0, 0, inside]]);
      pointer('pointerdown', surface, 2);
      touch('touchstart', spread(inside, surface, 100));
      pointer('pointerdown', outside, 7, 'mouse');
      pointer('pointerup', outside, 7, 'mouse');
      pointer('pointerdown', outside, 3);
      touch('touchstart', [...spread(inside, surface, 100), [200, 0, outside]], outside);
      const move = touch('touchmove', [...spread(inside, surface, 150), [200, 0, outside]]);
      // One of the surface's fingers comes up: two fingers stay down, one of them beside it.
      pointer('pointerup', surface, 1);
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

    // Chromium sends a finger's pointer event before its touch event; other orders count it once too.
    it.each([
      ['pointer events first', true],
      ['touch events first', false],
    ])(
      'leaves the app a pinch that starts with a finger beside it, after that finger comes up, with %s',
      (_, pointerFirst) => {
        const { setPageZoom } = mount(100);
        const { surface, inside, outside } = pinchSurface();

        pointer('pointerdown', outside, 1);
        touch('touchstart', [[200, 0, outside]]);
        pointer('pointerdown', inside, 2);
        touch('touchstart', [
          [200, 0, outside],
          [0, 0, inside],
        ]);
        pointer('pointerdown', surface, 3);
        touch('touchstart', [[200, 0, outside], ...spread(inside, surface, 100)], surface);
        if (pointerFirst) pointer('pointerup', outside, 1);
        touch('touchend', spread(inside, surface, 100), outside);
        if (!pointerFirst) pointer('pointerup', outside, 1);
        const move = touch('touchmove', spread(inside, surface, 150));
        flushFrames();

        expect(move.defaultPrevented).toBe(true);
        expect(setPageZoom).toHaveBeenCalledWith(150);
      }
    );

    it("gives the app the gestures of its pinch, also those sent to the surface's element", () => {
      const { setPageZoom } = mount(100);
      const { inside, outside } = pinchSurface();

      // Both fingers land in one frame, one on the surface; Safari then sends each finger's
      // element a gesturestart.
      touch('touchstart', spread(inside, outside, 100), inside);
      touch('touchstart', spread(inside, outside, 100), outside);
      gesture('gesturestart', 1, outside);
      const start = gesture('gesturestart', 1, inside);
      touch('touchmove', spread(inside, outside, 150));
      const change = gesture('gesturechange', 1.5, inside);
      flushFrames();

      expect(start.defaultPrevented).toBe(true);
      expect(change.defaultPrevented).toBe(true);
      expect(setPageZoom.mock.calls).toEqual([[150]]);
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

    it('gives a pinch to the marked element that holds all its fingers, a nested one or not', () => {
      const { setPageZoom } = mount(100);
      const { surface, inside } = pinchSurface();
      const [left, right] = [document.createElement('div'), document.createElement('div')];
      left.setAttribute(PINCH_SURFACE_ATTRIBUTE, '');
      right.setAttribute(PINCH_SURFACE_ATTRIBUTE, '');
      surface.append(left, right);

      // One finger on a marked child, one elsewhere on the surface; then one on each of two
      // marked children.
      for (const [a, b] of [
        [left, inside],
        [left, right],
      ] as const) {
        touch('touchstart', [[0, 0, a]]);
        touch('touchstart', spread(a, b, 100));
        const move = touch('touchmove', spread(a, b, 150));
        touch('touchend', [], a);
        expect(move.defaultPrevented).toBe(false);
      }
      flushFrames();

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

    // On a phone the viewer's frame is the whole screen, its safe-area padding included.
    it("is what the image viewer's frame is, so a pinch with a finger on its padding zooms no page", () => {
      const { setPageZoom } = mount(100);
      const { getByRole } = render(
        <ImageOverlay alt="harbor.jpg" src="blob:harbor" requestClose={() => undefined} />
      );
      const picture = getByRole('img', { name: 'harbor.jpg' });
      const frame = getByRole('dialog', { name: 'harbor.jpg' });

      touch('touchstart', [[0, 0, picture]]);
      touch('touchstart', spread(picture, frame, 100));
      const move = touch('touchmove', spread(picture, frame, 150));
      gesture('gesturestart', 1, frame);
      gesture('gesturechange', 1.5, frame);
      wheel({ ctrlKey: true, deltaY: -50 }, frame);
      flushFrames();

      expect(move.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });
  });

  describe('usePinchSurface', () => {
    /** An element that zooms itself, with a child, and what its onPinch was handed. */
    function Surface({
      label,
      pinches,
      children,
    }: {
      label: string;
      pinches: SurfacePinch[];
      children?: ReactNode;
    }) {
      const ref = useRef<HTMLDivElement>(null);
      usePinchSurface(ref, { onPinch: (pinch) => pinches.push(pinch) });
      return (
        <div ref={ref} data-testid={label}>
          <p data-testid={`${label} inside`} />
          {children}
        </div>
      );
    }

    /** A surface on the page, and an element beside it. */
    const renderSurface = () => {
      const pinches: SurfacePinch[] = [];
      const view = render(
        <>
          <Surface label="board" pinches={pinches} />
          <div data-testid="beside" />
        </>
      );
      return {
        pinches,
        surface: view.getByTestId('board'),
        inside: view.getByTestId('board inside'),
        outside: view.getByTestId('beside'),
        unmount: view.unmount,
      };
    };

    const handed = (phase: SurfacePinch['phase'], scale: number, x: number, y: number) => ({
      phase,
      scale,
      centre: { x, y },
    });

    it('stays a surface after StrictMode mounts it a second time', () => {
      mount(100);
      const pinches: SurfacePinch[] = [];
      const view = render(
        <StrictMode>
          <Surface label="board" pinches={pinches} />
        </StrictMode>
      );
      const surface = view.getByTestId('board');

      gesture('gesturestart', 1, surface);
      gesture('gesturechange', 1.2, surface);
      expect(surface.hasAttribute(PINCH_SURFACE_ATTRIBUTE)).toBe(true);
      expect(pinches.map(({ phase }) => phase)).toEqual(['start', 'move']);
    });

    it('marks its element as a pinch surface while it is mounted', () => {
      const { surface, unmount } = renderSurface();
      expect(surface.hasAttribute(PINCH_SURFACE_ATTRIBUTE)).toBe(true);
      unmount();
      expect(surface.hasAttribute(PINCH_SURFACE_ATTRIBUTE)).toBe(false);
    });

    it('hands it a pinch whose fingers all land on it, with its scale and centre, and keeps the page zoom', () => {
      const { setPageZoom } = mount(100);
      const { pinches, surface, inside } = renderSurface();

      touch('touchstart', [[0, 0, inside]]);
      touch('touchstart', spread(inside, surface, 100));
      const move = touch('touchmove', [
        [10, 0, inside],
        [10, 150, surface],
      ]);
      const start = gesture('gesturestart', 1, inside);
      const change = gesture('gesturechange', 1.5, inside);
      touch('touchend', [[10, 0, inside]], surface);
      touch('touchend', [], inside);
      gesture('gestureend', 1.5, inside);
      flushFrames();

      expect(pinches).toEqual([
        handed('start', 1, 0, 50),
        handed('move', 1.5, 10, 75),
        handed('end', 1.5, 10, 75),
      ]);
      // The page zoom keeps the web view from scrolling or magnifying the page.
      expect(move.defaultPrevented).toBe(true);
      expect(start.defaultPrevented).toBe(true);
      expect(change.defaultPrevented).toBe(true);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('leaves a one-finger touch on it alone', () => {
      mount(100);
      const { pinches, inside } = renderSurface();

      touch('touchstart', [[0, 0, inside]]);
      const move = touch('touchmove', [[0, 80, inside]]);
      touch('touchend', [], inside);

      expect(move.defaultPrevented).toBe(false);
      expect(pinches).toEqual([]);
    });

    it.each([
      ['on the surface', true],
      ['beside it', false],
    ])('hands it no pinch whose first finger lands %s and the other not', (_, insideFirst) => {
      const { setPageZoom } = mount(100);
      const { pinches, inside, outside } = renderSurface();
      const [first, second] = insideFirst ? [inside, outside] : [outside, inside];

      touch('touchstart', [[0, 0, first]]);
      touch('touchstart', spread(first, second, 100));
      touch('touchmove', spread(first, second, 150));
      touch('touchend', [], first);
      flushFrames();

      expect(pinches).toEqual([]);
      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it('hands a pinch only to the innermost surface that holds all its fingers', () => {
      mount(100);
      const outer: SurfacePinch[] = [];
      const inner: SurfacePinch[] = [];
      const view = render(
        <Surface label="outer" pinches={outer}>
          <Surface label="inner" pinches={inner} />
        </Surface>
      );
      const pinch = (a: Element, b: Element) => {
        touch('touchstart', [[0, 0, a]]);
        touch('touchstart', spread(a, b, 100));
        touch('touchmove', spread(a, b, 200));
        touch('touchend', [], a);
      };

      pinch(view.getByTestId('inner inside'), view.getByTestId('inner'));
      expect(inner.map(({ phase }) => phase)).toEqual(['start', 'move', 'end']);
      expect(outer).toEqual([]);

      inner.length = 0;
      pinch(view.getByTestId('inner inside'), view.getByTestId('outer inside'));
      expect(outer.map(({ phase }) => phase)).toEqual(['start', 'move', 'end']);
      expect(inner).toEqual([]);
    });

    it('hands no pinch to a surface inside a marked element without onPinch, nor zooms the page', () => {
      const { setPageZoom } = mount(100);
      const pinches: SurfacePinch[] = [];
      const view = render(
        <Surface label="board" pinches={pinches}>
          <div data-testid="marked" {...{ [PINCH_SURFACE_ATTRIBUTE]: '' }} />
        </Surface>
      );
      const marked = view.getByTestId('marked');

      touch('touchstart', [[0, 0, marked]]);
      touch('touchstart', spread(marked, marked, 100));
      const move = touch('touchmove', spread(marked, marked, 150));
      flushFrames();

      // The marked element keeps its pinch, and prevents its defaults itself, as before.
      expect(move.defaultPrevented).toBe(false);
      expect(pinches).toEqual([]);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it.each(['pointerup', 'pointercancel'] as const)(
      'ends its pinch once when the element under a finger goes and the pointers send %s, and the next starts afresh',
      (type) => {
        const { setPageZoom } = mount(100);
        const { pinches, surface, inside, outside } = renderSurface();

        pointer('pointerdown', inside, 1);
        touch('touchstart', [[0, 0, inside]]);
        pointer('pointerdown', surface, 2);
        touch('touchstart', spread(inside, surface, 100));
        inside.remove();
        // The first finger's touches go to the removed element; the second's still list both.
        touch('touchmove', spread(inside, surface, 120), surface);
        pointer(type, document.body, 1);
        pointer(type, document.body, 2);
        // The touch ends that come later end nothing more.
        touch('touchend', [[0, 0, inside]], surface);
        touch('touchend', [], surface);
        gesture('gestureend', 1.2, surface);
        expect(pinches).toEqual([
          handed('start', 1, 0, 50),
          handed('move', 1.2, 0, 60),
          handed('end', 1.2, 0, 60),
        ]);

        // The next pinch on the surface starts from its own fingers.
        pinches.length = 0;
        touch('touchstart', [[0, 0, surface]]);
        touch('touchstart', spread(surface, surface, 200));
        touch('touchmove', spread(surface, surface, 300));
        touch('touchend', [], surface);
        expect(pinches).toEqual([
          handed('start', 1, 0, 100),
          handed('move', 1.5, 0, 150),
          handed('end', 1.5, 0, 150),
        ]);

        // A pinch across its edge after one whose ends were lost is the app's.
        pinches.length = 0;
        touch('touchstart', [[0, 0, surface]]);
        touch('touchstart', spread(surface, outside, 100));
        touch('touchmove', spread(surface, outside, 150));
        flushFrames();
        expect(pinches).toEqual([]);
        expect(setPageZoom).toHaveBeenCalledWith(150);
      }
    );

    it('starts its pinch afresh when one of its two measured fingers is replaced, and ends it when one is left', () => {
      const { setPageZoom } = mount(100);
      const { pinches, surface, inside, outside } = renderSurface();

      touch('touchstart', [[0, 0, inside, 1]]);
      touch('touchstart', [
        [0, 0, inside, 1],
        [0, 100, surface, 2],
      ]);
      touch('touchmove', [
        [0, 0, inside, 1],
        [0, 200, surface, 2],
      ]);
      // A third finger lands beside it: the pinch stays the surface's, measured by the first two.
      touch(
        'touchstart',
        [
          [0, 0, inside, 1],
          [0, 200, surface, 2],
          [300, 200, outside, 3],
        ],
        outside
      );
      // The first finger lifts: the pinch goes on from the two left, without a jump.
      touch(
        'touchend',
        [
          [0, 200, surface, 2],
          [300, 200, outside, 3],
        ],
        inside
      );
      touch('touchmove', [
        [0, 200, surface, 2],
        [600, 200, outside, 3],
      ]);
      // One finger is left: the pinch ends.
      touch('touchend', [[600, 200, outside, 3]], surface);
      flushFrames();

      expect(pinches).toEqual([
        handed('start', 1, 0, 50),
        handed('move', 2, 0, 100),
        handed('end', 2, 0, 100),
        handed('start', 1, 150, 200),
        handed('move', 2, 300, 200),
        handed('end', 2, 300, 200),
      ]);
      expect(setPageZoom).not.toHaveBeenCalled();

      // A finger lands beside it while the one left stays: a new pinch, across its edge: the app's.
      pinches.length = 0;
      touch(
        'touchstart',
        [
          [600, 200, outside, 3],
          [0, 200, surface, 4],
        ],
        surface
      );
      touch('touchmove', [
        [600, 200, outside, 3],
        [-300, 200, surface, 4],
      ]);
      flushFrames();
      expect(pinches).toEqual([]);
      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it('keeps the browser from zooming for its pinch by a gesture sent beside it, and measures the fingers left when the second lifts', () => {
      const { setPageZoom } = mount(100);
      const { pinches, surface, inside, outside } = renderSurface();

      touch('touchstart', [[0, 0, inside, 1]]);
      touch('touchstart', [
        [0, 0, inside, 1],
        [0, 100, surface, 2],
      ]);
      touch(
        'touchstart',
        [
          [0, 0, inside, 1],
          [0, 100, surface, 2],
          [0, 50, outside, 3],
        ],
        outside
      );
      // Safari sends the third finger's element a gesture of its own.
      const start = gesture('gesturestart', 1, outside);
      // The second finger lifts: the first and the third are measured from here.
      touch(
        'touchend',
        [
          [0, 0, inside, 1],
          [0, 50, outside, 3],
        ],
        surface
      );
      touch('touchmove', [
        [0, 0, inside, 1],
        [0, 100, outside, 3],
      ]);
      flushFrames();

      expect(start.defaultPrevented).toBe(true);
      expect(pinches).toEqual([
        handed('start', 1, 0, 50),
        handed('end', 1, 0, 50),
        handed('start', 1, 0, 25),
        handed('move', 2, 0, 50),
      ]);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it("hands it iOS's pinch whose gesture starts before the second finger's touch, without a jump at a third finger", () => {
      const { setPageZoom } = mount(100);
      const { pinches, surface, inside, outside } = renderSurface();

      touch('touchstart', [[0, 0, inside]]);
      const start = gesture('gesturestart', 1, inside);
      touch('touchstart', spread(inside, surface, 100));
      touch('touchmove', spread(inside, surface, 150));
      gesture('gesturechange', 1.5, inside);
      // A third finger lands beside it.
      touch(
        'touchstart',
        [
          [0, 0, inside],
          [0, 150, surface],
          [200, 0, outside],
        ],
        outside
      );
      const move = touch('touchmove', [
        [0, 0, inside],
        [0, 180, surface],
        [220, 0, outside],
      ]);
      const change = gesture('gesturechange', 1.8, inside);
      flushFrames();

      expect(pinches).toEqual([
        handed('start', 1, 0, 50),
        handed('move', 1.5, 0, 75),
        handed('move', 1.8, 0, 90),
      ]);
      expect(start.defaultPrevented).toBe(true);
      expect(move.defaultPrevented).toBe(true);
      expect(change.defaultPrevented).toBe(true);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it.each([
      ['two fingers land at once', false],
      ['a finger lands again after its pointer ended the pinch', true],
    ])(
      "hands it no gesture of an iOS pinch that its touches make the app's, when %s",
      (_, regrip) => {
        const { setPageZoom } = mount(100);
        const { pinches, inside, outside } = renderSurface();
        if (regrip) {
          // The page's pinch; one finger lifts, its touch end first, and lands again.
          pointer('pointerdown', outside, 1);
          pointer('pointerdown', inside, 2);
          touch('touchstart', [
            [0, 0, outside, 1],
            [0, 100, inside, 2],
          ]);
          touch('touchend', [[0, 100, inside, 2]], outside);
          pointer('pointerup', outside, 1);
        }
        // Safari's gesture comes before the touch that shows the pinch's fingers.
        gesture('gesturestart', 1, inside);
        touch('touchstart', [
          [0, 0, outside, 3],
          [0, 100, inside, 2],
        ]);
        touch('touchmove', [
          [0, 0, outside, 3],
          [0, 150, inside, 2],
        ]);
        gesture('gesturechange', 1.5, inside);
        flushFrames();

        // The touches show the pinch is the app's before the gesture changes.
        expect(pinches).toEqual([]);
        expect(setPageZoom).toHaveBeenCalledWith(150);
      }
    );

    it("hands it a trackpad's pinch over it, and leaves the page one beside it", () => {
      const { setPageZoom } = mount(100);
      const { pinches, inside, outside } = renderSurface();

      const start = gesture('gesturestart', 1, inside, [40, 30]);
      gesture('gesturechange', 1.5, inside, [42, 31]);
      const change = gesture('gesturechange', 1.8, inside, [43, 32]);
      gesture('gestureend', 1.8, inside, [43, 32]);
      flushFrames();
      expect(pinches).toEqual([
        handed('start', 1, 40, 30),
        handed('move', 1.5, 42, 31),
        handed('move', 1.8, 43, 32),
        handed('end', 1.8, 43, 32),
      ]);
      expect(start.defaultPrevented).toBe(true);
      expect(change.defaultPrevented).toBe(true);
      expect(setPageZoom).not.toHaveBeenCalled();

      // One that ends before it changes is nothing.
      pinches.length = 0;
      gesture('gesturestart', 1, inside);
      gesture('gestureend', 1, inside);
      gesture('gesturechange', 1.5, inside);
      expect(pinches).toEqual([]);

      // A gesture whose end is lost ends as the next one starts, beside it.
      pinches.length = 0;
      gesture('gesturestart', 1, inside, [40, 30]);
      gesture('gesturechange', 1.2, inside, [40, 30]);
      gesture('gesturestart', 1, outside);
      gesture('gesturechange', 1.5, outside);
      expect(pinches).toEqual([
        handed('start', 1, 40, 30),
        handed('move', 1.2, 40, 30),
        handed('end', 1.2, 40, 30),
      ]);
      gesture('gestureend', 1.5, outside);
      flushFrames();
      expect(setPageZoom).toHaveBeenCalledWith(150);
    });

    it('scales nothing from fingers that land on one point', () => {
      mount(100);
      const { pinches, surface } = renderSurface();

      touch('touchstart', [[0, 0, surface]]);
      touch('touchstart', spread(surface, surface, 0));
      touch('touchmove', spread(surface, surface, 50));

      expect(pinches).toEqual([handed('start', 1, 0, 0)]);
    });

    it('ends the pinch it handed when the page zoom goes', () => {
      const { unmount } = mount(100);
      const { pinches, inside } = renderSurface();

      gesture('gesturestart', 1, inside, [40, 30]);
      gesture('gesturechange', 1.2, inside, [40, 30]);
      unmount();

      expect(pinches).toEqual([
        handed('start', 1, 40, 30),
        handed('move', 1.2, 40, 30),
        handed('end', 1.2, 40, 30),
      ]);
    });

    it('hands it ctrl and the wheel over it as one pinch, which ends once the wheel rests', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { setPageZoom } = mount(100);
      const { pinches, inside, outside } = renderSurface();

      const first = wheel({ ctrlKey: true, deltaY: -50, clientX: 40, clientY: 30 }, inside);
      vi.advanceTimersByTime(100);
      wheel({ ctrlKey: true, deltaY: -50, clientX: 40, clientY: 30 }, inside);
      // Without ctrl the wheel scrolls, as before.
      const plain = wheel({ deltaY: -50 }, inside);
      vi.advanceTimersByTime(100);
      expect(pinches.map(({ phase }) => phase)).toEqual(['start', 'move', 'move']);
      vi.advanceTimersByTime(200);
      flushFrames();

      expect(pinches).toEqual([
        handed('start', 1, 40, 30),
        handed('move', Math.exp(0.5), 40, 30),
        handed('move', Math.exp(0.5) ** 2, 40, 30),
        handed('end', Math.exp(0.5) ** 2, 40, 30),
      ]);
      expect(first.defaultPrevented).toBe(true);
      expect(plain.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();

      // Ctrl and the wheel beside it zoom the page, and end nothing more.
      pinches.length = 0;
      wheel({ ctrlKey: true, deltaY: -50 }, outside);
      vi.advanceTimersByTime(500);
      flushFrames();
      expect(pinches).toEqual([]);
      expect(setPageZoom).toHaveBeenCalledWith(101);
    });

    it('ends a wheel pinch on one surface before it hands the next pinch to another', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      mount(100);
      const first: SurfacePinch[] = [];
      const second: SurfacePinch[] = [];
      const view = render(
        <>
          <Surface label="first" pinches={first} />
          <Surface label="second" pinches={second} />
        </>
      );

      wheel({ ctrlKey: true, deltaY: -50 }, view.getByTestId('first'));
      gesture('gesturestart', 1, view.getByTestId('second'));
      gesture('gesturechange', 1.2, view.getByTestId('second'));
      // The wheel's rest ends no pinch but its own.
      vi.advanceTimersByTime(500);

      expect(first.map(({ phase }) => phase)).toEqual(['start', 'move', 'end']);
      expect(second.map(({ phase }) => phase)).toEqual(['start', 'move']);

      // The wheel goes on over the other surface before it rests: a pinch of that one's.
      gesture('gestureend', 1, view.getByTestId('second'));
      first.length = 0;
      second.length = 0;
      wheel({ ctrlKey: true, deltaY: -50 }, view.getByTestId('first'));
      wheel({ ctrlKey: true, deltaY: -50 }, view.getByTestId('second'));
      expect(first.map(({ phase }) => phase)).toEqual(['start', 'move', 'end']);
      expect(second).toEqual([handed('start', 1, 0, 0), handed('move', Math.exp(0.5), 0, 0)]);
    });

    it("ends a pinch with the callback of the element it went to when the hook's element changes or goes", () => {
      const calls: string[] = [];
      function Slide({ name }: { name: string }) {
        const ref = useRef<HTMLDivElement>(null);
        usePinchSurface(ref, { onPinch: ({ phase }) => calls.push(`${name} ${phase}`) });
        // Another slide is another element.
        return <div key={name} ref={ref} data-testid={name} />;
      }
      function Deck({ name, extra }: { name: string; extra?: boolean }) {
        return (
          <>
            <Slide name={name} />
            {extra && <Slide name="extra" />}
          </>
        );
      }
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      mount(100);
      const view = render(<Deck name="a" />);
      wheel({ ctrlKey: true, deltaY: -50 }, view.getByTestId('a'));
      view.rerender(<Deck name="b" />);
      vi.advanceTimersByTime(500);
      expect(calls).toEqual(['a start', 'a move', 'a end']);

      // A re-render with the same element, and another surface going, keep the pinch going.
      view.rerender(<Deck name="b" extra />);
      wheel({ ctrlKey: true, deltaY: -50 }, view.getByTestId('b'));
      view.rerender(<Deck name="b" />);
      wheel({ ctrlKey: true, deltaY: -50 }, view.getByTestId('b'));
      expect(calls.slice(3)).toEqual(['b start', 'b move', 'b move']);

      // Unmounted mid-pinch, it gets its end then, and nothing later.
      view.unmount();
      expect(calls.slice(6)).toEqual(['b end']);
      vi.advanceTimersByTime(500);
      expect(calls).toHaveLength(7);
    });

    it('hands nothing more of a touch pinch once its hook goes, though its element stays', () => {
      const { setPageZoom } = mount(100);
      const calls: string[] = [];
      function Zoom({ target }: { target: RefObject<HTMLDivElement> }) {
        usePinchSurface(target, { onPinch: ({ phase }) => calls.push(phase) });
        return null;
      }
      function Board({ zooms }: { zooms: boolean }) {
        const ref = useRef<HTMLDivElement>(null);
        return (
          <>
            <div ref={ref} data-testid="board" />
            {zooms && <Zoom target={ref} />}
          </>
        );
      }
      const view = render(<Board zooms />);
      const board = view.getByTestId('board');

      touch('touchstart', [[0, 0, board]]);
      touch('touchstart', spread(board, board, 100));
      touch('touchmove', spread(board, board, 150));
      view.rerender(<Board zooms={false} />);
      const move = touch('touchmove', spread(board, board, 200));
      flushFrames();

      expect(calls).toEqual(['start', 'move', 'end']);
      // The pinch stays the one its start decided, and the page zoom keeps out of it.
      expect(move.defaultPrevented).toBe(false);
      expect(setPageZoom).not.toHaveBeenCalled();
    });

    it('hands another element nothing of a touch pinch on the one its ref named before', () => {
      mount(100);
      const calls: string[] = [];
      function Canvases({ shown }: { shown: 'a' | 'b' }) {
        const ref = useRef<HTMLDivElement>(null);
        usePinchSurface(ref, { onPinch: ({ phase }) => calls.push(`${shown} ${phase}`) });
        // Both stay on the page, as while a panel switch animates; the ref names the one shown.
        return (
          <>
            <div ref={shown === 'a' ? ref : undefined} data-testid="a" />
            <div ref={shown === 'b' ? ref : undefined} data-testid="b" />
          </>
        );
      }
      const view = render(<Canvases shown="a" />);
      const a = view.getByTestId('a');

      touch('touchstart', [[0, 0, a]]);
      touch('touchstart', spread(a, a, 100));
      view.rerender(<Canvases shown="b" />);
      touch('touchmove', spread(a, a, 150));

      expect(calls).toEqual(['a start', 'a end']);
      expect(a.hasAttribute(PINCH_SURFACE_ATTRIBUTE)).toBe(false);
      expect(view.getByTestId('b').hasAttribute(PINCH_SURFACE_ATTRIBUTE)).toBe(true);
    });

    it('calls the newest onPinch, and nothing once the surface is gone', () => {
      mount(100);
      const calls: string[] = [];
      function Named({ name }: { name: string }) {
        const ref = useRef<HTMLDivElement>(null);
        usePinchSurface(ref, { onPinch: ({ phase }) => calls.push(`${name} ${phase}`) });
        return <div ref={ref} data-testid="named" />;
      }
      const view = render(<Named name="first" />);
      view.rerender(<Named name="second" />);
      const surface = view.getByTestId('named');

      gesture('gesturestart', 1, surface);
      gesture('gesturechange', 1, surface);
      gesture('gestureend', 1, surface);
      view.unmount();
      document.body.append(surface);
      gesture('gesturestart', 1, surface);
      gesture('gesturechange', 1, surface);

      expect(calls).toEqual(['second start', 'second move', 'second end']);
    });
  });
});
