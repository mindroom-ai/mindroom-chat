import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OWN_INPUT_WINDOW_MS, useFollowLateGrowth } from './useFollowLateGrowth';

type Listener = () => void;

/** A scroll area 400 px tall over 1000 px of rows, read at the bottom unless moved. */
const createScrollArea = () => {
  const listeners = new Map<string, Set<Listener>>();
  const area = {
    scrollHeight: 1000,
    clientHeight: 400,
    scrollTop: 600,
    addEventListener: (type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    },
    scrollTo: vi.fn(({ top }: { top: number }) => {
      area.scrollTop = top;
      area.fire('scroll');
    }),
    fire: (type: string) => listeners.get(type)?.forEach((listener) => listener()),
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
  return area;
};

describe('useFollowLateGrowth', () => {
  let resize: Listener | undefined;
  let renderer: ReactTestRenderer | undefined;
  let area: ReturnType<typeof createScrollArea>;
  const content = { offsetHeight: 1000 };
  const atLiveEndRef = { current: true };
  let now: number;

  /** The rows grow by `px`, as a link preview that loaded does. */
  const grow = (px: number) => {
    content.offsetHeight += px;
    area.scrollHeight += px;
    act(() => resize?.());
  };

  beforeEach(() => {
    now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: Listener) {
          resize = callback;
        }

        observe = vi.fn();

        disconnect = vi.fn();
      }
    );
    area = createScrollArea();
    content.offsetHeight = 1000;
    atLiveEndRef.current = true;
    const contentRef = { current: content as unknown as HTMLElement };
    function Harness() {
      useFollowLateGrowth(area as unknown as HTMLElement, contentRef, atLiveEndRef);
      return null;
    }
    act(() => {
      renderer = create(<Harness />);
    });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps a reader at the bottom there when a row grows after it rendered', () => {
    area.fire('scroll');
    grow(120);

    expect(area.scrollTo).toHaveBeenCalledWith({ top: 720, behavior: 'instant' });
    expect(area.scrollTop).toBe(720);
  });

  it('leaves a reader up in the history where they are', () => {
    area.scrollTop = 200;
    area.fire('scroll');
    grow(120);

    expect(area.scrollTo).not.toHaveBeenCalled();
  });

  it('lets a row the reader just expanded unfold in place', () => {
    area.fire('scroll');
    area.fire('pointerdown');
    now += OWN_INPUT_WINDOW_MS - 1;
    grow(300);
    expect(area.scrollTo).not.toHaveBeenCalled();

    now += OWN_INPUT_WINDOW_MS;
    grow(120);
    expect(area.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('does not follow before the first scroll, while the timeline opens', () => {
    grow(120);

    expect(area.scrollTo).not.toHaveBeenCalled();
  });

  it('does not follow at the bottom of older history', () => {
    area.fire('scroll');
    atLiveEndRef.current = false;
    grow(120);

    expect(area.scrollTo).not.toHaveBeenCalled();
  });

  it('writes nothing when the bottom stayed in view, as rows that land above the reader leave it', () => {
    area.fire('scroll');
    content.offsetHeight += 120;
    area.scrollHeight += 120;
    area.scrollTop += 120;
    act(() => resize?.());

    expect(area.scrollTo).not.toHaveBeenCalled();
  });

  it('ignores rows that shrink', () => {
    area.fire('scroll');
    grow(-120);

    expect(area.scrollTo).not.toHaveBeenCalled();
  });

  it('stops listening when it unmounts', () => {
    expect(area.listenerCount()).toBe(5);
    act(() => renderer?.unmount());
    renderer = undefined;

    expect(area.listenerCount()).toBe(0);
  });
});
