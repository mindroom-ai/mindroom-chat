// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachComputerTouchpad } from './computerTouchpad';
import { SCROLL_GAIN, pointerGain } from './touchpadGestures';
// noVNC's mouse capture, which its canvas takes on every mousedown. The package exports only RFB.
/* eslint-disable import/no-relative-packages */
import {
  releaseCapture,
  setCapture,
} from '../../../../node_modules/@novnc/novnc/core/util/events.js';
/* eslint-enable import/no-relative-packages */

type Finger = { id: number; x: number; y: number; on?: EventTarget };

type Recorded = {
  type: string;
  x: number;
  y: number;
  button: number;
  buttons: number;
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  event: Event;
};

const asTouches = (fingers: Finger[], fallback: EventTarget) =>
  fingers.map(({ id, x, y, on }) => ({
    identifier: id,
    clientX: x,
    clientY: y,
    target: on ?? fallback,
  }));

/**
 * Dispatches a touch event as a browser does: on the element the changed finger started on,
 * with `touches` listing every finger still down afterwards.
 */
const touch = (
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  on: Element,
  down: Finger[],
  time: number,
  changed: Finger[] = down
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = asTouches(down, on);
  Object.defineProperties(event, {
    touches: { value: touches },
    targetTouches: { value: touches.filter((item) => item.target === on) },
    changedTouches: { value: asTouches(changed, on) },
    timeStamp: { value: time },
  });
  on.dispatchEvent(event);
  return event;
};

const finger = (x: number, y: number, id = 1): Finger => ({ id, x, y });

describe('attachComputerTouchpad', () => {
  let wrapper: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let rect: { left: number; top: number; width: number; height: number };
  let recorded: Recorded[];
  let controlling: boolean;
  let detach: (() => void) | undefined;

  const record = (event: Event) => {
    const mouse = event as MouseEvent;
    const entry: Recorded = {
      type: event.type,
      x: mouse.clientX,
      y: mouse.clientY,
      button: mouse.button,
      buttons: mouse.buttons,
      event,
    };
    if (event instanceof WheelEvent) {
      entry.deltaX = event.deltaX;
      entry.deltaY = event.deltaY;
      entry.deltaMode = event.deltaMode;
    }
    recorded.push(entry);
  };

  const attach = () => {
    detach = attachComputerTouchpad(wrapper, { isControlling: () => controlling });
    return detach;
  };

  // A tap, so the next touch within the double-tap window starts a drag.
  const tap = (at: Finger, from: number, to: number) => {
    touch('touchstart', canvas, [at], from);
    touch('touchend', canvas, [], to, [at]);
  };

  const types = (entries = recorded) => entries.map((entry) => entry.type);

  beforeEach(() => {
    recorded = [];
    controlling = true;
    wrapper = document.createElement('div');
    canvas = document.createElement('canvas');
    wrapper.append(canvas);
    document.body.append(wrapper);
    rect = { left: 10, top: 20, width: 400, height: 250 };
    canvas.getBoundingClientRect = () =>
      ({
        ...rect,
        x: rect.left,
        y: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => undefined,
      } as DOMRect);
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'wheel']) {
      canvas.addEventListener(type, record);
    }
  });

  afterEach(() => {
    detach?.();
    detach = undefined;
    releaseCapture();
    document.getElementById('noVNC_mouse_capture_elem')?.remove();
    wrapper.remove();
  });

  it('moves a pointer from the canvas centre', () => {
    attach();
    touch('touchstart', canvas, [finger(100, 100)], 0);
    touch('touchmove', canvas, [finger(105, 100)], 10);
    expect(recorded).toEqual([]);

    // 15 px in 10 ms past the slop.
    touch('touchmove', canvas, [finger(120, 100)], 20);
    const first = 210 + 15 * pointerGain(1.5);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ type: 'mousemove', x: first, y: 145, buttons: 0 });
    expect(recorded[0].event).toBeInstanceOf(MouseEvent);
    expect(recorded[0].event.bubbles).toBe(true);
    expect(recorded[0].event.cancelable).toBe(true);

    // 1 px down in 20 ms: slow, so the base gain.
    touch('touchmove', canvas, [finger(120, 101)], 40);
    expect(recorded[1]).toMatchObject({
      type: 'mousemove',
      x: first,
      y: 145 + pointerGain(0.05),
      buttons: 0,
    });

    touch('touchend', canvas, [], 60, [finger(120, 101)]);
    expect(types()).toEqual(['mousemove', 'mousemove']);
  });

  it('clamps the pointer to the canvas', () => {
    attach();
    // A fast drag left and down, far past the canvas edges.
    touch('touchstart', canvas, [finger(300, 100)], 0);
    touch('touchmove', canvas, [finger(200, 300)], 10);
    expect(recorded.at(-1)).toMatchObject({ x: 10, y: 270 });
    touch('touchmove', canvas, [finger(100, 400)], 20);
    expect(recorded.at(-1)).toMatchObject({ x: 10, y: 270 });
    touch('touchend', canvas, [], 30, [finger(100, 400)]);

    // To the right edge, then the canvas shrinks (an orientation change or Expand).
    touch('touchstart', canvas, [finger(0, 100)], 1000);
    touch('touchmove', canvas, [finger(200, 100)], 1010);
    expect(recorded.at(-1)).toMatchObject({ x: 410 });
    rect = { ...rect, width: 200 };
    touch('touchmove', canvas, [finger(199, 100)], 1030);
    expect(recorded.at(-1)?.x).toBeLessThanOrEqual(210);
    expect(recorded.at(-1)?.x).toBeGreaterThan(200);
  });

  it('clicks at the pointer', () => {
    attach();
    // Move the pointer off the centre first.
    touch('touchstart', canvas, [finger(100, 100)], 0);
    touch('touchmove', canvas, [finger(130, 100)], 20);
    touch('touchend', canvas, [], 40, [finger(130, 100)]);
    const at = recorded.at(-1)!;
    recorded.length = 0;

    tap(finger(50, 50), 1000, 1050);
    expect(recorded).toEqual([
      expect.objectContaining({ type: 'mousedown', x: at.x, y: at.y, button: 0, buttons: 1 }),
      expect.objectContaining({ type: 'mouseup', x: at.x, y: at.y, button: 0, buttons: 0 }),
    ]);
  });

  it('shows the pointer before pressing where noVNC has not seen it', () => {
    attach();
    // No move yet: noVNC's touch cursor learns the position from a mousemove.
    tap(finger(50, 50), 0, 50);
    expect(recorded).toEqual([
      expect.objectContaining({ type: 'mousemove', x: 210, y: 145, buttons: 0 }),
      expect.objectContaining({ type: 'mousedown', x: 210, y: 145, buttons: 1 }),
      expect.objectContaining({ type: 'mouseup', x: 210, y: 145, buttons: 0 }),
    ]);

    // The canvas shrinks under the pointer: the next press moves it inside first.
    rect = { ...rect, width: 100, height: 100 };
    recorded.length = 0;
    tap(finger(50, 50), 1000, 1050);
    expect(recorded).toEqual([
      expect.objectContaining({ type: 'mousemove', x: 110, y: 120, buttons: 0 }),
      expect.objectContaining({ type: 'mousedown', x: 110, y: 120, buttons: 1 }),
      expect.objectContaining({ type: 'mouseup', x: 110, y: 120, buttons: 0 }),
    ]);
  });

  it('hands each release to noVNC while it holds the mouse capture', () => {
    attach();
    // As noVNC's canvas listener does: a press takes the capture, and no event bubbles on.
    const noVnc = (event: Event) => {
      event.stopPropagation();
      if (event.type === 'mousedown') setCapture(canvas);
    };
    for (const type of ['mousedown', 'mousemove', 'mouseup']) {
      canvas.addEventListener(type, noVnc);
    }
    const captured = () =>
      (document as Document & { captureElement?: Element | null }).captureElement;
    const overlay = () => document.getElementById('noVNC_mouse_capture_elem');

    tap(finger(100, 100), 0, 50);
    // The page-covering element is gone, so the next touch lands on the screen again.
    expect(captured()).toBeNull();
    expect(overlay()?.style.display).toBe('none');
    expect(recorded).toEqual([
      expect.objectContaining({ type: 'mousemove', x: 210, y: 145, buttons: 0 }),
      expect.objectContaining({ type: 'mousedown', x: 210, y: 145, buttons: 1 }),
      expect.objectContaining({ type: 'mouseup', x: 210, y: 145, button: 0, buttons: 0 }),
    ]);

    // A drag keeps the capture until the finger lifts.
    recorded.length = 0;
    touch('touchstart', canvas, [finger(100, 100)], 150);
    touch('touchmove', canvas, [finger(130, 100)], 170);
    expect(captured()).toBe(canvas);
    touch('touchend', canvas, [], 190, [finger(130, 100)]);
    expect(captured()).toBeNull();
    expect(types()).toEqual(['mousedown', 'mousemove', 'mouseup']);
    expect(recorded[2]).toMatchObject({ x: recorded[1].x, buttons: 0 });

    // A two-finger tap's right click too.
    touch('touchstart', canvas, [finger(100, 100, 1), finger(160, 100, 2)], 2000);
    touch('touchend', canvas, [], 2050, [finger(100, 100, 1), finger(160, 100, 2)]);
    expect(captured()).toBeNull();
    expect(recorded.at(-1)).toMatchObject({ type: 'mouseup', button: 2, buttons: 0 });
  });

  it('leaves releases on the canvas where the browser captures the mouse itself', () => {
    attach();
    // Firefox's Element.setCapture, which noVNC uses instead of covering the page.
    const nativeCapture = vi.fn();
    Object.defineProperty(canvas, 'setCapture', { value: nativeCapture });
    canvas.addEventListener('mousedown', () => setCapture(canvas));
    try {
      tap(finger(100, 100), 0, 50);
      expect(nativeCapture).toHaveBeenCalledOnce();
      expect(types()).toEqual(['mousemove', 'mousedown', 'mouseup']);
    } finally {
      (document as Document & { captureElement?: Element | null }).captureElement = null;
    }
  });

  it('right-clicks with two fingers', () => {
    attach();
    touch('touchstart', canvas, [finger(100, 100, 1)], 0);
    touch('touchstart', canvas, [finger(100, 100, 1), finger(160, 100, 2)], 30);
    touch('touchend', canvas, [finger(160, 100, 2)], 120, [finger(100, 100, 1)]);
    touch('touchend', canvas, [], 130, [finger(160, 100, 2)]);

    const presses = recorded.filter((entry) => entry.type !== 'mousemove');
    expect(presses).toEqual([
      expect.objectContaining({ type: 'mousedown', x: 210, y: 145, button: 2, buttons: 2 }),
      expect.objectContaining({ type: 'mouseup', x: 210, y: 145, button: 2, buttons: 0 }),
    ]);
  });

  it('drags with the left button held', () => {
    attach();
    tap(finger(100, 100), 0, 50);
    recorded.length = 0;

    touch('touchstart', canvas, [finger(100, 100)], 150);
    touch('touchmove', canvas, [finger(130, 100)], 170);
    touch('touchmove', canvas, [finger(150, 100)], 190);
    touch('touchend', canvas, [], 210, [finger(150, 100)]);

    expect(types()).toEqual(['mousedown', 'mousemove', 'mousemove', 'mouseup']);
    expect(recorded[0]).toMatchObject({ x: 210, y: 145, button: 0, buttons: 1 });
    expect(recorded[1]).toMatchObject({ buttons: 1 });
    expect(recorded[1].x).toBeGreaterThan(210);
    expect(recorded[2]).toMatchObject({ buttons: 1 });
    expect(recorded[3]).toMatchObject({ x: recorded[2].x, button: 0, buttons: 0 });

    // The button is up again for the next move.
    recorded.length = 0;
    touch('touchstart', canvas, [finger(100, 100)], 2000);
    touch('touchmove', canvas, [finger(130, 100)], 2020);
    expect(recorded).toEqual([expect.objectContaining({ type: 'mousemove', buttons: 0 })]);
  });

  it('scrolls at the pointer', () => {
    attach();
    touch('touchstart', canvas, [finger(100, 100, 1), finger(160, 100, 2)], 0);
    // Both fingers up by 30 px: the content scrolls down.
    touch('touchmove', canvas, [finger(100, 70, 1), finger(160, 70, 2)], 20);

    const wheels = recorded.filter((entry) => entry.type === 'wheel');
    expect(wheels).toHaveLength(1);
    expect(wheels[0].event).toBeInstanceOf(WheelEvent);
    expect(wheels[0]).toMatchObject({
      x: 210,
      y: 145,
      deltaX: 0,
      deltaY: 30 * SCROLL_GAIN,
      deltaMode: 0,
    });
    expect(wheels[0].event.bubbles).toBe(true);
    expect(wheels[0].event.cancelable).toBe(true);
  });

  it('leaves touches alone while watching', () => {
    controlling = false;
    attach();
    const noVncTouch = vi.fn();
    canvas.addEventListener('touchstart', noVncTouch);

    const start = touch('touchstart', canvas, [finger(100, 100)], 0);
    const move = touch('touchmove', canvas, [finger(140, 100)], 20);
    touch('touchend', canvas, [], 40, [finger(140, 100)]);
    tap(finger(100, 100), 1000, 1050);

    expect(noVncTouch).toHaveBeenCalledTimes(2);
    expect(start.defaultPrevented).toBe(false);
    expect(move.defaultPrevented).toBe(false);
    expect(recorded).toEqual([]);
  });

  it('leaves touches alone before noVNC made its canvas', () => {
    canvas.remove();
    attach();
    const start = touch('touchstart', wrapper, [finger(100, 100)], 0);
    expect(start.defaultPrevented).toBe(false);
  });

  it('stops noVNC from seeing touches while in control', () => {
    attach();
    const noVncTouch = vi.fn();
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      canvas.addEventListener(type, noVncTouch);
      wrapper.addEventListener(type, noVncTouch);
    }

    const events = [
      touch('touchstart', canvas, [finger(100, 100)], 0),
      touch('touchmove', canvas, [finger(140, 100)], 20),
      touch('touchend', canvas, [], 40, [finger(140, 100)]),
      touch('touchstart', canvas, [finger(100, 100)], 1000),
      touch('touchcancel', canvas, [], 1010, [finger(100, 100)]),
    ];

    expect(noVncTouch).not.toHaveBeenCalled();
    expect(events.every((event) => event.defaultPrevented)).toBe(true);
    expect(types()).toEqual(['mousemove']);
  });

  it('counts only the touches that began on the screen', () => {
    attach();
    const outside = document.createElement('button');
    document.body.append(outside);
    const stray = { ...finger(5, 5, 9), on: outside };

    // A finger resting outside the screen does not make this a two-finger gesture.
    touch('touchstart', canvas, [stray, finger(100, 100)], 0, [finger(100, 100)]);
    touch('touchmove', canvas, [stray, finger(130, 100)], 20, [finger(130, 100)]);
    expect(types()).toEqual(['mousemove']);
    touch('touchend', canvas, [stray], 40, [finger(130, 100)]);

    // A finger on the letterbox around the canvas is on the screen: this scrolls.
    // Each finger keeps the element it started on, so the margin finger is not among the
    // canvas finger's targetTouches.
    recorded.length = 0;
    const onCanvas = { ...finger(100, 100), on: canvas };
    const margin = { ...finger(300, 300, 2), on: wrapper };
    touch('touchstart', canvas, [stray, onCanvas], 1000, [onCanvas]);
    touch('touchstart', wrapper, [stray, onCanvas, margin], 1020, [margin]);
    touch('touchmove', canvas, [stray, { ...onCanvas, y: 60 }, { ...margin, y: 260 }], 1040, [
      { ...onCanvas, y: 60 },
    ]);
    expect(types()).toEqual(['wheel']);
    outside.remove();
  });

  it('releases a held drag on detach and on touchcancel', () => {
    const startDrag = (from: number) => {
      tap(finger(100, 100), from, from + 50);
      touch('touchstart', canvas, [finger(100, 100)], from + 150);
      touch('touchmove', canvas, [finger(130, 100)], from + 170);
      expect(recorded.at(-1)).toMatchObject({ type: 'mousemove', buttons: 1 });
    };
    const releases = () =>
      recorded.filter((entry) => entry.type === 'mouseup' && entry.button === 0).slice(1);

    const detachFirst = attach();
    startDrag(0);
    detachFirst();
    expect(releases()).toEqual([expect.objectContaining({ buttons: 0 })]);
    expect(recorded.at(-1)).toMatchObject({ type: 'mouseup', buttons: 0 });
    // Detached: touches pass through and nothing more is sent.
    const after = touch('touchstart', canvas, [finger(100, 100)], 1000);
    expect(after.defaultPrevented).toBe(false);
    expect(releases()).toHaveLength(1);

    recorded = [];
    attach();
    startDrag(5000);
    touch('touchcancel', canvas, [], 5200, [finger(130, 100)]);
    expect(releases()).toEqual([expect.objectContaining({ buttons: 0 })]);
    detach?.();
    detach = undefined;
    expect(releases()).toHaveLength(1);
  });

  it('releases a held drag once control ends', () => {
    attach();
    tap(finger(100, 100), 0, 50);
    touch('touchstart', canvas, [finger(100, 100)], 150);
    touch('touchmove', canvas, [finger(130, 100)], 170);
    recorded.length = 0;

    controlling = false;
    const move = touch('touchmove', canvas, [finger(160, 100)], 190);
    expect(move.defaultPrevented).toBe(false);
    expect(recorded).toEqual([expect.objectContaining({ type: 'mouseup', buttons: 0 })]);

    touch('touchend', canvas, [], 210, [finger(160, 100)]);
    detach?.();
    detach = undefined;
    expect(recorded).toHaveLength(1);
  });

  it('ignores its own synthetic events', () => {
    attach();
    touch('touchstart', canvas, [finger(100, 100)], 0);
    touch('touchmove', canvas, [finger(130, 100)], 20);
    expect(types()).toEqual(['mousemove']);

    // Dispatching the layer's own event again reaches noVNC and nothing else.
    const own = recorded[0].event;
    canvas.dispatchEvent(own);
    wrapper.dispatchEvent(own);
    expect(types()).toEqual(['mousemove', 'mousemove']);

    // A listener that answers the layer's move with a touch does not re-enter the gesture.
    recorded.length = 0;
    let answers = 0;
    canvas.addEventListener('mousemove', () => {
      if (answers >= 5) return;
      answers += 1;
      touch('touchmove', canvas, [finger(130 + 40 * answers, 100)], 20 + answers);
    });
    touch('touchmove', canvas, [finger(150, 100)], 40);
    expect(types()).toEqual(['mousemove']);
  });
});
