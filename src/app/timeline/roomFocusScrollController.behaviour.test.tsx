// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act as actInDom } from 'react-dom/test-utils';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  useRoomFocusScrollController,
  type RoomFocusScrollControllerOptions,
  type RoomTimelineFocusItem,
} from './roomFocusScrollController';
import type { PendingThreadTarget, ThreadTargetCommands } from '../threads/open/threadSessionTypes';

type Options = RoomFocusScrollControllerOptions;

const ROOM = '!room:example.org';

/** Room rows as the hook reads them: only their event IDs matter. */
const makeRows = (count: number, prefix = '$row'): MatrixEvent[] =>
  Array.from({ length: count }, (_, index) => {
    const eventId = `${prefix}-${index}`;
    return { getId: () => eventId } as unknown as MatrixEvent;
  });

const makeRow = (eventId: string): HTMLDivElement => {
  const row = document.createElement('div');
  row.setAttribute('data-message-id', eventId);
  return row;
};

/** A scroll area in the document with a row for each event ID. */
const makeScrollArea = (...eventIds: string[]): HTMLDivElement => {
  const area = document.createElement('div');
  eventIds.forEach((eventId) => area.appendChild(makeRow(eventId)));
  document.body.appendChild(area);
  return area;
};

const firstRow = (area: HTMLElement): HTMLElement => {
  const row = area.querySelector<HTMLElement>('[data-message-id]');
  if (!row) throw new Error('Expected a row in the scroll area');
  return row;
};

const makeTargets = (pending?: PendingThreadTarget) =>
  ({
    getPending: vi.fn(() => pending),
    queue: vi.fn(),
    complete: vi.fn(),
    discard: vi.fn(),
    advanceAttempt: vi.fn(),
    wakeRetry: vi.fn(),
  } satisfies ThreadTargetCommands);

/** The hook's options with recording callbacks; each test overrides what it is about. */
const setup = (scrollArea: HTMLDivElement | null, overrides: Partial<Options> = {}) => {
  const mocks = {
    retryPagination: vi.fn<Options['retryPagination']>(),
    scrollToElement: vi.fn<Options['scrollToElement']>(() => true),
    scrollToItem: vi.fn<Options['scrollToItem']>(() => true),
    setAtBottom: vi.fn<Options['setAtBottom']>(),
    setFocusItem: vi.fn<Options['setFocusItem']>(),
    cancelThreadOpenBottomPin: vi.fn<Options['cancelThreadOpenBottomPin']>(),
  };
  const rows = overrides.threadFilteredEvents ?? [];
  const options: Options = {
    alive: () => true,
    atBottomAnchorRef: { current: null },
    focusScrollResetToken: ROOM,
    threadTargets: makeTargets(),
    pendingThreadOpenTick: 0,
    roomId: ROOM,
    scrollRef: { current: scrollArea },
    scrollToBottomRef: { current: { count: 0, smooth: false } },
    suppressFocusPaginationRef: { current: false },
    isThreadOpenBottomPinSuppressed: () => false,
    requestThreadOpenBottomPin: () => false,
    shouldApplyThreadBottomPin: () => true,
    threadEventIndexMapRef: { current: new Map<string, number>() },
    threadEventsLength: 0,
    threadFilteredEvents: rows,
    threadFilteredEventsRef: { current: rows },
    threadInitialRenderMode: 'live',
    threadLatestOpenPending: false,
    threadOpenedAtLatest: false,
    threadUserScrolled: false,
    threadTimelineTick: 0,
    timelineAtLiveEnd: true,
    ...mocks,
    ...overrides,
  };
  return { options, mocks };
};

function Harness({ options }: { options: Options }) {
  useRoomFocusScrollController(options);
  return null;
}

type FocusState = { shown?: RoomTimelineFocusItem; set?: Options['setFocusItem'] };

/** Keeps the focus item in state, as the room timeline does, and reports it to `state`. */
function FocusHarness({
  options,
  initialFocus,
  state,
}: {
  options: Options;
  initialFocus: RoomTimelineFocusItem;
  state: FocusState;
}) {
  const [focusItem, setFocusItem] = useState<RoomTimelineFocusItem | undefined>(initialFocus);
  state.shown = focusItem;
  state.set = setFocusItem;
  useRoomFocusScrollController({ ...options, focusItem, setFocusItem });
  return null;
}

const rendered: ReactTestRenderer[] = [];

const render = (element: JSX.Element): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(element);
  });
  if (!renderer) throw new Error('Expected a renderer');
  rendered.push(renderer);
  return renderer;
};

/** Lets the mutation observers deliver the changes made so far. */
const flushMutations = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

/** A ResizeObserver whose size changes the test makes. */
const stubResizeObserver = () => {
  const callbacks: ResizeObserverCallback[] = [];
  class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }

    observe = vi.fn();

    unobserve = vi.fn();

    disconnect = vi.fn();
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    resize: () => callbacks.forEach((callback) => callback([], {} as ResizeObserver)),
  };
};

const stubAnimationFrames = () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
};

const fakeTimeouts = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

const firstCall = (mock: Mock) => mock.mock.invocationCallOrder[0] ?? Number.NaN;

const jumpTo = (eventId: string, index: number): RoomTimelineFocusItem => ({
  eventId,
  index,
  scrollTo: true,
  highlight: true,
});

afterEach(() => {
  // Unmounting stops what a test left running, such as a focus item's lifetime.
  rendered.splice(0).forEach((renderer) => {
    act(() => renderer.unmount());
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('unread marker opening', () => {
  const marker = { inLiveTimeline: true, readUptoEventId: '$row-6', scrollTo: true };
  const atTop = { behavior: 'instant', align: 'start', stopInView: true };

  it('puts the row after the marker at the top once when the room opens', () => {
    const { options, mocks } = setup(makeScrollArea(), {
      unreadInfo: marker,
      unreadScrollAnchorIndex: 7,
    });
    const renderer = render(<Harness options={options} />);

    expect(mocks.scrollToItem).toHaveBeenCalledTimes(1);
    expect(mocks.scrollToItem).toHaveBeenCalledWith(7, atTop);

    act(() => renderer.update(<Harness options={{ ...options }} />));
    expect(mocks.scrollToItem).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['in a thread', { threadId: '$thread' }],
    ['without a request to scroll there', { unreadInfo: { ...marker, scrollTo: false } }],
    [
      'for a marker outside the live timeline',
      { unreadInfo: { ...marker, inLiveTimeline: false } },
    ],
  ])('leaves the position alone %s', (_case, override: Partial<Options>) => {
    const { options, mocks } = setup(makeScrollArea(), {
      unreadInfo: marker,
      unreadScrollAnchorIndex: 7,
      ...override,
    });
    render(<Harness options={options} />);

    expect(mocks.scrollToItem).not.toHaveBeenCalled();
  });

  it('aims again while older rows load, until the reader scrolls', () => {
    const area = makeScrollArea();
    const { options, mocks } = setup(area, { unreadInfo: marker, unreadScrollAnchorIndex: 7 });
    const renderer = render(<Harness options={options} />);

    // Older rows page in above the marker before the reader touched anything.
    act(() => renderer.update(<Harness options={{ ...options, unreadScrollAnchorIndex: 27 }} />));
    expect(mocks.scrollToItem).toHaveBeenCalledTimes(2);
    expect(mocks.scrollToItem).toHaveBeenLastCalledWith(27, atTop);

    // The reader scrolls; more older rows arrive and must not pull them back to the marker.
    act(() => {
      area.dispatchEvent(new Event('wheel'));
    });
    act(() => renderer.update(<Harness options={{ ...options, unreadScrollAnchorIndex: 47 }} />));
    expect(mocks.scrollToItem).toHaveBeenCalledTimes(2);
  });

  it('stops at a gesture on a scroll area that mounts after the room view', () => {
    const { options, mocks } = setup(null, { unreadInfo: marker, unreadScrollAnchorIndex: 7 });
    const renderer = render(<Harness options={options} />);

    // The Compact view has no scroll area; the Full view mounts one and renders again.
    const area = makeScrollArea();
    options.scrollRef.current = area;
    act(() => renderer.update(<Harness options={{ ...options }} />));
    act(() => {
      area.dispatchEvent(new Event('wheel'));
    });
    act(() => renderer.update(<Harness options={{ ...options, unreadScrollAnchorIndex: 27 }} />));
    expect(mocks.scrollToItem).toHaveBeenCalledTimes(1);
  });

  it('stops aiming once the view changes', () => {
    const { options, mocks } = setup(makeScrollArea(), {
      unreadInfo: marker,
      unreadScrollAnchorIndex: 7,
    });
    const renderer = render(<Harness options={options} />);

    // A thread opens and closes again; the marker state of the room is still the same object.
    act(() => renderer.update(<Harness options={{ ...options, threadId: '$thread' }} />));
    act(() => renderer.update(<Harness options={{ ...options, unreadScrollAnchorIndex: 9 }} />));
    expect(mocks.scrollToItem).toHaveBeenCalledTimes(1);
  });
});

describe('reader gestures', () => {
  it('end the opening pin of an open thread once each, until the thread closes or unmounts', () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const area = makeScrollArea();
    const { options, mocks } = setup(area, { threadId: '$thread' });
    // A react-dom root: StrictMode mounts the effects, unmounts them and mounts them again.
    const root = createRoot(document.createElement('div'));
    const show = (current: Options) =>
      actInDom(() =>
        root.render(
          <StrictMode>
            <Harness options={current} />
          </StrictMode>
        )
      );
    const gesture = (type: string) =>
      actInDom(() => {
        area.dispatchEvent(new Event(type));
      });

    show(options);
    gesture('touchmove');
    gesture('scroll');
    expect(mocks.cancelThreadOpenBottomPin).toHaveBeenCalledTimes(1);

    show({ ...options, threadId: undefined });
    gesture('wheel');
    expect(mocks.cancelThreadOpenBottomPin).toHaveBeenCalledTimes(1);

    show(options);
    gesture('pointerdown');
    expect(mocks.cancelThreadOpenBottomPin).toHaveBeenCalledTimes(2);

    actInDom(() => root.unmount());
    gesture('keydown');
    expect(mocks.cancelThreadOpenBottomPin).toHaveBeenCalledTimes(2);
  });
});

describe('room focus jump', () => {
  it('pauses pagination, jumps to the index, then the row, and resumes after the settle', () => {
    fakeTimeouts();
    const sizes = stubResizeObserver();
    stubAnimationFrames();
    const area = makeScrollArea('$row-10');
    const row = firstRow(area);
    const { options, mocks } = setup(area, {
      threadFilteredEvents: makeRows(20),
      focusItem: jumpTo('$row-10', 10),
    });
    render(<Harness options={options} />);

    const centred = { behavior: 'instant', align: 'center', offset: undefined };
    expect(options.suppressFocusPaginationRef.current).toBe(true);
    expect(mocks.scrollToItem).toHaveBeenCalledWith(10, { ...centred, stopInView: false });
    expect(mocks.scrollToElement).toHaveBeenCalledWith(row, centred);
    expect(firstCall(mocks.scrollToItem)).toBeLessThan(firstCall(mocks.scrollToElement));

    // A row near the target measures: it is aimed at again, and the settle waits for rest.
    act(() => sizes.resize());
    expect(mocks.scrollToElement).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(mocks.retryPagination).not.toHaveBeenCalled();
    expect(options.suppressFocusPaginationRef.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mocks.retryPagination).toHaveBeenCalledWith({ preserveAnchorIndex: 10 });
    expect(options.suppressFocusPaginationRef.current).toBe(false);
  });

  it('finds a row that mounts later at the DOM change and settles it', async () => {
    const area = makeScrollArea();
    const { options, mocks } = setup(area, {
      threadFilteredEvents: makeRows(20),
      focusItem: jumpTo('$row-3', 3),
    });
    render(<Harness options={options} />);

    const nearStart = { behavior: 'instant', align: 'start', offset: 32 };
    expect(mocks.scrollToItem).toHaveBeenCalledWith(3, { ...nearStart, stopInView: false });
    expect(mocks.scrollToElement).not.toHaveBeenCalled();
    expect(options.suppressFocusPaginationRef.current).toBe(true);

    const row = makeRow('$row-3');
    await act(async () => {
      area.appendChild(makeRow('$row-2'));
      area.appendChild(row);
      await flushMutations();
    });
    expect(mocks.scrollToElement).toHaveBeenCalledTimes(1);
    expect(mocks.scrollToElement).toHaveBeenCalledWith(row, nearStart);
    // jsdom has no ResizeObserver, so the settle ends at once.
    expect(mocks.retryPagination).toHaveBeenCalledWith({ preserveAnchorIndex: 3 });
    expect(options.suppressFocusPaginationRef.current).toBe(false);
  });

  it('gives up on a row that does not show up within 2000 ms without resuming pagination', async () => {
    fakeTimeouts();
    const area = makeScrollArea();
    const { options, mocks } = setup(area, {
      threadFilteredEvents: makeRows(20),
      focusItem: jumpTo('$row-3', 3),
    });
    render(<Harness options={options} />);

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(options.suppressFocusPaginationRef.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(options.suppressFocusPaginationRef.current).toBe(false);
    expect(mocks.retryPagination).not.toHaveBeenCalled();

    await act(async () => {
      area.appendChild(makeRow('$row-3'));
      await flushMutations();
    });
    expect(mocks.scrollToElement).not.toHaveBeenCalled();
  });

  it('jumps to nothing in a thread or for a focus that does not ask for it', () => {
    const area = makeScrollArea('$row-3');
    const { options, mocks } = setup(area, {
      threadFilteredEvents: makeRows(20),
      focusItem: { ...jumpTo('$row-3', 3), scrollTo: false },
    });
    options.suppressFocusPaginationRef.current = true;
    const renderer = render(<Harness options={options} />);
    expect(options.suppressFocusPaginationRef.current).toBe(false);

    act(() =>
      renderer.update(
        <Harness options={{ ...options, threadId: '$thread', focusItem: jumpTo('$row-3', 3) }} />
      )
    );
    expect(mocks.scrollToItem).not.toHaveBeenCalled();
    expect(mocks.scrollToElement).not.toHaveBeenCalled();
  });

  it('moves the focus index with its event and aims at the new position while scrollTo holds', () => {
    const rows = makeRows(20);
    const area = makeScrollArea('$row-10');
    const { options, mocks } = setup(area, { threadFilteredEvents: rows });
    const state: FocusState = {};
    const harness = (current: Options) => (
      <FocusHarness options={current} initialFocus={jumpTo('$row-10', 10)} state={state} />
    );
    const renderer = render(harness(options));
    const centred = { behavior: 'instant', align: 'center', offset: undefined, stopInView: false };
    expect(mocks.scrollToItem).toHaveBeenLastCalledWith(10, centred);

    // Five older rows page in above the focused event.
    const moved = [...makeRows(5, '$older'), ...rows];
    options.threadFilteredEventsRef.current = moved;
    act(() => renderer.update(harness({ ...options, threadFilteredEvents: moved })));

    expect(state.shown).toEqual(jumpTo('$row-10', 15));
    expect(mocks.scrollToItem).toHaveBeenLastCalledWith(15, centred);
  });
});

describe('focus lifetime', () => {
  const highlighted: RoomTimelineFocusItem = {
    eventId: '$row-2',
    index: 2,
    scrollTo: false,
    highlight: true,
  };

  it('ends the highlight and the jump request 2200 ms later', () => {
    fakeTimeouts();
    const { options } = setup(null, { threadFilteredEvents: makeRows(5) });
    const state: FocusState = {};
    render(<FocusHarness options={options} initialFocus={highlighted} state={state} />);

    act(() => {
      vi.advanceTimersByTime(2199);
    });
    expect(state.shown).toBe(highlighted);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(state.shown).toEqual({ ...highlighted, highlight: false, scrollTo: false });
  });

  it('leaves a newer focus item alone', () => {
    fakeTimeouts();
    const { options } = setup(null, { threadFilteredEvents: makeRows(5) });
    const state: FocusState = {};
    render(<FocusHarness options={options} initialFocus={highlighted} state={state} />);

    const newer: RoomTimelineFocusItem = { ...highlighted, eventId: '$row-4', index: 4 };
    act(() => {
      vi.advanceTimersByTime(1000);
      state.set?.(newer);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(state.shown).toBe(newer);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(state.shown).toEqual({ ...newer, highlight: false });
  });

  it('only replaces the focus item it was started for', () => {
    fakeTimeouts();
    const { options, mocks } = setup(null, { focusItem: highlighted });
    render(<Harness options={options} />);
    act(() => {
      vi.advanceTimersByTime(2200);
    });

    const update = mocks.setFocusItem.mock.calls[0]?.[0];
    if (typeof update !== 'function') throw new Error('Expected a functional update');
    const newer: RoomTimelineFocusItem = { ...highlighted, eventId: '$row-4', index: 4 };
    expect(update(newer)).toBe(newer);
    expect(update(highlighted)).toEqual({ ...highlighted, highlight: false, scrollTo: false });
  });
});

describe('jump target in an open thread', () => {
  const target: PendingThreadTarget = {
    requestId: 5,
    threadId: '$thread',
    eventId: '$reply-3',
    highlight: true,
    attempts: 0,
  };

  it('cancels the opening pin, then centres the mounted row and completes the target', () => {
    const area = makeScrollArea('$reply-3');
    const threadTargets = makeTargets(target);
    const cancelThreadBottomSettle = vi.fn();
    const { options, mocks } = setup(area, {
      threadId: '$thread',
      threadTargets,
      cancelThreadBottomSettle,
      threadEventIndexMapRef: { current: new Map([['$reply-3', 3]]) },
    });
    render(<Harness options={options} />);

    expect(mocks.setFocusItem).toHaveBeenCalledWith({
      eventId: '$reply-3',
      index: 3,
      scrollTo: false,
      highlight: true,
    });
    const centredUnlessShown = { align: 'center', behavior: 'instant', stopInView: true };
    expect(mocks.scrollToElement).toHaveBeenCalledWith(firstRow(area), centredUnlessShown);
    expect(threadTargets.complete).toHaveBeenCalledWith(5, true);
    expect(firstCall(cancelThreadBottomSettle)).toBeLessThan(firstCall(mocks.scrollToElement));
    expect(firstCall(mocks.scrollToElement)).toBeLessThan(firstCall(threadTargets.complete));
    expect(threadTargets.advanceAttempt).not.toHaveBeenCalled();
  });

  it('discards a target meant for another thread', () => {
    const area = makeScrollArea('$reply-3');
    const threadTargets = makeTargets({ ...target, threadId: '$other-thread' });
    const { options, mocks } = setup(area, { threadId: '$thread', threadTargets });
    render(<Harness options={options} />);

    expect(threadTargets.discard).toHaveBeenCalledWith(5);
    expect(threadTargets.complete).not.toHaveBeenCalled();
    expect(mocks.scrollToElement).not.toHaveBeenCalled();
  });
});

describe('the message being edited', () => {
  it('brings its mounted row into view with a smooth, centred scroll', () => {
    const area = makeScrollArea('$row-4');
    const { options, mocks } = setup(area, { editId: '$row-4' });
    render(<Harness options={options} />);

    expect(mocks.scrollToElement).toHaveBeenCalledWith(firstRow(area), {
      behavior: 'smooth',
      align: 'center',
      stopInView: true,
    });
  });

  it('does nothing while its row is not mounted', () => {
    const { options, mocks } = setup(makeScrollArea('$row-4'), { editId: '$row-9' });
    render(<Harness options={options} />);

    expect(mocks.scrollToElement).not.toHaveBeenCalled();
  });
});

describe('room switch', () => {
  it('never lands a focus of the previous room in the next one', async () => {
    const area = makeScrollArea();
    const roomFocus = jumpTo('$a-5', 5);
    const { options, mocks } = setup(area, {
      threadFilteredEvents: makeRows(20, '$a'),
      focusItem: roomFocus,
    });
    const renderer = render(<Harness options={options} />);
    expect(mocks.scrollToItem).toHaveBeenCalledTimes(1);

    // The reader opens another room before the row showed up; the focus state is unchanged.
    const nextRoom = { ...options, roomId: '!b:example.org', focusScrollResetToken: '!b' };
    act(() => renderer.update(<Harness options={nextRoom} />));
    expect(options.suppressFocusPaginationRef.current).toBe(false);

    await act(async () => {
      area.appendChild(makeRow('$a-5'));
      await flushMutations();
    });
    expect(mocks.scrollToItem).toHaveBeenCalledTimes(1);
    expect(mocks.scrollToElement).not.toHaveBeenCalled();
    expect(mocks.retryPagination).not.toHaveBeenCalled();

    // A focus the next room asks for still jumps.
    act(() => renderer.update(<Harness options={{ ...nextRoom, focusItem: jumpTo('$a-5', 5) }} />));
    expect(mocks.scrollToItem).toHaveBeenCalledTimes(2);
  });
});

describe('unmount', () => {
  it('ends the settle without a pagination retry or a focus update', () => {
    fakeTimeouts();
    const sizes = stubResizeObserver();
    stubAnimationFrames();
    const area = makeScrollArea('$row-10');
    const { options, mocks } = setup(area, {
      threadFilteredEvents: makeRows(20),
      focusItem: jumpTo('$row-10', 10),
    });
    const renderer = render(<Harness options={options} />);
    expect(mocks.scrollToElement).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
    act(() => {
      sizes.resize();
      vi.advanceTimersByTime(5000);
    });
    expect(mocks.retryPagination).not.toHaveBeenCalled();
    expect(mocks.setFocusItem).not.toHaveBeenCalled();
    expect(options.suppressFocusPaginationRef.current).toBe(false);
  });

  it('ends the wait for the row without a pagination retry or a focus update', async () => {
    fakeTimeouts();
    const area = makeScrollArea();
    const { options, mocks } = setup(area, {
      threadFilteredEvents: makeRows(20),
      focusItem: jumpTo('$row-10', 10),
    });
    const renderer = render(<Harness options={options} />);

    act(() => renderer.unmount());
    await act(async () => {
      area.appendChild(makeRow('$row-10'));
      await flushMutations();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(mocks.scrollToElement).not.toHaveBeenCalled();
    expect(mocks.retryPagination).not.toHaveBeenCalled();
    expect(mocks.setFocusItem).not.toHaveBeenCalled();
  });
});

describe('bottom-pin requests', () => {
  const openThread = () => {
    const area = makeScrollArea();
    const scrollTo = vi.fn();
    area.scrollTo = scrollTo;
    const pins = { current: { count: 0, smooth: false } };
    const { options } = setup(area, {
      threadId: '$thread',
      threadEventsLength: 20,
      threadLatestOpenPending: true,
      scrollToBottomRef: pins,
      requestThreadOpenBottomPin: () => {
        pins.current = { count: pins.current.count + 1, smooth: false };
        return true;
      },
    });
    const renderer = render(<Harness options={options} />);
    return { options, pins, renderer, scrollTo };
  };

  it('takes an opening pin in the commit that asked for it, never in a later one', () => {
    const { options, pins, renderer, scrollTo } = openThread();
    expect(pins.current.count).toBe(1);
    const scrollsAtOpen = scrollTo.mock.calls.length;
    expect(scrollsAtOpen).toBeGreaterThan(0);

    // The open completes; nothing asks for the bottom again.
    act(() =>
      renderer.update(<Harness options={{ ...options, threadLatestOpenPending: false }} />)
    );
    expect(scrollTo).toHaveBeenCalledTimes(scrollsAtOpen);
  });

  it('pins a thread opened at its newest row again when its rows grow below the view', () => {
    const { options, renderer, scrollTo } = openThread();
    const area = options.scrollRef.current;
    if (!area) throw new Error('Expected the scroll area');
    const settled = { ...options, threadLatestOpenPending: false, threadOpenedAtLatest: true };
    act(() => renderer.update(<Harness options={settled} />));
    scrollTo.mockClear();

    // The rows measured taller than estimated, and the commit that renders the measurement
    // changes nothing else: the bottom is 440 px below the view.
    Object.defineProperty(area, 'scrollHeight', { configurable: true, value: 1300 });
    Object.defineProperty(area, 'clientHeight', { configurable: true, value: 860 });
    act(() => renderer.update(<Harness options={{ ...settled }} />));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 440, behavior: 'instant' });

    // At the bottom nothing moves; after the reader's own scroll the pin is over.
    Object.defineProperty(area, 'scrollTop', { configurable: true, value: 440 });
    scrollTo.mockClear();
    act(() => renderer.update(<Harness options={{ ...settled }} />));
    expect(scrollTo).not.toHaveBeenCalled();
    // A script or assistive technology moved the view up, without a gesture: it stays there.
    Object.defineProperty(area, 'scrollTop', { configurable: true, value: 200 });
    act(() => renderer.update(<Harness options={{ ...settled }} />));
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(area, 'scrollTop', { configurable: true, value: 100 });
    act(() => renderer.update(<Harness options={{ ...settled, threadUserScrolled: true }} />));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it.each([
    { extraScroll: 0, shouldPin: true },
    { extraScroll: -20, shouldPin: false },
  ])('keeps opening ownership after measurement corrections, extra scroll $extraScroll', ({ extraScroll, shouldPin }) => {
    const { options, renderer, scrollTo } = openThread();
    const area = options.scrollRef.current;
    if (!area) throw new Error('Expected the scroll area');
    let correction = 0;
    const settled = {
      ...options,
      threadLatestOpenPending: false,
      threadOpenedAtLatest: true,
      readMeasurementCorrectionPx: () => correction,
    };
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, value: 1300 },
      clientHeight: { configurable: true, value: 860 },
      scrollTop: { configurable: true, value: 440 },
    });
    act(() => renderer.update(<Harness options={settled} />));
    scrollTo.mockClear();

    // The same measurement pass grows some rows and shrinks six others by 10 px each.
    // The list corrects the scroll upward by 60 px before rendering its larger height.
    correction = -60;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, value: 1402 },
      scrollTop: { configurable: true, value: 380 + extraScroll },
    });
    act(() => renderer.update(<Harness options={settled} />));
    if (shouldPin) {
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 542, behavior: 'instant' });
    } else {
      expect(scrollTo).not.toHaveBeenCalled();
    }
  });

  it('applies a later request once, smoothly when it asks so', () => {
    const { options, pins, renderer, scrollTo } = openThread();
    const settled = { ...options, threadLatestOpenPending: false };
    act(() => renderer.update(<Harness options={settled} />));
    scrollTo.mockClear();

    pins.current = { count: pins.current.count + 1, smooth: true };
    act(() => renderer.update(<Harness options={{ ...settled }} />));
    act(() => renderer.update(<Harness options={{ ...settled }} />));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  /** A scroll area whose geometry the test sets, with frames it runs one at a time. */
  const geometry = (area: HTMLElement, sizes: { scrollHeight: number; clientHeight: number }) => {
    Object.defineProperty(area, 'scrollHeight', {
      configurable: true,
      get: () => sizes.scrollHeight,
    });
    Object.defineProperty(area, 'clientHeight', {
      configurable: true,
      get: () => sizes.clientHeight,
    });
    Object.defineProperty(area, 'scrollTop', { configurable: true, writable: true, value: 0 });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    );
    const nextFrame = () => frames.splice(0).forEach((callback) => callback(0));
    return { nextFrame };
  };

  const smoothPin = () => {
    const opened = openThread();
    const area = opened.options.scrollRef.current as HTMLDivElement;
    const sizes = { scrollHeight: 2000, clientHeight: 500 };
    const { nextFrame } = geometry(area, sizes);
    area.scrollTop = 1400;
    const settled = { ...opened.options, threadLatestOpenPending: false };
    act(() => opened.renderer.update(<Harness options={settled} />));
    opened.scrollTo.mockClear();
    opened.pins.current = { count: opened.pins.current.count + 1, smooth: true };
    act(() => opened.renderer.update(<Harness options={{ ...settled }} />));
    return { ...opened, area, nextFrame, settled, sizes };
  };

  it('finishes a smooth pin at once when it stops short of the end', () => {
    const { area, nextFrame, scrollTo, sizes } = smoothPin();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1500, behavior: 'smooth' });
    // The composer's typing line moves the position by a write, which stops the animation, and
    // the reader's own message grows the end past where it aimed.
    area.scrollTop = 1424;
    sizes.scrollHeight = 2068;
    // It starts a frame after the request, and stopped when a frame finds it where it was.
    nextFrame();
    nextFrame();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    nextFrame();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1568, behavior: 'instant' });
  });

  it('leaves a smooth pin that reaches the end, or that a gesture or a newer request ended', () => {
    const reached = smoothPin();
    reached.area.scrollTop = 1500;
    [1, 2, 3, 4].forEach(reached.nextFrame);
    expect(reached.scrollTo).toHaveBeenCalledTimes(1);
    act(() => reached.renderer.unmount());

    const gesture = smoothPin();
    gesture.area.scrollTop = 1424;
    const count = gesture.pins.current.count;
    act(() =>
      gesture.renderer.update(
        <Harness options={{ ...gesture.settled, shouldApplyThreadBottomPin: (c) => c !== count }} />
      )
    );
    [1, 2, 3, 4].forEach(gesture.nextFrame);
    expect(gesture.scrollTo).toHaveBeenCalledTimes(1);
    act(() => gesture.renderer.unmount());

    const jumped = smoothPin();
    jumped.area.scrollTop = 1424;
    jumped.nextFrame();
    jumped.nextFrame();
    // A jump to an older message moves the position up while the pin waits.
    jumped.area.scrollTop = 300;
    [1, 2, 3].forEach(jumped.nextFrame);
    expect(jumped.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('skips a request the guard refuses', () => {
    const { options, pins, renderer, scrollTo } = openThread();
    const settled = { ...options, threadLatestOpenPending: false };
    act(() => renderer.update(<Harness options={settled} />));
    scrollTo.mockClear();

    pins.current = { count: pins.current.count + 1, smooth: false };
    const refused = pins.current.count;
    const guarded = {
      ...settled,
      shouldApplyThreadBottomPin: (count: number) => count !== refused,
    };
    act(() => renderer.update(<Harness options={guarded} />));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
