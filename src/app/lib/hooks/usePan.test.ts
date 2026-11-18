import React, { type PointerEvent } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePan } from './usePan';

describe('usePan', () => {
  let renderer: ReactTestRenderer;
  let state: ReturnType<typeof usePan>;
  const target = { setPointerCapture: vi.fn() };
  const event = (pointerId: number, clientX = 0, clientY = 0, pointerType = 'touch', button = 0) =>
    ({
      pointerId,
      clientX,
      clientY,
      pointerType,
      button,
      currentTarget: target,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent<HTMLElement>);

  function Harness({ active }: { active: boolean }) {
    state = usePan(active);
    return null;
  }

  const mount = (active = true) => {
    act(() => {
      renderer = create(React.createElement(Harness, { active }));
    });
  };
  const activate = (active: boolean) => {
    act(() => {
      renderer.update(React.createElement(Harness, { active }));
    });
  };

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.clearAllMocks();
  });

  it('keeps the point it zooms around in place', () => {
    mount();
    act(() => state.setPan({ translateX: 10, translateY: -20 }));
    const at = { x: 60, y: 20 };
    // Content at offset (60, 20) sits 50 and 40 px from the image centre at zoom 1.5; at zoom 3
    // that becomes 100 and 80, so the centre moves to (60 - 100, 20 - 80).
    act(() => state.zoomAround({ from: 1.5, to: 3, at, before: at }));
    expect(state.pan).toEqual({ translateX: -40, translateY: -60 });
    act(() => state.zoomAround({ from: 3, to: 1.5, at, before: at }));
    expect(state.pan).toEqual({ translateX: 10, translateY: -20 });
  });

  it('moves the content under the fingers with them as they pinch', () => {
    mount();
    // At zoom 1 the content at (0, -10) lands at (0, -20) at zoom 2: the centre goes to (0, 0).
    act(() => state.zoomAround({ from: 1, to: 2, at: { x: 0, y: -20 }, before: { x: 0, y: -10 } }));
    expect(state.pan).toEqual({ translateX: 0, translateY: 0 });
  });

  it('recentres at fit, wherever the zoom aimed', () => {
    mount();
    const at = { x: 60, y: 20 };
    act(() => {
      state.zoomAround({ from: 1, to: 1.2, at, before: at });
      state.zoomAround({ from: 1.2, to: 1, at: { x: -90, y: 0 }, before: { x: -90, y: 0 } });
    });
    expect(state.pan).toEqual({ translateX: 0, translateY: 0 });
  });

  it('anchors a zoom aimed beside the image at its nearest edge', () => {
    mount();
    const size = { width: 100, height: 200 };
    // The cursor sits 150 px right of a 100 px wide image's centre: its right edge (50) stays,
    // and the image grows to its left, so its centre moves to -50.
    const at = { x: 150, y: 0 };
    act(() => state.zoomAround({ from: 1, to: 2, at, before: at }, size));
    expect(state.pan).toEqual({ translateX: -50, translateY: 0 });
  });

  it.each(['touch', 'mouse', 'pen'])('pans with %s using screen coordinates', (pointerType) => {
    mount();
    act(() => state.onPointerDown(event(1, 100, 200, pointerType)));
    act(() => state.onPointerMove(event(1, 140, 230, pointerType)));
    expect(state.pan).toEqual({ translateX: 40, translateY: 30 });
    expect(state.isPanning).toBe(true);
    act(() => state.onPointerUp(event(1, 140, 230, pointerType)));
    act(() => state.onPointerMove(event(1, 200, 300, pointerType)));
    expect(state.pan).toEqual({ translateX: 40, translateY: 30 });
    expect(state.isPanning).toBe(false);
  });

  it.each(['onPointerUp', 'onPointerCancel'] as const)(
    'suspends panning during pinch and resumes the remaining finger after %s',
    (handler) => {
      mount(false);
      act(() => state.onPointerDown(event(1, 100, 200)));
      act(() => state.onPointerDown(event(2, 200, 200)));
      activate(true);
      act(() => state.onPointerMove(event(1, 50, 200)));
      act(() => state.onPointerMove(event(2, 250, 200)));
      expect(state.pan).toEqual({ translateX: 0, translateY: 0 });
      expect(state.isPanning).toBe(false);
      act(() => state[handler](event(2, 250, 200)));
      act(() => state.onLostPointerCapture(event(2, 250, 200)));
      act(() => state.onPointerMove(event(1, 80, 240)));
      expect(state.pan).toEqual({ translateX: 30, translateY: 40 });
    }
  );

  it('can add a second finger while dragging without accumulating pinch movement', () => {
    mount();
    act(() => state.onPointerDown(event(1, 100, 200)));
    act(() => state.onPointerMove(event(1, 120, 210)));
    act(() => state.onPointerDown(event(2, 200, 200)));
    act(() => state.onPointerMove(event(1, 50, 200)));
    expect(state.pan).toEqual({ translateX: 20, translateY: 10 });
    expect(state.isPanning).toBe(false);
    act(() => state.onPointerUp(event(1, 50, 200)));
    act(() => state.onPointerMove(event(2, 210, 220)));
    expect(state.pan).toEqual({ translateX: 30, translateY: 30 });
  });

  it.each(['onPointerCancel', 'onLostPointerCapture'] as const)(
    'ends a drag on %s and allows a fresh drag',
    (handler) => {
      mount();
      act(() => state.onPointerDown(event(1, 100, 200)));
      act(() => state.onPointerMove(event(1, 120, 210)));
      act(() => state[handler](event(1, 120, 210)));
      act(() => state.onPointerMove(event(1, 500, 500)));
      expect(state.pan).toEqual({ translateX: 20, translateY: 10 });
      expect(state.isPanning).toBe(false);
      act(() => state.onPointerDown(event(2, 300, 300)));
      act(() => state.onPointerMove(event(2, 310, 320)));
      expect(state.pan).toEqual({ translateX: 30, translateY: 30 });
    }
  );

  it('resets the offset and ignores dragging when zoom returns to normal', () => {
    mount();
    act(() => state.onPointerDown(event(1, 100, 200)));
    act(() => state.onPointerMove(event(1, 140, 230)));
    activate(false);
    act(() => state.onPointerMove(event(1, 200, 300)));
    expect(state.pan).toEqual({ translateX: 0, translateY: 0 });
    expect(state.isPanning).toBe(false);
    expect(state.cursor).toBe('initial');
  });

  it('ignores secondary mouse buttons and pointers that did not start on the surface', () => {
    mount();
    act(() => state.onPointerDown(event(1, 100, 200, 'mouse', 2)));
    act(() => state.onPointerMove(event(1, 140, 230, 'mouse')));
    act(() => state.onPointerMove(event(2, 400, 500)));
    expect(state.pan).toEqual({ translateX: 0, translateY: 0 });
    expect(state.isPanning).toBe(false);
  });
});
