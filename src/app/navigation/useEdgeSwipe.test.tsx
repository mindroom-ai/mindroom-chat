// @vitest-environment jsdom
import { useRef } from 'react';
import { Provider, createStore } from 'jotai';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageViewerOpenAtom } from './imageViewerState';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';
import { useEdgeSwipe } from './useEdgeSwipe';

type Point = { clientX: number; clientY: number };

const touchEvent = (type: string, touches: Point[]) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  return event;
};

/**
 * One finger from `start` on `target` to `end`, then lifted (or cancelled, as iOS Safari does when
 * its own back gesture takes the touch); `beforeMove` and `beforeLift` run in between. Returns
 * whether the touchmove's default was prevented.
 */
const swipe = (
  target: Element,
  start: Point,
  end: Point,
  {
    fingers = 1,
    beforeMove,
    beforeLift,
    lift = 'touchend',
  }: {
    fingers?: number;
    beforeMove?: () => void;
    beforeLift?: () => void;
    lift?: 'touchend' | 'touchcancel';
  } = {}
) => {
  const many = (point: Point) => Array.from({ length: fingers }, () => point);
  const move = touchEvent('touchmove', many(end));
  act(() => {
    target.dispatchEvent(touchEvent('touchstart', many(start)));
    beforeMove?.();
    target.dispatchEvent(move);
    beforeLift?.();
    target.dispatchEvent(touchEvent(lift, []));
  });
  return move.defaultPrevented;
};

const FROM_EDGE: [Point, Point] = [
  { clientX: 12, clientY: 300 },
  { clientX: 96, clientY: 310 },
];

/** A layer portaled into `<body>`, as folds puts its overlays, menus and tooltips. */
const openLayer = (html: string): HTMLElement => {
  const layer = document.createElement('div');
  layer.innerHTML = html;
  document.body.append(layer);
  return layer;
};

/** Settings as `Modal500` opens it over the page. */
const SETTINGS = '<div role="dialog" aria-modal="true">Settings</div>';
const TOOLTIP = '<div role="tooltip">Back</div>';

function Viewer({ onSwipe, within }: { onSwipe: () => void; within: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeSwipe({ direction: 'back', onSwipe, within: within ? ref : undefined });
  return (
    <>
      {/* The viewer's own modal, a dialog in <body> as `ImageOverlay` renders it. */}
      <div ref={ref} role="dialog" aria-modal="true" data-testid="viewer" />
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
    store.set(imageViewerOpenAtom, true);
  });
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

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
      { fingers: 2 }
    );
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('still swipes over a dialog the viewer opened over, and with a tooltip shown', () => {
    openLayer(SETTINGS);
    renderViewer();
    openLayer(TOOLTIP);
    swipe(screen.getByTestId('viewer'), ...FROM_EDGE);
    expect(onSwipe).toHaveBeenCalledOnce();
  });

  it('leaves the swipe to a menu or dialog open over the viewer, also one that opens mid-drag', () => {
    renderViewer();
    const viewer = screen.getByTestId('viewer');
    const menu = openLayer('<div role="menu"></div>');
    swipe(viewer, ...FROM_EDGE);
    menu.remove();

    swipe(viewer, ...FROM_EDGE, { beforeMove: () => openLayer(SETTINGS) });
    document.body.lastElementChild?.remove();
    swipe(viewer, ...FROM_EDGE, { beforeLift: () => openLayer(SETTINGS) });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('closes nothing when iOS Safari takes the touch for its own back gesture', () => {
    renderViewer();
    swipe(screen.getByTestId('viewer'), ...FROM_EDGE, { lift: 'touchcancel' });
    expect(onSwipe).not.toHaveBeenCalled();
  });
});

function Page({ onSwipe }: { onSwipe: () => void }) {
  useEdgeSwipe({ direction: 'back', onSwipe });
  return <div data-testid="page" />;
}

describe('useEdgeSwipe under a layer in <body>', () => {
  const onSwipe = vi.fn();
  const renderPage = () => {
    render(
      <Provider store={createStore()}>
        <Page onSwipe={onSwipe} />
      </Provider>
    );
    return screen.getByTestId('page');
  };

  beforeEach(() => onSwipe.mockReset());
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it('leaves the page alone while Settings or a menu is open over it', () => {
    const page = renderPage();
    const settings = openLayer(SETTINGS);
    swipe(page, ...FROM_EDGE);
    swipe(settings, ...FROM_EDGE);
    settings.remove();
    const menu = openLayer('<div role="menu"></div>');
    swipe(page, ...FROM_EDGE);
    menu.remove();
    expect(onSwipe).not.toHaveBeenCalled();

    swipe(page, ...FROM_EDGE);
    expect(onSwipe).toHaveBeenCalledOnce();
  });

  it('drops a swipe a dialog opens over before the finger lifts', () => {
    const page = renderPage();
    swipe(page, ...FROM_EDGE, { beforeMove: () => openLayer(SETTINGS) });
    document.body.lastElementChild?.remove();
    swipe(page, ...FROM_EDGE, { beforeLift: () => openLayer(SETTINGS) });
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('never lets a tooltip block it, nor a dialog left in an inert page', () => {
    const page = renderPage();
    openLayer(TOOLTIP);
    openLayer(`<div inert>${SETTINGS}</div>`);
    swipe(page, ...FROM_EDGE);
    expect(onSwipe).toHaveBeenCalledOnce();
  });
});
