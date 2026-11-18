import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useZoom, type ZoomAround } from './useZoom';

type Listener = (event: Event) => void;

class MockEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: AddEventListenerOptions | boolean
  ) {
    if (!listener) return;

    const fn =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<Listener>();
    current.add(fn);
    this.listeners.set(type, current);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    _options?: EventListenerOptions | boolean
  ) {
    if (!listener) return;

    const current = this.listeners.get(type);
    if (!current) return;

    for (const candidate of current) {
      if (candidate === listener) {
        current.delete(candidate);
      }
    }
  }

  // A 200 x 100 surface at (100, 50): its centre is (200, 100).
  getBoundingClientRect() {
    return { left: 100, top: 50, width: 200, height: 100 } as DOMRect;
  }

  dispatch(type: string, event: Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function HookHarness({
  onUpdate,
  onZoomAround,
}: {
  onUpdate: (state: ReturnType<typeof useZoom>) => void;
  onZoomAround?: ZoomAround;
}) {
  onUpdate(useZoom(0.2, undefined, undefined, onZoomAround));
  return null;
}

const createTouchList = (touches: Array<{ clientX: number; clientY: number }>) =>
  touches as unknown as TouchList;

describe('useZoom', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    vi.restoreAllMocks();
  });

  it('updates zoom from touch pinch gestures on the attached surface', () => {
    const zoomSurface = new MockEventTarget();
    let zoomState!: ReturnType<typeof useZoom>;

    act(() => {
      renderer = create(
        React.createElement(HookHarness, {
          onUpdate: (state) => {
            zoomState = state;
          },
        })
      );
    });

    act(() => {
      zoomState.zoomTargetRef(zoomSurface as unknown as HTMLElement);
    });

    const preventDefault = vi.fn();

    act(() => {
      zoomSurface.dispatch(
        'touchstart',
        {
          touches: createTouchList([
            { clientX: 0, clientY: 0 },
            { clientX: 0, clientY: 100 },
          ]),
        } as unknown as TouchEvent
      );
      zoomSurface.dispatch(
        'touchmove',
        {
          cancelable: true,
          preventDefault,
          touches: createTouchList([
            { clientX: 0, clientY: 0 },
            { clientX: 0, clientY: 150 },
          ]),
        } as unknown as TouchEvent
      );
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(zoomState.isZooming).toBe(true);
    expect(zoomState.zoom).toBeCloseTo(1.5);

    act(() => {
      zoomSurface.dispatch(
        'touchend',
        {
          touches: createTouchList([{ clientX: 0, clientY: 0 }]),
        } as unknown as TouchEvent
      );
    });

    expect(zoomState.isZooming).toBe(false);
  });

  it('aims a modifier wheel zoom at the cursor, step after step between renders', () => {
    const zoomSurface = new MockEventTarget();
    const onZoomAround = vi.fn<ZoomAround>();
    let zoomState!: ReturnType<typeof useZoom>;
    act(() => {
      renderer = create(
        React.createElement(HookHarness, {
          onUpdate: (state) => {
            zoomState = state;
          },
          onZoomAround,
        })
      );
    });
    act(() => {
      zoomState.zoomTargetRef(zoomSurface as unknown as HTMLElement);
    });
    const wheel = (deltaY: number, modifier: Partial<WheelEvent>) =>
      ({ deltaY, clientX: 250, clientY: 80, preventDefault: vi.fn(), ...modifier } as WheelEvent);

    act(() => {
      zoomSurface.dispatch('wheel', wheel(-100, { metaKey: true }));
      zoomSurface.dispatch('wheel', wheel(-100, { ctrlKey: true }));
      zoomSurface.dispatch('wheel', wheel(-100, {}));
    });

    const at = { x: 50, y: -20 };
    expect(zoomState.zoom).toBe(1.4);
    expect(onZoomAround.mock.calls).toEqual([
      [{ from: 1, to: 1.2, at, before: at }],
      [{ from: 1.2, to: 1.4, at, before: at }],
    ]);
  });

  it('lands on exactly 1 when stepping back to fit', () => {
    let zoomState!: ReturnType<typeof useZoom>;
    act(() => {
      renderer = create(
        React.createElement(HookHarness, {
          onUpdate: (state) => {
            zoomState = state;
          },
        })
      );
    });
    act(() => zoomState.setZoom(2));
    for (let i = 0; i < 5; i += 1) act(() => zoomState.zoomOut());
    expect(zoomState.zoom).toBe(1);
  });

  it('aims a pinch at the middle of the fingers, and stays quiet at the limit', () => {
    const zoomSurface = new MockEventTarget();
    const onZoomAround = vi.fn<ZoomAround>();
    let zoomState!: ReturnType<typeof useZoom>;
    act(() => {
      renderer = create(
        React.createElement(HookHarness, {
          onUpdate: (state) => {
            zoomState = state;
          },
          onZoomAround,
        })
      );
    });
    act(() => {
      zoomState.zoomTargetRef(zoomSurface as unknown as HTMLElement);
    });
    // The first finger stays put; the second moves away from it.
    const touches = (spread: number) =>
      createTouchList([
        { clientX: 120, clientY: 60 },
        { clientX: 120, clientY: 60 + spread },
      ]);

    act(() => {
      zoomSurface.dispatch('touchstart', { touches: touches(20) } as unknown as TouchEvent);
      zoomSurface.dispatch('touchmove', {
        cancelable: true,
        preventDefault: vi.fn(),
        touches: touches(40),
      } as unknown as TouchEvent);
    });
    expect(onZoomAround).toHaveBeenLastCalledWith({
      from: 1,
      to: 2,
      at: { x: -80, y: -20 },
      before: { x: -80, y: -30 },
    });

    act(() => {
      zoomSurface.dispatch('touchmove', {
        cancelable: true,
        preventDefault: vi.fn(),
        touches: touches(400),
      } as unknown as TouchEvent);
      zoomSurface.dispatch('touchmove', {
        cancelable: true,
        preventDefault: vi.fn(),
        touches: touches(500),
      } as unknown as TouchEvent);
    });
    expect(zoomState.zoom).toBe(5);
    expect(onZoomAround).toHaveBeenCalledTimes(2);
  });

  it('clamps touch pinch zoom to the configured maximum', () => {
    const zoomSurface = new MockEventTarget();
    let zoomState!: ReturnType<typeof useZoom>;

    act(() => {
      renderer = create(
        React.createElement(HookHarness, {
          onUpdate: (state) => {
            zoomState = state;
          },
        })
      );
    });

    act(() => {
      zoomState.zoomTargetRef(zoomSurface as unknown as HTMLElement);
    });

    act(() => {
      zoomSurface.dispatch(
        'touchstart',
        {
          touches: createTouchList([
            { clientX: 0, clientY: 0 },
            { clientX: 0, clientY: 100 },
          ]),
        } as unknown as TouchEvent
      );
      zoomSurface.dispatch(
        'touchmove',
        {
          cancelable: true,
          preventDefault: vi.fn(),
          touches: createTouchList([
            { clientX: 0, clientY: 0 },
            { clientX: 0, clientY: 600 },
          ]),
        } as unknown as TouchEvent
      );
    });

    expect(zoomState.zoom).toBe(5);
  });
});
