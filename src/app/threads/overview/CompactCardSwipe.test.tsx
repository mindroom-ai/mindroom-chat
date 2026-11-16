import React, { type ReactNode, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactCardSwipe, useCompactCardSwipeList } from './CompactCardSwipe';

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return { ...actual, Icon: () => null, Text: 'span' };
});

vi.mock('./CompactCardSwipe.css', () => ({
  SwipeAction: 'SwipeAction',
  SwipeList: 'SwipeList',
  SwipeTrack: 'SwipeTrack',
  SwipeTrackSettling: 'SwipeTrackSettling',
}));

const CARD_WIDTH = 300;
const VIEWPORT_WIDTH = 400;

type FakeTrack = {
  style: { transform: string };
  getBoundingClientRect: () => { width: number };
  setPointerCapture: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: () => void;
  ownerDocument: {
    visibilityState: 'visible' | 'hidden';
    addEventListener: (type: string, listener: (event: unknown) => void) => void;
    removeEventListener: () => void;
  };
};

/** The strip under the card that names the action. */
type FakeStrip = { style: { display: string } };

/** The element that holds the cards. */
type FakeList = {
  addEventListener: (type: string, listener: (event: unknown) => void, options: unknown) => void;
  removeEventListener: ReturnType<typeof vi.fn>;
  touchMoveListener?: (event: unknown) => void;
  touchMoveOptions?: unknown;
};

let track: FakeTrack;
let strip: FakeStrip;
let list: FakeList;
let documentTouchStarts: Array<(event: unknown) => void>;
let documentListeners: Record<string, Array<(event: unknown) => void>>;
/** Tells the document's listeners of `type`, as the browser tells them of every touch. */
const tellDocument = (type: string, event: Record<string, unknown> = {}) =>
  act(() => (documentListeners[type] ?? []).forEach((listener) => listener({ type, ...event })));
let direction: 'ltr' | 'rtl';
let renderers: ReactTestRenderer[];

beforeEach(() => {
  track = {
    style: { transform: '' },
    getBoundingClientRect: () => ({ width: CARD_WIDTH }),
    setPointerCapture: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: () => undefined,
    ownerDocument: {
      visibilityState: 'visible',
      addEventListener: (type, listener) => {
        if (type === 'touchstart') documentTouchStarts.push(listener);
        (documentListeners[type] ??= []).push(listener);
      },
      removeEventListener: () => undefined,
    },
  };
  strip = { style: { display: '' } };
  list = {
    addEventListener: (type, listener, options) => {
      if (type !== 'touchmove') return;
      list.touchMoveListener = listener;
      list.touchMoveOptions = options;
    },
    removeEventListener: vi.fn(),
  };
  documentTouchStarts = [];
  documentListeners = {};
  direction = 'ltr';
  renderers = [];
  vi.stubGlobal('window', { innerWidth: VIEWPORT_WIDTH });
  vi.stubGlobal('getComputedStyle', () => ({ direction }));
});

afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Props = React.ComponentProps<typeof CompactCardSwipe>;

function List({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useCompactCardSwipeList(ref);
  return (
    <div ref={ref} data-list="true">
      {children}
    </div>
  );
}

const render = (props: Partial<Props> = {}) => {
  const onSwipe = vi.fn();
  const element = (next: Partial<Props>) => (
    <List>
      <CompactCardSwipe enabled resolved={false} label="Resolve" onSwipe={onSwipe} {...next}>
        <button type="button">card</button>
      </CompactCardSwipe>
    </List>
  );
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element(props), {
      createNodeMock: (host) => {
        if (host.props['data-list']) return list;
        return host.props['data-compact-card-swipe'] === 'action' ? strip : track;
      },
    });
  });
  renderers.push(renderer);
  const rerender = (next: Partial<Props>) => act(() => renderer.update(element(next)));
  const trackElement = () => renderer.root.findByProps({ 'data-compact-card-swipe': 'track' });
  const pointer = (
    type:
      | 'onPointerDown'
      | 'onPointerMove'
      | 'onPointerUp'
      | 'onPointerCancel'
      | 'onLostPointerCapture',
    clientX: number,
    clientY = 100,
    overrides: Record<string, unknown> = {}
  ) => {
    act(() => {
      trackElement().props[type]({
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX,
        clientY,
        target: track,
        currentTarget: track,
        ...overrides,
      });
    });
  };
  // Starts the swipe 10px along (where it locks sideways), then moves to `toX`.
  const swipe = (fromX: number, toX: number, overrides: Record<string, unknown> = {}) => {
    pointer('onPointerDown', fromX, 100, overrides);
    pointer('onPointerMove', fromX + Math.sign(toX - fromX) * 10, 100, overrides);
    pointer('onPointerMove', toX, 100, overrides);
    pointer('onPointerUp', toX, 100, overrides);
  };
  const actionStrip = () => renderer.root.findAllByProps({ 'data-compact-card-swipe': 'action' });
  const transitionEnd = (target: unknown = track) =>
    act(() => {
      trackElement().props.onTransitionEnd({
        target,
        currentTarget: track,
        propertyName: 'transform',
      });
    });
  return { onSwipe, renderer, rerender, pointer, swipe, trackElement, actionStrip, transitionEnd };
};

describe('CompactCardSwipe', () => {
  it('fires the swipe action when a touch swipe toward the start passes the threshold', () => {
    const { onSwipe, swipe } = render();

    swipe(300, 150);

    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(onSwipe).toHaveBeenCalledWith(false);
    expect(track.style.transform).toBe('');
  });

  it('snaps back without the action when the swipe stops short of the threshold', () => {
    const { onSwipe, swipe, trackElement } = render();

    swipe(300, 240);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
    expect(trackElement().props.className).toContain('SwipeTrackSettling');
  });

  it('moves the card from where the swipe locks and arms the strip past the threshold', () => {
    const { pointer, actionStrip } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    expect(track.style.transform).toBe('translateX(0px)');
    pointer('onPointerMove', 250);
    expect(track.style.transform).toBe('translateX(-40px)');
    expect(actionStrip()).toHaveLength(1);
    expect(actionStrip()[0]!.props['data-armed']).toBeUndefined();

    pointer('onPointerMove', 170);
    expect(track.style.transform).toBe('translateX(-120px)');
    expect(actionStrip()[0]!.props['data-armed']).toBe('true');
  });

  it('hides the strip once the card itself has settled back', () => {
    const { swipe, trackElement, actionStrip, transitionEnd } = render();

    swipe(300, 240);
    transitionEnd({ nodeName: 'BUTTON' });
    expect(actionStrip()).toHaveLength(1);

    transitionEnd();

    expect(actionStrip()).toHaveLength(0);
    expect(trackElement().props.className).not.toContain('SwipeTrackSettling');
  });

  it('hides the strip when the settle transition never ends', () => {
    vi.useFakeTimers();
    const { swipe, actionStrip } = render();

    swipe(300, 240);
    expect(actionStrip()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(actionStrip()).toHaveLength(0);
  });

  it('keeps naming the action it ran while the card settles', () => {
    const { swipe, rerender, actionStrip } = render();

    swipe(300, 150);
    rerender({ resolved: true, label: 'Reopen thread' });

    expect(actionStrip()[0]!.props['data-armed']).toBe('true');
    expect(actionStrip()[0]!.props['data-resolved']).toBeUndefined();
    expect(actionStrip()[0]!.findByType('span').props.children).toBe('Resolve');
  });

  it('runs the action the strip showed when the thread toggles mid-swipe', () => {
    const { onSwipe, pointer, rerender } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    rerender({ resolved: true, label: 'Reopen thread' });
    pointer('onPointerMove', 150);
    pointer('onPointerUp', 150);

    expect(onSwipe).toHaveBeenCalledWith(false);
  });

  it('leaves a vertical drag to the scroller', () => {
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300, 100);
    pointer('onPointerMove', 296, 130);
    pointer('onPointerMove', 150, 140);
    pointer('onPointerUp', 150, 140);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
    expect(track.setPointerCapture).not.toHaveBeenCalled();
  });

  it('keeps the scroller out of a touch only once it is a sideways swipe', () => {
    const { pointer } = render();
    // The touch started on the card's button; its events pass the track and the list.
    const touchMove = (cancelable = true, path: unknown[] = [{}, track, list]) => {
      const event = { cancelable, preventDefault: vi.fn(), composedPath: () => path };
      list.touchMoveListener!(event);
      return event.preventDefault;
    };

    expect(list.touchMoveOptions).toEqual({ passive: false });
    pointer('onPointerDown', 300);
    expect(touchMove()).not.toHaveBeenCalled();
    pointer('onPointerMove', 280);
    expect(touchMove()).toHaveBeenCalled();
    // A touch on another card is not the swipe's.
    expect(touchMove(true, [{}, {}, list])).not.toHaveBeenCalled();
    // A scroll already under way cannot be cancelled; trying only logs a warning.
    expect(touchMove(false)).not.toHaveBeenCalled();
    pointer('onPointerUp', 280);
    expect(touchMove()).not.toHaveBeenCalled();
  });

  it('leaves the touch listener and the touch-action to the element that holds the cards', () => {
    // One of each for the whole list: a listener or a touch-action on every card costs
    // WebKit on iOS a touch region a card, all rebuilt in every frame of a swipe.
    const { renderer, trackElement } = render();

    expect(track.addEventListener).not.toHaveBeenCalled();
    expect(trackElement().props.className).toBe('SwipeTrack');
    const listener = list.touchMoveListener;
    expect(listener).toBeDefined();

    act(() => renderer.unmount());
    expect(list.removeEventListener).toHaveBeenCalledWith('touchmove', listener);
  });

  it('ignores a swipe toward the end', () => {
    const { onSwipe, swipe } = render();

    swipe(100, 290);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('leaves touches that start at a screen edge to the edge swipes', () => {
    const { onSwipe, swipe } = render();

    swipe(VIEWPORT_WIDTH - 10, 150);
    direction = 'rtl';
    swipe(10, 250);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.setPointerCapture).not.toHaveBeenCalled();
  });

  it('ignores mouse drags, which have the hover actions', () => {
    const { onSwipe, swipe } = render();

    swipe(300, 150, { pointerType: 'mouse' });

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('follows only the first finger', () => {
    const { onSwipe, pointer, swipe } = render();

    swipe(300, 150, { isPrimary: false });
    expect(onSwipe).not.toHaveBeenCalled();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 100, 100, { pointerId: 2 });
    pointer('onPointerUp', 100, 100, { pointerId: 2 });
    expect(track.style.transform).toBe('translateX(0px)');
    pointer('onPointerMove', 150);
    pointer('onPointerUp', 150);
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('ignores swipes while disabled', () => {
    const { onSwipe, pointer, actionStrip } = render({ enabled: false });

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 150);
    expect(track.style.transform).toBe('');
    expect(actionStrip()).toHaveLength(0);
    pointer('onPointerUp', 150);

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('drops the action when the card is disabled mid-swipe', () => {
    const { onSwipe, pointer, rerender, actionStrip } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    rerender({ enabled: false });
    pointer('onPointerUp', 150);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
    expect(actionStrip()[0]!.props['data-armed']).toBeUndefined();
  });

  it('lets go of a swipe without its action once a second finger makes it a pinch', () => {
    // The pinch changes the page zoom (theme/usePinchToZoom.ts). Its second finger may land
    // anywhere, away from the card, and the swiping finger may then hold still.
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    act(() => documentTouchStarts.forEach((listener) => listener({ touches: [{}, {}] })));
    pointer('onPointerUp', 150);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('snaps back without the action when the browser cancels the touch', () => {
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    pointer('onPointerCancel', 150);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('snaps back when the card loses the touch, but not when the card button does', () => {
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onLostPointerCapture', 290, 100, { target: { nodeName: 'BUTTON' } });
    pointer('onPointerMove', 250);
    expect(track.style.transform).toBe('translateX(-40px)');

    pointer('onLostPointerCapture', 250);
    expect(track.style.transform).toBe('');
    pointer('onPointerMove', 100);
    pointer('onPointerUp', 100);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  // On a phone a card was left swiped with its strip showing, and no resolve was sent: the touch
  // had ended without the card being told. However a touch ends, no swipe outlives it.
  it('lets go of a swipe whose end never came when the next touch starts', () => {
    const { onSwipe, pointer, actionStrip } = render();
    vi.useFakeTimers();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    expect(track.style.transform).toBe('translateX(-140px)');
    // One finger on the screen: the one that swiped is gone.
    tellDocument('touchstart', { touches: [{}] });

    expect(track.style.transform).toBe('');
    expect(onSwipe).not.toHaveBeenCalled();
    act(() => {
      vi.runAllTimers();
    });
    expect(actionStrip()).toHaveLength(0);
  });

  it('keeps the swipe of a touch whose own start the document hears', () => {
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300);
    tellDocument('touchstart', { touches: [{}] });
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    pointer('onPointerUp', 150);

    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('lets go of a swipe whose end never came when the card is touched again', () => {
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    pointer('onPointerDown', 300, 100, { pointerId: 2 });
    expect(track.style.transform).toBe('');
    expect(onSwipe).not.toHaveBeenCalled();

    // The new touch swipes as any other.
    pointer('onPointerMove', 290, 100, { pointerId: 2 });
    pointer('onPointerMove', 150, 100, { pointerId: 2 });
    pointer('onPointerUp', 150, 100, { pointerId: 2 });
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(track.style.transform).toBe('');
  });

  it('runs the action when the finger lifts and the card is not told', () => {
    const { onSwipe, pointer } = render();
    vi.useFakeTimers();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    tellDocument('touchend', { touches: [] });
    // The card's own pointer event of the lift comes first where it comes.
    expect(onSwipe).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(onSwipe).toHaveBeenCalledWith(false);
    expect(track.style.transform).toBe('');
  });

  it('runs the action once when the card is told of the lift too', () => {
    const { onSwipe, pointer } = render();
    vi.useFakeTimers();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    tellDocument('touchend', { touches: [] });
    pointer('onPointerUp', 150);
    act(() => {
      vi.runAllTimers();
    });

    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('lets go without the action when the browser cancels a touch the card is not told of', () => {
    const { onSwipe, pointer } = render();
    vi.useFakeTimers();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    tellDocument('touchcancel', { touches: [] });
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('keeps the swipe while another finger lifts', () => {
    const { onSwipe, pointer } = render();
    vi.useFakeTimers();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    tellDocument('touchend', { touches: [{}] });
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('translateX(-140px)');
  });

  it('lets go of a swipe without its action when the page goes out of sight', () => {
    const { onSwipe, pointer } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    track.ownerDocument.visibilityState = 'hidden';
    tellDocument('visibilitychange');

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('leaves a card that goes mid-swipe at rest, without its strip', () => {
    // The list shows a card that left a moment longer as a copy (ui/listMotion.tsx).
    const { renderer, pointer } = render();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    act(() => renderer.unmount());

    expect(track.style.transform).toBe('');
    expect(strip.style.display).toBe('none');
  });

  it('swallows the click that ends a swipe but not a keyboard click or a later tap', async () => {
    const { swipe, pointer, trackElement } = render();
    const click = async (detail = 1) => {
      const event = { detail, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      await act(() => trackElement().props.onClickCapture(event));
      return event.stopPropagation;
    };

    swipe(300, 240);
    expect(await click(0)).not.toHaveBeenCalled();
    expect(await click()).toHaveBeenCalled();
    expect(await click()).not.toHaveBeenCalled();

    swipe(300, 240);
    pointer('onPointerDown', 300);
    pointer('onPointerUp', 300);
    expect(await click()).not.toHaveBeenCalled();
  });

  it('swipes toward the inline start in right-to-left layouts', () => {
    direction = 'rtl';
    const { onSwipe, swipe } = render();

    swipe(300, 150);
    expect(onSwipe).not.toHaveBeenCalled();

    swipe(100, 250);
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(track.style.transform).toBe('');
  });

  it('labels the strip for the action the swipe takes', () => {
    const { pointer, actionStrip } = render({ resolved: true, label: 'Reopen thread' });

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 260);

    expect(actionStrip()[0]!.props['data-resolved']).toBe('true');
    expect(actionStrip()[0]!.findByType('span').props.children).toBe('Reopen thread');
    expect(actionStrip()[0]!.props['aria-hidden']).toBe(true);
  });
});
