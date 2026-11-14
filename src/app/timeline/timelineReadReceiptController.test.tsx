// @vitest-environment jsdom
import React from 'react';
import { getDefaultStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import {
  markMainTimelineAsRead,
  markRoomAndThreadsAsRead,
  markThreadAsRead,
} from '../notifications/readReceipts';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import {
  conversationBehindPanelAtom,
  conversationCoveredAtom,
} from '../navigation/conversationCover';
import {
  ConversationViewContext,
  shownConversationViewsAtom,
} from '../navigation/conversationView';

vi.mock('../notifications/readReceipts', () => ({
  markMainTimelineAsRead: vi.fn(),
  markRoomAndThreadsAsRead: vi.fn(),
  markThreadAsRead: vi.fn(),
}));

/** Each wait for the scroll area to rest, until the test lets it rest. */
const { rests } = vi.hoisted(() => ({ rests: [] as Array<() => void> }));
vi.mock('./scrollQuiescence', () => ({
  waitForScrollQuiescence: () => new Promise<void>((resolve) => rests.push(resolve)),
}));

/** The observers the hook creates, with their callbacks, newest last. */
const observers: FakeObserver[] = [];

class FakeObserver {
  observe = vi.fn();

  unobserve = vi.fn();

  disconnect = vi.fn();

  constructor(readonly report: IntersectionObserverCallback) {
    observers.push(this);
  }
}

const anchor = document.createElement('span');
const anchorRef = { current: anchor };
const atBottomRef = { current: false };
const atLiveEndRef = { current: false };
const readUptoEventIdRef: { current: string | undefined } = { current: undefined };
const room = { roomId: '!room:example.org' } as Room;
const mx = {} as MatrixClient;
const getScrollElement = () => null;
const handleOpenEvent = () => undefined;

function Harness({
  atLiveEnd,
  setAtBottom,
}: {
  atLiveEnd: boolean;
  setAtBottom: (atBottom: React.SetStateAction<boolean>) => void;
}) {
  atLiveEndRef.current = atLiveEnd;
  useTimelineReadReceiptController({
    atBottom: false,
    atBottomAnchorRef: anchorRef,
    atBottomRef,
    atLiveEndRef,
    getScrollElement,
    handleOpenEvent,
    hideActivity: false,
    mx,
    readUptoEventIdRef,
    room,
    setAtBottom,
    threadEvents: [],
    threadEventsLength: 0,
    threadInitialRenderMode: 'live',
    threadTailLoaded: true,
    timelineAtLiveEnd: atLiveEnd,
  });
  return null;
}

describe('useTimelineReadReceiptController', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it('reports the bottom anchor again once the window is back at the live end', () => {
    const setAtBottom = vi.fn();
    act(() => {
      renderer = create(<Harness atLiveEnd={false} setAtBottom={setAtBottom} />);
    });
    const observer = observers.at(-1);
    expect(observer?.observe).toHaveBeenCalledWith(anchor);
    expect(observer?.unobserve).not.toHaveBeenCalled();

    // The reader stayed at the bottom while the window left the live end and came back: the
    // anchor never left the margin, so only a fresh report can show them at the bottom.
    act(() => renderer?.update(<Harness atLiveEnd setAtBottom={setAtBottom} />));
    expect(observers.at(-1)).toBe(observer);
    expect(observer?.unobserve).toHaveBeenCalledWith(anchor);
    expect(observer?.observe).toHaveBeenLastCalledWith(anchor);

    act(() =>
      observer?.report(
        [{ target: anchor, isIntersecting: true } as unknown as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver
      )
    );
    expect(setAtBottom).toHaveBeenCalledWith(true);
  });
});

type ControllerOptions = Parameters<typeof useTimelineReadReceiptController>[0];

/** An observer double that also keeps the options it was built with. */
class RecordingObserver extends FakeObserver {
  constructor(report: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    super(report);
  }
}

/** The four sides of a CSS margin shorthand, as top, right, bottom and left. */
const marginSides = (margin = '') => {
  const [top = '0px', right = top, bottom = top, left = right] = margin.trim().split(/\s+/);
  return { top, right, bottom, left };
};

/** A timeline double whose forward neighbour is `next`. */
const timelineDouble = (next?: object) => ({
  getNeighbouringTimeline: (direction: Direction) =>
    direction === Direction.Forward ? next ?? null : null,
});

const liveTimeline = timelineDouble();
const loadedTimelines: Record<string, object> = {
  // Older history whose forward links run into the live timeline.
  $linked: timelineDouble(timelineDouble(liveTimeline)),
  // History the reader jumped to, cut off from the live end.
  $detached: timelineDouble(),
};
const roomWithTimelines = {
  roomId: room.roomId,
  getLiveTimeline: () => liveTimeline,
  getUnfilteredTimelineSet: () => ({
    getTimelineForEvent: (eventId: string) => loadedTimelines[eventId] ?? null,
  }),
} as unknown as Room;

describe('useTimelineReadReceiptController bottom detection and receipts', () => {
  let probe: ReactTestRenderer | undefined;
  let frames: FrameRequestCallback[] = [];
  let markAsRead: (() => void) | undefined;

  function Probe({ options }: { options: ControllerOptions }) {
    markAsRead = useTimelineReadReceiptController(options).handleMarkAsRead;
    return null;
  }

  const optionsWith = (overrides: Partial<ControllerOptions> = {}): ControllerOptions => ({
    atBottom: true,
    atBottomAnchorRef: { current: anchor },
    atBottomRef: { current: true },
    atLiveEndRef: { current: true },
    getScrollElement,
    handleOpenEvent: vi.fn(),
    hideActivity: false,
    mx,
    readUptoEventIdRef: { current: undefined },
    room,
    setAtBottom: vi.fn(),
    threadEvents: [],
    threadEventsLength: 0,
    threadInitialRenderMode: 'live',
    threadTailLoaded: true,
    timelineAtLiveEnd: true,
    ...overrides,
  });

  const mount = (options: ControllerOptions) => {
    act(() => {
      probe = create(<Probe options={options} />);
    });
  };
  const rerender = (options: ControllerOptions) => {
    act(() => probe?.update(<Probe options={options} />));
  };
  const reportAnchor = (isIntersecting: boolean, target: Element = anchor) => {
    const observer = observers.at(-1);
    act(() =>
      observer?.report(
        [{ target, isIntersecting } as unknown as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver
      )
    );
  };
  const runFrames = () => frames.splice(0).forEach((frame) => frame(0));
  const focusWindow = () => {
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
  };

  beforeEach(() => {
    observers.length = 0;
    frames = [];
    vi.clearAllMocks();
    vi.stubGlobal('IntersectionObserver', RecordingObserver);
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame));
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    act(() => probe?.unmount());
    probe = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('bottom detection', () => {
    const awayFromLiveEnd = { atLiveEndRef: { current: false }, timelineAtLiveEnd: false };

    it.each([
      { reports: [false, true], atBottom: true },
      { reports: [true, false], atBottom: false },
    ])('uses the last anchor report in a batch: $reports', ({ reports, atBottom }) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const setAtBottom = vi.fn();
      mount(optionsWith({ setAtBottom }));
      const observer = observers.at(-1);
      const bounds = new DOMRect(0, 0, 100, 100);
      act(() => {
        observer?.report(
          reports.map((isIntersecting, time) => ({
            target: anchor,
            isIntersecting,
            time,
            boundingClientRect: bounds,
            intersectionRect: bounds,
            rootBounds: bounds,
            intersectionRatio: isIntersecting ? 1 : 0,
          })),
          observer as unknown as IntersectionObserver
        );
        vi.advanceTimersByTime(500);
      });
      expect(setAtBottom).toHaveBeenLastCalledWith(atBottom);
    });

    it('shows the reader at the bottom at once and away only after 500 ms without a report', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const setAtBottom = vi.fn();
      mount(optionsWith({ setAtBottom }));

      reportAnchor(true);
      expect(setAtBottom).toHaveBeenCalledWith(true);

      setAtBottom.mockClear();
      reportAnchor(false);
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(setAtBottom).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(setAtBottom).toHaveBeenCalledWith(false);
    });

    it('keeps the reader at the bottom when the anchor is back within 500 ms', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const setAtBottom = vi.fn();
      mount(optionsWith({ setAtBottom }));

      reportAnchor(false);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      reportAnchor(true);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(setAtBottom).toHaveBeenCalledWith(true);
      expect(setAtBottom).not.toHaveBeenCalledWith(false);
    });

    it('keeps Jump to Latest offered at the end of rows away from the live end', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const setAtBottom = vi.fn();
      mount(optionsWith({ ...awayFromLiveEnd, setAtBottom }));

      // A message link's window: its newest loaded row, and the anchor after it, are in view.
      reportAnchor(true);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(setAtBottom).not.toHaveBeenCalled();
      runFrames();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    });

    it('sets nothing when the view unmounts within the 500 ms', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const setAtBottom = vi.fn();
      mount(optionsWith({ ...awayFromLiveEnd, setAtBottom }));

      reportAnchor(false);
      act(() => probe?.unmount());
      probe = undefined;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(setAtBottom).not.toHaveBeenCalled();
    });

    it('ignores reports about other elements', () => {
      const setAtBottom = vi.fn();
      mount(optionsWith({ setAtBottom }));

      reportAnchor(true, document.createElement('div'));
      runFrames();
      expect(setAtBottom).not.toHaveBeenCalled();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    });

    it('watches the anchor from the scroll area, reaching 96 px below it, and starts over with a new scroll area', () => {
      const firstArea = document.createElement('div');
      const options = optionsWith({ getScrollElement: () => firstArea });
      mount(options);
      const first = observers.at(-1) as RecordingObserver | undefined;
      expect(first?.options?.root).toBe(firstArea);
      expect(marginSides(first?.options?.rootMargin)).toEqual({
        top: '0px',
        right: '0px',
        bottom: '96px',
        left: '0px',
      });
      expect(first?.observe).toHaveBeenCalledWith(anchor);

      const secondArea = document.createElement('div');
      rerender({ ...options, getScrollElement: () => secondArea });
      const second = observers.at(-1) as RecordingObserver | undefined;
      expect(second).not.toBe(first);
      expect(first?.disconnect).toHaveBeenCalled();
      expect(second?.options?.root).toBe(secondArea);
      expect(second?.observe).toHaveBeenCalledWith(anchor);
    });

    it('uses the viewport as root while there is no scroll area', () => {
      mount(optionsWith());
      expect((observers.at(-1) as RecordingObserver | undefined)?.options?.root).toBeNull();
    });
  });

  describe('reaching the bottom of the room', () => {
    it('reads the main timeline on the next frame when the reader has no read marker', () => {
      mount(optionsWith({ hideActivity: true }));

      reportAnchor(true);
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
      runFrames();
      expect(markMainTimelineAsRead).toHaveBeenCalledTimes(1);
      expect(markMainTimelineAsRead).toHaveBeenCalledWith(mx, room.roomId, true);
    });

    it('reads nothing without window focus', () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      mount(optionsWith());

      reportAnchor(true);
      runFrames();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    });

    it('reads nothing when the reader scrolled away before the frame comes', () => {
      mount(optionsWith());

      reportAnchor(true);
      const away = vi
        .spyOn(anchor, 'getBoundingClientRect')
        .mockReturnValue({ top: 5_000 } as DOMRect);
      runFrames();
      away.mockRestore();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    });

    it('reads nothing when the window loses its focus before the frame comes', () => {
      mount(optionsWith());

      reportAnchor(true);
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      runFrames();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    });

    it('reads nothing away from the live end', () => {
      mount(optionsWith({ atLiveEndRef: { current: false }, timelineAtLiveEnd: false }));

      reportAnchor(true);
      runFrames();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    });

    it.each([
      ['in history linked to the live timeline', '$linked', 1],
      ['in history cut off from the live timeline', '$detached', 0],
      ['not loaded', '$unloaded', 0],
    ])('with the read marker %s (%s), sends %i main receipts', (_where, marker, receipts) => {
      mount(optionsWith({ room: roomWithTimelines, readUptoEventIdRef: { current: marker } }));

      reportAnchor(true);
      runFrames();
      expect(markMainTimelineAsRead).toHaveBeenCalledTimes(receipts);
    });

    it('reads another room the view shows from a fresh report of the anchor', () => {
      const options = optionsWith();
      mount(options);
      const observer = observers.at(-1);
      const unobserved = observer?.unobserve.mock.calls.length ?? 0;

      // The view stays mounted from one room to the next, at the live end of each: the anchor
      // stays within reach, so only observing it afresh makes it report for the next room.
      const next = { roomId: '!next:example.org' } as Room;
      rerender({ ...options, room: next });
      expect(observers.at(-1)).toBe(observer);
      expect(observer?.unobserve).toHaveBeenCalledTimes(unobserved + 1);
      expect(observer?.observe).toHaveBeenLastCalledWith(anchor);

      reportAnchor(true);
      runFrames();
      expect(markMainTimelineAsRead).toHaveBeenCalledWith(mx, next.roomId, false);
    });

    it('reads the room from the fresh report once the view is back at its live end', () => {
      const options = optionsWith({ atLiveEndRef: { current: false }, timelineAtLiveEnd: false });
      mount(options);
      const observer = observers.at(-1);

      options.atLiveEndRef.current = true;
      rerender({ ...options, timelineAtLiveEnd: true });
      expect(observers.at(-1)).toBe(observer);
      expect(observer?.unobserve).toHaveBeenCalledWith(anchor);
      expect(observer?.observe).toHaveBeenLastCalledWith(anchor);

      reportAnchor(true);
      runFrames();
      expect(markMainTimelineAsRead).toHaveBeenCalledWith(mx, room.roomId, false);
    });
  });

  describe('a thread at its bottom', () => {
    const openThread = { threadId: '$thread', threadEventsLength: 2 };

    it('waits for opening scroll corrections to settle before reading the thread', async () => {
      const area = document.createElement('div');
      mount(optionsWith({ ...openThread, getScrollElement: () => area }));
      runFrames();
      expect(markThreadAsRead).not.toHaveBeenCalled();

      await act(async () => {
        rests.splice(0).forEach((rest) => rest());
        await Promise.resolve();
      });
      runFrames();
      expect(markThreadAsRead).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['its newest replies are not loaded', { threadTailLoaded: false }],
      ['it is still loading', { threadInitialRenderMode: 'loading' as const }],
      ['it has no rows', { threadEventsLength: 0 }],
    ])('is not read while %s', (_why, overrides: Partial<ControllerOptions>) => {
      mount(optionsWith({ ...openThread, ...overrides }));

      reportAnchor(true);
      focusWindow();
      runFrames();
      expect(markThreadAsRead).not.toHaveBeenCalled();
    });

    it.each([
      ['a phone navigation drawer covers', phoneNavDrawerOpenAtom],
      ["a plugin's cover hides", conversationCoveredAtom],
    ])('leaves a reply unread while %s it, then reads it', (_what, atom) => {
      const store = getDefaultStore();
      const rows = [
        { getId: () => '$thread' },
        { getId: () => '$reply-1' },
      ] as unknown as MatrixEvent[];
      const options = optionsWith({ ...openThread, threadEvents: rows });
      act(() => store.set(atom, true));
      try {
        mount(options);
        runFrames();
        const moreRows = [...rows, { getId: () => '$reply-2' } as unknown as MatrixEvent];
        rerender({ ...options, threadEventsLength: 3, threadEvents: moreRows });
        runFrames();
        expect(markThreadAsRead).not.toHaveBeenCalled();

        act(() => store.set(atom, false));
        runFrames();
        expect(markThreadAsRead).toHaveBeenCalledTimes(1);
      } finally {
        act(() => store.set(atom, false));
      }
    });

    it("is read in another conversation view while a side panel hides the room's page, and not while that view does not show", () => {
      const store = getDefaultStore();
      const inView = (options: ControllerOptions) => (
        <ConversationViewContext.Provider value="thread-view">
          <Probe options={options} />
        </ConversationViewContext.Provider>
      );
      act(() => store.set(conversationBehindPanelAtom, true));
      try {
        // Mounted, the view does not show yet: a folded side panel keeps it out of sight.
        act(() => {
          probe = create(inView(optionsWith(openThread)));
        });
        runFrames();
        expect(markThreadAsRead).not.toHaveBeenCalled();
        act(() => probe?.unmount());
        act(() =>
          store.set(shownConversationViewsAtom, [
            { view: 'thread-view', roomId: room.roomId, threadId: '$thread' },
          ])
        );
        act(() => {
          probe = create(inView(optionsWith(openThread)));
        });
        runFrames();
        expect(markThreadAsRead).toHaveBeenCalledTimes(1);

        // A phone's navigation drawer hides it, and a new reply waits until the drawer goes.
        act(() => store.set(phoneNavDrawerOpenAtom, true));
        const rows = [
          { getId: () => '$thread' },
          { getId: () => '$reply-1' },
          { getId: () => '$reply-2' },
        ] as unknown as MatrixEvent[];
        act(() =>
          probe?.update(
            inView(optionsWith({ ...openThread, threadEventsLength: 3, threadEvents: rows }))
          )
        );
        runFrames();
        expect(markThreadAsRead).toHaveBeenCalledTimes(1);
        act(() => store.set(phoneNavDrawerOpenAtom, false));
        runFrames();
        expect(markThreadAsRead).toHaveBeenCalledTimes(2);
        expect(vi.mocked(markThreadAsRead).mock.lastCall?.[5]).toBe(rows);
      } finally {
        act(() => store.set(conversationBehindPanelAtom, false));
        act(() => store.set(phoneNavDrawerOpenAtom, false));
        act(() => store.set(shownConversationViewsAtom, []));
      }
    });

    it('is read on the next frame when it opens there, and again for each new reply', () => {
      const rows = [
        { getId: () => '$thread' },
        { getId: () => '$reply-1' },
      ] as unknown as MatrixEvent[];
      const options = optionsWith({ ...openThread, threadEvents: rows });
      mount(options);
      expect(markThreadAsRead).not.toHaveBeenCalled();

      runFrames();
      expect(markThreadAsRead).toHaveBeenCalledTimes(1);
      // As far as the rows it renders.
      expect(markThreadAsRead).toHaveBeenLastCalledWith(
        mx,
        room.roomId,
        '$thread',
        false,
        undefined,
        rows
      );

      const moreRows = [...rows, { getId: () => '$reply-2' } as unknown as MatrixEvent];
      rerender({ ...options, threadEventsLength: 3, threadEvents: moreRows });
      runFrames();
      expect(markThreadAsRead).toHaveBeenCalledTimes(2);
      expect(markThreadAsRead).toHaveBeenLastCalledWith(
        mx,
        room.roomId,
        '$thread',
        false,
        undefined,
        moreRows
      );
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    });

    it('is not read when the reader left the thread before the frame comes', () => {
      const options = optionsWith(openThread);
      mount(options);
      rerender({ ...options, threadId: '$other-thread' });
      frames.splice(1);

      runFrames();
      expect(markThreadAsRead).not.toHaveBeenCalled();
    });

    it('is not read when the reader scrolled away before the frame comes', () => {
      mount(optionsWith(openThread));
      const away = vi
        .spyOn(anchor, 'getBoundingClientRect')
        .mockReturnValue({ top: 5_000 } as DOMRect);

      runFrames();
      away.mockRestore();
      expect(markThreadAsRead).not.toHaveBeenCalled();
    });

    it('is not read when the view left the live end or unmounted before the frame comes', () => {
      const atLiveEndRef = { current: true };
      mount(optionsWith({ ...openThread, atLiveEndRef }));
      atLiveEndRef.current = false;
      runFrames();
      act(() => probe?.unmount());

      mount(optionsWith(openThread));
      act(() => probe?.unmount());
      probe = undefined;
      runFrames();
      expect(markThreadAsRead).not.toHaveBeenCalled();
    });

    it('is not read when the window loses its focus before the frame comes', () => {
      // A busy machine: the window lost its focus, and the reply finished, before the frame.
      mount(optionsWith(openThread));
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);

      runFrames();
      expect(markThreadAsRead).not.toHaveBeenCalled();
    });

    it('is not read while the window has no focus', () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      mount(optionsWith(openThread));

      reportAnchor(true);
      runFrames();
      expect(markThreadAsRead).not.toHaveBeenCalled();
    });
  });

  describe('coming back to the window', () => {
    const marker = { inLiveTimeline: true, readUptoEventId: '$linked' };

    /**
     * A scroll area 800 px tall holding the read marker's row, which starts `rowTop` px below the
     * area's top; `place` moves it.
     */
    const areaWithMarkerRow = (rowTop: number) => {
      const area = document.createElement('div');
      const row = document.createElement('div');
      row.setAttribute('data-message-id', marker.readUptoEventId);
      area.append(row);
      vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 800 } as DOMRect);
      const place = (top: number) =>
        vi
          .spyOn(row, 'getBoundingClientRect')
          .mockReturnValue({ top, bottom: top + 40 } as DOMRect);
      place(rowTop);
      return { area, place };
    };

    /** Mounts the room with its read marker, focuses the window, and answers its scroll callback. */
    const focusAtMarker = (area: HTMLElement | null = null) => {
      const handleOpenEvent = vi.fn();
      mount(
        optionsWith({
          getScrollElement: () => area,
          handleOpenEvent,
          readUptoEventIdRef: { current: marker.readUptoEventId },
          room: roomWithTimelines,
          unreadInfo: marker,
        })
      );
      focusWindow();
      expect(handleOpenEvent).toHaveBeenCalledWith('$linked', false, expect.any(Function));
      return handleOpenEvent.mock.calls[0]?.[2] as (scrolled: boolean) => void;
    };
    /** Lets the scroll area come to rest once. */
    const scrollRests = () =>
      act(async () => {
        rests.splice(0).forEach((rest) => rest());
      });

    it('goes to a read marker in the live timeline and reads the room when nothing scrolled', () => {
      focusAtMarker()(false);
      runFrames();
      expect(markMainTimelineAsRead).toHaveBeenCalledTimes(1);
    });

    it('reads the room once a jump has reached the read marker with the newest rows in reach', async () => {
      const onScroll = focusAtMarker(areaWithMarkerRow(300).area);

      onScroll(true);
      runFrames();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();

      await scrollRests();
      runFrames();
      expect(markMainTimelineAsRead).toHaveBeenCalledTimes(1);
    });

    it('waits for a jump that has not reached the read marker when the scroll area rests', async () => {
      // A busy machine: the area rests before the jump has moved it.
      const { area, place } = areaWithMarkerRow(-2_000);
      const onScroll = focusAtMarker(area);

      onScroll(true);
      await scrollRests();
      runFrames();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();

      place(300);
      await scrollRests();
      runFrames();
      expect(markMainTimelineAsRead).toHaveBeenCalledTimes(1);
    });

    it('reads nothing when the jump to the read marker leaves the newest rows below the view', async () => {
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ top: 2_000 } as DOMRect);
      const onScroll = focusAtMarker(areaWithMarkerRow(300).area);

      onScroll(true);
      await scrollRests();
      runFrames();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    });

    it('reads the room directly without a read marker in the live timeline', () => {
      const handleOpenEvent = vi.fn();
      mount(optionsWith({ handleOpenEvent }));

      focusWindow();
      runFrames();
      expect(handleOpenEvent).not.toHaveBeenCalled();
      expect(markMainTimelineAsRead).toHaveBeenCalledTimes(1);
    });

    it('reads an open thread at its live end', () => {
      mount(optionsWith({ threadId: '$thread', threadEventsLength: 1 }));
      runFrames();
      vi.mocked(markThreadAsRead).mockClear();

      focusWindow();
      runFrames();
      expect(markThreadAsRead).toHaveBeenCalledTimes(1);
    });

    it('does nothing away from the bottom, or when the window loses focus', () => {
      const handleOpenEvent = vi.fn();
      mount(
        optionsWith({
          atBottom: false,
          atBottomRef: { current: false },
          handleOpenEvent,
          unreadInfo: marker,
        })
      );

      focusWindow();
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      runFrames();
      expect(handleOpenEvent).not.toHaveBeenCalled();
      expect(markMainTimelineAsRead).not.toHaveBeenCalled();
    });
  });

  describe('Mark as Read', () => {
    it('reads the open thread at once', () => {
      mount(optionsWith({ hideActivity: true, threadId: '$thread', threadTailLoaded: false }));

      act(() => markAsRead?.());
      expect(markThreadAsRead).toHaveBeenCalledWith(mx, room.roomId, '$thread', true);
      expect(markRoomAndThreadsAsRead).not.toHaveBeenCalled();
    });

    it('reads the room and every thread at once, keeping its identity while its inputs stay', () => {
      const options = optionsWith({ hideActivity: true });
      mount(options);
      const first = markAsRead;

      act(() => markAsRead?.());
      expect(markRoomAndThreadsAsRead).toHaveBeenCalledWith(mx, room.roomId, true);
      expect(markThreadAsRead).not.toHaveBeenCalled();

      rerender({ ...options, atBottom: false, threadEventsLength: 4 });
      expect(markAsRead).toBe(first);
      rerender({ ...options, hideActivity: false });
      expect(markAsRead).not.toBe(first);
    });
  });
});
