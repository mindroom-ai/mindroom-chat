import React, { type ReactNode, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopShellEvent } from '../../lib/desktopBridge';
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
  ownerDocument: {
    visibilityState: 'visible' | 'hidden';
    defaultView?: unknown;
    addEventListener: (type: string, listener: (event: unknown) => void) => void;
    removeEventListener: (type: string, listener: (event: unknown) => void) => void;
  };
};

/** The strip under the card that names the action. */
type FakeStrip = { style: { display: string } };

/** The element that holds the cards. */
type FakeList = {
  addEventListener: (type: string, listener: (event: unknown) => void, options: unknown) => void;
  removeEventListener: ReturnType<typeof vi.fn>;
  ownerDocument?: FakeTrack['ownerDocument'];
  touchMoveListener?: (event: unknown) => void;
  touchMoveOptions?: unknown;
  wheelListener?: (event: unknown) => void;
  wheelOptions?: unknown;
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
      removeEventListener: (type, listener) => {
        const listForType = documentListeners[type];
        if (!listForType) return;
        const idx = listForType.indexOf(listener);
        if (idx >= 0) listForType.splice(idx, 1);
      },
    },
  };
  strip = { style: { display: '' } };
  list = {
    ownerDocument: track.ownerDocument,
    addEventListener: (type, listener, options) => {
      if (type === 'touchmove') {
        list.touchMoveListener = listener;
        list.touchMoveOptions = options;
      } else if (type === 'wheel') {
        list.wheelListener = listener;
        list.wheelOptions = options;
      }
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
    const track1: FakeTrack = { ...track, style: { transform: '' } };
    const track2: FakeTrack = { ...track, style: { transform: '' } };
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
              return { style: { display: '' } };
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

    // Escape
    swipe(300, 190);
    const esc = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    tellDocument('keydown', esc);
    expect(track.style.transform).toBe('');
    expect(esc.preventDefault).toHaveBeenCalled();

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
});

describe('CompactCardSwipe macOS Electron trackpad', () => {
  let emitShell: (event: DesktopShellEvent) => void;
  let unsubscribeShell: ReturnType<typeof vi.fn<() => void>>;
  let windowListeners: Record<string, Array<() => void>>;
  let rafQueue: Array<() => void>;

  const setupMacElectron = () => {
    const shellListeners = new Set<(event: DesktopShellEvent) => void>();
    unsubscribeShell = vi.fn<() => void>();
    emitShell = (event) => {
      act(() => {
        shellListeners.forEach((listener) => listener(event));
      });
    };
    windowListeners = {};
    rafQueue = [];
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      maxTouchPoints: 0,
    });
    const fakeWindow = {
      innerWidth: VIEWPORT_WIDTH,
      mindroomDesktop: {
        onShellEvent: (listener: (event: DesktopShellEvent) => void) => {
          shellListeners.add(listener);
          return () => {
            shellListeners.delete(listener);
            unsubscribeShell();
          };
        },
      },
      addEventListener: (type: string, listener: () => void) => {
        (windowListeners[type] ??= []).push(listener);
      },
      removeEventListener: vi.fn(),
      requestAnimationFrame: (cb: () => void) => {
        rafQueue.push(cb);
        return rafQueue.length;
      },
      cancelAnimationFrame: (id: number) => {
        rafQueue[id - 1] = () => undefined;
      },
    };
    track.ownerDocument.defaultView = fakeWindow;
    vi.stubGlobal('window', fakeWindow);
  };

  const flushRaf = () =>
    act(() => {
      const pending = rafQueue.splice(0);
      pending.forEach((cb) => cb());
    });

  const dispatchWheel = (
    overrides: Partial<{
      deltaX: number;
      deltaY: number;
      deltaMode: number;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      momentum: boolean;
      defaultPrevented: boolean;
      path: unknown[];
    }> = {}
  ) => {
    const preventDefault = vi.fn();
    const event = {
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault,
      target: track,
      composedPath: () => overrides.path ?? [track, list],
      ...overrides,
    };
    act(() => list.wheelListener?.(event));
    return preventDefault;
  };

  it('attaches one shared wheel listener on the list (never on card tracks) and cleans up', () => {
    setupMacElectron();
    const { renderer } = render({ snoozeLabel: 'Snooze', onSnooze: vi.fn() });

    expect(track.addEventListener).not.toHaveBeenCalled();
    expect(list.wheelListener).toBeDefined();
    expect(list.wheelOptions).toEqual({ passive: false });

    const wheelListener = list.wheelListener;
    act(() => renderer.unmount());
    expect(list.removeEventListener).toHaveBeenCalledWith('wheel', wheelListener);
    expect(unsubscribeShell).toHaveBeenCalledOnce();
  });

  it('parks on short left trackpad swipe and deep-commits on deep left trackpad swipe', () => {
    setupMacElectron();
    const { onSwipe, actionStrip } = render({ snoozeLabel: 'Snooze', onSnooze: vi.fn() });

    // Short left swipe (deltaX > 0 in LTR) -> preventDefault + parks open on end.
    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    expect(dispatchWheel({ deltaX: 50 })).toHaveBeenCalled();
    expect(dispatchWheel({ deltaX: 40 })).toHaveBeenCalled();
    expect(track.style.transform).toBe('translateX(-90px)');
    emitShell({ type: 'scroll-gesture', phase: 'end' });
    flushRaf();
    expect(track.style.transform).toBe('translateX(-156px)');
    expect(actionStrip()[0]!.props['data-parked']).toBe('true');
    expect(onSwipe).not.toHaveBeenCalled();

    // Deep swipe from parked past deepThreshold commits Resolve immediately on end.
    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    expect(dispatchWheel({ deltaX: 40 })).toHaveBeenCalled();
    expect(actionStrip()[0]!.props['data-armed']).toBe('true');
    emitShell({ type: 'scroll-gesture', phase: 'end' });
    expect(onSwipe).toHaveBeenCalledWith(false);
    expect(track.style.transform).toBe('');
  });

  it('leaves right swipe on a closed card untouched (no preventDefault) for Back navigation', () => {
    setupMacElectron();
    const { onSwipe } = render({ snoozeLabel: 'Snooze', onSnooze: vi.fn() });

    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    expect(dispatchWheel({ deltaX: -5 })).not.toHaveBeenCalled();
    expect(dispatchWheel({ deltaX: -20 })).not.toHaveBeenCalled();
    expect(dispatchWheel({ deltaX: -40 })).not.toHaveBeenCalled();
    emitShell({ type: 'scroll-gesture', phase: 'end' });

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('prevents default and closes a parked card when swiped right over track or tray', () => {
    setupMacElectron();
    render({ snoozeLabel: 'Snooze', onSnooze: vi.fn() });

    // Park open first.
    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    dispatchWheel({ deltaX: 90 });
    emitShell({ type: 'scroll-gesture', phase: 'end' });
    flushRaf();
    expect(track.style.transform).toBe('translateX(-156px)');

    // Swipe right over the revealed tray -> calls preventDefault() and closes card cleanly.
    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    expect(dispatchWheel({ deltaX: -40, path: [strip, list] })).toHaveBeenCalled();
    emitShell({ type: 'scroll-gesture', phase: 'end' });
    flushRaf();
    expect(track.style.transform).toBe('');
  });

  it('closes a parked card on vertical scroll without calling preventDefault', () => {
    setupMacElectron();
    render({ snoozeLabel: 'Snooze', onSnooze: vi.fn() });

    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    dispatchWheel({ deltaX: 90 });
    emitShell({ type: 'scroll-gesture', phase: 'end' });
    flushRaf();
    expect(track.style.transform).toBe('translateX(-156px)');

    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    expect(dispatchWheel({ deltaX: 2, deltaY: 25 })).not.toHaveBeenCalled();
    expect(dispatchWheel({ deltaX: 0, deltaY: 40 })).not.toHaveBeenCalled();
    emitShell({ type: 'scroll-gesture', phase: 'end' });
    expect(track.style.transform).toBe('');
  });

  it('ignores wheel events outside scroll-gesture, momentum events, modifiers, and non-pixel deltas', () => {
    setupMacElectron();
    const { onSwipe } = render({ snoozeLabel: 'Snooze', onSnooze: vi.fn() });

    // Outside scroll-gesture (e.g. mouse wheel)
    expect(dispatchWheel({ deltaX: 120 })).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');

    // Momentum / modifier / non-pixel inside scroll-gesture
    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    expect(dispatchWheel({ deltaX: 120, momentum: true })).not.toHaveBeenCalled();
    emitShell({ type: 'scroll-gesture', phase: 'end' });

    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    expect(dispatchWheel({ deltaX: 120, ctrlKey: true })).not.toHaveBeenCalled();
    emitShell({ type: 'scroll-gesture', phase: 'end' });

    emitShell({ type: 'scroll-gesture', phase: 'begin' });
    expect(dispatchWheel({ deltaX: 120, deltaMode: 1 })).not.toHaveBeenCalled();
    emitShell({ type: 'scroll-gesture', phase: 'end' });

    expect(onSwipe).not.toHaveBeenCalled();
    expect(track.style.transform).toBe('');
  });

  it('cancels an active trackpad swipe without committing on cancel, window-hidden, or blur', () => {
    setupMacElectron();
    const { onSwipe } = render({ snoozeLabel: 'Snooze', onSnooze: vi.fn() });

    for (const abort of [
      () => emitShell({ type: 'scroll-gesture', phase: 'cancel' }),
      () => emitShell({ type: 'window-hidden' }),
      () => act(() => (windowListeners.blur ?? []).forEach((fn) => fn())),
    ]) {
      emitShell({ type: 'scroll-gesture', phase: 'begin' });
      dispatchWheel({ deltaX: 200 });
      expect(track.style.transform).toBe('translateX(-200px)');
      abort();
      expect(track.style.transform).toBe('');
    }
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
