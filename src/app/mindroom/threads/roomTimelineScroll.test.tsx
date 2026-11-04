import { createElement, useReducer, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  useRoomFocusScrollController,
  type ScrollToBottomState,
} from './roomFocusScrollController';
import { useThreadBackPaginationController } from './threadBackPaginationController';
import { useViewScopedFlag } from './roomTimelineViewScope';
import { useThreadGestureBottomPins } from './roomTimelineScroll';
import type { ThreadTargetCommands } from './session/threadSessionTypes';

/** A thread's scroll area at its bottom: listeners by event type and a recorded `scrollTo`. */
const fakeThreadScroller = () => {
  const handlers = new Map<string, Set<() => void>>();
  const element = {
    scrollHeight: 3000,
    clientHeight: 600,
    scrollTop: 2400,
    scrollTo: vi.fn(),
    addEventListener: (type: string, handler: () => void) => {
      const forType = handlers.get(type) ?? new Set<() => void>();
      forType.add(handler);
      handlers.set(type, forType);
    },
    removeEventListener: (type: string, handler: () => void) => {
      handlers.get(type)?.delete(handler);
    },
  };
  const fire = (type: string) => handlers.get(type)?.forEach((handler) => handler());
  return { element, fire };
};

const noTargets: ThreadTargetCommands = {
  getPending: () => undefined,
  queue: () => undefined,
  complete: () => undefined,
  discard: () => undefined,
  advanceAttempt: () => undefined,
  wakeRetry: () => undefined,
};

type ThreadProps = {
  scroller: ReturnType<typeof fakeThreadScroller>['element'];
  pins: { current: ScrollToBottomState };
  rows: number;
  openPending: boolean;
};

/** The pieces of an open thread that decide its bottom pins, wired as the room timeline does. */
function OpenThread({ scroller, pins, rows, openPending }: ThreadProps) {
  const scrollRef = useRef(scroller as unknown as HTMLDivElement);
  const backController = useThreadBackPaginationController();
  const readerScrolledRef = useViewScopedFlag('!room|$thread');
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const gesturePins = useThreadGestureBottomPins({
    backController,
    scrollToBottomRef: pins,
    readerScrolledRef,
    onFirstGesture: rerender,
  });
  useRoomFocusScrollController({
    alive: () => true,
    atBottomAnchorRef: { current: null },
    focusScrollResetToken: '!room',
    threadTargets: noTargets,
    pendingThreadOpenTick: 0,
    retryPagination: () => undefined,
    roomId: '!room',
    scrollRef,
    scrollToBottomRef: pins,
    scrollToElement: () => false,
    scrollToItem: () => false,
    setAtBottom: () => undefined,
    setFocusItem: () => undefined,
    suppressFocusPaginationRef: { current: false },
    isThreadOpenBottomPinSuppressed: backController.isOpenBottomPinSuppressed,
    requestThreadOpenBottomPin: () => backController.requestOpenBottomPin(pins),
    cancelThreadOpenBottomPin: gesturePins.onThreadGesture,
    shouldApplyThreadBottomPin: gesturePins.shouldApplyBottomPin,
    threadEventIndexMapRef: { current: new Map() },
    threadEventsLength: rows,
    threadFilteredEvents: [],
    threadFilteredEventsRef: { current: [] },
    threadId: '$thread',
    threadInitialRenderMode: 'live',
    threadLatestOpenPending: openPending,
    threadOpenedAtLatest: true,
    threadUserScrolled: readerScrolledRef.current.value,
    threadTimelineTick: 0,
    timelineAtLiveEnd: true,
  });
  return null;
}

/** A thread opened at its newest row, the opening done, the reader still at the bottom. */
const openAtLatest = () => {
  const { element, fire } = fakeThreadScroller();
  const pins = { current: { count: 0, smooth: false } };
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      createElement(OpenThread, { scroller: element, pins, rows: 20, openPending: true })
    );
  });
  if (!renderer) throw new Error('Expected a renderer');
  const shown = renderer;
  act(() => {
    shown.update(
      createElement(OpenThread, { scroller: element, pins, rows: 20, openPending: false })
    );
  });
  expect(element.scrollTo).toHaveBeenCalled();
  element.scrollTo.mockClear();
  const showRows = (rows: number) =>
    act(() => {
      shown.update(
        createElement(OpenThread, { scroller: element, pins, rows, openPending: false })
      );
    });
  // What the live row handling does for a row that arrives while the reader is at the bottom.
  const followNewRow = () => {
    pins.current.count += 1;
  };
  return { element, fire, showRows, followNewRow };
};

describe('useThreadGestureBottomPins', () => {
  it('drops a follow pin a row asked for when the reader touches before it is applied', () => {
    const thread = openAtLatest();

    thread.followNewRow();
    // The reader's finger lands before the commit that shows the new row.
    act(() => thread.fire('touchstart'));
    thread.showRows(21);

    expect(thread.element.scrollTo).not.toHaveBeenCalled();
  });

  it('drops a pin queued before a later gesture of a reader who already scrolled', () => {
    const thread = openAtLatest();
    act(() => thread.fire('touchstart'));
    thread.showRows(20);

    thread.followNewRow();
    act(() => thread.fire('wheel'));
    thread.showRows(21);

    expect(thread.element.scrollTo).not.toHaveBeenCalled();
  });

  it('still follows a row that asks after the gesture', () => {
    const thread = openAtLatest();
    act(() => thread.fire('touchstart'));
    thread.showRows(20);

    thread.followNewRow();
    thread.showRows(21);

    expect(thread.element.scrollTo).toHaveBeenCalledTimes(1);
    expect(thread.element.scrollTo).toHaveBeenCalledWith({ top: 2400, behavior: 'instant' });
  });
});
