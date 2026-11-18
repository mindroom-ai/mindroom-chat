// @vitest-environment jsdom
import { useRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageViewerOpenAtom } from './imageViewerState';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';
import { useEdgeSwipe } from './useEdgeSwipe';

// The viewer's own modal sits in the portal container while it is open.
const portal = vi.hoisted(() => ({ blocking: true }));
vi.mock('../lib/portalOverlay', () => ({ hasBlockingPortalOverlay: () => portal.blocking }));

type Point = { clientX: number; clientY: number };

const touchEvent = (type: string, touches: Point[]) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  return event;
};

/** One finger from `start` on `target` to `end`, then lifted; the touchmove's default prevented. */
const swipe = (target: Element, start: Point, end: Point, fingers = 1) => {
  const many = (point: Point) => Array.from({ length: fingers }, () => point);
  const move = touchEvent('touchmove', many(end));
  act(() => {
    target.dispatchEvent(touchEvent('touchstart', many(start)));
    target.dispatchEvent(move);
    target.dispatchEvent(touchEvent('touchend', []));
  });
  return move.defaultPrevented;
};

function Viewer({ onSwipe, within }: { onSwipe: () => void; within: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeSwipe({ direction: 'back', onSwipe, within: within ? ref : undefined });
  return (
    <>
      <div ref={ref} data-testid="viewer" />
      <div data-testid="menu" />
    </>
  );
}

describe('useEdgeSwipe within an overlay', () => {
  const store = createStore();
  const onSwipe = vi.fn();
  const renderViewer = (within = true) =>
    render(
      <Provider store={store}>
        <Viewer onSwipe={onSwipe} within={within} />
      </Provider>
    );

  beforeEach(() => {
    onSwipe.mockReset();
    portal.blocking = true;
    store.set(imageViewerOpenAtom, true);
  });
  afterEach(cleanup);

  it('swipes from the left edge over the open viewer, whose overlay blocks the page swipes', () => {
    renderViewer();
    const viewer = screen.getByTestId('viewer');
    expect(swipe(viewer, { clientX: 12, clientY: 300 }, { clientX: 96, clientY: 310 })).toBe(true);
    expect(onSwipe).toHaveBeenCalledOnce();

    // A phone layer under the viewer does not stop it either.
    store.set(phoneNavDrawerOpenAtom, true);
    swipe(viewer, { clientX: 12, clientY: 300 }, { clientX: 96, clientY: 310 });
    expect(onSwipe).toHaveBeenCalledTimes(2);
    store.set(phoneNavDrawerOpenAtom, false);
  });

  it('keeps the page swipe off while the viewer is open', () => {
    renderViewer(false);
    swipe(
      screen.getByTestId('viewer'),
      { clientX: 12, clientY: 300 },
      { clientX: 96, clientY: 310 }
    );
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('leaves a touch that starts outside it (a menu over the viewer), off the edge, short, or drifting', () => {
    renderViewer();
    const viewer = screen.getByTestId('viewer');
    swipe(screen.getByTestId('menu'), { clientX: 12, clientY: 300 }, { clientX: 96, clientY: 310 });
    swipe(viewer, { clientX: 60, clientY: 300 }, { clientX: 200, clientY: 300 });
    swipe(viewer, { clientX: 12, clientY: 300 }, { clientX: 60, clientY: 300 });
    swipe(viewer, { clientX: 12, clientY: 300 }, { clientX: 96, clientY: 420 });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('never swipes with two fingers (a pinch)', () => {
    renderViewer();
    swipe(
      screen.getByTestId('viewer'),
      { clientX: 12, clientY: 300 },
      { clientX: 96, clientY: 310 },
      2
    );
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
