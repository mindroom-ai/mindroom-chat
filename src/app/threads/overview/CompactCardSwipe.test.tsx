// @vitest-environment jsdom
import React, { type ReactNode, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CompactCardSwipe,
  getDeepThreshold,
  getParkWidth,
  useCompactCardSwipeList,
} from './CompactCardSwipe';

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return { ...actual, Icon: () => null, Text: 'span' };
});

vi.mock('./CompactCardSwipe.css', () => ({
  ResolveButton: 'ResolveButton',
  SnoozeButton: 'SnoozeButton',
  SwipeAction: 'SwipeAction',
  SwipeList: 'SwipeList',
  SwipeTrack: 'SwipeTrack',
  SwipeTrackSettling: 'SwipeTrackSettling',
  SwipeTray: 'SwipeTray',
  TrayButton: 'TrayButton',
  TrayLabel: 'TrayLabel',
}));

const CARD_WIDTH = 300;
const VIEWPORT_WIDTH = 400;

type FakeTrack = {
  style: { transform: string };
  getBoundingClientRect: () => { width: number };
  setPointerCapture: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: () => void;
  contains: (node: unknown) => boolean;
  parentElement?: Element | null;
  querySelector: (selector: string) => { focus: ReturnType<typeof vi.fn> } | null;
  ownerDocument: {
    visibilityState: 'visible' | 'hidden';
    activeElement?: unknown;
    addEventListener: (type: string, listener: (event: unknown) => void) => void;
    removeEventListener: (type: string, listener: (event: unknown) => void) => void;
  };
};

/** The strip under the card that names the action. */
type FakeStrip = { style: { display: string }; contains: (node: unknown) => boolean };

/** The element that holds the cards. */
type FakeList = {
  addEventListener: ReturnType<typeof vi.fn>;
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
    contains: (node) => node === track,
    querySelector: () => null,
    ownerDocument: {
      visibilityState: 'visible',
      addEventListener: (type, listener) => {
        if (type === 'touchstart') documentTouchStarts.push(listener);
        (documentListeners[type] ??= []).push(listener);
      },
      removeEventListener: (type, listener) => {
        const listForType = documentListeners[type];
        if (!listForType) return;
        const idx = listForType.indexOf(listener);
        if (idx >= 0) listForType.splice(idx, 1);
      },
    },
  };
  strip = { style: { display: '' }, contains: (node) => node === strip };
  list = {
    addEventListener: vi.fn(
      (type: string, listener: (event: unknown) => void, options: unknown) => {
        if (type !== 'touchmove') return;
        list.touchMoveListener = listener;
        list.touchMoveOptions = options;
      }
    ),
    removeEventListener: vi.fn(),
  };
  documentTouchStarts = [];
  documentListeners = {};
  direction = 'ltr';
  renderers = [];
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_WIDTH });
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
      createNodeMock: (host: React.ReactElement<any>) => {
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
  it('cancels a pending touch when disabled even if enabled again before that finger moves', () => {
    const { pointer, rerender, onSwipe, actionStrip } = render();
    pointer('onPointerDown', 300);
    rerender({ enabled: false });
    rerender({ enabled: true });
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    pointer('onPointerUp', 150);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(actionStrip()).toHaveLength(0);
    expect(track.style.transform).toBe('');
  });

  it('uses the shared finish path to cancel an armed swipe when disabled', () => {
    const { pointer, rerender, onSwipe } = render();
    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 150);
    expect(track.style.transform).toBe('translateX(-140px)');
    rerender({ enabled: false });
    expect(track.style.transform).toBe('');
    rerender({ enabled: true });
    pointer('onPointerUp', 150);
    expect(onSwipe).not.toHaveBeenCalled();
  });

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

describe('CompactCardSwipe split tray (Option A1)', () => {
  const renderSplit = (props: Partial<Props> = {}) => {
    const onSnooze = vi.fn();
    const view = render({ snoozeLabel: 'Snooze', onSnooze, ...props });
    const trayButton = (action: 'snooze' | 'resolve') =>
      view.renderer.root.findByProps({ 'data-compact-card-swipe-action': action });
    return { ...view, onSnooze, trayButton };
  };

  it('parks open on short swipe with interactive Snooze + Resolve buttons and runs each action', () => {
    const { onSwipe, onSnooze, swipe, actionStrip, trayButton, transitionEnd } = renderSplit();

    // Short swipe (100px >= 60px park threshold, < 168px deep threshold) parks at 156px.
    swipe(300, 190);
    expect(onSwipe).not.toHaveBeenCalled();
    expect(onSnooze).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('translateX(-156px)');
    expect(actionStrip()[0]!.props['data-parked']).toBe('true');
    expect(actionStrip()[0]!.props['aria-hidden']).toBeUndefined();
    expect(trayButton('snooze').props.tabIndex).toBe(0);
    expect(trayButton('resolve').props.tabIndex).toBe(0);

    // Completing the glide into parked keeps the tray mounted.
    transitionEnd();
    expect(actionStrip()).toHaveLength(1);
    expect(track.style.transform).toBe('translateX(-156px)');

    // Clicking Snooze settles closed and calls onSnooze(false).
    act(() => {
      trayButton('snooze').props.onClick();
    });
    expect(onSnooze).toHaveBeenCalledWith(false);
    expect(track.style.transform).toBe('');
    transitionEnd();
    expect(actionStrip()).toHaveLength(0);

    // Clicking Resolve settles closed and calls onSwipe(false).
    swipe(300, 190);
    act(() => {
      trayButton('resolve').props.onClick();
    });
    expect(onSwipe).toHaveBeenCalledWith(false);
    expect(track.style.transform).toBe('');
    transitionEnd();
    expect(actionStrip()).toHaveLength(0);
  });

  it('shows Unsnooze when already snoozed and calls onSnooze(true)', () => {
    const { onSnooze, swipe, trayButton } = renderSplit({
      snoozed: true,
      snoozeLabel: 'Unsnooze',
    });

    swipe(300, 190);
    expect(trayButton('snooze').findByType('span').props.children).toBe('Unsnooze');
    act(() => {
      trayButton('snooze').props.onClick();
    });
    expect(onSnooze).toHaveBeenCalledWith(true);
  });

  it('expands Resolve when deep-swiped past deepThreshold and commits immediately on lift', () => {
    const { onSwipe, onSnooze, pointer, actionStrip } = renderSplit();

    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 190); // 100px: not armed
    expect(actionStrip()[0]!.props['data-armed']).toBeUndefined();

    pointer('onPointerMove', 110); // 180px >= 168px deepThreshold: armed
    expect(actionStrip()[0]!.props['data-armed']).toBe('true');
    expect(actionStrip()[0]!.props['aria-hidden']).toBe(true);

    pointer('onPointerUp', 110);
    expect(onSwipe).toHaveBeenCalledWith(false);
    expect(onSnooze).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('clamps parkWidth and deepThreshold on narrow cards so >= 40px remains visible', () => {
    const deep = getDeepThreshold(200, true);
    const park = getParkWidth(200, deep);
    expect(deep).toBeLessThanOrEqual(200 * 0.65);
    expect(200 - park).toBeGreaterThanOrEqual(40);
    expect(park).toBeLessThan(deep);
  });

  it('closes a parked card on body tap (swallowing click) without closing on the swipe trailing click', async () => {
    const { swipe, pointer, trackElement, actionStrip } = renderSplit();
    const click = async (detail = 1) => {
      const event = { detail, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      await act(() => trackElement().props.onClickCapture(event));
      return event;
    };

    swipe(300, 190);
    expect(track.style.transform).toBe('translateX(-156px)');

    // Trailing click from the swipe that just parked the card is swallowed and keeps it parked.
    const trailing = await click();
    expect(trailing.stopPropagation).toHaveBeenCalled();
    expect(track.style.transform).toBe('translateX(-156px)');

    // Next tap on the parked card body closes it and swallows the click so the thread does not open.
    pointer('onPointerDown', 80);
    pointer('onPointerUp', 80);
    const tap = await click();
    expect(tap.stopPropagation).toHaveBeenCalled();
    expect(tap.preventDefault).toHaveBeenCalled();
    expect(track.style.transform).toBe('');
    expect(actionStrip()[0]!.props['data-parked']).toBeUndefined();

    // Clicking an explicit card action button (e.g. More) while parked closes the tray without swallowing the click.
    swipe(300, 190);
    pointer('onPointerDown', 80);
    pointer('onPointerUp', 80);
    const moreTarget = document.createElement('button');
    moreTarget.setAttribute('data-compact-thread-more', 'true');
    const moreClick = {
      detail: 1,
      target: moreTarget,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    await act(() => trackElement().props.onClickCapture(moreClick));
    expect(track.style.transform).toBe('');
    expect(moreClick.preventDefault).not.toHaveBeenCalled();
    expect(moreClick.stopPropagation).not.toHaveBeenCalled();
  });

  it('closes a parked card when swiped back toward inline-end, and closes first card when swiping a second', () => {
    const { swipe, pointer } = renderSplit();

    // Park open, then swipe right by 40px (> 24px close threshold) -> closes smoothly.
    swipe(300, 190);
    expect(track.style.transform).toBe('translateX(-156px)');
    pointer('onPointerDown', 100);
    pointer('onPointerMove', 110);
    pointer('onPointerMove', 150);
    pointer('onPointerUp', 150);
    expect(track.style.transform).toBe('');

    // Two cards in one list: swiping the second closes the first parked card.
    const track1: FakeTrack = { ...track, style: { transform: '' }, contains: (t) => t === track1 };
    const track2: FakeTrack = { ...track, style: { transform: '' }, contains: (t) => t === track2 };
    let two!: ReactTestRenderer;
    act(() => {
      two = create(
        <List>
          <CompactCardSwipe
            enabled
            resolved={false}
            label="Resolve"
            snoozeLabel="Snooze"
            onSwipe={vi.fn()}
            onSnooze={vi.fn()}
          >
            <button type="button" data-card="1">
              one
            </button>
          </CompactCardSwipe>
          <CompactCardSwipe
            enabled
            resolved={false}
            label="Resolve"
            snoozeLabel="Snooze"
            onSwipe={vi.fn()}
            onSnooze={vi.fn()}
          >
            <button type="button" data-card="2">
              two
            </button>
          </CompactCardSwipe>
        </List>,
        {
          createNodeMock: (host: React.ReactElement<any>) => {
            if (host.props['data-list']) return list;
            if (host.props['data-compact-card-swipe'] === 'action')
              return { style: { display: '' }, contains: () => false };
            if (host.props['data-compact-card-swipe'] === 'track') {
              return host.props.children.props['data-card'] === '1' ? track1 : track2;
            }
            return {};
          },
        }
      );
    });
    renderers.push(two);
    const [t1, t2] = two.root.findAllByProps({ 'data-compact-card-swipe': 'track' });
    const drag = (el: typeof t1, node: FakeTrack, fromX: number, toX: number) => {
      const fire = (type: string, clientX: number) => {
        act(() => {
          el!.props[type]({
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX,
            clientY: 100,
            target: node,
            currentTarget: node,
          });
        });
      };
      fire('onPointerDown', fromX);
      fire('onPointerMove', fromX - 10);
      fire('onPointerMove', toX);
      fire('onPointerUp', toX);
    };
    drag(t1, track1, 300, 190);
    expect(track1.style.transform).toBe('translateX(-156px)');
    drag(t2, track2, 300, 190);
    expect(track1.style.transform).toBe('');
    expect(track2.style.transform).toBe('translateX(-156px)');
  });

  it('closes a parked card on Escape, outside pointerdown, scroll, disable, and visibility hidden', () => {
    const { swipe, rerender } = renderSplit();

    // Escape with focus inside the card closes and stops propagation
    swipe(300, 190);
    track.ownerDocument.activeElement = track;
    const escInCard = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    tellDocument('keydown', escInCard);
    expect(track.style.transform).toBe('');
    expect(escInCard.preventDefault).toHaveBeenCalled();
    expect(escInCard.stopPropagation).toHaveBeenCalled();

    // Escape with focus outside card/tray closes the tray without swallowing Escape
    swipe(300, 190);
    track.ownerDocument.activeElement = document.body;
    const escOutside = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    tellDocument('keydown', escOutside);
    expect(track.style.transform).toBe('');
    expect(escOutside.preventDefault).not.toHaveBeenCalled();
    expect(escOutside.stopPropagation).not.toHaveBeenCalled();

    // Escape while a dialog overlay is open leaves the parked tray alone
    swipe(300, 190);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    track.ownerDocument.activeElement = strip;
    const escOverlay = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    tellDocument('keydown', escOverlay);
    expect(track.style.transform).toBe('translateX(-156px)');
    expect(escOverlay.preventDefault).not.toHaveBeenCalled();
    dialog.remove();
    tellDocument('keydown', { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });

    // Outside pointerdown (inside track or strip stays open; outside closes)
    swipe(300, 190);
    tellDocument('pointerdown', { target: strip, composedPath: () => [strip] });
    expect(track.style.transform).toBe('translateX(-156px)');
    tellDocument('pointerdown', { target: {}, composedPath: () => [{}] });
    expect(track.style.transform).toBe('');

    // Vertical scroll
    swipe(300, 190);
    tellDocument('scroll', { target: track.ownerDocument });
    expect(track.style.transform).toBe('');

    // Disabling card (e.g. menu opens or mutation starts)
    swipe(300, 190);
    rerender({ enabled: false, snoozeLabel: 'Snooze', onSnooze: vi.fn() });
    expect(track.style.transform).toBe('');
    rerender({ enabled: true, snoozeLabel: 'Snooze', onSnooze: vi.fn() });

    // Page hidden
    swipe(300, 190);
    track.ownerDocument.visibilityState = 'hidden';
    tellDocument('visibilitychange');
    expect(track.style.transform).toBe('');
  });

  it('supports RTL split tray parking, closing, and deep resolve', () => {
    direction = 'rtl';
    const { onSwipe, swipe, pointer } = renderSplit();

    // Swiping right (toward inline-start in RTL) parks at +156px.
    swipe(100, 210);
    expect(track.style.transform).toBe('translateX(156px)');

    // Swiping left from parked closes it.
    pointer('onPointerDown', 200);
    pointer('onPointerMove', 190);
    pointer('onPointerMove', 150);
    pointer('onPointerUp', 150);
    expect(track.style.transform).toBe('');

    // Deep swipe right commits Resolve.
    swipe(50, 250);
    expect(onSwipe).toHaveBeenCalledWith(false);
  });

  it('keeps resolved cards on the single-action Reopen strip with no Snooze button', () => {
    const { onSwipe, swipe, pointer, actionStrip } = render({
      resolved: true,
      label: 'Reopen thread',
      snoozeLabel: 'Snooze',
      onSnooze: vi.fn(),
    });

    // Short pull snaps closed (does not park) and renders single-action strip.
    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 220);
    expect(actionStrip()[0]!.props.className).toBe('SwipeAction');
    expect(
      actionStrip()[0]!.findAllByProps({ 'data-compact-card-swipe-action': 'snooze' })
    ).toHaveLength(0);
    pointer('onPointerUp', 220);
    expect(track.style.transform).toBe('');
    expect(onSwipe).not.toHaveBeenCalled();

    // Pulling past single-action threshold (105px on 300px card) commits Reopen.
    swipe(300, 160);
    expect(onSwipe).toHaveBeenCalledWith(true);
  });
  it('restores focus to the card button on Escape when focus was inside the parked tray', () => {
    const cardFocus = vi.fn();
    track.querySelector = (selector) =>
      selector === '[data-thread-root-id]' ? { focus: cardFocus } : null;
    const { swipe } = renderSplit();

    // Focus inside the parked tray -> Escape closes tray and restores focus with preventScroll.
    swipe(300, 190);
    track.ownerDocument.activeElement = strip;
    tellDocument('keydown', { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(track.style.transform).toBe('');
    expect(cardFocus).toHaveBeenCalledWith({ preventScroll: true });

    // Focus outside the tray -> Escape closes tray without stealing focus.
    cardFocus.mockClear();
    swipe(300, 190);
    track.ownerDocument.activeElement = {};
    tellDocument('keydown', { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(track.style.transform).toBe('');
    expect(cardFocus).not.toHaveBeenCalled();
  });

  it('closes a parked tray on keyboard activation (detail 0) without swallowing the click', async () => {
    const { swipe, trackElement } = renderSplit();

    swipe(300, 190);
    expect(track.style.transform).toBe('translateX(-156px)');
    const event = { detail: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(() => {
      trackElement().props.onClickCapture(event);
    });
    expect(track.style.transform).toBe('');
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('attaches no wheel listener on the list or track (trackpad arbitration lives in desktopHistorySwipe)', () => {
    renderSplit();
    expect(track.addEventListener).not.toHaveBeenCalled();
    const types = list.addEventListener.mock.calls.map(([type]) => type);
    expect(types).toEqual(['touchmove']);
  });

  it('supports touch return-swipe starting on the parked tray while keeping plain taps working', async () => {
    const { onSwipe, onSnooze, swipe, actionStrip, trayButton } = renderSplit();
    const trayPointer = (
      type: 'onPointerDown' | 'onPointerMove' | 'onPointerUp',
      clientX: number,
      clientY = 0
    ) =>
      act(() => {
        actionStrip()[0]!.props[type]({
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          clientX,
          clientY,
          currentTarget: strip,
          target: strip,
        });
      });

    // Park card, then start a rightward return-swipe directly on the exposed tray.
    swipe(300, 190);
    expect(track.style.transform).toBe('translateX(-156px)');
    track.setPointerCapture.mockClear();

    trayPointer('onPointerDown', 220);
    trayPointer('onPointerMove', 232);
    expect(track.setPointerCapture).toHaveBeenCalledWith(1);
    const moveEvent = {
      cancelable: true,
      preventDefault: vi.fn(),
      composedPath: () => [strip, list],
    };
    list.touchMoveListener!(moveEvent);
    expect(moveEvent.preventDefault).toHaveBeenCalledTimes(1);
    trayPointer('onPointerMove', 300);
    trayPointer('onPointerUp', 300);
    expect(track.style.transform).toBe('');
    expect(onSnooze).not.toHaveBeenCalled();
    expect(onSwipe).not.toHaveBeenCalled();

    // Small horizontal wiggle on the parked tray re-parks and swallows the trailing click.
    swipe(300, 190);
    trayPointer('onPointerDown', 220);
    trayPointer('onPointerMove', 232);
    trayPointer('onPointerMove', 236);
    trayPointer('onPointerUp', 236);
    expect(track.style.transform).toBe('translateX(-156px)');
    const trailingClick = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(() => actionStrip()[0]!.props.onClickCapture(trailingClick));
    expect(trailingClick.preventDefault).toHaveBeenCalled();
    expect(trailingClick.stopPropagation).toHaveBeenCalled();
    expect(onSnooze).not.toHaveBeenCalled();

    // Plain tap (no horizontal drag) on Snooze still clicks cleanly.
    trayPointer('onPointerDown', 220);
    trayPointer('onPointerUp', 220);
    const tapClick = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(() => actionStrip()[0]!.props.onClickCapture(tapClick));
    expect(tapClick.stopPropagation).not.toHaveBeenCalled();
    act(() => {
      trayButton('snooze').props.onClick();
    });
    expect(onSnooze).toHaveBeenCalledWith(false);
    expect(track.style.transform).toBe('');
  });

  it('restores focus to [data-thread-root-id] on focused Unsnooze/Resolve activation, but lets SnoozePicker manage focus for Snooze', () => {
    const cardFocus = vi.fn();
    track.querySelector = (selector) =>
      selector === '[data-thread-root-id]' ? { focus: cardFocus } : null;

    // Focused Unsnooze button restores focus to the card button with preventScroll.
    const snoozedView = renderSplit({ snoozed: true, snoozeLabel: 'Unsnooze' });
    snoozedView.swipe(300, 190);
    track.ownerDocument.activeElement = strip;
    act(() => {
      snoozedView.trayButton('snooze').props.onClick();
    });
    expect(snoozedView.onSnooze).toHaveBeenCalledWith(true);
    expect(cardFocus).toHaveBeenCalledWith({ preventScroll: true });

    // Unsnooze when focus is NOT in the tray does not steal focus.
    cardFocus.mockClear();
    snoozedView.swipe(300, 190);
    track.ownerDocument.activeElement = {};
    act(() => {
      snoozedView.trayButton('snooze').props.onClick();
    });
    expect(cardFocus).not.toHaveBeenCalled();

    // Focused Resolve button restores focus to the card button with preventScroll.
    cardFocus.mockClear();
    const openView = renderSplit({ snoozed: false, snoozeLabel: 'Snooze' });
    openView.swipe(300, 190);
    track.ownerDocument.activeElement = strip;
    act(() => {
      openView.trayButton('resolve').props.onClick();
    });
    expect(openView.onSwipe).toHaveBeenCalledWith(false);
    expect(cardFocus).toHaveBeenCalledWith({ preventScroll: true });

    // Focused Snooze button opens SnoozePicker and does not steal focus onto the card button.
    cardFocus.mockClear();
    openView.swipe(300, 190);
    track.ownerDocument.activeElement = strip;
    act(() => {
      openView.trayButton('snooze').props.onClick();
    });
    expect(openView.onSnooze).toHaveBeenCalledWith(false);
    expect(cardFocus).not.toHaveBeenCalled();
  });

  it('ignores tiny <= 8px vertical scroll drift after parking and dismisses on > 8px scroll', () => {
    const scroller = document.createElement('div');
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 100,
    });
    scroller.contains = (node: unknown) => node === track;
    track.parentElement = scroller;
    const { swipe } = renderSplit();

    swipe(300, 190);
    expect(track.style.transform).toBe('translateX(-156px)');

    // Residual <= 8px drift in either direction keeps the tray parked.
    scroller.scrollTop = 108;
    tellDocument('scroll', { target: scroller });
    expect(track.style.transform).toBe('translateX(-156px)');

    scroller.scrollTop = 92;
    tellDocument('scroll', { target: scroller });
    expect(track.style.transform).toBe('translateX(-156px)');

    // Real vertical scroll (> 8px) closes it immediately.
    scroller.scrollTop = 109;
    tellDocument('scroll', { target: scroller });
    expect(track.style.transform).toBe('');
  });

  it('reflects live snooze state while parked, refuses to park if resolved mid-swipe, and ignores post-unmount touchend', () => {
    const cardFocus = vi.fn();
    track.querySelector = (selector) =>
      selector === '[data-thread-root-id]' ? { focus: cardFocus } : null;
    const { swipe, pointer, rerender, onSnooze, onSwipe, actionStrip, trayButton, renderer } =
      renderSplit({ snoozed: true, snoozeLabel: 'Unsnooze' });

    // Park while snoozed, then snooze expires while parked -> label and action update live.
    swipe(300, 190);
    expect(actionStrip()[0]!.props['data-snoozed']).toBe('true');
    rerender({ snoozed: false, snoozeLabel: 'Snooze', onSnooze });
    expect(actionStrip()[0]!.props['data-snoozed']).toBeUndefined();
    expect(trayButton('snooze').findByType('span').props.children).toBe('Snooze');
    track.ownerDocument.activeElement = strip;
    act(() => {
      trayButton('snooze').props.onClick();
    });
    expect(onSnooze).toHaveBeenCalledWith(false);
    expect(cardFocus).not.toHaveBeenCalled();

    // Thread resolves mid-swipe -> releasing in the park range snaps closed instead of parking.
    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 190);
    rerender({
      resolved: true,
      label: 'Reopen thread',
      snoozeLabel: undefined,
      onSnooze: undefined,
    });
    pointer('onPointerUp', 190);
    expect(track.style.transform).toBe('');

    // Unmounting mid-swipe cancels any deferred touchend timer so onSwipe is not called.
    vi.useFakeTimers();
    rerender({ resolved: false, label: 'Resolve', snoozeLabel: 'Snooze', onSnooze });
    pointer('onPointerDown', 300);
    pointer('onPointerMove', 290);
    pointer('onPointerMove', 100);
    tellDocument('touchend', { touches: [] });
    act(() => renderer.unmount());
    act(() => {
      vi.runAllTimers();
    });
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
