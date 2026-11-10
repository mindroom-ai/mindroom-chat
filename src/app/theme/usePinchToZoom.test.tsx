// @vitest-environment jsdom

import { cleanup, render, renderHook } from '@testing-library/react';
import type FocusTrap from 'focus-trap-react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageOverlay } from '../messages/content/ImageOverlay';
import { PINCH_SURFACE_ATTRIBUTE, usePinchToZoom } from './usePinchToZoom';

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
});
