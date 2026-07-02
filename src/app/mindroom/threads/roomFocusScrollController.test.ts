import React, { createRef, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  useRoomFocusScrollController,
  type RoomFocusScrollControllerOptions,
} from './roomFocusScrollController';

type Listener = () => void;

const makeScrollElement = (): HTMLDivElement & {
  dispatchScroll: () => void;
  dispatch: (type: string) => void;
  listeners: Map<string, Set<Listener>>;
  scrollTo: ReturnType<typeof vi.fn>;
} => {
  const listeners = new Map<string, Set<Listener>>();
  const scrollEl = {
    addEventListener: (type: string, listener: Listener) => {
      const nextListeners = listeners.get(type) ?? new Set<Listener>();
      nextListeners.add(listener);
      listeners.set(type, nextListeners);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    },
    dispatchScroll: () => {
      listeners.get('scroll')?.forEach((listener) => listener());
    },
    dispatch: (type: string) => {
      listeners.get(type)?.forEach((listener) => listener());
    },
    getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    querySelectorAll: () => [],
    scrollHeight: 1000,
    clientHeight: 400,
    scrollTop: 0,
    offsetHeight: 400,
    scrollTo: vi.fn(),
  } as unknown as HTMLDivElement & {
    dispatchScroll: () => void;
    dispatch: (type: string) => void;
    listeners: Map<string, Set<Listener>>;
    scrollTo: ReturnType<typeof vi.fn>;
  };
  scrollEl.listeners = listeners;
  return scrollEl;
};

type HarnessProps = Partial<RoomFocusScrollControllerOptions> & {
  onSuppressRef: (ref: React.MutableRefObject<boolean>) => void;
  scrollEl: HTMLDivElement;
};

function Harness({ onSuppressRef, scrollEl, ...overrides }: HarnessProps) {
  const suppressThreadOpenBottomPinRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(scrollEl);
  scrollRef.current = scrollEl;
  onSuppressRef(suppressThreadOpenBottomPinRef);

  useRoomFocusScrollController({
    alive: () => true,
    atBottomAnchorRef: createRef(),
    focusScrollResetToken: 'test',
    pendingThreadOpenRef: createRef(),
    pendingThreadOpenTick: 0,
    restorePendingThreadBackPaginationAnchor: vi.fn(() => false),
    retryPagination: vi.fn(),
    roomId: '!room:test',
    scrollRef,
    scrollToBottomRef: { current: { count: 0, smooth: false } },
    scrollToElement: vi.fn(),
    scrollToItem: vi.fn(),
    setAtBottom: vi.fn(),
    setFocusItem: vi.fn(),
    setPendingThreadOpenTick: vi.fn(),
    suppressFocusPaginationRef: { current: false },
    suppressThreadOpenBottomPinRef,
    threadEventIndexMapRef: { current: new Map() },
    threadEventsLength: 0,
    threadFilteredEvents: [],
    threadFilteredEventsRef: { current: [] },
    threadId: '$thread',
    threadInitialRenderMode: 'live',
    threadLatestOpenPending: true,
    threadTimelineTick: 0,
    timelineAtLiveEnd: true,
    ...overrides,
  });

  return null;
}

describe('useRoomFocusScrollController', () => {
  it('cancels a pending thread-open bottom pin when the user scrolls before events render', () => {
    const scrollEl = makeScrollElement();
    let renderer: ReactTestRenderer;
    let suppressRef: React.MutableRefObject<boolean> | undefined;

    act(() => {
      renderer = create(
        React.createElement(Harness, {
          scrollEl,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    scrollEl.scrollTo.mockClear();
    act(() => {
      scrollEl.dispatch('wheel');
      scrollEl.dispatchScroll();
    });

    expect(suppressRef?.current).toBe(true);

    act(() => {
      renderer.update(
        React.createElement(Harness, {
          scrollEl,
          threadEventsLength: 20,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    expect(scrollEl.scrollTo).not.toHaveBeenCalled();
  });

  it('does not cancel the open bottom pin on programmatic scrolls without user intent', () => {
    // Virtualized timelines adjust the scroll offset programmatically when
    // rows above the viewport re-measure; those scroll events must not be
    // mistaken for the user scrolling away during a pending open.
    const scrollEl = makeScrollElement();
    let suppressRef: React.MutableRefObject<boolean> | undefined;

    act(() => {
      create(
        React.createElement(Harness, {
          scrollEl,
          onSuppressRef: (ref) => {
            suppressRef = ref;
          },
        })
      );
    });

    act(() => {
      scrollEl.dispatchScroll();
      scrollEl.dispatchScroll();
    });

    expect(suppressRef?.current).toBe(false);
  });

  it('falls back to virtualizer index scrolling when a pending thread-open target row is unmounted', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    try {
      const scrollEl = makeScrollElement();
      const pendingThreadOpenRef = {
        current: {
          threadId: '$thread',
          eventId: '$target',
          highlight: false,
          attempts: 2,
        },
      };
      const scrollThreadEventIntoView = vi.fn(() => true);
      const setPendingThreadOpenTick = vi.fn();

      act(() => {
        create(
          React.createElement(Harness, {
            scrollEl,
            onSuppressRef: () => undefined,
            pendingThreadOpenRef,
            scrollThreadEventIntoView,
            setPendingThreadOpenTick,
            threadEventIndexMapRef: { current: new Map([['$target', 42]]) },
            threadLatestOpenPending: false,
          })
        );
      });

      expect(scrollThreadEventIntoView).toHaveBeenCalledWith('$target');
      expect(pendingThreadOpenRef.current?.attempts).toBe(3);
      expect(setPendingThreadOpenTick).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives up a pending thread open after three attempts without invoking the fallback', () => {
    const scrollEl = makeScrollElement();
    const onScroll = vi.fn();
    const pendingThreadOpenRef = {
      current: {
        threadId: '$thread',
        eventId: '$target',
        highlight: false,
        attempts: 3,
        onScroll,
      } as
        | {
            threadId: string;
            eventId: string;
            highlight: boolean;
            attempts: number;
            onScroll?: (success: boolean) => void;
          }
        | undefined,
    };
    const scrollThreadEventIntoView = vi.fn(() => true);

    act(() => {
      create(
        React.createElement(Harness, {
          scrollEl,
          onSuppressRef: () => undefined,
          pendingThreadOpenRef,
          scrollThreadEventIntoView,
          threadLatestOpenPending: false,
        })
      );
    });

    expect(scrollThreadEventIntoView).not.toHaveBeenCalled();
    expect(onScroll).toHaveBeenCalledWith(false);
    expect(pendingThreadOpenRef.current).toBeUndefined();
  });
});
