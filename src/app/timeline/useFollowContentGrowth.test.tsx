import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveReplyStore } from '../messages/live/liveReplyStore';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';
import { useFollowContentGrowth } from './useFollowContentGrowth';

type ResizeCallback = (entries: ResizeObserverEntry[]) => void;

const ROOM = '!room:example';

const createScroller = () => {
  const listeners = new Map<string, Set<() => void>>();
  const listenersOf = (type: string) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    return listeners.get(type) as Set<() => void>;
  };
  const scroller = {
    scrollHeight: 1000,
    clientHeight: 400,
    offsetHeight: 400,
    scrollTop: 600,
    addEventListener: (type: string, listener: () => void) => listenersOf(type).add(listener),
    removeEventListener: (type: string, listener: () => void) =>
      listenersOf(type).delete(listener),
    scrollTo: vi.fn(({ top }: { top: number }) => {
      scroller.scrollTop = top;
      scroller.scroll();
    }),
    dispatch: (type: string) => listenersOf(type).forEach((listener) => listener()),
    scroll: () => scroller.dispatch('scroll'),
  };
  return scroller;
};

describe('useFollowContentGrowth', () => {
  let resize: ResizeCallback | undefined;
  let renderer: ReactTestRenderer | undefined;
  const content = {} as HTMLElement;
  let scroller: ReturnType<typeof createScroller>;
  let liveReplies: LiveReplyStore;
  let seq: number;
  const atLiveEndRef = { current: true };
  let pendingShrink = 0;

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeCallback) {
          resize = callback;
        }

        observe = vi.fn();

        disconnect = vi.fn();
      }
    );
    scroller = createScroller();
    liveReplies = new LiveReplyStore();
    seq = 0;
    pendingShrink = 0;
    atLiveEndRef.current = true;
    const getScrollElement = () => scroller as unknown as HTMLElement;
    // The timeline's live reading of its viewport bottom.
    const isViewportAtBottomNow = () => isScrollNearBottom(scroller);
    const contentRef = { current: content };
    function Harness() {
      useFollowContentGrowth(
        getScrollElement,
        contentRef,
        isViewportAtBottomNow,
        atLiveEndRef,
        liveReplies,
        ROOM,
        () => pendingShrink
      );
      return null;
    }
    act(() => {
      renderer = create(<Harness />);
    });
    act(() => resize?.([{ target: content, contentRect: { height: 1000 } } as never]));
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    liveReplies.clear();
    vi.unstubAllGlobals();
  });

  const applyFrame = (roomId = ROOM) => {
    liveReplies.ingest(
      roomId,
      '@agent:example',
      {
        reply: '$reply',
        sid: '1761858000123-0a1b2c3d',
        seq,
        snapshot: {
          md: 'x'.repeat(seq + 1),
          reasoning: '',
          tools: [],
          status: 'streaming',
          activity: '',
        },
      },
      Date.now()
    );
    seq += 1;
  };

  const grow = (px: number, { correction = 0, frame = true } = {}) => {
    if (frame) applyFrame();
    scroller.scrollHeight += px;
    scroller.scrollTop += correction;
    act(() =>
      resize?.([{ target: content, contentRect: { height: scroller.scrollHeight } } as never])
    );
  };

  it('keeps a reader who was at the bottom there while the content grows', () => {
    grow(120);

    expect(scroller.scrollTop).toBe(720);

    grow(80);

    expect(scroller.scrollTop).toBe(800);
  });

  it('keeps following a reply whose rows reach the list in a later pass than its frames', () => {
    // Under load the list renders a reply's rows a pass late: the pass that follows the last
    // frames' growth comes after the finishing edit, whose own growth then lands in a pass with
    // no frame since the one before.
    grow(34);
    grow(35, { frame: false });

    expect(scroller.scrollTop).toBe(669);
  });

  it('leaves a block the reader expands in place once the reply stopped streaming', () => {
    grow(34);
    scroller.dispatch('pointerdown');
    grow(200, { frame: false });

    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(634);
  });

  it('keeps following when the scroll a shrinking composer causes is reported after the content grew', () => {
    applyFrame();
    // The list grows by a finished reply while the composer's typing line goes: the browser
    // clamps the position up by the line's height, and reports that scroll after the growth.
    scroller.scrollHeight += 150;
    scroller.scrollTop -= 36;
    scroller.scroll();
    act(() =>
      resize?.([{ target: content, contentRect: { height: scroller.scrollHeight } } as never])
    );

    expect(scroller.scrollTop).toBe(750);
  });

  it('follows to where the list will end when a row shrank in the same frame', () => {
    // The finished reply grew the list, and its Stop button went in the same frame: the list
    // still holds those 62 px until React renders it.
    pendingShrink = 62;
    grow(150);

    expect(scroller.scrollTop).toBe(688);
  });

  it('leaves a reader who scrolled up where they are', () => {
    scroller.scrollTop = 500;
    scroller.scroll();

    grow(120);

    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(500);
  });

  it('leaves a reader near the bottom whom a measurement correction moves with the growth', () => {
    scroller.scrollTop = 500;
    scroller.scroll();

    grow(300, { correction: 300 });

    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it('leaves a reader at the bottom where they are when content grows without a live frame', () => {
    grow(300, { frame: false });

    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(600);
  });

  it('leaves a reader at the bottom of older history where they are while newer events load', () => {
    atLiveEndRef.current = false;

    grow(300);

    expect(scroller.scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(600);
  });

  it('does not follow growth after a live frame in another room', () => {
    applyFrame('!other:example');
    grow(300, { frame: false });

    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });
});
